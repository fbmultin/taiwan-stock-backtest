import React, { useMemo, useState } from 'react';
import { TrendingUp, RefreshCw, AlertTriangle, Zap, Info } from 'lucide-react';
import { fetchStockPriceData, fetchStockDisplayName } from './dataCache';
import {
  MA_LINE_KEYS,
  MA_LINE_LABELS,
  preprocessPriceSeries,
  buildParamCombinations,
  runOptimizationBatch,
  OPTIMIZE_OBJECTIVES,
  OPTIMIZE_OBJECTIVE_LABELS,
  COMBINATION_COUNT_WARNING_THRESHOLD,
  COMBINATION_COUNT_HARD_LIMIT,
} from './dcaEngine';

// 每條均線(月線/季線/半年線)加碼條件的預設值:預設不啟用,
// 啟用後預設「偏離5% 時,固定加碼一萬元」,使用者可自行改成範圍或改用倍數模式。
const buildDefaultLineConfig = () => ({
  enabled: false,
  topUpMode: 'fixed', // 'fixed' 固定金額 | 'multiple' 基礎倍數
  deviationRange: { min: 5, max: 5, step: 1 },
  topUpRange: { min: 10000, max: 10000, step: 5000 },
});

const RangeInputGroup = ({ unit, value, onChange }) => {
  const set = (patch) => onChange({ ...value, ...patch });
  return (
    <div className="grid grid-cols-3 gap-1">
      <div>
        <div className="text-[11px] text-slate-500">最小{unit ? `(${unit})` : ''}</div>
        <input
          type="number"
          value={value.min}
          onChange={(e) => set({ min: parseFloat(e.target.value) })}
          className="w-full bg-slate-800 border border-slate-600 rounded text-xs p-1"
        />
      </div>
      <div>
        <div className="text-[11px] text-slate-500">最大</div>
        <input
          type="number"
          value={value.max}
          onChange={(e) => set({ max: parseFloat(e.target.value) })}
          className="w-full bg-slate-800 border border-slate-600 rounded text-xs p-1"
        />
      </div>
      <div>
        <div className="text-[11px] text-slate-500">間距</div>
        <input
          type="number"
          value={value.step}
          onChange={(e) => set({ step: parseFloat(e.target.value) })}
          className="w-full bg-slate-800 border border-slate-600 rounded text-xs p-1"
        />
      </div>
    </div>
  );
};

const Metric = ({ label, value, highlight }) => (
  <div className="flex flex-col">
    <span className="text-[12px] text-slate-500">{label}</span>
    <span className={`font-mono font-bold ${highlight ? 'text-emerald-400' : 'text-slate-200'}`}>
      {value}
    </span>
  </div>
);

const describeConfig = (config) => {
  const parts = [];
  MA_LINE_KEYS.forEach((key) => {
    const line = config.maLines[key];
    if (line && line.enabled) {
      const modeLabel =
        line.topUpMode === 'multiple'
          ? `${line.topUpValue}倍`
          : `$${Math.round(line.topUpValue).toLocaleString()}`;
      const triggerLabel = config.useKLineCrossTrigger ? 'K線穿越均線' : `偏離${line.deviationPct}%`;
      parts.push(`${MA_LINE_LABELS[key]} ${triggerLabel}/${modeLabel}`);
    }
  });
  if (parts.length === 0) parts.push('未啟用加碼(純定期定額)');
  parts.push(`每月上限${config.monthlyTriggerCap}次`);
  parts.push(`再投${Math.round(config.reinvestRatio * 100)}%`);
  return parts.join(' · ');
};

const todayStr = () => new Date().toISOString().split('T')[0];

