            <div>
              <h3
                className={`font-bold text-lg sm:text-xl mb-4 flex items-center gap-2 ${textClass.main}`}
              >
                <DollarSign className={`w-6 h-6 ${textClass.highlight}`} />
                個別標的績效
                {independentCycleMode && (
                  <span className="text-xs bg-purple-900/50 text-purple-300 px-2 py-0.5 rounded border border-purple-700/50 ml-2">
                    基準: {cyclesUsed} 次配息周期
                  </span>
                )}
                {strictTimeMode && (
                  <span className="text-xs bg-orange-900/50 text-orange-300 px-2 py-0.5 rounded border border-orange-700/50 ml-2">
                    強制固定區間
                  </span>
                )}
              </h3>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 print-grid">
                {portfolioSummary.details
                  .sort((a, b) => b.totalReturnPct - a.totalReturnPct)
                  .map((item, idx) => {
                    if (item.isExcluded) {
                      return (
                        <div
                          key={idx}
                          className={`rounded-xl border p-4 flex items-center justify-between opacity-60 ${
                            printMode
                              ? 'bg-gray-100 border-gray-300'
                              : 'bg-slate-800/50 border-slate-700'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={`text-lg font-bold ${textClass.sub}`}
                            >
                              {item.symbol}
                              {item.stockName && (
                                <span className="text-xs font-normal text-slate-400 ml-1">
                                  {item.stockName}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-rose-400 bg-rose-900/20 px-2 py-1 rounded border border-rose-800/50 flex items-center gap-1">
                              <Ban className="w-3 h-3" />
                              {item.exclusionReason}
                            </div>
                          </div>
                          <div className={`text-xs ${textClass.sub}`}>
                            未納入計算
                          </div>
                        </div>
                      );
                    }

                    const {
                      label: riskLabel,
                      color: riskColor,
                      icon: RiskIcon,
                      volatility,
                    } = item.riskProfile;

                    return (
                      <div
                        key={idx}
                        className={`rounded-xl shadow-sm overflow-hidden relative group ${cardClass}`}
                      >
                        <div className="p-3">
                          <div
                            className={`flex items-center justify-between mb-2 pb-2 border-b ${
                              printMode
                                ? 'border-gray-200'
                                : 'border-slate-700/50'
                            }`}
                          >
                            <div className="flex items-center gap-2 sm:gap-3">
                              <div
                                className={`text-lg sm:text-xl font-bold ${textClass.main}`}
                              >
                                {item.symbol}
                                {item.stockName && (
                                  <span className="text-xs font-normal text-slate-400 ml-1">
                                    {item.stockName}
                                  </span>
                                )}
                              </div>
                              {idx === 0 && (
                                <span className="bg-yellow-500 text-slate-900 text-[14px] px-1.5 py-0.5 rounded font-bold">
                                  TOP 1
                                </span>
                              )}
                              <div className="flex gap-1 flex-wrap">
                                {(item.isShortHistory || item.isYoungStock) && (
                                  <span
                                    className={`text-[14px] px-1.5 py-0.5 rounded border flex items-center gap-1 ${
                                      printMode
                                        ? 'text-amber-700 border-amber-200 bg-amber-50'
                                        : 'text-amber-400 border-amber-900/50 bg-amber-900/20'
                                    }`}
                                  >
                                    <AlertTriangle className="w-3 h-3" />
                                    成立: {item.actualInceptionDate}
                                  </span>
                                )}
                                {item.snapToExDiv && (
                                  <span
                                    className={`text-[14px] px-1.5 py-0.5 rounded border flex items-center gap-1 ${
                                      printMode
                                        ? 'text-purple-700 border-purple-200 bg-purple-50'
                                        : 'text-purple-400 border-purple-900/50 bg-purple-900/20'
                                    }`}
                                  >
                                    <CalendarDays className="w-3 h-3" />
                                    週期對齊
                                  </span>
                                )}
                                {(item.splitEvents || []).map((ev) => {
                                  const typeLabel =
                                    ev.type === 'split' ? '分割' : '反分割';
                                  const ratioLabel =
                                    ev.type === 'split'
                                      ? `1拆${ev.ratio}`
                                      : `${ev.ratio}合1`;
                                  const priceLabel = `${ev.priceBefore}→${ev.priceAfter}`;
                                  let text, title, colorClass;
                                  if (ev.status === 'corrected') {
                                    text = `${ev.date} ${typeLabel} ${ratioLabel} (已校正)`;
                                    title = `${ev.label}\n${ev.date} 恢復買賣\n分割前收盤 ${ev.priceBefore} 元 → 分割後參考價 ${ev.priceAfter} 元\n資料源尚未回溷調整，已依此比例自動校正 ${ev.date} 以前的股價與除息金額。`;
                                    colorClass = printMode
                                      ? 'text-teal-700 border-teal-200 bg-teal-50'
                                      : 'text-teal-400 border-teal-900/50 bg-teal-900/20';
                                  } else if (ev.status === 'already_adjusted') {
                                    text = `${ev.date} ${typeLabel} ${ratioLabel} (資料已調整)`;
                                    title = `${ev.label}\n${ev.date} 恢復買賣\n分割前收盤 ${ev.priceBefore} 元 → 分割後參考價 ${ev.priceAfter} 元\n資料源已經回溷調整過歷史股價，未再重複處理。`;
                                    colorClass = printMode
                                      ? 'text-slate-600 border-slate-300 bg-slate-100'
                                      : 'text-slate-400 border-slate-600 bg-slate-800';
                                  } else {
                                    text = `${ev.date} 疑似${typeLabel} (未校正)`;
                                    title = `${ev.label}\n${ev.date} 恢復買賣\n分割前收盤 ${ev.priceBefore} 元 → 分割後參考價 ${ev.priceAfter} 元\n實際資料價位與這兩個參考值都對不上，無法自動判斷是否已調整，故未自動校正，建議自行確認。`;
                                    colorClass = printMode
                                      ? 'text-amber-700 border-amber-200 bg-amber-50'
                                      : 'text-amber-400 border-amber-900/50 bg-amber-900/20';
                                  }
                                  return (
                                    <span
                                      key={`${ev.symbol}-${ev.date}`}
                                      title={title}
                                      className={`text-[14px] px-1.5 py-0.5 rounded border flex items-center gap-1 ${colorClass}`}
                                    >
                                      <Scissors className="w-3 h-3" />
                                      {text} {priceLabel}
                                    </span>
                                  );
                                })}
                                {item.usedCache && (
                                  <span
                                    title={`即時資料回應較慢或抓取失敗，此檔已改用先前暫存的資料${
                                      item.cachedAt
                                        ? `\n暫存時間: ${new Date(
                                            item.cachedAt
                                          ).toLocaleString('zh-TW')}`
                                        : ''
                                    }`}
                                    className={`text-[14px] px-1.5 py-0.5 rounded border flex items-center gap-1 ${
                                      printMode
                                        ? 'text-amber-700 border-amber-200 bg-amber-50'
                                        : 'text-amber-400 border-amber-900/50 bg-amber-900/20'
                                    }`}
                                  >
                                    <Database className="w-3 h-3" />
                                    使用暫存資料
                                    {item.cachedAt
                                      ? ` (${item.cachedAt.split('T')[0]})`
                                      : ''}
                                  </span>
                                )}
                                {item.dividendDataIncomplete && (
                                  <span
                                    title="這次改用證交所(TWSE)備援資料源取得股價,但除息資料同時也抓取失敗,配息與殖利率計算可能不完整,建議稍後重新整理再試一次"
                                    className={`text-[14px] px-1.5 py-0.5 rounded border flex items-center gap-1 ${
                                      printMode
                                        ? 'text-amber-700 border-amber-200 bg-amber-50'
                                        : 'text-amber-400 border-amber-900/50 bg-amber-900/20'
                                    }`}
                                  >
                                    <AlertTriangle className="w-3 h-3" />
                                    配息資料可能不完整
                                  </span>
                                )}
                                <span
                                  className={`text-[14px] px-1.5 py-0.5 rounded border flex items-center gap-1 ${riskColor}`}
                                >
                                  <RiskIcon className="w-3 h-3" />
                                  {riskLabel}
                                </span>
                                {item.beta !== undefined && (
                                  <span
                                    title="β值(系統性風險係數):以個股日報酬對大盤加權指數(^TWII)日報酬做迴歸估算,反映相對大盤的波動敏感度;β>1 代表波動比大盤劇烈,β<1 代表較平緩"
                                    className={`text-[14px] px-1.5 py-0.5 rounded border flex items-center gap-1 ${
                                      printMode
                                        ? 'text-indigo-700 border-indigo-200 bg-indigo-50'
                                        : 'text-indigo-400 border-indigo-900/50 bg-indigo-900/20'
                                    }`}
                                  >
                                    β{' '}
                                    {item.beta !== null
                                      ? item.beta.toFixed(2)
                                      : '資料不足'}
                                  </span>
                                )}
                                <span
                                  className={`text-[14px] px-1.5 py-0.5 rounded border ${
                                    printMode
                                      ? 'text-emerald-700 border-emerald-200 bg-emerald-50'
                                      : 'text-emerald-400 border-emerald-900/50 bg-emerald-900/20'
                                  }`}
                                >
                                  {item.weight.toFixed(1)}%
                                </span>
                              </div>
                            </div>
                            <div className="text-right">
                              <div
                                className={`text-lg sm:text-xl font-bold font-mono ${
                                  item.totalReturnPct >= 0
                                    ? textClass.warn
                                    : textClass.highlight
                                }`}
                              >
                                {item.totalReturnPct > 0 ? '+' : ''}
                                {item.totalReturnPct.toFixed(2)}%
                              </div>
                            </div>
                          </div>
