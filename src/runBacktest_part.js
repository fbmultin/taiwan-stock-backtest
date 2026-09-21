  const runBacktest = async (
    overrideManualData = null,
    dateOverride = null,
    situationResolutions = null
  ) => {
    setLoading(true);
    setResults(null);
    setPeriodStats(null);
    setErrorMsg('');
    setDebugInfo('');
    setCycleInfoText('');
    setComparisonInfo(null);
    setFailedTickers([]);
    setMissingDataList([]);
    setPendingSituations(null);
    setDateAdjustmentNote(null);
    setIsConfigExpanded(false);
    setProgress(0);
    setLoadingStage('準備回測參數...');
    setLoadingStagePhase('params');
    setFetchStatusList([]);
    setSkipAvailable(false);
    setSkipTriggered(false);
    setSkippedAtPhase('');

    const SKIP_MARKER = Symbol('skip');
    let skipResolve;
    const skipPromise = new Promise((resolve) => {
      skipResolve = resolve;
    });
    skipResolverRef.current = () => {
      setSkippedAtPhase(loadingStagePhaseRef.current);
      setSkipTriggered(true);
      setSkipAvailable(false);
      skipResolve(SKIP_MARKER);
    };
    if (skipTimerRef.current) clearTimeout(skipTimerRef.current);
    skipTimerRef.current = setTimeout(() => setSkipAvailable(true), 6000);

    const raceWithSkip = (promise) =>
      Promise.race([promise, skipPromise]).then((res) => ({
        value: res === SKIP_MARKER ? null : res,
        wasSkipped: res === SKIP_MARKER,
      }));

    const finishLoading = () => {
      if (skipTimerRef.current) {
        clearTimeout(skipTimerRef.current);
        skipTimerRef.current = null;
      }
      setSkipAvailable(false);
      setLoadingStage('');
      setLoadingStagePhase('');
    };

    let rangeStart, rangeEnd;

    if (dateOverride && dateOverride.start && dateOverride.end) {
      const d1 = new Date(dateOverride.start);
      const d2 = new Date(dateOverride.end);
      if (d1 > d2) {
        rangeStart = d2;
        rangeEnd = d1;
      } else {
        rangeStart = d1;
        rangeEnd = d2;
      }
    } else if (timeRange === 'custom') {
      if (!customStart || !customEnd) {
        setErrorMsg('請選擇起始與結束日期');
        setLoading(false);
        finishLoading();
        return;
      }
      const d1 = new Date(customStart);
      const d2 = new Date(customEnd);
      if (d1 > d2) {
        rangeStart = d2;
        rangeEnd = d1;
      } else {
        rangeStart = d1;
        rangeEnd = d2;
      }
    } else {
      rangeEnd = getLastCompletedTradingDay();
      rangeStart = new Date(rangeEnd);
      if (timeRange === 'ytd') {
        rangeStart = new Date(rangeStart.getFullYear(), 0, 1);
      } else {
        const months =
          timeRange === '3m'
            ? 3
            : timeRange === '6m'
            ? 6
            : timeRange === '12m'
            ? 12
            : timeRange === '3y'
            ? 36
            : timeRange === '5y'
            ? 60
            : 12;
        rangeStart.setMonth(rangeStart.getMonth() - months);
      }
    }

    const rawRequestedStart = new Date(rangeStart);
    const rawRequestedEnd = new Date(rangeEnd);

    const lastCompletedTradingDay = getLastCompletedTradingDay();
    if (rangeEnd > lastCompletedTradingDay) {
      rangeEnd = new Date(lastCompletedTradingDay);
    }
    while (isNonTradingDay(rangeEnd)) {
      rangeEnd.setDate(rangeEnd.getDate() - 1);
    }
    while (isNonTradingDay(rangeStart)) {
      rangeStart.setDate(rangeStart.getDate() + 1);
    }
    setRequestedStartDate(rangeStart);

    const adjustedStartStr = rangeStart.toISOString().split('T')[0];
    const adjustedEndStr = rangeEnd.toISOString().split('T')[0];
    const rawStartStr = rawRequestedStart.toISOString().split('T')[0];
    const rawEndStr = rawRequestedEnd.toISOString().split('T')[0];
    const startShifted = rawStartStr !== adjustedStartStr;
    const endShifted = rawEndStr !== adjustedEndStr;
    if (startShifted || endShifted) {
      setDateAdjustmentNote({
        originalStart: rawStartStr,
        adjustedStart: adjustedStartStr,
        originalEnd: rawEndStr,
        adjustedEnd: adjustedEndStr,
        startShifted,
        endShifted,
      });
    }

    const activeStocks = inputs
      .map((s, idx) => ({ s, idx }))
      .filter((item) => item.s !== '' && enabledInputs[item.idx]);
    if (activeStocks.length === 0) {
      setLoading(false);
      finishLoading();
      return;
    }

    setFetchStatusList(
      activeStocks.map((item) => ({ symbol: item.s, status: 'pending' }))
    );
    const updateFetchStatus = (symbol, status) => {
      setFetchStatusList((prev) =>
        prev.map((f) => (f.symbol === symbol ? { ...f, status } : f))
      );
    };

    try {
      let fetchedCount = 0;
      const totalStocks = activeStocks.length;
      setLoadingStage(`正在抓取股價與配息資料 (0/${totalStocks})...`);
      setLoadingStagePhase('price');
      setProgress(5);
      const promises = activeStocks.map((item) =>
        raceWithSkip(fetchStockPriceData(item.s)).then(
          ({ value, wasSkipped }) => {
            fetchedCount++;
            updateFetchStatus(
              item.s,
              wasSkipped
                ? 'skipped'
                : value && value.fromCache
                ? 'cached'
                : value && value.data.length > 0
                ? 'done'
                : 'failed'
            );
            setProgress(5 + (fetchedCount / totalStocks) * 55);
            setLoadingStage(
              `正在抓取股價與配息資料 (${fetchedCount}/${totalStocks})...`
            );
            return value;
          }
        )
      );
      const benchmarkPromise = calcBeta
        ? fetchIndexPriceData('^TWII')
        : Promise.resolve(null);
      const [rawResults, benchmarkResult] = await Promise.all([
        Promise.all(promises),
        benchmarkPromise,
      ]);
      const benchmarkReturnsByDate = buildDailyReturnsByDate(
        benchmarkResult?.data
      );

      const failures = [];
      activeStocks.forEach((item, idx) => {
        if (!rawResults[idx] || rawResults[idx].data.length === 0) {
          failures.push(item.s);
        }
      });
      if (failures.length > 0) {
        setFailedTickers(failures);
      }

      const successfulData = rawResults
        .map((r, i) => (r ? { ...r, inputIndex: activeStocks[i].idx } : null))
        .filter((r) => r && r.data.length > 0);

      if (successfulData.length === 0) {
        setErrorMsg('無法抓取任何有效數據，請檢查代碼或網路。');
        setLoading(false);
        finishLoading();
        return;
      }

      successfulData.forEach((stock) => {
        stock.splitEvents = applySplitAdjustments(stock);
      });

      setLoadingStage('正在查詢股票名稱...');
      setLoadingStagePhase('name');
      setProgress(65);
      setFetchStatusList(
        successfulData.map((stock) => ({
          symbol: stock.symbol,
          status: stockNames[stock.symbol] ? 'done' : 'pending',
        }))
      );
      await Promise.all(
        successfulData.map(async (stock) => {
          try {
            if (stockNames[stock.symbol]) {
              stock.stockName = stockNames[stock.symbol];
            } else {
              const { value: name, wasSkipped } = await raceWithSkip(
                fetchStockDisplayName(stock.symbol)
              );
              stock.stockName = name || '';
              updateFetchStatus(stock.symbol, wasSkipped ? 'skipped' : 'done');
            }
          } catch (e) {
            stock.stockName = '';
            updateFetchStatus(stock.symbol, 'failed');
          }
        })
      );

      const newNamesMap = {};
      successfulData.forEach((s) => {
        if (s.stockName) newNamesMap[s.symbol] = s.stockName;
      });
      setStockNames((prev) => ({ ...prev, ...newNamesMap }));
      setProgress(78);

      setProgress(90);

      const currentManualData = overrideManualData || manualPriceData;
      successfulData.forEach((stock) => {
        Object.keys(currentManualData).forEach((key) => {
          if (key.startsWith(stock.symbol + '_')) {
            const dateStr = key.split('_')[1];
            const price = parseFloat(currentManualData[key]);
            const existingIdx = stock.data.findIndex((d) => d.date === dateStr);
            if (existingIdx !== -1) {
              stock.data[existingIdx].price = price;
            } else {
              const targetTs = new Date(dateStr).getTime();
              let insertPos = 0;
              while (
                insertPos < stock.data.length &&
                stock.data[insertPos].timestamp < targetTs
              ) {
                insertPos++;
              }
              let prevAccDiv = 0;
              if (insertPos > 0)
                prevAccDiv = stock.data[insertPos - 1].accumulatedDividend;

              const newPoint = {
                date: dateStr,
                timestamp: targetTs,
                price: price,
                accumulatedDividend: prevAccDiv,
              };
              stock.data.splice(insertPos, 0, newPoint);
            }
          }
        });
      });

      const finalAllocations = allocations;

      const analyzedStocks = successfulData.map((stock) => {
        const firstDataDate = new Date(stock.data[0].date);
        const daysHistory = (rangeEnd - firstDataDate) / (1000 * 60 * 60 * 24);
        const isMonthly = checkIsMonthly(stock.divDates);
        return {
          ...stock,
          daysHistory,
          isMonthly,
          firstDataDate,
        };
      });