export default function DcaOptimizer() {
  const [symbol, setSymbol] = useState('');
  const [stockName, setStockName] = useState('');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 3);
    return d.toISOString().split('T')[0];
  });
  const [monthlyAmount, setMonthlyAmount] = useState(10000);
  const [investDay, setInvestDay] = useState(5);

  const [maLineConfigs, setMaLineConfigs] = useState({
    ma20: buildDefaultLineConfig(),
    ma60: buildDefaultLineConfig(),
    ma120: buildDefaultLineConfig(),
  });
  const [monthlyTriggerCapRange, setMonthlyTriggerCapRange] = useState({
    min: 1,
    max: 1,
    step: 1,
  });
  const [reinvestRatioRange, setReinvestRatioRange] = useState({
    min: 100,
    max: 100,
    step: 0,
  });
  const [useKLineCrossTrigger, setUseKLineCrossTrigger] = useState(false);
  const [objective, setObjective] = useState(OPTIMIZE_OBJECTIVES.BALANCED);

  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState('');
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [topResults, setTopResults] = useState(null);
  const [dataSourceInfo, setDataSourceInfo] = useState(null);

  const updateLineConfig = (key, patch) => {
    setMaLineConfigs((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };

  const optimizerConfig = useMemo(
    () => ({
      base: {
        startDate,
        monthlyAmount: Number(monthlyAmount) || 0,
        investDay: Number(investDay) || 1,
      },
      maLines: {
        ma20: maLineConfigs.ma20,
        ma60: maLineConfigs.ma60,
        ma120: maLineConfigs.ma120,
      },
      monthlyTriggerCapRange,
      reinvestRatioRange,
      useKLineCrossTrigger,
    }),
    [
      startDate,
      monthlyAmount,
      investDay,
      maLineConfigs,
      monthlyTriggerCapRange,
      reinvestRatioRange,
      useKLineCrossTrigger,
    ]
  );

  const previewCombinationCount = useMemo(() => {
    try {
      return buildParamCombinations(optimizerConfig).length;
    } catch (e) {
      return 0;
    }
  }, [optimizerConfig]);

  const runOptimization = async () => {
    setErrorMsg('');
    setTopResults(null);
    setDataSourceInfo(null);

    const cleanSymbol = symbol.trim().toUpperCase();
    if (!cleanSymbol) {
      setErrorMsg('請輸入股票代碼。');
      return;
    }
    if (!(Number(monthlyAmount) > 0)) {
      setErrorMsg('每月定期定額金額必須大於 0。');
      return;
    }
    if (previewCombinationCount > COMBINATION_COUNT_HARD_LIMIT) {
      setErrorMsg(
        `目前參數組合數為 ${previewCombinationCount.toLocaleString()} 組,超過上限(${COMBINATION_COUNT_HARD_LIMIT.toLocaleString()}),請縮小搜尋範圍或加大間距後再試一次。`
      );
      return;
    }

    setLoading(true);
    setProgress(0);
    setLoadingStage('正在抓取股價與配息資料...');

    try {
      const priceResult = await fetchStockPriceData(cleanSymbol);
      if (!priceResult || !priceResult.data || priceResult.data.length === 0) {
        setErrorMsg('無法取得股價資料,請確認代碼是否正確。');
        setLoading(false);
        return;
      }
      setDataSourceInfo({
        source: priceResult.source,
        fromCache: priceResult.fromCache,
        dataPoints: priceResult.data.length,
        firstDate: priceResult.data[0]?.date,
        lastDate: priceResult.data[priceResult.data.length - 1]?.date,
      });
      setProgress(15);

      fetchStockDisplayName(cleanSymbol)
        .then((name) => {
          if (name) setStockName(name);
        })
        .catch(() => {});

      setLoadingStage('正在計算均線(MA20/MA60/MA120)與除息標記...');
      const preprocessed = preprocessPriceSeries(priceResult);
      setProgress(25);

      const combos = buildParamCombinations(optimizerConfig);
      if (combos.length === 0) {
        setErrorMsg('沒有產生任何可執行的參數組合,請檢查參數設定。');
        setLoading(false);
        return;
      }

      setLoadingStage(`正在批次回測(共 ${combos.length.toLocaleString()} 組參數)...`);
      const top5 = await runOptimizationBatch({
        preprocessedData: preprocessed,
        paramCombinations: combos,
        objective,
        topN: 5,
        onProgress: (done, total) => {
          setProgress(25 + (done / total) * 74);
          setLoadingStage(
            `正在批次回測... (${done.toLocaleString()}/${total.toLocaleString()})`
          );
        },
      });
      setProgress(100);

      if (top5.length === 0) {
        setErrorMsg(
          '這段期間的資料不足以完成任何一組策略的模擬,請確認起始日期是否早於股票上市日,或調整參數範圍。'
        );
      } else {
        setTopResults(top5);
      }
    } catch (e) {
      setErrorMsg('執行時發生錯誤:' + (e?.message || String(e)));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-4">
        <h2 className="font-bold text-lg flex items-center gap-2 text-slate-100">
          <TrendingUp className="w-5 h-5 text-emerald-400" />
          定期定額策略最佳化
        </h2>
        <p className="text-[13px] text-slate-400 leading-relaxed">
          設定股票代碼、起始日期與每月定期定額金額後,可另外開啟月線
          (MA20)、季線(MA60)、半年線(MA120)三組獨立的加碼條件,每個參數都用
          「最小 / 最大 / 間距」設定搜尋範圍(最小=最大時等同固定單一數值)。
          系統會自動排列組合所有範圍內的參數跑批次回測,依您選擇的目標排序,
          輸出成效前 5 名的策略組合。
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-slate-400 font-bold">股票代碼</label>
            <input
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="例如 0050、2330"
              className="w-full mt-1 bg-slate-800 border border-slate-600 rounded p-2 text-sm"
            />
            {stockName && (
              <div className="text-[12px] text-slate-500 mt-0.5">{stockName}</div>
            )}
          </div>
          <div>
            <label className="text-xs text-slate-400 font-bold">回測起始日期</label>
            <input
              type="date"
              value={startDate}
              max={todayStr()}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full mt-1 bg-slate-800 border border-slate-600 rounded p-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 font-bold">每月定期定額金額</label>
            <input
              type="number"
              value={monthlyAmount}
              onChange={(e) => setMonthlyAmount(e.target.value)}
              className="w-full mt-1 bg-slate-800 border border-slate-600 rounded p-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 font-bold">每月投入日(1~31)</label>
            <input
              type="number"
              min={1}
              max={31}
              value={investDay}
              onChange={(e) => setInvestDay(e.target.value)}
              className="w-full mt-1 bg-slate-800 border border-slate-600 rounded p-2 text-sm"
            />
            <div className="text-[11px] text-slate-500 mt-0.5">
              遇非交易日順延至當月第一個交易日
            </div>
          </div>
        </div>
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3">
        <h3 className="font-bold text-slate-100 flex items-center gap-2">
          加碼條件(三組,各自獨立開關)
        </h3>

        <label className="flex items-start gap-2 cursor-pointer bg-slate-900/50 border border-slate-700 rounded-lg p-3">
          <input
            type="checkbox"
            checked={useKLineCrossTrigger}
            onChange={() => setUseKLineCrossTrigger((v) => !v)}
            className="mt-0.5"
          />
          <span>
            <span className="font-bold text-sm text-slate-200">
              用「K線穿越均線」判斷加碼(取代偏離%規則)
            </span>
            <div className="text-[12px] text-slate-400 mt-0.5 leading-relaxed">
              全域套用於所有已啟用的均線:模擬在均線價位掛買進限價單——前一天收盤價高於前一天均線,且今天最低價跌到均線價位以下(含等於)才成交。開啟後,下方各均線的「觸發偏離%」範圍會停用,不會納入最佳化搜尋。
            </div>
          </span>
        </label>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {MA_LINE_KEYS.map((key) => {
            const line = maLineConfigs[key];
            return (
              <div
                key={key}
                className="bg-slate-800/60 border border-slate-700 rounded-lg p-3 space-y-2"
              >
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={line.enabled}
                    onChange={() => updateLineConfig(key, { enabled: !line.enabled })}
                  />
                  <span className="font-bold text-sm text-slate-200">
                    {MA_LINE_LABELS[key]}
                  </span>
                </label>
                {line.enabled && (
                  <>
                    <div className={useKLineCrossTrigger ? 'opacity-40 pointer-events-none' : ''}>
                      <div className="text-[12px] text-slate-400 mb-1">
                        觸發偏離%(收盤價低於均線多少% 觸發)
                        {useKLineCrossTrigger && '(已改用K線穿越,此設定停用)'}
                      </div>
                      <RangeInputGroup
                        unit="%"
                        value={line.deviationRange}
                        onChange={(range) => updateLineConfig(key, { deviationRange: range })}
                      />
                    </div>
                    <div className="flex items-center gap-3 text-[12px] text-slate-300">
                      <span className="text-slate-400">加碼方式:</span>
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="radio"
                          name={`${key}-topupmode`}
                          checked={line.topUpMode === 'fixed'}
                          onChange={() => updateLineConfig(key, { topUpMode: 'fixed' })}
                        />
                        固定金額
                      </label>
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="radio"
                          name={`${key}-topupmode`}
                          checked={line.topUpMode === 'multiple'}
                          onChange={() => updateLineConfig(key, { topUpMode: 'multiple' })}
                        />
                        基礎倍數
                      </label>
                    </div>
                    <div>
                      <div className="text-[12px] text-slate-400 mb-1">
                        {line.topUpMode === 'multiple'
                          ? '加碼倍數(× 每月定額)'
                          : '加碼金額(元)'}
                      </div>
                      <RangeInputGroup
                        unit={line.topUpMode === 'multiple' ? '倍' : '元'}
                        value={line.topUpRange}
                        onChange={(range) => updateLineConfig(key, { topUpRange: range })}
                      />
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-700/50">
          <div>
            <div className="text-[12px] text-slate-400 mb-1">
              每月共用觸發次數上限(三條線共用額度,誰先觸發誰先買)
            </div>
            <RangeInputGroup
              unit="次"
              value={monthlyTriggerCapRange}
              onChange={setMonthlyTriggerCapRange}
            />
          </div>
          <div>
            <div className="text-[12px] text-slate-400 mb-1">配息再投入比例</div>
            <RangeInputGroup
              unit="%"
              value={reinvestRatioRange}
              onChange={setReinvestRatioRange}
            />
          </div>
        </div>
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <label className="text-xs text-slate-400 font-bold">最佳化目標</label>
            <select
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              className="w-full sm:w-auto mt-1 bg-slate-800 border border-slate-600 rounded p-2 text-sm"
            >
              {Object.entries(OPTIMIZE_OBJECTIVE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="text-[13px] text-right">
            <div
              className={`font-bold ${
                previewCombinationCount > COMBINATION_COUNT_WARNING_THRESHOLD
                  ? 'text-amber-400'
                  : 'text-slate-300'
              }`}
            >
              目前參數組合數:{previewCombinationCount.toLocaleString()} 組
            </div>
            {previewCombinationCount > COMBINATION_COUNT_WARNING_THRESHOLD && (
              <div className="text-amber-400/80 text-[12px] flex items-center gap-1 justify-end">
                <AlertTriangle className="w-3 h-3" />
                組合數較多,執行可能需要較長時間
              </div>
            )}
          </div>
        </div>

        <button
          onClick={runOptimization}
          disabled={loading}
          className={`w-full py-3 rounded-xl font-bold shadow-lg flex items-center justify-center gap-2 transition-all ${
            loading
              ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
              : 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white'
          }`}
        >
          {loading ? (
            <RefreshCw className="animate-spin w-5 h-5" />
          ) : (
            <>
              <Zap className="w-5 h-5 fill-current" /> 開始最佳化
            </>
          )}
        </button>

        {loading && (
          <div>
            <div className="w-full bg-slate-700 rounded-full h-2 overflow-hidden">
              <div
                className="bg-emerald-500 h-2 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="text-[12px] text-slate-400 mt-1">{loadingStage}</div>
          </div>
        )}

        {errorMsg && (
          <div className="text-[13px] text-rose-400 bg-rose-900/20 border border-rose-800/50 rounded-lg p-2 flex items-start gap-1.5">
            <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {dataSourceInfo && (
          <div className="text-[12px] text-slate-500 flex items-center gap-1.5">
            <Info className="w-3 h-3 flex-shrink-0" />
            資料來源:
            {dataSourceInfo.fromCache
              ? '本機快取'
              : dataSourceInfo.source || '即時抓取'}
            ,共 {dataSourceInfo.dataPoints} 筆({dataSourceInfo.firstDate} ~{' '}
            {dataSourceInfo.lastDate})
          </div>
        )}
      </div>

      {topResults && (
        <div className="space-y-3">
          <h3 className="font-bold text-lg text-slate-100">
            成效前 {topResults.length} 名策略({OPTIMIZE_OBJECTIVE_LABELS[objective]})
          </h3>
          {topResults.map((item, idx) => (
            <div
              key={idx}
              className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3"
            >
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="bg-yellow-500 text-slate-900 text-xs px-2 py-0.5 rounded font-bold">
                    第 {idx + 1} 名
                  </span>
                </div>
                <div className="text-[12px] text-slate-400 text-right">
                  {describeConfig(item.config)}
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Metric
                  label="總投入金額"
                  value={`$${Math.round(item.result.totalInvested).toLocaleString()}`}
                />
                <Metric
                  label="目前市值"
                  value={`$${Math.round(item.result.finalMarketValue).toLocaleString()}`}
                  highlight
                />
                <Metric
                  label="總報酬率(不含息)"
                  value={`${item.result.totalReturnPct >= 0 ? '+' : ''}${item.result.totalReturnPct.toFixed(2)}%`}
                />
                <Metric
                  label="含息報酬率"
                  value={`${item.result.dividendReturnPct >= 0 ? '+' : ''}${item.result.dividendReturnPct.toFixed(2)}%`}
                  highlight
                />
                <Metric label="CAGR(年化報酬率)" value={`${item.result.cagr.toFixed(2)}%`} />
                <Metric
                  label="累計配息金額"
                  value={`$${Math.round(item.result.totalDividends).toLocaleString()}`}
                />
                <Metric
                  label="最大回撤"
                  value={`${item.result.maxDrawdownPct.toFixed(2)}%`}
                />
                <Metric
                  label="回測區間"
                  value={`${item.result.startDate} ~ ${item.result.endDate}`}
                />
                <Metric
                  label="加碼實際成交次數"
                  value={`${item.result.topUpEvents.filter((e) => !e.skipped).length} 次`}
                />
              </div>
              <details className="text-[12px] text-slate-400">
                <summary className="cursor-pointer select-none text-slate-300 font-bold">
                  各年度報酬拆解
                </summary>
                <div className="overflow-x-auto mt-2">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="text-slate-500 border-b border-slate-700">
                        <th className="text-left py-1">年度</th>
                        <th className="text-right py-1">年底市值</th>
                        <th className="text-right py-1">累計投入</th>
                        <th className="text-right py-1">年度變動%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {item.result.yearlyBreakdown.map((y) => (
                        <tr key={y.year} className="border-b border-slate-800">
                          <td className="py-1">{y.year}</td>
                          <td className="text-right py-1 font-mono">
                            ${Math.round(y.endValue).toLocaleString()}
                          </td>
                          <td className="text-right py-1 font-mono">
                            ${Math.round(y.totalInvested).toLocaleString()}
                          </td>
                          <td
                            className={`text-right py-1 font-mono ${
                              y.yearReturnPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {y.yearReturnPct >= 0 ? '+' : ''}
                            {y.yearReturnPct.toFixed(2)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="text-[11px] text-slate-600 mt-1">
                  年度變動% 為簡化呈現(今年底市值 vs
                  去年底市值,第一年則為今年底市值vs今年度累計投入),會同時反映市場漲跌與當年度資金投入的影響,並非嚴格的年化報酬。
                </div>
              </details>

              {item.result.topUpEvents.length > 0 && (
                <details className="text-[12px] text-slate-400">
                  <summary className="cursor-pointer select-none text-slate-300 font-bold">
                    加碼明細(共 {item.result.topUpEvents.length} 次觸發,
                    {item.result.topUpEvents.filter((e) => !e.skipped).length} 次成交)
                  </summary>
                  <div className="overflow-x-auto mt-2">
                    <table className="w-full text-[12px]">
                      <thead>
                        <tr className="text-slate-500 border-b border-slate-700">
                          <th className="text-left py-1">日期</th>
                          <th className="text-left py-1">觸發均線</th>
                          <th className="text-left py-1">加碼原因</th>
                          <th className="text-right py-1">加碼金額</th>
                        </tr>
                      </thead>
                      <tbody>
                        {item.result.topUpEvents.map((e, i) => (
                          <tr
                            key={i}
                            className={`border-b border-slate-800 ${
                              e.skipped ? 'text-slate-600 italic' : ''
                            }`}
                          >
                            <td className="py-1 font-mono">{e.date}</td>
                            <td className="py-1">{e.lineLabel}</td>
                            <td className="py-1">
                              {e.triggerMode === 'kline' ? (
                                <>
                                  前一天收盤 {e.prevPrice.toFixed(2)} {'>'} 前一天均線{' '}
                                  {e.prevMa.toFixed(2)},今天最低價 {e.low.toFixed(2)} ≤ 今天均線{' '}
                                  {e.ma.toFixed(2)}
                                </>
                              ) : (
                                <>
                                  收盤價 {e.price.toFixed(2)} 跌破均線 {e.ma.toFixed(2)},
                                  乖離 {e.deviationPct.toFixed(2)}%(門檻 -{e.thresholdPct}%)
                                </>
                              )}
                              {e.skipped
                                ? ',但當月加碼配額已用完,未實際加碼'
                                : `,依設定${
                                    e.topUpMode === 'multiple'
                                      ? `以${e.topUpValue}倍定額`
                                      : '固定金額'
                                  }加碼`}
                            </td>
                            <td className="text-right py-1 font-mono">
                              {e.skipped ? '—' : `$${Math.round(e.topUpAmount).toLocaleString()}`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="text-[11px] text-slate-600 mt-1">
                    {item.config.useKLineCrossTrigger
                      ? '「觸發」代表模擬在均線價位掛買進限價單成交(前一天收盤高於前一天均線,且當天最低價跌到均線價位以下);'
                      : '「觸發」代表收盤價當天首次跌破該均線的乖離門檻;'}
                    若當月共用配額已被其他均線用完,會顯示「未實際加碼」(灰階斜體),要等下個月配額重置才會恢復。
                  </div>
                </details>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
