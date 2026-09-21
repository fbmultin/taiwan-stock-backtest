                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[17px]">
                            <div className="space-y-1">
                              <div className="flex justify-between">
                                <span className={textClass.sub}>本金</span>
                                <span className={`font-mono ${textClass.main}`}>
                                  $
                                  {Math.round(
                                    item.allocatedCapital
                                  ).toLocaleString()}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className={textClass.sub}>市值</span>
                                <span className="text-blue-300 font-mono">
                                  $
                                  {Math.round(
                                    item.finalMarketValue
                                  ).toLocaleString()}
                                </span>
                              </div>
                              <div
                                className={`flex justify-between border-t border-dashed pt-1 mt-1 ${
                                  printMode
                                    ? 'border-gray-300'
                                    : 'border-slate-600/50'
                                }`}
                              >
                                <span className={textClass.sub}>含息值</span>
                                <span
                                  className={`font-mono font-bold ${
                                    item.finalTotalValue >=
                                    item.allocatedCapital
                                      ? textClass.highlight
                                      : textClass.warn
                                  }`}
                                >
                                  $
                                  {Math.round(
                                    item.finalTotalValue
                                  ).toLocaleString()}
                                </span>
                              </div>
                            </div>
                            <div className="space-y-1 sm:border-l border-slate-700/50 sm:pl-2">
                              <div className="flex justify-between">
                                <span className={textClass.sub}>始</span>
                                <span className={`font-mono ${textClass.sub}`}>
                                  {item.initialPrice.toFixed(2)}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className={textClass.sub}>終</span>
                                <span className={`font-mono ${textClass.sub}`}>
                                  {item.finalPrice.toFixed(2)}
                                </span>
                              </div>
                              <div
                                className={`flex justify-between border-t border-dashed pt-1 mt-1 ${
                                  printMode
                                    ? 'border-gray-300'
                                    : 'border-slate-600/50'
                                }`}
                              >
                                <span className={textClass.sub}>不含息報酬</span>
                                <span
                                  className={`font-mono ${
                                    item.priceReturnPct >= 0
                                      ? textClass.warn
                                      : textClass.highlight
                                  }`}
                                >
                                  {item.priceReturnPct > 0 ? '+' : ''}
                                  {item.priceReturnPct.toFixed(2)}%
                                </span>
                              </div>
                            </div>
                            <div className="space-y-1 sm:border-l border-slate-700/50 sm:pl-2 border-t sm:border-t-0 pt-2 sm:pt-0">
                              <div className="flex justify-between">
                                <span className={textClass.sub}>配息</span>
                                <span
                                  className={`font-mono font-bold ${
                                    fairMode
                                      ? textClass.amber
                                      : textClass.highlight
                                  }`}
                                >
                                  +$
                                  {Math.round(
                                    item.finalStockDividends
                                  ).toLocaleString()}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className={textClass.sub}>年化</span>
                                <span className="text-emerald-500/70 font-mono">
                                  {item.annualizedDividendYield.toFixed(1)}%
                                </span>
                              </div>
                            </div>
                            <div className="space-y-0.5 sm:border-l border-slate-700/50 sm:pl-2 border-t sm:border-t-0 pt-2 sm:pt-0 flex flex-col justify-center">
                              <div
                                className={`text-[17px] font-bold ${textClass.sub} mb-0.5`}
                              >
                                除 {item.lastDivDate || '--'}
                              </div>
                              <div className={`text-[17px] ${textClass.sub}`}>
                                配{' '}
                                <span
                                  className={`font-mono ${textClass.highlight}`}
                                >
                                  {item.lastDivAmount !== undefined &&
                                  item.lastDivAmount !== null
                                    ? String(item.lastDivAmount)
                                    : '-'}
                                </span>
                                / 收{' '}
                                <span className={`font-mono ${textClass.main}`}>
                                  {item.recentExDivClosePrice
                                    ? Number(
                                        item.recentExDivClosePrice
                                      ).toFixed(2)
                                    : '-'}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div
                            className={`text-[15px] ${
                              textClass.sub
                            } mt-2 border-t ${
                              printMode
                                ? 'border-gray-200'
                                : 'border-slate-700/30'
                            } pt-1 flex justify-between items-center`}
                          >
                            <span>
                              統計區間: {item.startDate} ~ {item.endDate}{' '}
                              <span className="text-slate-500/80 ml-1">
                                (
                                {getDurationLabel(item.startDate, item.endDate)}
                                )
                              </span>
                            </span>
                            {item.isDataLagging ? (
                              <span
                                className="text-amber-500 flex items-center gap-1"
                                title={`實際資料僅更新至 ${item.actualEndDateStr}`}
                              >
                                <AlertTriangle className="w-3 h-3" /> 資料僅至{' '}
                                {item.actualEndDateStr} (延用收盤價)
                              </span>
                            ) : (
                              <span
                                className={`px-1.5 py-0.5 rounded ${
                                  printMode
                                    ? 'bg-gray-100'
                                    : 'bg-slate-700 text-slate-300'
                                }`}
                              >
                                共配息 {item.dividendCount} 次
                              </span>
                            )}
                          </div>
