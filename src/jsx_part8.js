            <div className={`p-6 rounded-xl shadow-lg no-print ${cardClass}`}>
              <h3
                className={`font-bold mb-4 flex items-center gap-2 ${textClass.sub}`}
              >
                <TrendingUp className={`w-5 h-5 ${textClass.blue}`} />
                報酬率走勢比較
              </h3>
              <div className="h-[300px] w-full">
                <ResponsiveContainer>
                  <LineChart data={chartData}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke={printMode ? '#e5e7eb' : '#334155'}
                    />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(s) => s.slice(5)}
                      minTickGap={30}
                      tick={{
                        fill: printMode ? '#333' : '#94a3b8',
                        fontSize: 10,
                      }}
                    />
                    <YAxis
                      tickFormatter={(v) => `${v}%`}
                      tick={{
                        fill: printMode ? '#333' : '#94a3b8',
                        fontSize: 10,
                      }}
                      width={35}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: printMode ? '#fff' : '#1e293b',
                        border: printMode
                          ? '1px solid #ccc'
                          : '1px solid #475569',
                        color: printMode ? '#000' : '#f8fafc',
                        borderRadius: '8px',
                      }}
                      formatter={(val) => [`${Number(val).toFixed(2)}%`]}
                      labelFormatter={(l) => `日期: ${l}`}
                    />
                    <Legend />
                    <ReferenceLine y={0} stroke="#64748b" />
                    {results.map((r, i) => (
                      <Line
                        key={r.symbol}
                        type="monotone"
                        dataKey={r.symbol}
                        stroke={COLORS[i % COLORS.length]}
                        dot={(props) => (
                          <CustomizedDot {...props} divDates={r.divDates} />
                        )}
                        activeDot={{ r: 6 }}
                        strokeWidth={1.5}
                      />
                    ))}
                    <Line
                      type="monotone"
                      dataKey="綜合績效"
                      name="⭐ 綜合績效 (投資組合)"
                      stroke="#facc15"
                      strokeWidth={3}
                      dot={false}
                      activeDot={{ r: 8 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {periodStats && (
              <div className={`p-6 rounded-xl shadow-lg no-print ${cardClass}`}>
                <h3
                  className={`font-bold mb-4 flex items-center gap-2 ${textClass.sub}`}
                >
                  <Clock className="w-5 h-5 text-purple-400" />
                  資產配置多週期總報酬
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left whitespace-nowrap">
                    <thead
                      className={`border-b ${
                        printMode
                          ? 'bg-gray-100 border-gray-200'
                          : 'bg-slate-900/50 border-slate-700'
                      }`}
                    >
                      <tr>
                        <th className="px-4 py-3">期間</th>
                        <th className="px-4 py-3">起始日期</th>
                        <th className="px-4 py-3 text-right">總報酬率</th>
                      </tr>
                    </thead>
                    <tbody
                      className={`divide-y ${
                        printMode ? 'divide-gray-200' : 'divide-slate-700'
                      }`}
                    >
                      {periodStats.map((stat, i) => {
                        if (!stat) return null;
                        const label =
                          stat.months >= 12
                            ? `${stat.months / 12} 年`
                            : `${stat.months} 個月`;
                        return (
                          <tr
                            key={i}
                            className={`transition-colors ${
                              printMode
                                ? 'hover:bg-gray-50'
                                : 'hover:bg-slate-700/30'
                            }`}
                          >
                            <td
                              className={`px-4 py-3 font-bold ${textClass.main}`}
                            >
                              {label}
                            </td>
                            <td
                              className={`px-4 py-3 font-mono ${textClass.sub}`}
                            >
                              {stat.startDate}{' '}
                              {stat.isPartial && (
                                <span className="text-[14px] opacity-70">
                                  (成立以來)
                                </span>
                              )}
                            </td>
                            <td
                              className={`px-4 py-3 text-right font-mono font-bold ${
                                stat.roi >= 0
                                  ? textClass.warn
                                  : textClass.highlight
                              }`}
                            >
                              {stat.roi > 0 ? '+' : ''}
                              {stat.roi.toFixed(2)}%
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
      )}
    </>
  );
};

export default App;
