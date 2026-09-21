                          {item.dividendDetails &&
                            item.dividendDetails.length > 0 && (
                              <div className="mt-2 pt-1 border-t border-slate-700/30">
                                <details
                                  className="group"
                                  open={independentCycleMode}
                                >
                                  <summary className="text-[15px] text-slate-500 cursor-pointer hover:text-slate-300 flex items-center gap-1 mb-1">
                                    <Table2 className="w-3 h-3" /> 近{' '}
                                    {item.dividendDetails.length} 次配息明細
                                  </summary>
                                  <div
                                    className={`mt-1 overflow-x-auto rounded border ${
                                      printMode
                                        ? 'border-gray-200'
                                        : 'border-slate-700/50'
                                    }`}
                                  >
                                    <table className="w-full text-[16px] leading-normal text-left">
                                      <thead
                                        className={`${
                                          printMode
                                            ? 'bg-gray-100'
                                            : 'bg-slate-700/30'
                                        } text-slate-500`}
                                      >
                                        <tr>
                                          <th className="py-2 pl-2">除息日</th>
                                          <th className="py-2">前價</th>
                                          <th className="py-2">配息</th>
                                          <th className="py-2 text-right" title="配息 ÷ 買進成本價(本次回測起始價)">
                                            成本殖利率
                                          </th>
                                          <th className="py-2 text-right" title="配息 ÷ 除息前一日收盤價">
                                            除息前殖利率
                                          </th>
                                          <th className="py-2 pr-2 text-right">
                                            當日收
                                          </th>
                                        </tr>
                                      </thead>
                                      <tbody
                                        className={`divide-y ${
                                          printMode
                                            ? 'divide-gray-100'
                                            : 'divide-slate-700/30'
                                        }`}
                                      >
                                        {item.dividendDetails.map((d, i) => (
                                          <tr
                                            key={i}
                                            className={`${
                                              d.isExcludedDiv
                                                ? 'bg-slate-800/80 italic text-slate-500'
                                                : printMode
                                                ? 'hover:bg-gray-50'
                                                : 'hover:bg-slate-700/20'
                                            }`}
                                          >
                                            <td
                                              className={`py-2 pl-2 font-mono ${
                                                textClass.sub
                                              } ${
                                                d.isExcludedDiv
                                                  ? 'line-through decoration-slate-500/50'
                                                  : ''
                                              }`}
                                            >
                                              {d.date}
                                            </td>
                                            <td
                                              className={`py-2 font-mono ${textClass.sub}`}
                                            >
                                              {d.prePrice
                                                ? d.prePrice.toFixed(2)
                                                : '-'}
                                            </td>
                                            <td
                                              className={`py-2 font-mono ${
                                                d.isExcludedDiv
                                                  ? ''
                                                  : textClass.highlight
                                              }`}
                                            >
                                              ${d.amount}
                                            </td>
                                            <td
                                              className={`py-2 font-mono text-right ${textClass.sub}`}
                                            >
                                              {d.costYieldPct != null
                                                ? `${d.costYieldPct.toFixed(2)}%`
                                                : '-'}
                                            </td>
                                            <td
                                              className={`py-2 font-mono text-right ${textClass.sub}`}
                                            >
                                              {d.exDivYieldPct != null
                                                ? `${d.exDivYieldPct.toFixed(2)}%`
                                                : '-'}
                                            </td>
                                            <td
                                              className={`py-2 pr-2 font-mono text-right ${textClass.main}`}
                                            >
                                              {d.exDivPrice
                                                ? d.exDivPrice.toFixed(2)
                                                : '-'}
                                            </td>
                                          </tr>
                                        ))}
                                        {item.dividendDetails.some(
                                          (d) => d.isExcludedDiv
                                        ) && (
                                          <tr>
                                            <td
                                              colSpan="6"
                                              className="py-2 px-1 text-[14px] text-center text-slate-500 italic bg-slate-800/50"
                                            >
                                              <Info className="w-2 h-2 inline mr-0.5" />{' '}
                                              ⚠️ 本次除息不計入
                                              (為求公平，區間截止於除息前一日)
                                            </td>
                                          </tr>
                                        )}
                                        <tr
                                          className={`font-bold ${
                                            printMode
                                              ? 'bg-gray-50'
                                              : 'bg-slate-700/30'
                                          }`}
                                        >
                                          <td className="py-2 pl-2" colSpan="2">
                                            計入總計
                                          </td>
                                          <td
                                            className={`py-2 ${textClass.highlight}`}
                                          >
                                            $
                                            {Math.round(
                                              item.dividendDetails
                                                .filter((d) => !d.isExcludedDiv)
                                                .reduce(
                                                  (acc, curr) =>
                                                    acc + curr.amount,
                                                  0
                                                ) * 100
                                            ) / 100}
                                          </td>
                                          <td
                                            className={`py-2 text-right ${textClass.highlight}`}
                                          >
                                            {item.initialPrice > 0
                                              ? `${(
                                                  (item.dividendDetails
                                                    .filter(
                                                      (d) => !d.isExcludedDiv
                                                    )
                                                    .reduce(
                                                      (acc, curr) =>
                                                        acc + curr.amount,
                                                      0
                                                    ) /
                                                    item.initialPrice) *
                                                  100
                                                ).toFixed(2)}%`
                                              : '-'}
                                          </td>
                                          <td className="py-2"></td>
                                          <td className="py-2"></td>
                                        </tr>
                                      </tbody>
                                    </table>
                                  </div>
                                </details>
                              </div>
                            )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
