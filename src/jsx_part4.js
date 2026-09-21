      <div className="container mx-auto px-4 mt-4 sm:mt-8 space-y-8 pb-8">
        {errorMsg && (
          <div className="bg-rose-900/30 text-rose-300 p-4 rounded-xl border border-rose-800 flex items-center gap-2 no-print">
            <AlertTriangle className="w-5 h-5" /> {errorMsg}
          </div>
        )}
        {dateAdjustmentNote && results && (
          <div className="bg-blue-900/30 text-blue-300 p-4 rounded-xl border border-blue-800 flex items-start gap-2 no-print text-sm">
            <Info className="w-5 h-5 mt-0.5 shrink-0" />
            <div>
              <span className="font-bold">
                系統已自動調整日期(避開週末/國定假日):
              </span>
              <div className="text-blue-300/90 mt-0.5 space-y-0.5">
                {dateAdjustmentNote.startShifted && (
                  <div>
                    起始日 {dateAdjustmentNote.originalStart} →{' '}
                    <span className="font-mono font-bold">
                      {dateAdjustmentNote.adjustedStart}
                    </span>
                  </div>
                )}
                {dateAdjustmentNote.endShifted && (
                  <div>
                    結束日 {dateAdjustmentNote.originalEnd} →{' '}
                    <span className="font-mono font-bold">
                      {dateAdjustmentNote.adjustedEnd}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        {failedTickers && failedTickers.length > 0 && (
          <div className="bg-amber-900/30 text-amber-300 p-4 rounded-xl border border-amber-800 flex flex-col gap-2 no-print">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" />
              <span className="font-bold">
                部分標的無法取得歷史資料，已自動排除：{failedTickers.join(', ')}
              </span>
            </div>
            <div className="text-xs text-amber-400/80 ml-7 space-y-1">
              <p>💡 可能原因：</p>
              <ul className="list-disc pl-4 space-y-0.5">
                <li>
                  該標的為近期剛上市（如主動型 ETF 009xxA
                  系列），資料庫尚未建檔。
                </li>
                <li>輸入的代碼錯誤，或查無此股票。</li>
                <li>網路轉接通道暫時壅塞，可稍後重新點擊回測。</li>
              </ul>
            </div>
          </div>
        )}

        {!results && !loading && !errorMsg && (
          <div className="h-64 flex flex-col items-center justify-center text-slate-600 border-2 border-dashed border-slate-800 rounded-xl no-print m-4">
            <CloudLightning className="w-12 h-12 mb-2 opacity-30" />
            <p>設定上方投資組合後，點擊「開始回測」</p>
          </div>
        )}

        {results && portfolioSummary && (
          <>
            <div className="flex justify-between items-center no-print">
              <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-2">
                <h2 className={`text-xl font-bold ${textClass.main}`}>
                  回測報告
                </h2>
                {cycleInfoText && (
                  <span className="text-xs text-purple-400 bg-purple-900/20 px-2 py-0.5 rounded border border-purple-800/50">
                    {cycleInfoText}
                  </span>
                )}
                {comparisonInfo?.limitingStock && !strictTimeMode && comparisonInfo?.mode !== 'cycle' && (
                  <span className="text-xs text-amber-400 bg-amber-900/20 px-2 py-0.5 rounded border border-amber-800/50 flex items-center gap-1">
                    <Info className="w-3 h-3" />
                    起始日由 {comparisonInfo.limitingStock} 資料起始較晚限制
                  </span>
                )}
                {comparisonInfo?.endDateLimiter && !strictTimeMode && (
                  <span className="text-xs text-amber-400 bg-amber-900/20 px-2 py-0.5 rounded border border-amber-800/50 flex items-center gap-1">
                    <Info className="w-3 h-3" />
                    截止日由 {comparisonInfo.endDateLimiter} 近期除息限制
                  </span>
                )}
              </div>
              <button
                onClick={handlePrint}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg shadow-lg shadow-indigo-900/20 text-sm"
              >
                <Printer className="w-4 h-4" />{' '}
                <span className="hidden sm:inline">匯出 PDF</span>
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-4 print-grid">
              <div
                className={`lg:col-span-2 p-6 rounded-2xl shadow-xl relative overflow-hidden ${cardClass} ${
                  printMode
                    ? 'bg-white'
                    : 'bg-gradient-to-br from-slate-800 to-slate-900'
                }`}
              >
                <div className="absolute top-0 right-0 p-4 opacity-10">
                  <Wallet
                    className={`w-24 h-24 sm:w-32 sm:h-32 ${textClass.main}`}
                  />
                </div>
                <h3
                  className={`${textClass.sub} text-sm font-bold uppercase tracking-wider mb-2`}
                >
                  期末資產總值 (含息)
                </h3>
                <div
                  className={`text-3xl sm:text-4xl lg:text-5xl font-bold font-mono mb-6 ${textClass.main}`}
                >
                  $
                  {Math.round(
                    portfolioSummary.grandTotalValue
                  ).toLocaleString()}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div
                    className={`p-3 rounded-lg border ${
                      printMode
                        ? 'bg-gray-50 border-gray-200'
                        : 'bg-slate-700/50 border-slate-600'
                    }`}
                  >
                    <div className={`${textClass.sub} text-xs mb-1`}>
                      總投入本金
                    </div>
                    <div className={`text-lg font-mono ${textClass.main}`}>
                      $
                      {Math.round(
                        portfolioSummary.totalInvested
                      ).toLocaleString()}
                    </div>
                  </div>
                  <div
                    className={`p-3 rounded-lg border ${
                      printMode
                        ? 'bg-blue-50 border-blue-200'
                        : 'bg-blue-900/30 border-blue-800/50'
                    }`}
                  >
                    <div className={`text-xs mb-1 ${textClass.blue}`}>
                      資本利得 (價差)
                    </div>
                    <div className={`text-lg font-mono ${textClass.blue}`}>
                      $
                      {Math.round(
                        portfolioSummary.grandTotalMarketValue -
                          portfolioSummary.totalInvested
                      ).toLocaleString()}
                    </div>
                  </div>
                  <div
                    className={`p-3 rounded-lg border ${
                      printMode
                        ? 'bg-emerald-50 border-emerald-200'
                        : 'bg-emerald-900/30 border-emerald-800/50'
                    }`}
                  >
                    <div className={`text-xs mb-1 ${textClass.highlight}`}>
                      總領股息
                    </div>
                    <div className={`text-lg font-mono ${textClass.highlight}`}>
                      +$
                      {Math.round(
                        portfolioSummary.grandTotalDividends
                      ).toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>

              <div
                className={`p-6 rounded-2xl shadow-xl flex flex-col items-center justify-center relative ${cardClass}`}
              >
                <h3
                  className={`absolute top-6 left-6 text-sm font-bold uppercase ${textClass.sub}`}
                >
                  組合總報酬率
                </h3>
                <div className="relative w-40 h-40 mt-4">
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie
                        data={[{ value: 100 }]}
                        dataKey="value"
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={70}
                        fill={printMode ? '#e5e7eb' : '#334155'}
                        stroke="none"
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex items-center justify-center flex-col">
                    <span
                      className={`text-3xl font-bold font-mono ${
                        portfolioSummary.grandTotalRoi >= 0
                          ? textClass.highlight
                          : textClass.warn
                      }`}
                    >
                      {portfolioSummary.grandTotalRoi > 0 ? '+' : ''}
                      {portfolioSummary.grandTotalRoi.toFixed(1)}%
                    </span>
                    <span className={`text-xs ${textClass.sub}`}>ROI</span>
                  </div>
                </div>
              </div>
            </div>
