      let maxMinDate = rangeStart;
      let finalStockList = [];
      let commonCycles = 12;

      let globalLatestDivDate = null;
      let globalCalcEndDate = rangeEnd;
      if (successfulData && successfulData.length > 0) {
        const lastDatesPerStock = successfulData
          .filter((s) => s.data && s.data.length > 0)
          .map((s) => new Date(s.data[s.data.length - 1].date));
        if (lastDatesPerStock.length > 0) {
          const earliestLastDate = new Date(
            Math.min(...lastDatesPerStock.map((d) => d.getTime()))
          );
          if (earliestLastDate < rangeEnd) {
            globalCalcEndDate = earliestLastDate;
          }
        }
      }
      let endDateLimiter = null;

      const situations = [];

      if (!strictTimeMode) {
        let maxDivTs = 0;
        let candidateEndLimiter = null;
        analyzedStocks.forEach((s) => {
          const divsInRange = s.divDates.filter(
            (ts) => ts <= rangeEnd.getTime()
          );
          if (divsInRange.length > 0) {
            const lastDiv = divsInRange[divsInRange.length - 1];
            const daysDiff =
              (rangeEnd.getTime() - lastDiv) / (1000 * 60 * 60 * 24);
            if (daysDiff <= 7 && lastDiv > maxDivTs) {
              maxDivTs = lastDiv;
              candidateEndLimiter = s.symbol;
            }
          }
        });

        if (maxDivTs > 0) {
          const pulledBackDate = new Date(maxDivTs);
          pulledBackDate.setDate(pulledBackDate.getDate() - 1);
          const applyPullback = () => {
            globalLatestDivDate = new Date(maxDivTs);
            globalCalcEndDate = pulledBackDate;
            endDateLimiter = candidateEndLimiter;
          };

          if (independentCycleMode) {
            applyPullback();
          } else if (situationResolutions?.endDateNearDividend) {
            if (situationResolutions.endDateNearDividend === 'pullback') {
              applyPullback();
            }
          } else {
            situations.push({
              key: 'endDateNearDividend',
              title: `${candidateEndLimiter} 的除息日太靠近您指定的結束日`,
              description: `${candidateEndLimiter} 的除息日為 ${
                new Date(maxDivTs).toISOString().split('T')[0]
              },距離您指定的結束日 ${
                rangeEnd.toISOString().split('T')[0]
              } 只差 ${Math.round(
                (rangeEnd.getTime() - maxDivTs) / (1000 * 60 * 60 * 24)
              )} 天。除息當天股價會出現除權息缺口,可能影響報酬率比較的公平性,要怎麼處理?`,
              options: [
                {
                  value: 'pullback',
                  label: `結束日往前調整到 ${
                    pulledBackDate.toISOString().split('T')[0]
                  }(除息日前一天)`,
                  recommended: true,
                },
                {
                  value: 'keep',
                  label: `仍使用您指定的結束日 ${
                    rangeEnd.toISOString().split('T')[0]
                  }`,
                },
              ],
            });
          }
        }
      }

      let limitingStockSymbol = null;

      if (independentCycleMode && !strictTimeMode) {
        const minDaysThreshold = 180;
        const validCandidates = analyzedStocks.filter(
          (s) => s.daysHistory >= minDaysThreshold
        );
        const tooNewStocks = analyzedStocks
          .filter((s) => s.daysHistory < minDaysThreshold)
          .map((s) => ({
            ...s,
            isExcluded: true,
            exclusionReason: '排除: 上市未滿180日',
          }));

        const finalCandidates = [];
        const midTermExcluded = [];

        validCandidates.forEach((s) => {
          if (s.daysHistory < 390) {
            if (s.isMonthly) {
              finalCandidates.push(s);
            } else {
              midTermExcluded.push({
                ...s,
                isExcluded: true,
                exclusionReason: '排除: 上市未滿390日且非月配',
              });
            }
          } else {
            finalCandidates.push(s);
          }
        });

        const allExcluded = [...tooNewStocks, ...midTermExcluded];

        let benchmarkStock = null;
        const intermediateStocks = finalCandidates.filter(
          (s) => s.daysHistory < 390
        );

        if (intermediateStocks.length > 0) {
          benchmarkStock = intermediateStocks.reduce((prev, curr) =>
            prev.daysHistory < curr.daysHistory ? prev : curr
          );
          limitingStockSymbol = benchmarkStock.symbol;
        } else if (finalCandidates.length > 0) {
          const monthlyOlds = finalCandidates.filter((s) => s.isMonthly);
          if (monthlyOlds.length > 0) benchmarkStock = monthlyOlds[0];
          else benchmarkStock = finalCandidates[0];
        }

        if (benchmarkStock) {
          const benchmarkDivs = [...benchmarkStock.divDates].sort(
            (a, b) => b - a
          );
          const baseEndDateTs = globalCalcEndDate.getTime();
          const latestDivIdx = benchmarkDivs.findIndex(
            (ts) => ts <= baseEndDateTs
          );

          if (latestDivIdx !== -1) {
            const availableCycles = benchmarkDivs.length - latestDivIdx;
            commonCycles = Math.min(12, availableCycles);
            const targetDivIdx = Math.min(
              latestDivIdx + commonCycles - 1,
              benchmarkDivs.length - 1
            );
            const targetStartDivTs = benchmarkDivs[targetDivIdx];
            maxMinDate = new Date(targetStartDivTs);

            setCycleInfoText(
              `基準: ${
                benchmarkStock.symbol
              } (近${commonCycles}次除息, 結算至 ${
                globalCalcEndDate.toISOString().split('T')[0]
              })`
            );
          } else {
            maxMinDate = rangeStart;
            setCycleInfoText('基準標的無配息紀錄');
          }
        } else {
          maxMinDate = rangeStart;
        }

        setCyclesUsed(commonCycles);
        finalStockList = [...finalCandidates, ...allExcluded];
      } else {
        let excludedSymbols = [];
        if (!strictTimeMode) {
          const validStocksForDate = successfulData.filter(
            (s) => s.data.length > 10
          );
          let candidateStart = rangeStart;
          let candidateLimiter = null;
          const shortHistoryStocks = [];
          validStocksForDate.forEach((stock) => {
            const firstDate = new Date(stock.data[0].date);
            if (firstDate > rangeStart) {
              shortHistoryStocks.push({
                symbol: stock.symbol,
                firstDateStr: firstDate.toISOString().split('T')[0],
              });
            }
            if (firstDate > candidateStart) {
              candidateStart = firstDate;
              candidateLimiter = stock.symbol;
            }
          });
          if (validStocksForDate.length === 0 && successfulData.length > 0) {
            candidateStart = new Date(successfulData[0].data[0].date);
            candidateLimiter = successfulData[0].symbol;
            if (candidateStart.getTime() !== rangeStart.getTime()) {
              shortHistoryStocks.push({
                symbol: candidateLimiter,
                firstDateStr: candidateStart.toISOString().split('T')[0],
              });
            }
          }

          if (
            candidateLimiter &&
            candidateStart.getTime() !== rangeStart.getTime()
          ) {
            const candidateStartStr = candidateStart
              .toISOString()
              .split('T')[0];
            const rangeStartStr = rangeStart.toISOString().split('T')[0];
            const resolution = situationResolutions?.startDateShortHistory;
            const shortHistoryLabel = shortHistoryStocks
              .map((s) => `${s.symbol}(${s.firstDateStr})`)
              .join('、');
            const isMultiple = shortHistoryStocks.length > 1;

            if (resolution === 'pushForward') {
              maxMinDate = candidateStart;
              limitingStockSymbol = candidateLimiter;
            } else if (resolution === 'exclude') {
              excludedSymbols = shortHistoryStocks.map((s) => s.symbol);
              maxMinDate = rangeStart;
            } else if (resolution === 'keepPartial') {
              maxMinDate = rangeStart;
            } else {
              situations.push({
                key: 'startDateShortHistory',
                title: isMultiple
                  ? `有 ${shortHistoryStocks.length} 檔標的的資料起始日晚於您指定的起始日`
                  : `${candidateLimiter} 的資料起始日晚於您指定的起始日`,
                description: `${shortHistoryLabel} 最早的資料如上,晚於您指定的起始日 ${rangeStartStr}(可能是上市較晚,或資料庫尚未收錄更早的資料),要怎麼處理?`,
                options: [
                  {
                    value: 'pushForward',
                    label: `全部標的統一從 ${candidateStartStr} 開始比較`,
                    recommended: true,
                  },
                  {
                    value: 'exclude',
                    label: isMultiple
                      ? `排除以上 ${shortHistoryStocks.length} 檔(${shortHistoryLabel}),其餘標的維持從 ${rangeStartStr} 開始`
                      : `排除 ${candidateLimiter},其餘標的維持從 ${rangeStartStr} 開始`,
                  },
                  {
                    value: 'keepPartial',
                    label: isMultiple
                      ? `維持 ${rangeStartStr},以上標的從其各自實際起始日開始比較(各標的起點不同)`
                      : `維持 ${rangeStartStr},${candidateLimiter} 從其實際起始日開始比較(各標的起點不同)`,
                  },
                ],
              });
            }
          }
        }
        finalStockList = excludedSymbols.length
          ? successfulData.map((s) =>
              excludedSymbols.includes(s.symbol)
                ? {
                    ...s,
                    isExcluded: true,
                    exclusionReason: '使用者選擇排除(資料起始日晚於指定起始日)',
                  }
                : s
            )
          : successfulData;
        setCycleInfoText('');
      }

      if (situations.length > 0) {
        pendingRunArgsRef.current = { overrideManualData, dateOverride };
        setPendingSituations(situations);
        setLoading(false);
        finishLoading();
        return;
      }

      setComparisonInfo({
        startDate: maxMinDate.toISOString().split('T')[0],
        endDate: globalCalcEndDate.toISOString().split('T')[0],
        limitingStock: limitingStockSymbol,
        endDateLimiter: endDateLimiter,
        mode: strictTimeMode
          ? 'strict'
          : independentCycleMode
          ? 'cycle'
          : 'normal',
      });
