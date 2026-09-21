              <div className="lg:col-span-2 flex flex-col justify-end mt-4 lg:mt-0">
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2 cursor-pointer bg-slate-800 border border-slate-600 p-2 rounded-lg hover:bg-slate-700/50 transition-colors">
                    <div className="relative flex-shrink-0">
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={independentCycleMode}
                        onChange={() => toggleIndependentCycleMode()}
                      />
                      <div
                        className={`w-8 h-4 rounded-full shadow-inner transition-colors ${
                          independentCycleMode
                            ? 'bg-purple-500'
                            : 'bg-slate-600'
                        }`}
                      ></div>
                      <div
                        className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${
                          independentCycleMode
                            ? 'translate-x-4'
                            : 'translate-x-0'
                        }`}
                      ></div>
                    </div>
                    <div className="text-[14px] sm:text-xs text-slate-300 leading-tight">
                      <div>依除息日對齊週期</div>
                      <div className="text-[13px] text-slate-500">
                        獨立計算每檔績效 (近12次)
                      </div>
                    </div>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer bg-slate-800 border border-slate-600 p-2 rounded-lg hover:bg-slate-700/50 transition-colors">
                    <div className="relative flex-shrink-0">
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={strictTimeMode}
                        onChange={() => toggleStrictTimeMode()}
                      />
                      <div
                        className={`w-8 h-4 rounded-full shadow-inner transition-colors ${
                          strictTimeMode ? 'bg-orange-500' : 'bg-slate-600'
                        }`}
                      ></div>
                      <div
                        className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${
                          strictTimeMode ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      ></div>
                    </div>
                    <div className="text-[14px] sm:text-xs text-slate-300 leading-tight">
                      <div>強制固定區間</div>
                      <div className="text-[13px] text-slate-500">
                        忽略除息對齊 (時間優先)
                      </div>
                    </div>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer bg-slate-800 border border-slate-600 p-2 rounded-lg hover:bg-slate-700/50 transition-colors">
                    <div className="relative flex-shrink-0">
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={calcBeta}
                        onChange={() => setCalcBeta((v) => !v)}
                      />
                      <div
                        className={`w-8 h-4 rounded-full shadow-inner transition-colors ${
                          calcBeta ? 'bg-indigo-500' : 'bg-slate-600'
                        }`}
                      ></div>
                      <div
                        className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${
                          calcBeta ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      ></div>
                    </div>
                    <div className="text-[14px] sm:text-xs text-slate-300 leading-tight">
                      <div>計算β值</div>
                      <div className="text-[13px] text-slate-500">
                        額外抓取大盤指數比對,較耗時 (預設關閉)
                      </div>
                    </div>
                  </label>
                  {independentCycleMode && !strictTimeMode && (
                    <div className="text-[14px] sm:text-[14.5px] leading-snug text-purple-300 bg-purple-900/20 border border-purple-800/50 rounded-lg p-2 flex items-start gap-1.5">
                      <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
                      <span>
                        此模式會以「配息次數最少 / 上市最晚」的標的為基準，用它近
                        12 次除息紀錄反推實際計算區間，
                        <span className="font-bold text-purple-200">
                          可能大幅覆蓋您手動選擇的起訖日期
                        </span>
                        。若想強制使用您指定的日期區間，請改勾選下方「強制固定區間」，或執行後於報告上方用「調整日期」手動校正。
                      </span>
                    </div>
                  )}
                  {!independentCycleMode && !strictTimeMode && (
                    <div className="text-[14px] sm:text-[14.5px] leading-snug text-slate-500 bg-slate-800/60 border border-slate-700 rounded-lg p-2 flex items-start gap-1.5">
                      <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
                      <span>
                        一般模式:若執行時遇到標的資料起始日晚於指定日期、或除息日太靠近結束日等需要調整的情況，會直接跳出視窗詢問您要怎麼處理，不會自動靜默調整。
                      </span>
                    </div>
                  )}
                  <button
                    onClick={() => runBacktest()}
                    disabled={
                      loading ||
                      (allocationError &&
                        Object.values(enabledInputs).every((v) => v))
                    }
                    className={`w-full py-4 rounded-xl font-bold shadow-lg flex items-center justify-center gap-2 transition-all ${
                      allocationError &&
                      Object.values(enabledInputs).every((v) => v)
                        ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                        : 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white'
                    }`}
                  >
                    {loading ? (
                      <RefreshCw className="animate-spin w-5 h-5" />
                    ) : (
                      <>
                        <Zap className="w-5 h-5 fill-current" /> 開始回測
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {!isConfigExpanded && (
            <div
              className={`border p-3 rounded-lg flex flex-col gap-3 animate-in fade-in slide-in-from-top-2 no-print ${
                printMode
                  ? 'bg-gray-50 border-gray-200'
                  : 'bg-slate-800/50 border-slate-700'
              }`}
            >
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-0">
                <div
                  className={`flex flex-wrap items-center gap-2 sm:gap-4 text-sm ${textClass.sub}`}
                >
                  <span>
                    本金:{' '}
                    <span
                      className={`font-mono font-bold ${textClass.highlight}`}
                    >
                      {Math.round(totalCapital / 10000)}萬
                    </span>
                  </span>
                  <span className="hidden sm:inline">|</span>
                  <span>
                    區間:{' '}
                    {timeRange === 'custom'
                      ? '自訂'
                      : timeRange === 'ytd'
                      ? '今年以來'
                      : timeRange === '3m'
                      ? '近3個月'
                      : timeRange === '6m'
                      ? '半年'
                      : timeRange === '12m'
                      ? '近1年'
                      : timeRange === '3y'
                      ? '近3年'
                      : '近5年'}
                  </span>
                  {comparisonInfo && (
                    <>
                      <span className="hidden sm:inline">|</span>
                      <span className="text-[14px] sm:text-xs text-slate-500 flex items-center gap-1 flex-wrap">
                        <CalendarDays className="w-3 h-3" />
                        {comparisonInfo.startDate} ~ {comparisonInfo.endDate}
                        {comparisonInfo.mode === 'strict' && (
                          <span className="text-orange-500">(強制固定)</span>
                        )}
                        {comparisonInfo.mode === 'cycle' && (
                          <span className="text-purple-500">(除息對齊)</span>
                        )}
                        {comparisonInfo.limitingStock && !strictTimeMode && comparisonInfo.mode !== 'cycle' && (
                          <span
                            className="text-amber-500 ml-1"
                            title={`${comparisonInfo.limitingStock} 資料起始日較晚,限制了起始日`}
                          >
                            (起始日由 {comparisonInfo.limitingStock} 限制)
                          </span>
                        )}
                        {comparisonInfo.endDateLimiter && !strictTimeMode && (
                          <span
                            className="text-amber-500 ml-1"
                            title={`由 ${comparisonInfo.endDateLimiter} 近期除息限制截止日`}
                          >
                            (截止日由 {comparisonInfo.endDateLimiter} 限制)
                          </span>
                        )}
                        <button
                          onClick={() => {
                            setAdjustStart(comparisonInfo.startDate);
                            setAdjustEnd(comparisonInfo.endDate);
                            setShowDateAdjustPanel((v) => !v);
                          }}
                          className="ml-1 text-blue-400 hover:text-blue-300 underline decoration-dotted"
                          title="手動調整此次回測實際使用的日期區間"
                        >
                          調整日期
                        </button>
                      </span>
                    </>
                  )}
                  <span className="hidden sm:inline">|</span>
                  <span>
                    標的:{' '}
                    {
                      inputs.filter((s, i) => s !== '' && enabledInputs[i])
                        .length
                    }
                  </span>
                </div>
                <div className="flex gap-2 w-full sm:w-auto">
                  <button
                    onClick={handlePrint}
                    className="flex-1 sm:flex-none text-xs bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded flex justify-center items-center gap-1.5"
                  >
                    <Printer className="w-3 h-3" />{' '}
                    <span className="sm:hidden">匯出</span>
                    <span className="hidden sm:inline">匯出報告</span>
                  </button>
                  <button
                    onClick={() => runBacktest()}
                    className="flex-1 sm:flex-none text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-2 rounded flex justify-center items-center gap-1.5"
                  >
                    <RefreshCw className="w-3 h-3" /> 重算
                  </button>
                </div>
              </div>

              {showDateAdjustPanel && comparisonInfo && (
                <div
                  className={`flex flex-wrap items-center gap-2 text-xs pt-3 border-t ${
                    printMode ? 'border-gray-200' : 'border-slate-700'
                  }`}
                >
                  <span className={`font-bold ${textClass.sub}`}>
                    手動校正實際計算區間:
                  </span>
                  <input
                    type="date"
                    value={adjustStart}
                    onChange={(e) => setAdjustStart(e.target.value)}
                    className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white"
                  />
                  <span className={textClass.sub}>~</span>
                  <input
                    type="date"
                    value={adjustEnd}
                    onChange={(e) => setAdjustEnd(e.target.value)}
                    className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white"
                  />
                  <button
                    onClick={() => {
                      if (!adjustStart || !adjustEnd) return;
                      setCustomStart(adjustStart);
                      setCustomEnd(adjustEnd);
                      setTimeRange('custom');
                      setShowDateAdjustPanel(false);
                      runBacktest(null, { start: adjustStart, end: adjustEnd });
                    }}
                    className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded font-bold"
                  >
                    套用並重新計算
                  </button>
                  <button
                    onClick={() => setShowDateAdjustPanel(false)}
                    className="text-slate-500 hover:text-slate-300 px-2"
                  >
                    取消
                  </button>
                  <span className="text-slate-500 text-[14px] w-full sm:w-auto">
                    ※ 套用後系統仍會自動避開週末與國定假日
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </header>
