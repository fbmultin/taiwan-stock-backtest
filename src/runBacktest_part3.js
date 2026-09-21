      const missingList = [];
      const requiredEndDateStr = globalCalcEndDate.toISOString().split('T')[0];
      const activeCheckList = finalStockList.filter((s) => !s.isExcluded);

      activeCheckList.forEach((stock) => {
        const hasEndData = stock.data.find(
          (d) => d.date === requiredEndDateStr
        );
        if (!hasEndData) {
          const lastData = stock.data[stock.data.length - 1];
          const lastDateTs = new Date(lastData.date).getTime();
          const reqEndTs = globalCalcEndDate.getTime();
          const diffDays = (reqEndTs - lastDateTs) / (1000 * 60 * 60 * 24);

          if (diffDays > 0) {
            missingList.push({
              symbol: stock.symbol,
              stockName: stock.stockName,
              date: requiredEndDateStr,
              type: 'end',
            });
          }
        }
      });

      if (missingList.length > 0) {
        setMissingDataList(missingList);
        setLoading(false);
        finishLoading();
        return;
      }

      setLoadingStage('正在計算績效與配息周期...');
      setLoadingStagePhase('compute');
      setProgress(96);

      const periods = [3, 6, 12, 36, 60];
      const stats = periods.map((m) =>
        calculatePeriodStats(successfulData, m, finalAllocations, totalCapital)
      );
      setPeriodStats(stats);

      const finalResults = finalStockList
        .map((stock) => {
          if (stock.isExcluded) {
            return {
              symbol: stock.symbol,
              stockName: stock.stockName,
              isExcluded: true,
              exclusionReason: stock.exclusionReason,
              inputIndex: stock.inputIndex,
              weight: finalAllocations[stock.inputIndex] || 0,
            };
          }

          let effectiveStartDate = maxMinDate;
          let effectiveEndDate = globalCalcEndDate;
          let snapToExDiv = independentCycleMode && !strictTimeMode;
          let dividendDetails = [];

          let startIndex = stock.data.findIndex(
            (d) => new Date(d.date) >= effectiveStartDate
          );

          if (startIndex === -1) {
            if (new Date(stock.data[0].date) > effectiveStartDate)
              startIndex = 0;
            else return null;
          }

          let rawData = stock.data.slice(startIndex);
          let endIndex = rawData.findIndex(
            (d) => new Date(d.date) > effectiveEndDate
          );
          if (endIndex !== -1) {
            rawData = rawData.slice(0, endIndex);
          }

          const filteredData = rawData;
          if (filteredData.length < 1) return null;

          const startData = filteredData[0];
          const endData = filteredData[filteredData.length - 1];

          const today = new Date();
          const fiveYearsAgo = new Date(
            today.getFullYear() - 5,
            today.getMonth(),
            today.getDate()
          );
          const firstDataDate = new Date(stock.data[0].date);
          const isYoungStock = stock.firstDataDate > fiveYearsAgo;
          const isShortHistory =
            firstDataDate > new Date(rangeStart.getTime() + 86400000 * 5);

          const initialPrice = startData.price;
          const finalPrice = endData.price;

          const periodStartTs = new Date(startData.date).getTime();
          const periodEndTs = effectiveEndDate.getTime();
          const rawPeriodEndTs = rangeEnd.getTime();
          const validDivTimestamps = stock.divDates
            .filter((ts) => ts >= periodStartTs && ts <= periodEndTs)
            .sort((a, b) => a - b);

          let periodDividends = 0;
          validDivTimestamps.forEach((ts) => {
            const keySec = Math.floor(ts / 1000);
            const divInfo =
              stock.dividendsMap[keySec.toString()] ||
              stock.dividendsMap[keySec] ||
              stock.dividendsMap[ts];
            if (divInfo) periodDividends += divInfo.amount;
          });
          if (periodDividends < 0) periodDividends = 0;

          const totalReturnVal = finalPrice - initialPrice + periodDividends;
          const totalReturnPct = (totalReturnVal / initialPrice) * 100;
          const priceReturnPct =
            ((finalPrice - initialPrice) / initialPrice) * 100;
          const dividendYield = (periodDividends / initialPrice) * 100;

          let annualizedDividendYield = 0;
          if (validDivTimestamps.length >= 2) {
            const firstDiv = validDivTimestamps[0];
            const lastDiv = validDivTimestamps[validDivTimestamps.length - 1];
            const spanDays = (lastDiv - firstDiv) / (1000 * 60 * 60 * 24);
            if (spanDays > 0) {
              const avgInterval = spanDays / (validDivTimestamps.length - 1);
              const estFreq = 365 / avgInterval;
              const avgDivAmount = periodDividends / validDivTimestamps.length;
              const estAnnualDiv = avgDivAmount * estFreq;
              annualizedDividendYield = (estAnnualDiv / initialPrice) * 100;
            }
          } else {
            const daysHeld =
              (effectiveEndDate - new Date(startData.date)) /
              (1000 * 60 * 60 * 24);
            annualizedDividendYield =
              daysHeld > 0 ? (dividendYield / daysHeld) * 365 : 0;
          }

          const trendData = filteredData.map((d) => ({
            date: d.date,
            returnPct:
              ((d.price -
                initialPrice +
                (d.accumulatedDividend - startData.accumulatedDividend)) /
                initialPrice) *
              100,
          }));

          const dividendCount = validDivTimestamps.length;
          let fillCount = 0;
          let lastDivDate = null;
          let lastDivAmount = null;
          let lastPreDivPrice = null;
          let recentExDivClosePrice = null;

          if (dividendCount > 0) {
            const lastTs = validDivTimestamps[validDivTimestamps.length - 1];
            lastDivDate = new Date(lastTs).toISOString().split('T')[0];
            const keySec = Math.floor(lastTs / 1000);
            const divInfo =
              stock.dividendsMap[keySec.toString()] ||
              stock.dividendsMap[keySec] ||
              stock.dividendsMap[lastTs];
            lastDivAmount = divInfo?.amount;

            const divDateIndex = stock.data.findIndex(
              (d) => d.date === lastDivDate
            );
            if (divDateIndex !== -1) {
              recentExDivClosePrice = stock.data[divDateIndex].price;
              if (divDateIndex > 0) {
                lastPreDivPrice = stock.data[divDateIndex - 1].price;
              }
            }
          }

          const allDivsInRange = stock.divDates
            .filter((ts) => ts >= periodStartTs && ts <= rawPeriodEndTs)
            .sort((a, b) => a - b);

          allDivsInRange.forEach((divTs) => {
            const divDateStr = new Date(divTs).toISOString().split('T')[0];
            const rawIndex = stock.data.findIndex((d) => d.date === divDateStr);
            let isFilled = false;
            let prePrice = null;
            let currentDivAmount = 0;
            const isExcludedDiv = !strictTimeMode && divTs > periodEndTs;
            const keySec = Math.floor(divTs / 1000);
            const divInfo =
              stock.dividendsMap[keySec.toString()] ||
              stock.dividendsMap[keySec] ||
              stock.dividendsMap[divTs];
            currentDivAmount = divInfo?.amount || 0;

            if (rawIndex > 0) {
              prePrice = stock.data[rawIndex - 1].price;
              if (!isExcludedDiv) {
                const checkData = filteredData.slice(
                  filteredData.findIndex((d) => d.date === divDateStr)
                );
                isFilled = checkData.some((d) => d.price >= prePrice);
                if (isFilled) fillCount++;
              }
            }

            const exDivPrice =
              rawIndex !== -1 ? stock.data[rawIndex].price : null;
            const costYieldPct =
              initialPrice > 0 ? (currentDivAmount / initialPrice) * 100 : null;
            const exDivYieldPct =
              prePrice && prePrice > 0
                ? (currentDivAmount / prePrice) * 100
                : null;
            dividendDetails.push({
              date: divDateStr,
              prePrice: prePrice,
              exDivPrice: exDivPrice,
              amount: currentDivAmount,
              isFilled: isFilled,
              isExcludedDiv,
              costYieldPct,
              exDivYieldPct,
            });
          });

          let isDataLagging = false;
          let actualEndDateStr = '';
          if (endData) {
            const endDateTs = new Date(endData.date).getTime();
            const targetEndTs = effectiveEndDate.getTime();
            const diffTime = targetEndTs - endDateTs;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            if (diffDays > 3) {
              isDataLagging = true;
              actualEndDateStr = endData.date;
            }
          }

          const weight = finalAllocations[stock.inputIndex] || 0;

          return {
            symbol: stock.symbol,
            stockName: stock.stockName,
            inputIndex: stock.inputIndex,
            startDate: startData.date,
            endDate: effectiveEndDate.toISOString().split('T')[0],
            initialPrice,
            finalPrice,
            totalDividends: periodDividends,
            dividendCount,
            fillCount,
            lastDivDate,
            lastDivAmount,
            lastPreDivPrice,
            recentExDivClosePrice,
            totalReturnPct,
            priceReturnPct,
            dividendYield,
            annualizedDividendYield,
            trendData,
            dataPoints: filteredData.length,
            riskProfile: calculateRiskProfile(
              filteredData.map((d) => d.price),
              printMode
            ),
            ...(calcBeta
              ? { beta: calculateBeta(filteredData, benchmarkReturnsByDate) }
              : {}),
            frequencyLabel: getFrequencyLabel(stock.divDates),
            weight,
            divDates: stock.divDates,
            isShortHistory,
            isYoungStock,
            actualInceptionDate: stock.data[0].date,
            snapToExDiv,
            dividendDetails: dividendDetails.reverse(),
            isDataLagging,
            actualEndDateStr,
            splitEvents: (stock.splitEvents || []).filter(
              (ev) =>
                ev.date >= startData.date &&
                ev.date <= effectiveEndDate.toISOString().split('T')[0]
            ),
            usedCache: !!stock.fromCache,
            cachedAt: stock.cachedAt || null,
            dividendDataIncomplete: !!stock.dividendDataIncomplete,
          };
        })
        .filter((r) => r !== null);

      const resultsWithValues = finalResults.map((r) => {
        const allocated = totalCapital * (r.weight / 100);
        const shares = allocated / r.initialPrice;
        const finalMarketValue = shares * r.finalPrice;
        const finalStockDividends = shares * r.totalDividends;
        return {
          ...r,
          allocatedCapital: allocated,
          finalMarketValue,
          finalStockDividends,
          finalTotalValue: finalMarketValue + finalStockDividends,
        };
      });

      setResults(resultsWithValues);
      finishLoading();
      setProgress(100);
      setTimeout(() => setLoading(false), 500);
    } catch (err) {
      setErrorMsg('發生錯誤');
      console.error(err);
      setLoading(false);
      finishLoading();
    }
  };

  const handleManualInputConfirm = (newInputs) => {
    const updatedData = { ...manualPriceData, ...newInputs };
    setManualPriceData(updatedData);
    setMissingDataList([]);
    runBacktest(updatedData);
  };

  const handleManualInputCancel = () => {
    setMissingDataList([]);
    setLoading(false);
  };

  const handleResolveSituations = (choices) => {
    const args = pendingRunArgsRef.current || {};
    setPendingSituations(null);
    runBacktest(args.overrideManualData, args.dateOverride, choices);
  };

  const handleCancelSituations = () => {
    pendingRunArgsRef.current = { overrideManualData: null, dateOverride: null };
    setPendingSituations(null);
    setLoading(false);
  };

  const chartData = useMemo(() => {
    if (!results || results.length === 0) return [];
    const validResults = results.filter((r) => !r.isExcluded);
    const dateMap = {};

    validResults.forEach((stock) => {
      stock.trendData.forEach((point) => {
        if (!dateMap[point.date]) dateMap[point.date] = { date: point.date };
        dateMap[point.date][stock.symbol] = point.returnPct;
      });
    });

    const sortedData = Object.values(dateMap).sort(
      (a, b) => new Date(a.date) - new Date(b.date)
    );

    sortedData.forEach((dayData) => {
      let weightedSum = 0;
      let activeWeight = 0;

      validResults.forEach((stock) => {
        if (dayData[stock.symbol] !== undefined) {
          weightedSum += dayData[stock.symbol] * stock.weight;
          activeWeight += stock.weight;
        }
      });

      dayData['綜合績效'] = activeWeight > 0 ? weightedSum / activeWeight : 0;
    });

    return sortedData;
  }, [results]);

  const portfolioSummary = useMemo(() => {
    if (!results) return null;
    let totalInvested = 0;
    let grandTotalValue = 0;
    let grandTotalDividends = 0;
    let grandTotalMarketValue = 0;

    const details = results.map((r) => {
      if (r.isExcluded) {
        return {
          ...r,
          allocatedCapital: 0,
          finalMarketValue: 0,
          finalStockDividends: 0,
          totalReturnPct: 0,
        };
      }

      totalInvested += r.allocatedCapital;
      grandTotalValue += r.finalTotalValue;
      grandTotalDividends += r.finalStockDividends;
      grandTotalMarketValue += r.finalMarketValue;

      return r;
    });

    const grandTotalRoi =
      totalInvested > 0
        ? ((grandTotalValue - totalInvested) / totalInvested) * 100
        : 0;

    return {
      details,
      totalWeight: 100,
      totalInvested,
      grandTotalMarketValue,
      grandTotalDividends,
      grandTotalValue,
      grandTotalRoi,
    };
  }, [results, totalCapital, fairMode]);

  const shiftCustomRange = (amount, unit = 'month') => {
    const startBase = customStart
      ? new Date(customStart)
      : (() => {
          const d = new Date();
          d.setFullYear(d.getFullYear() - 1);
          return d;
        })();
    const shifted = new Date(
      shiftDateStr(startBase.toISOString().split('T')[0], amount, unit)
    );
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const clamped = shifted.getTime() > yesterday.getTime() ? yesterday : shifted;
    setCustomStart(clamped.toISOString().split('T')[0]);
    setCustomEnd(new Date().toISOString().split('T')[0]);
    setTimeRange('custom');
  };
