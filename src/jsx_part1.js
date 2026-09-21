  return (
    <>
      {/* 分頁切換:既有的「ETF回測比較」與新增的「定期定額策略最佳化」並排 */}
      <div className="no-print sticky top-0 z-40 flex gap-1 px-2 sm:px-4 bg-slate-900 border-b border-slate-700">
        <button
          onClick={() => setActiveTab('backtest')}
          className={`px-3 sm:px-4 py-2.5 text-sm sm:text-base font-medium border-b-2 transition-colors ${
            activeTab === 'backtest'
              ? 'border-emerald-400 text-emerald-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          ETF回測比較
        </button>
        <button
          onClick={() => setActiveTab('dca')}
          className={`px-3 sm:px-4 py-2.5 text-sm sm:text-base font-medium border-b-2 transition-colors ${
            activeTab === 'dca'
              ? 'border-emerald-400 text-emerald-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          定期定額策略最佳化
        </button>
      </div>

      {activeTab === 'dca' && (
        <div className={containerClass}>
          <div className="max-w-6xl mx-auto p-4 sm:p-6">
            <DcaOptimizer />
          </div>
        </div>
      )}

      {activeTab === 'backtest' && (
    <div className={containerClass}>
      {missingDataList.length > 0 && (
        <ManualInputModal
          missingData={missingDataList}
          onConfirm={handleManualInputConfirm}
          onCancel={handleManualInputCancel}
        />
      )}

      {!missingDataList.length && pendingSituations && pendingSituations.length > 0 && (
        <SituationDecisionModal
          situations={pendingSituations}
          onConfirm={handleResolveSituations}
          onCancel={handleCancelSituations}
        />
      )}

      {loading && missingDataList.length === 0 && !pendingSituations && (
        <div className="fixed inset-0 bg-slate-900/90 z-50 flex flex-col items-center justify-center backdrop-blur-sm no-print px-4">
          <div className="w-full max-w-xs sm:max-w-sm space-y-4">
            <div className="flex justify-between text-xs text-slate-400 mb-1 gap-2">
              <span className="truncate">{loadingStage || '資料回測中...'}</span>
              <span className="flex-shrink-0">{Math.round(progress)}%</span>
            </div>
            <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)] transition-all duration-300 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>

            {fetchStatusList.length > 0 && (
              <div className="flex flex-wrap gap-1.5 justify-center max-h-24 overflow-y-auto">
                {fetchStatusList.map((f) => (
                  <span
                    key={f.symbol}
                    className={`text-[14px] px-1.5 py-0.5 rounded border flex items-center gap-1 font-mono ${
                      f.status === 'done'
                        ? 'border-emerald-700 text-emerald-400 bg-emerald-900/20'
                        : f.status === 'cached'
                        ? 'border-amber-700 text-amber-400 bg-amber-900/20'
                        : f.status === 'failed'
                        ? 'border-rose-700 text-rose-400 bg-rose-900/20'
                        : f.status === 'skipped'
                        ? 'border-slate-600 text-slate-400 bg-slate-800'
                        : 'border-slate-600 text-slate-300 bg-slate-800 animate-pulse'
                    }`}
                    title={f.status === 'cached' ? '即時資料回應較慢或抓取失敗，已改用先前快取的資料' : undefined}
                  >
                    {f.status === 'done' && <CheckCircle2 className="w-2.5 h-2.5" />}
                    {f.status === 'cached' && <Database className="w-2.5 h-2.5" />}
                    {f.status === 'failed' && <XCircle className="w-2.5 h-2.5" />}
                    {f.status === 'skipped' && <SkipForward className="w-2.5 h-2.5" />}
                    {f.status === 'pending' && <Clock className="w-2.5 h-2.5" />}
                    {f.symbol}
                  </span>
                ))}
              </div>
            )}

            <div className="text-center">
              <Loader2 className="w-6 h-6 text-emerald-500 animate-spin mx-auto opacity-70" />
            </div>

            {skipTriggered ? (
              <div className="text-center space-y-1">
                <div className="text-[14.5px] text-amber-400 flex items-center justify-center gap-1">
                  <Info className="w-3 h-3 flex-shrink-0" />
                  已跳過「{STAGE_SKIP_INFO[skippedAtPhase]?.label || '目前步驟'}」等待中項目，使用現有資料繼續計算...
                </div>
                {STAGE_SKIP_INFO[skippedAtPhase]?.consequence && (
                  <p className="text-[12.5px] text-slate-500 leading-snug px-2">
                    {STAGE_SKIP_INFO[skippedAtPhase].consequence}
                  </p>
                )}
              </div>
            ) : skipAvailable ? (
              <div className="text-center space-y-1.5">
                <p className="text-[14.5px] text-slate-400">
                  「{STAGE_SKIP_INFO[loadingStagePhase]?.label || '目前步驟'}」部分項目回應較久，可手動跳過等待以加快速度
                </p>
                {STAGE_SKIP_INFO[loadingStagePhase]?.consequence && (
                  <p className="text-[12.5px] text-slate-500 leading-snug px-2">
                    {STAGE_SKIP_INFO[loadingStagePhase].consequence}
                  </p>
                )}
                {fetchStatusList.some((f) => f.status === 'pending') && (
                  <p className="text-[12.5px] text-slate-500">
                    目前等待中:{' '}
                    {fetchStatusList
                      .filter((f) => f.status === 'pending')
                      .map((f) => f.symbol)
                      .join('、')}
                  </p>
                )}
                <button
                  onClick={() => skipResolverRef.current && skipResolverRef.current()}
                  className="inline-flex items-center gap-1.5 text-xs bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded-lg font-bold"
                >
                  <SkipForward className="w-3.5 h-3.5" /> 跳過等待，使用目前資料繼續
                </button>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {printMode && (
        <div className="fixed top-4 right-4 z-50 no-print">
          <button
            onClick={() => setPrintMode(false)}
            className="bg-slate-800 text-white px-4 py-2 rounded-full shadow-xl flex items-center gap-2 hover:bg-slate-700"
          >
            <X className="w-4 h-4" /> 退出預覽
          </button>
        </div>
      )}

      {!results && !loading && !printMode && (
        <button
          onClick={() => runBacktest()}
          disabled={
            allocationError && Object.values(enabledInputs).every((v) => v)
          }
          className={`sm:hidden fixed bottom-20 right-4 z-30 w-12 h-12 rounded-full text-white text-lg font-bold shadow-xl flex items-center justify-center no-print ${
            allocationError && Object.values(enabledInputs).every((v) => v)
              ? 'bg-slate-700 text-slate-500 cursor-not-allowed shadow-slate-900/40'
              : 'bg-gradient-to-r from-emerald-500 to-teal-600 shadow-emerald-900/40'
          }`}
          title="直接開始回測"
        >
          測
        </button>
      )}

      {!results && !loading && !printMode && (
        <button
          onClick={() =>
            window.scrollTo({
              top: document.body.scrollHeight,
              behavior: 'smooth',
            })
          }
          className="sm:hidden fixed bottom-5 right-4 z-30 w-12 h-12 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white shadow-xl shadow-emerald-900/40 flex items-center justify-center no-print"
          title="快速跳到最底"
        >
          <ChevronDown className="w-6 h-6" />
        </button>
      )}

      <header
        className={`border-b shadow-xl sm:sticky sm:top-0 z-20 no-print ${
          printMode
            ? 'bg-white border-slate-200'
            : 'bg-slate-800 border-slate-700'
        }`}
      >
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Wallet className={`w-8 h-8 ${textClass.highlight}`} />
              <div>
                <h1
                  className={`text-2xl font-bold tracking-wide ${textClass.main}`}
                >
                  台股資產配置 & 含息回測
                </h1>
                <p className={`${textClass.sub} text-sm hidden sm:block`}>
                  先設定組合，再看歷史表現
                </p>
              </div>
            </div>
            <button
              onClick={() => setIsConfigExpanded(!isConfigExpanded)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm font-medium border ${
                isConfigExpanded
                  ? 'bg-slate-700 hover:bg-slate-600 text-slate-300 border-slate-600'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500 shadow-lg shadow-emerald-500/20'
              }`}
            >
              {isConfigExpanded ? (
                <>
                  <ChevronUp className="w-4 h-4" />
                  <span>收起設定</span>
                </>
              ) : (
                <>
                  <ChevronDown className="w-4 h-4" />
                  <span>回去改設定</span>
                </>
              )}
            </button>
          </div>
