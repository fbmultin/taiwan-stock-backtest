          <div
            className={`transition-all duration-300 ease-in-out overflow-hidden ${
              isConfigExpanded
                ? 'max-h-[1500px] opacity-100'
                : 'max-h-0 opacity-0'
            }`}
          >
            <div className="grid lg:grid-cols-12 gap-6 bg-slate-900/50 p-4 rounded-xl border border-slate-700">
              <div className="lg:col-span-3 space-y-4 border-b lg:border-b-0 lg:border-r border-slate-700 pb-4 lg:pb-0 pr-0 lg:pr-4">
                <div className="flex flex-col gap-2">
                  <label className="text-xs text-slate-400 font-bold">
                    總投入本金 (萬元)
                  </label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <DollarSign className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
                      <SmartNumberInput
                        value={Math.round((totalCapital / 10000) * 10) / 10}
                        onChange={handleTotalCapitalChange}
                        className="w-full bg-slate-800 border border-slate-600 rounded-lg py-2 pl-9 pr-3 text-white focus:ring-2 focus:ring-emerald-500 font-mono"
                      />
                    </div>
                    <button
                      onClick={setAllEnabledTo100W}
                      className="bg-slate-700 hover:bg-slate-600 text-white text-[14px] px-2 rounded border border-slate-600 transition-colors whitespace-nowrap"
                      title="將所有已勾選的標的金額設為100萬"
                    >
                      全設
                      <br />
                      100萬
                    </button>
                  </div>
                  <div className="text-[14px] text-slate-500 text-right">
                    = {Math.round(totalCapital).toLocaleString()} 元
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-xs text-slate-400 font-bold">
                    回測投資年限
                  </label>
                  <div className="grid grid-cols-3 gap-1">
                    {['ytd', '3m', '6m', '12m', '3y', '5y'].map((t) => (
                      <button
                        key={t}
                        onClick={() => setTimeRange(t)}
                        className={`py-2 text-[14px] rounded border font-bold ${
                          timeRange === t
                            ? 'bg-emerald-600 border-emerald-500 text-white'
                            : 'bg-slate-800 border-slate-600 text-slate-400'
                        }`}
                      >
                        {t === 'ytd'
                          ? '今年'
                          : t === '3m'
                          ? '3個月'
                          : t === '6m'
                          ? '半年'
                          : t === '12m'
                          ? '近1年'
                          : t === '3y'
                          ? '近3年'
                          : '近5年'}
                      </button>
                    ))}
                    {[
                      { label: '2026/06/22', dateStr: '2026-06-22' },
                      { label: '2026/07/29', dateStr: '2026-07-29' },
                    ].map(({ label, dateStr }) => {
                      const todayStr = new Date().toISOString().split('T')[0];
                      const isActive =
                        timeRange === 'custom' &&
                        customStart === dateStr &&
                        customEnd === todayStr;
                      return (
                        <button
                          key={dateStr}
                          onClick={() => {
                            setCustomStart(dateStr);
                            setCustomEnd(todayStr);
                            setTimeRange('custom');
                          }}
                          className={`py-2 text-[14px] rounded border font-bold ${
                            isActive
                              ? 'bg-emerald-600 border-emerald-500 text-white'
                              : 'bg-slate-800 border-slate-600 text-slate-400'
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    onClick={() => setTimeRange('custom')}
                    className={`text-xs w-full py-2 rounded border ${
                      timeRange === 'custom'
                        ? 'bg-emerald-600 border-emerald-500 text-white'
                        : 'bg-slate-800 border-slate-600 text-slate-400'
                    }`}
                  >
                    自訂區間
                  </button>
                  <div className="flex gap-1 mt-1">
                    <input
                      type="date"
                      value={customStart}
                      onChange={(e) => {
                        setCustomStart(e.target.value);
                        setTimeRange('custom');
                      }}
                      className="w-1/2 bg-slate-800 border-slate-600 rounded text-xs p-1"
                    />
                    <input
                      type="date"
                      value={customEnd}
                      onChange={(e) => {
                        setCustomEnd(e.target.value);
                        setTimeRange('custom');
                      }}
                      className="w-1/2 bg-slate-800 border-slate-600 rounded text-xs p-1"
                    />
                  </div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <div className="flex items-center rounded border border-slate-600 overflow-hidden shrink-0">
                      <button
                        type="button"
                        onClick={() => shiftCustomRange(-1, 'day')}
                        title="起始日往前推1天"
                        className="px-2 py-1 text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-300"
                      >
                        −
                      </button>
                      <span className="px-2 py-1 text-[11px] text-slate-400 bg-slate-900 border-x border-slate-600">
                        日
                      </span>
                      <button
                        type="button"
                        onClick={() => shiftCustomRange(1, 'day')}
                        title="起始日往後推1天"
                        className="px-2 py-1 text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-300"
                      >
                        ＋
                      </button>
                    </div>
                    <div className="flex items-center rounded border border-slate-600 overflow-hidden shrink-0">
                      <button
                        type="button"
                        onClick={() => shiftCustomRange(-1)}
                        title="整段區間往前推1個月"
                        className="px-2 py-1 text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-300"
                      >
                        −
                      </button>
                      <span className="px-2 py-1 text-[11px] text-slate-400 bg-slate-900 border-x border-slate-600">
                        月
                      </span>
                      <button
                        type="button"
                        onClick={() => shiftCustomRange(1)}
                        title="整段區間往後推1個月"
                        className="px-2 py-1 text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-300"
                      >
                        ＋
                      </button>
                    </div>
                    <div className="flex items-center rounded border border-slate-600 overflow-hidden shrink-0">
                      <button
                        type="button"
                        onClick={() => shiftCustomRange(-3)}
                        title="整段區間往前推1季(3個月)"
                        className="px-2 py-1 text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-300"
                      >
                        −
                      </button>
                      <span className="px-2 py-1 text-[11px] text-slate-400 bg-slate-900 border-x border-slate-600">
                        季
                      </span>
                      <button
                        type="button"
                        onClick={() => shiftCustomRange(3)}
                        title="整段區間往後推1季(3個月)"
                        className="px-2 py-1 text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-300"
                      >
                        ＋
                      </button>
                    </div>
                  </div>
                  <div className="mt-1.5 text-[13px] font-mono text-center text-emerald-400 bg-slate-900/60 border border-slate-700 rounded py-1">
                    {formatDateForDisplay(customStart)} ～{' '}
                    {formatDateForDisplay(customEnd)}
                  </div>
                </div>
              </div>

              <div className="lg:col-span-7 space-y-3">
                <div className="flex flex-wrap items-center gap-2 mb-4 bg-slate-800/50 p-2 rounded-lg border border-slate-700/50">
                  <span className="text-xs text-slate-400 font-bold mr-2">
                    <Database className="w-4 h-4 inline mr-1" />
                    快速套用:
                  </span>
                  <button
                    onClick={handleApplyMyPreset}
                    title={
                      myPresetStocks
                        ? `套用我的常用標的: ${myPresetStocks.join('、')}`
                        : '尚未設定,請先輸入標的後按右側「設為常用」儲存'
                    }
                    className="text-xs bg-amber-900/30 hover:bg-amber-600 hover:text-white text-amber-300 px-3 py-1.5 rounded-md transition-colors border border-amber-700/60 hover:border-amber-500 flex items-center gap-1 font-bold"
                  >
                    <Star className="w-3.5 h-3.5" /> 我的常用標的
                  </button>
                  <button
                    onClick={handleSaveMyPreset}
                    title="將目前輸入的標的組合儲存為「我的常用標的」"
                    className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-2 py-1.5 rounded-md transition-colors border border-slate-600 flex items-center gap-1"
                  >
                    <Save className="w-3.5 h-3.5" /> 設為常用
                  </button>
                  {PRESETS.map((preset, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleApplyPreset(preset.stocks)}
                      className="text-xs bg-slate-700 hover:bg-emerald-600 hover:text-white text-slate-300 px-3 py-1.5 rounded-md transition-colors border border-slate-600 hover:border-emerald-500"
                    >
                      {preset.name}
                    </button>
                  ))}
                  <button
                    onClick={() => handleApplyPreset(['', '', '', '', '', ''])}
                    className="text-xs bg-rose-900/40 hover:bg-rose-600 hover:text-white text-rose-300 px-3 py-1.5 rounded-md transition-colors border border-rose-800 hover:border-rose-500 ml-auto"
                  >
                    全部清空
                  </button>
                </div>

                <div className="flex justify-between items-end mb-1">
                  <label className="text-xs text-slate-400 font-bold">
                    標的選擇 & 配置
                  </label>
                  <span
                    className={`text-xs font-mono font-bold ${
                      allocationError ? 'text-rose-400' : 'text-emerald-400'
                    }`}
                  >
                    勾選權重:{' '}
                    {Math.round(
                      Object.values(allocations).reduce(
                        (a, b, i) => a + (enabledInputs[i] ? b : 0),
                        0
                      ) * 10
                    ) / 10}
                    %
                  </span>
                </div>
                {inputs.map((val, idx) => {
                  const percent = allocations[idx] || 0;
                  const amountWan = (totalCapital * (percent / 100)) / 10000;
                  const isEnabled = enabledInputs[idx];

                  return (
                    <div
                      key={idx}
                      className={`flex flex-wrap sm:flex-nowrap items-center gap-2 sm:gap-3 transition-opacity ${
                        isEnabled ? 'opacity-100' : 'opacity-50'
                      }`}
                    >
                      <button
                        onClick={() => toggleEnabled(idx)}
                        className="text-slate-500 hover:text-white shrink-0"
                      >
                        {isEnabled ? (
                          <CheckSquare className="w-5 h-5 text-emerald-500" />
                        ) : (
                          <Square className="w-5 h-5" />
                        )}
                      </button>
                      <div className="relative w-24 sm:w-28 shrink-0">
                        <input
                          type="text"
                          onFocus={handleInputFocus}
                          value={val}
                          onChange={(e) =>
                            handleInputChange(idx, e.target.value)
                          }
                          onBlur={() => handleInputBlurInApp(idx, val)}
                          placeholder={`標的 ${idx + 1}`}
                          className="w-full bg-slate-800 border border-slate-600 rounded-md py-1.5 pl-2 pr-2 text-sm text-white font-mono uppercase"
                        />
                        {stockNames[val] && (
                          <div className="absolute left-0 -bottom-4 text-[13px] text-slate-400 whitespace-nowrap overflow-hidden text-ellipsis w-full">
                            {stockNames[val]}
                          </div>
                        )}
                      </div>
                      <div
                        className={`flex-1 flex items-center gap-2 w-full sm:w-auto ${
                          val && isEnabled
                            ? 'opacity-100'
                            : 'opacity-30 pointer-events-none'
                        }`}
                      >
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="0.5"
                          value={percent}
                          onChange={(e) =>
                            handleAllocationChange(idx, e.target.value)
                          }
                          className={`flex-1 h-1.5 rounded-lg appearance-none cursor-pointer ${
                            allocationError
                              ? 'bg-rose-900/50 accent-rose-500'
                              : 'bg-slate-700 accent-emerald-500'
                          }`}
                        />
                        <div className="relative w-12 sm:w-14 shrink-0">
                          <SmartNumberInput
                            value={Math.round(percent * 10) / 10}
                            onChange={(val) => handleAllocationChange(idx, val)}
                            className={`w-full bg-transparent border rounded px-1 text-right font-mono text-xs focus:outline-none ${
                              allocationError
                                ? 'text-rose-400 border-rose-900/50'
                                : 'text-white border-slate-700 focus:border-blue-500'
                            }`}
                          />
                          <span className="absolute right-5 -top-3 text-[14px] text-slate-500">
                            %
                          </span>
                        </div>
                        <div className="relative w-14 sm:w-16 shrink-0 flex items-center gap-1">
                          <div className="relative flex-1">
                            <SmartNumberInput
                              value={Math.round(amountWan * 10) / 10}
                              onChange={(val) => handleAmountChange(idx, val)}
                              className={`w-full bg-slate-800 border rounded px-1 text-right font-mono text-xs focus:outline-none text-emerald-400 border-slate-600 focus:ring-1 focus:ring-emerald-500`}
                            />
                            <span className="absolute right-0.5 -top-2.5 text-[13px] text-slate-500">
                              萬
                            </span>
                          </div>
                          <button
                            onClick={() => handleAmountChange(idx, 100)}
                            className="text-[13px] bg-slate-700 hover:bg-slate-600 text-slate-300 px-1.5 py-1 rounded border border-slate-600 whitespace-nowrap flex items-center"
                            title="設為100萬"
                          >
                            <MousePointerClick className="w-3 h-3 mr-0.5" /> 100
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
