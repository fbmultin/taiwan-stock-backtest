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
  KLINE_SUBMODE_KEYS,
  KLINE_SUBMODE_LABELS,
  DEFAULT_KLINE_SUBMODE_ENABLED,
  KLINE_PYRAMID_PRESETS,
} from './dcaEngine';

// 每條均線(月線/季線/半年線)加碼條件的預設值:預設不啟用,
// 啟用後預設「偏離5% 時,固定加碼一萬元」,使用者可自行改成範圍或改用倍數模式。
const buildDefaultLineConfig = () => ({
  enabled: false,
  topUpMode: 'fixed', // 'fixed' 固定金額 | 'multiple' 基礎倍數
  deviationRange: { min: 5, max: 5, step: 1 },
  topUpRange: { min: 10000, max: 10000, step: 5000 },
});

const RangeInputGroup = ({ unit, value, onChange, isLight }) => {
  const set = (patch) => onChange({ ...value, ...patch });
  const subText = isLight ? 'text-slate-500' : 'text-slate-500';
  const inputClass = isLight
    ? 'w-full bg-white border border-slate-300 rounded text-xs p-1 text-slate-900'
    : 'w-full bg-slate-800 border border-slate-600 rounded text-xs p-1';
  return (
    <div className="grid grid-cols-3 gap-1">
      <div>
        <div className={`text-[11px] ${subText}`}>最小{unit ? `(${unit})` : ''}</div>
        <input
          type="number"
          value={value.min}
          onChange={(e) => set({ min: parseFloat(e.target.value) })}
          className={inputClass}
        />
      </div>
      <div>
        <div className={`text-[11px] ${subText}`}>最大</div>
        <input
          type="number"
          value={value.max}
          onChange={(e) => set({ max: parseFloat(e.target.value) })}
          className={inputClass}
        />
      </div>
      <div>
        <div className={`text-[11px] ${subText}`}>間距</div>
        <input
          type="number"
          value={value.step}
          onChange={(e) => set({ step: parseFloat(e.target.value) })}
          className={inputClass}
        />
      </div>
    </div>
  );
};

const Metric = ({ label, value, highlight, isLight }) => (
  <div className="flex flex-col">
    <span className={`text-[12px] ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>{label}</span>
    <span
      className={`font-mono font-bold ${
        highlight
          ? isLight
            ? 'text-emerald-600'
            : 'text-emerald-400'
          : isLight
          ? 'text-slate-700'
          : 'text-slate-200'
      }`}
    >
      {value}
    </span>
  </div>
);

// 描述一組結果的參數組合,結果卡片右上角的一行摘要。K線穿越模式(新引擎,與 Tab1
// 共用)與偏離%模式(舊版,獨立不受影響)參數形狀完全不同,分開描述。
const describeConfig = (config) => {
  if (config.useKLineCrossTrigger) {
    const kc = config.klineConfig || {};
    const enabledLines = MA_LINE_KEYS.filter((key) => {
      const m = kc.subModeConfig && kc.subModeConfig[key];
      return m && (m.breakdown || m.pullback || m.recovery);
    });
    const lineSummaries = enabledLines.map((key) => {
      const m = kc.subModeConfig[key];
      const subs = KLINE_SUBMODE_KEYS.filter((s) => m[s]).map((s) => KLINE_SUBMODE_LABELS[s]);
      return `${MA_LINE_LABELS[key]}(${subs.join('/')})`;
    });
    const parts = [];
    parts.push(lineSummaries.length > 0 ? lineSummaries.join('、') : '未啟用任何均線');
    parts.push(kc.pyramidPresetName || '自訂倍數');
    parts.push(`冷卻${kc.cooldownDays?.ma20 ?? '—'}日`);
    parts.push(
      kc.decayWindowDays > 0 ? `遞減${kc.decayWindowDays}日/下限${kc.decayFloorPct}%` : '不遞減'
    );
    if (kc.chopEnabled) parts.push(`盤整偵測${kc.chopWindowDays}日/${kc.chopThresholdPct}%`);
    if (kc.totalCapEnabled) parts.push(`總量上限${kc.totalCapCount}次`);
    parts.push(`再投${Math.round(config.reinvestRatio * 100)}%`);
    return parts.join(' · ');
  }

  const parts = [];
  MA_LINE_KEYS.forEach((key) => {
    const line = config.maLines[key];
    if (line && line.enabled) {
      const modeLabel =
        line.topUpMode === 'multiple'
          ? `${line.topUpValue}倍`
          : `$${Math.round(line.topUpValue).toLocaleString()}`;
      parts.push(`${MA_LINE_LABELS[key]} 偏離${line.deviationPct}%/${modeLabel}`);
    }
  });
  if (parts.length === 0) parts.push('未啟用加碼(純定期定額)');
  parts.push(`每月上限${config.monthlyTriggerCap}次`);
  parts.push(`再投${Math.round(config.reinvestRatio * 100)}%`);
  return parts.join(' · ');
};

// 解析使用者輸入的股票代碼:逗號、全形逗號、頓號、空白都當分隔符,
// 自動去除空白、轉大寫、去重複,最多取前 MAX_COMPARE_SYMBOLS 檔。
export const MAX_COMPARE_SYMBOLS = 5;

// 股票代碼輸入框預設帶入的常用標的組合,方便使用者不用每次都手動輸入;
// 游標一移入輸入框(focus)就清空,讓使用者可以直接開始輸入自己要的代碼。
const DEFAULT_SYMBOL_INPUT = '00913,00947,00935,00891,00904';
export const parseSymbolsInput = (raw) => {
  const parts = (raw || '')
    .split(/[,，、\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const seen = new Set();
  const unique = [];
  parts.forEach((s) => {
    if (!seen.has(s)) {
      seen.add(s);
      unique.push(s);
    }
  });
  return unique;
};

// 單一策略結果的完整明細卡片(成效指標 + 各年度拆解 + 加碼明細),
// 單檔模式(前5名)與多檔比較模式(每檔最佳一組)共用同一份渲染邏輯。
const ResultDetailCard = ({ item, badge, isLight }) => {
  const cardClass = isLight
    ? 'bg-white border border-slate-300 rounded-xl p-4 space-y-3'
    : 'bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3';
  const subText = isLight ? 'text-slate-500' : 'text-slate-400';
  const tableBorder = isLight ? 'border-slate-300' : 'border-slate-700';
  const rowBorder = isLight ? 'border-slate-200' : 'border-slate-800';
  const summaryText = isLight ? 'text-slate-700' : 'text-slate-300';
  const footnoteText = isLight ? 'text-slate-500' : 'text-slate-600';
  return (
    <div className={cardClass}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">{badge}</div>
        <div className={`text-[12px] ${subText} text-right`}>{describeConfig(item.config)}</div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Metric
          isLight={isLight}
          label="總投入金額"
          value={`$${Math.round(item.result.totalInvested).toLocaleString()}`}
        />
        <Metric
          isLight={isLight}
          label="目前市值"
          value={`$${Math.round(item.result.finalMarketValue).toLocaleString()}`}
          highlight
        />
        <Metric
          isLight={isLight}
          label="總報酬率(不含息)"
          value={`${item.result.totalReturnPct >= 0 ? '+' : ''}${item.result.totalReturnPct.toFixed(2)}%`}
        />
        <Metric
          isLight={isLight}
          label="含息報酬率"
          value={`${item.result.dividendReturnPct >= 0 ? '+' : ''}${item.result.dividendReturnPct.toFixed(2)}%`}
          highlight
        />
        <Metric isLight={isLight} label="CAGR(年化報酬率)" value={`${item.result.cagr.toFixed(2)}%`} />
        <Metric
          isLight={isLight}
          label="累計配息金額"
          value={`$${Math.round(item.result.totalDividends).toLocaleString()}`}
        />
        <Metric isLight={isLight} label="最大回撤" value={`${item.result.maxDrawdownPct.toFixed(2)}%`} />
        <Metric
          isLight={isLight}
          label="回測區間"
          value={`${item.result.startDate} ~ ${item.result.endDate}`}
        />
        <Metric
          isLight={isLight}
          label="加碼實際成交次數"
          value={`${item.result.topUpEvents.filter((e) => !e.skipped).length} 次`}
        />
      </div>
      <details className={`text-[12px] ${subText}`}>
        <summary className={`cursor-pointer select-none ${summaryText} font-bold`}>
          各年度報酬拆解
        </summary>
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-[12px]">
            <thead>
              <tr className={`${isLight ? 'text-slate-500' : 'text-slate-500'} border-b ${tableBorder}`}>
                <th className="text-left py-1">年度</th>
                <th className="text-right py-1">年底市值</th>
                <th className="text-right py-1">累計投入</th>
                <th className="text-right py-1">年度變動%</th>
              </tr>
            </thead>
            <tbody>
              {item.result.yearlyBreakdown.map((y) => (
                <tr key={y.year} className={`border-b ${rowBorder}`}>
                  <td className="py-1">{y.year}</td>
                  <td className="text-right py-1 font-mono">
                    ${Math.round(y.endValue).toLocaleString()}
                  </td>
                  <td className="text-right py-1 font-mono">
                    ${Math.round(y.totalInvested).toLocaleString()}
                  </td>
                  <td
                    className={`text-right py-1 font-mono ${
                      y.yearReturnPct >= 0
                        ? isLight
                          ? 'text-emerald-600'
                          : 'text-emerald-400'
                        : isLight
                        ? 'text-rose-600'
                        : 'text-rose-400'
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
        <div className={`text-[11px] ${footnoteText} mt-1`}>
          年度變動% 為簡化呈現(今年底市值 vs
          去年底市值,第一年則為今年底市值vs今年度累計投入),會同時反映市場漲跌與當年度資金投入的影響,並非嚴格的年化報酬。
        </div>
      </details>

      {item.result.topUpEvents.length > 0 && (
        <details className={`text-[12px] ${subText}`}>
          <summary className={`cursor-pointer select-none ${summaryText} font-bold`}>
            加碼明細(共 {item.result.topUpEvents.length} 次觸發,
            {item.result.topUpEvents.filter((e) => !e.skipped).length} 次成交)
          </summary>
          <div className="overflow-x-auto mt-2">
            <table className="w-full text-[12px]">
              <thead>
                <tr className={`${isLight ? 'text-slate-500' : 'text-slate-500'} border-b ${tableBorder}`}>
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
                    className={`border-b ${rowBorder} ${
                      e.skipped ? (isLight ? 'text-slate-400 italic' : 'text-slate-600 italic') : ''
                    }`}
                  >
                    <td className="py-1 font-mono">{e.date}</td>
                    <td className="py-1">
                      {e.lineLabel}
                      {e.triggerMode === 'kline' && e.subModeLabel ? `·${e.subModeLabel}` : ''}
                    </td>
                    <td className="py-1">
                      {e.triggerMode === 'kline' ? (
                        <>
                          {e.skipped
                            ? e.skipReason || '未達加碼門檻'
                            : `倍數${e.multiplier?.toFixed(1)}x × 遞減${Math.round(
                                (e.decayRatio ?? 1) * 100
                              )}%`}
                        </>
                      ) : (
                        <>
                          收盤價 {e.price.toFixed(2)} 跌破均線 {e.ma.toFixed(2)},
                          乖離 {e.deviationPct.toFixed(2)}%(門檻 -{e.thresholdPct}%)
                          {e.skipped
                            ? ',但當月加碼配額已用完,未實際加碼'
                            : `,依設定${
                                e.topUpMode === 'multiple' ? `以${e.topUpValue}倍定額` : '固定金額'
                              }加碼`}
                        </>
                      )}
                    </td>
                    <td className="text-right py-1 font-mono">
                      {e.skipped ? '—' : `$${Math.round(e.topUpAmount).toLocaleString()}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={`text-[11px] ${footnoteText} mt-1`}>
            {item.config.useKLineCrossTrigger
              ? '「加碼原因」欄顯示觸發的子模式(跌破/回檔/站回)套用的金字塔倍數與距上次加碼的遞減折扣;若被冷卻期未滿、判定為盤整、或已達合計加碼次數上限擋下,會顯示原因(灰階斜體,未實際成交)。'
              : '「觸發」代表收盤價當天首次跌破該均線的乖離門檻;若當月共用配額已被其他均線用完,會顯示「未實際加碼」(灰階斜體),要等下個月配額重置才會恢復。'}
          </div>
        </details>
      )}
    </div>
  );
};

const todayStr = () => new Date().toISOString().split('T')[0];

export default function DcaOptimizer({ isLight = false }) {
  const [symbolInput, setSymbolInput] = useState(DEFAULT_SYMBOL_INPUT);
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

  // K線穿越模式(新引擎,與 Tab1「ETF回測比較」共用同一套邏輯)專用的參數。
  // 子模式開關與總量上限是使用者直接設定的固定選擇,不參與範圍搜尋;其餘皆可
  // 設定「最小/最大/間距」範圍讓最佳化去找最好的數字。
  const [klineBaseAmount, setKlineBaseAmount] = useState(10000);
  const [klineSubModeEnabled, setKlineSubModeEnabled] = useState(() => ({
    ma20: DEFAULT_KLINE_SUBMODE_ENABLED(),
    ma60: DEFAULT_KLINE_SUBMODE_ENABLED(),
    ma120: DEFAULT_KLINE_SUBMODE_ENABLED(),
  }));
  // 金字塔倍數:不用三條均線各自展開範圍(會讓組合數三次方成長),改成「勾選要
  // 嘗試哪幾組預設組合」;內建組合預設全選,另外可加一組自訂組合。
  const [klinePyramidPresetChecked, setKlinePyramidPresetChecked] = useState(() =>
    KLINE_PYRAMID_PRESETS.map(() => true)
  );
  const [klineCustomPyramid, setKlineCustomPyramid] = useState({
    enabled: false,
    values: { ma20: 1, ma60: 1, ma120: 1 },
  });
  const [klineCooldownRange, setKlineCooldownRange] = useState({ min: 21, max: 21, step: 5 });
  const [klinePullbackLookbackRange, setKlinePullbackLookbackRange] = useState({
    min: 20,
    max: 20,
    step: 5,
  });
  const [klinePullbackToleranceRange, setKlinePullbackToleranceRange] = useState({
    min: 1,
    max: 1,
    step: 0.5,
  });
  const [klineRecoveryConfirmRange, setKlineRecoveryConfirmRange] = useState({
    min: 2,
    max: 2,
    step: 1,
  });
  const [klineDecayWindowRange, setKlineDecayWindowRange] = useState({ min: 0, max: 0, step: 5 });
  const [klineDecayFloorRange, setKlineDecayFloorRange] = useState({
    min: 100,
    max: 100,
    step: 10,
  });
  const [klineChopEnabled, setKlineChopEnabled] = useState(false);
  const [klineChopWindowRange, setKlineChopWindowRange] = useState({ min: 10, max: 10, step: 5 });
  const [klineChopThresholdRange, setKlineChopThresholdRange] = useState({
    min: 2,
    max: 2,
    step: 1,
  });
  const [klineTotalCapEnabled, setKlineTotalCapEnabled] = useState(false);
  const [klineTotalCapCount, setKlineTotalCapCount] = useState(12);

  const [objective, setObjective] = useState(OPTIMIZE_OBJECTIVES.BALANCED);

  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState('');
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  // runResults: 陣列,每個元素對應一檔股票的回測結果
  // { symbol, stockName, dataSourceInfo, results: [{config,result,score}, ...], error }
  // 長度 1 時視為「單檔模式」(顯示前N名);長度 > 1 時視為「多檔比較模式」(每檔只取最佳一組)。
  const [runResults, setRunResults] = useState(null);

  // 亮色/暗色主題共用的樣式片段(theme 切換鈕在 App.js,這裡只吃 isLight 這個布林值)
  const cardClass = isLight
    ? 'bg-white border border-slate-300 rounded-xl p-4'
    : 'bg-slate-800 border border-slate-700 rounded-xl p-4';
  const nestedCardClass = isLight
    ? 'bg-slate-50 border border-slate-300 rounded-lg p-3'
    : 'bg-slate-800/60 border border-slate-700 rounded-lg p-3';
  const nestedCardShellClass = isLight
    ? 'bg-slate-50 border border-slate-300 rounded-lg'
    : 'bg-slate-800/60 border border-slate-700 rounded-lg';
  const wellClass = isLight
    ? 'bg-slate-100 border border-slate-300 rounded-lg p-3'
    : 'bg-slate-900/50 border border-slate-700 rounded-lg p-3';
  const inputClass = isLight
    ? 'bg-white border border-slate-300 rounded p-2 text-sm text-slate-900'
    : 'bg-slate-800 border border-slate-600 rounded p-2 text-sm';
  const labelClass = `text-xs font-bold ${isLight ? 'text-slate-600' : 'text-slate-400'}`;
  const headingClass = isLight ? 'text-slate-900' : 'text-slate-100';
  const bodyText = isLight ? 'text-slate-600' : 'text-slate-400';
  const subText = isLight ? 'text-slate-500' : 'text-slate-400';
  const dividerClass = isLight ? 'border-slate-200' : 'border-slate-700/50';
  const tableBorder = isLight ? 'border-slate-300' : 'border-slate-700';
  const rowBorder = isLight ? 'border-slate-200' : 'border-slate-800';
  const errorBoxClass = isLight
    ? 'text-[13px] text-rose-600 bg-rose-50 border border-rose-300 rounded-lg p-2 flex items-start gap-1.5'
    : 'text-[13px] text-rose-400 bg-rose-900/20 border border-rose-800/50 rounded-lg p-2 flex items-start gap-1.5';
  const errorBoxClassLg = isLight
    ? 'text-[13px] text-rose-600 bg-rose-50 border border-rose-300 rounded-lg p-3 flex items-start gap-1.5'
    : 'text-[13px] text-rose-400 bg-rose-900/20 border border-rose-800/50 rounded-lg p-3 flex items-start gap-1.5';
  const rankBadgeClass = isLight
    ? 'bg-slate-200 text-slate-700 text-xs px-2 py-0.5 rounded'
    : 'bg-slate-700 text-slate-200 text-xs px-2 py-0.5 rounded';

  const updateLineConfig = (key, patch) => {
    setMaLineConfigs((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };
  const updateKlineSubMode = (lineKey, subKey) => {
    setKlineSubModeEnabled((prev) => ({
      ...prev,
      [lineKey]: { ...prev[lineKey], [subKey]: !prev[lineKey][subKey] },
    }));
  };
  const togglePyramidPreset = (idx) => {
    setKlinePyramidPresetChecked((prev) => prev.map((v, i) => (i === idx ? !v : v)));
  };

  const parsedSymbols = useMemo(() => parseSymbolsInput(symbolInput), [symbolInput]);
  const symbolsToRun = useMemo(() => parsedSymbols.slice(0, MAX_COMPARE_SYMBOLS), [parsedSymbols]);
  const symbolOverflow = parsedSymbols.length > MAX_COMPARE_SYMBOLS;

  // 金字塔倍數的搜尋清單:使用者勾選的內建預設組合 + (若啟用)一組自訂組合。
  // 全部沒勾時退回「均等」,確保至少有一組可以跑,不會產生 0 組合的空結果。
  const klinePyramidPresets = useMemo(() => {
    const chosen = KLINE_PYRAMID_PRESETS.filter((_, idx) => klinePyramidPresetChecked[idx]);
    const list = chosen.length > 0 ? [...chosen] : [KLINE_PYRAMID_PRESETS[0]];
    if (klineCustomPyramid.enabled) {
      const v = klineCustomPyramid.values;
      list.push({
        name: `自訂(${v.ma20}x/${v.ma60}x/${v.ma120}x)`,
        values: { ma20: Number(v.ma20) || 0, ma60: Number(v.ma60) || 0, ma120: Number(v.ma120) || 0 },
      });
    }
    return list;
  }, [klinePyramidPresetChecked, klineCustomPyramid]);

  const optimizerConfig = useMemo(() => {
    const base = {
      startDate,
      monthlyAmount: Number(monthlyAmount) || 0,
      investDay: Number(investDay) || 1,
    };
    if (useKLineCrossTrigger) {
      return {
        base,
        useKLineCrossTrigger: true,
        klineBaseAmount: Number(klineBaseAmount) || 0,
        klineSubModeEnabled,
        klinePyramidPresets,
        klineCooldownRange,
        klinePullbackLookbackRange,
        klinePullbackToleranceRange,
        klineRecoveryConfirmRange,
        klineDecayWindowRange,
        klineDecayFloorRange,
        klineChopEnabled,
        klineChopWindowRange,
        klineChopThresholdRange,
        klineTotalCapEnabled,
        klineTotalCapCount: Number(klineTotalCapCount) || 1,
        reinvestRatioRange,
      };
    }
    return {
      base,
      useKLineCrossTrigger: false,
      maLines: {
        ma20: maLineConfigs.ma20,
        ma60: maLineConfigs.ma60,
        ma120: maLineConfigs.ma120,
      },
      monthlyTriggerCapRange,
      reinvestRatioRange,
    };
  }, [
    startDate,
    monthlyAmount,
    investDay,
    useKLineCrossTrigger,
    maLineConfigs,
    monthlyTriggerCapRange,
    reinvestRatioRange,
    klineBaseAmount,
    klineSubModeEnabled,
    klinePyramidPresets,
    klineCooldownRange,
    klinePullbackLookbackRange,
    klinePullbackToleranceRange,
    klineRecoveryConfirmRange,
    klineDecayWindowRange,
    klineDecayFloorRange,
    klineChopEnabled,
    klineChopWindowRange,
    klineChopThresholdRange,
    klineTotalCapEnabled,
    klineTotalCapCount,
  ]);

  const previewCombinationCount = useMemo(() => {
    try {
      return buildParamCombinations(optimizerConfig).length;
    } catch (e) {
      return 0;
    }
  }, [optimizerConfig]);

  const runOptimization = async () => {
    setErrorMsg('');
    setRunResults(null);

    const symbols = symbolsToRun;
    if (symbols.length === 0) {
      setErrorMsg('請輸入股票代碼(可一次輸入多檔,用逗號分隔,最多 5 檔)。');
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

    const isCompareMode = symbols.length > 1;
    const topNPerSymbol = isCompareMode ? 1 : 5;
    const results = [];

    try {
      for (let i = 0; i < symbols.length; i++) {
        const sym = symbols[i];
        const baseProgress = (i / symbols.length) * 100;
        const progressSpan = 100 / symbols.length;
        const stagePrefix = isCompareMode ? `(${i + 1}/${symbols.length}) ${sym}:` : '';

        setProgress(baseProgress);
        setLoadingStage(`${stagePrefix}正在抓取股價與配息資料...`);

        let priceResult = null;
        let displayName = '';
        try {
          const [priceRes, nameRes] = await Promise.all([
            fetchStockPriceData(sym),
            fetchStockDisplayName(sym).catch(() => ''),
          ]);
          priceResult = priceRes;
          displayName = nameRes || '';
        } catch (fetchErr) {
          results.push({
            symbol: sym,
            stockName: '',
            error: '抓取股價資料失敗:' + (fetchErr?.message || String(fetchErr)),
          });
          continue;
        }

        if (!priceResult || !priceResult.data || priceResult.data.length === 0) {
          results.push({
            symbol: sym,
            stockName: displayName,
            error: '無法取得股價資料,請確認代碼是否正確。',
          });
          continue;
        }

        const dataSourceInfo = {
          source: priceResult.source,
          fromCache: priceResult.fromCache,
          dataPoints: priceResult.data.length,
          firstDate: priceResult.data[0]?.date,
          lastDate: priceResult.data[priceResult.data.length - 1]?.date,
        };

        setLoadingStage(`${stagePrefix}正在計算均線(MA20/MA60/MA120)與除息標記...`);
        const preprocessed = preprocessPriceSeries(priceResult);

        const combos = buildParamCombinations(optimizerConfig);
        if (combos.length === 0) {
          results.push({
            symbol: sym,
            stockName: displayName,
            dataSourceInfo,
            error: '沒有產生任何可執行的參數組合,請檢查參數設定。',
          });
          continue;
        }

        const topForSymbol = await runOptimizationBatch({
          preprocessedData: preprocessed,
          paramCombinations: combos,
          objective,
          topN: topNPerSymbol,
          onProgress: (done, total) => {
            setProgress(baseProgress + (done / total) * progressSpan);
            setLoadingStage(
              `${stagePrefix}正在批次回測... (${done.toLocaleString()}/${total.toLocaleString()})`
            );
          },
        });

        if (topForSymbol.length === 0) {
          results.push({
            symbol: sym,
            stockName: displayName,
            dataSourceInfo,
            error:
              '這段期間的資料不足以完成任何一組策略的模擬,請確認起始日期是否早於股票上市日,或調整參數範圍。',
          });
          continue;
        }

        results.push({ symbol: sym, stockName: displayName, dataSourceInfo, results: topForSymbol });
      }

      setProgress(100);
      setRunResults(results);

      if (results.length > 0 && results.every((r) => r.error)) {
        setErrorMsg('所有股票都無法完成回測,請檢查代碼或參數設定。');
      }
    } catch (e) {
      setErrorMsg('執行時發生錯誤:' + (e?.message || String(e)));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className={`${cardClass} space-y-4`}>
        <h2 className={`font-bold text-lg flex items-center gap-2 ${headingClass}`}>
          <TrendingUp className={`w-5 h-5 ${isLight ? 'text-emerald-600' : 'text-emerald-400'}`} />
          定期定額策略最佳化
        </h2>
        <p className={`text-[13px] ${bodyText} leading-relaxed`}>
          設定股票代碼、起始日期與每月定期定額金額後,可另外開啟月線
          (MA20)、季線(MA60)、半年線(MA120)三組獨立的加碼條件,每個參數都用
          「最小 / 最大 / 間距」設定搜尋範圍(最小=最大時等同固定單一數值)。
          系統會自動排列組合所有範圍內的參數跑批次回測,依您選擇的目標排序,
          輸出成效前 5 名的策略組合。股票代碼也可以一次輸入多檔(用逗號分隔,
          最多 5 檔),套用同一組參數設定分別回測後並列比較,此時每檔只會列出
          成效最佳的一組結果。
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className={labelClass}>
              股票代碼(可輸入多檔,逗號分隔,最多 {MAX_COMPARE_SYMBOLS} 檔)
            </label>
            <input
              type="text"
              value={symbolInput}
              onChange={(e) => setSymbolInput(e.target.value.toUpperCase())}
              onFocus={() => {
                if (symbolInput === DEFAULT_SYMBOL_INPUT) setSymbolInput('');
              }}
              placeholder="例如 0050,0056,2330"
              className={`w-full mt-1 ${inputClass}`}
            />
            {symbolsToRun.length > 0 && (
              <div className={`text-[12px] ${subText} mt-0.5`}>
                將回測:{symbolsToRun.join('、')}
                {symbolOverflow && `(最多比較 ${MAX_COMPARE_SYMBOLS} 檔,超出的部分已忽略)`}
              </div>
            )}
          </div>
          <div>
            <label className={labelClass}>回測起始日期</label>
            <input
              type="date"
              value={startDate}
              max={todayStr()}
              onChange={(e) => setStartDate(e.target.value)}
              className={`w-full mt-1 ${inputClass}`}
            />
          </div>
          <div>
            <label className={labelClass}>每月定期定額金額</label>
            <input
              type="number"
              value={monthlyAmount}
              onChange={(e) => setMonthlyAmount(e.target.value)}
              className={`w-full mt-1 ${inputClass}`}
            />
          </div>
          <div>
            <label className={labelClass}>每月投入日(1~31)</label>
            <input
              type="number"
              min={1}
              max={31}
              value={investDay}
              onChange={(e) => setInvestDay(e.target.value)}
              className={`w-full mt-1 ${inputClass}`}
            />
            <div className={`text-[11px] ${subText} mt-0.5`}>
              遇非交易日順延至當月第一個交易日
            </div>
          </div>
        </div>
      </div>

      <div className={`${cardClass} space-y-3`}>
        <h3 className={`font-bold flex items-center gap-2 ${headingClass}`}>加碼條件</h3>

        <label className={`flex items-start gap-2 cursor-pointer ${wellClass}`}>
          <input
            type="checkbox"
            checked={useKLineCrossTrigger}
            onChange={() => setUseKLineCrossTrigger((v) => !v)}
            className="mt-0.5"
          />
          <span>
            <span className={`font-bold text-sm ${isLight ? 'text-slate-700' : 'text-slate-200'}`}>
              用「K線穿越均線」判斷加碼(取代偏離%規則)
            </span>
            <div className={`text-[12px] ${bodyText} mt-0.5 leading-relaxed`}>
              與「ETF回測比較」分頁共用同一套引擎:跌破/回檔/站回三種子模式、每條均線各自獨立的交易日冷卻期、金字塔倍數
              ×
              距上次加碼遞減折扣、盤整偵測、總量保護機制,行為完全一致。開啟後,下方改成這套引擎的參數範圍設定,原本的「偏離%」設定停用、不納入搜尋。
            </div>
          </span>
        </label>

        {!useKLineCrossTrigger && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              {MA_LINE_KEYS.map((key) => {
                const line = maLineConfigs[key];
                return (
                  <div key={key} className={`${nestedCardClass} space-y-2`}>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={line.enabled}
                        onChange={() => updateLineConfig(key, { enabled: !line.enabled })}
                      />
                      <span className={`font-bold text-sm ${isLight ? 'text-slate-700' : 'text-slate-200'}`}>
                        {MA_LINE_LABELS[key]}
                      </span>
                    </label>
                    {line.enabled && (
                      <>
                        <div>
                          <div className={`text-[12px] ${bodyText} mb-1`}>
                            觸發偏離%(收盤價低於均線多少% 觸發)
                          </div>
                          <RangeInputGroup
                            isLight={isLight}
                            unit="%"
                            value={line.deviationRange}
                            onChange={(range) => updateLineConfig(key, { deviationRange: range })}
                          />
                        </div>
                        <div className={`flex items-center gap-3 text-[12px] ${isLight ? 'text-slate-600' : 'text-slate-300'}`}>
                          <span className={bodyText}>加碼方式:</span>
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
                          <div className={`text-[12px] ${bodyText} mb-1`}>
                            {line.topUpMode === 'multiple'
                              ? '加碼倍數(× 每月定額)'
                              : '加碼金額(元)'}
                          </div>
                          <RangeInputGroup
                            isLight={isLight}
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

            <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t ${dividerClass}`}>
              <div>
                <div className={`text-[12px] ${bodyText} mb-1`}>
                  每月共用觸發次數上限(三條線共用額度,誰先觸發誰先買)
                </div>
                <RangeInputGroup
                  isLight={isLight}
                  unit="次"
                  value={monthlyTriggerCapRange}
                  onChange={setMonthlyTriggerCapRange}
                />
              </div>
              <div>
                <div className={`text-[12px] ${bodyText} mb-1`}>配息再投入比例</div>
                <RangeInputGroup
                  isLight={isLight}
                  unit="%"
                  value={reinvestRatioRange}
                  onChange={setReinvestRatioRange}
                />
              </div>
            </div>
          </>
        )}

        {useKLineCrossTrigger && (
          <div className="space-y-3">
            <div>
              <div className={`text-[12px] ${bodyText} mb-1`}>
                加碼基準金額(元,對應 Tab1 的「每次加碼金額」)
              </div>
              <input
                type="number"
                min={0}
                value={klineBaseAmount}
                onChange={(e) => setKlineBaseAmount(e.target.value)}
                className={`w-full sm:w-64 ${inputClass}`}
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              {MA_LINE_KEYS.map((lineKey) => (
                <div key={lineKey} className={`${nestedCardClass} space-y-1.5`}>
                  <div className={`font-bold text-sm ${isLight ? 'text-slate-700' : 'text-slate-200'}`}>
                    {MA_LINE_LABELS[lineKey]}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {KLINE_SUBMODE_KEYS.map((subKey) => (
                      <label
                        key={subKey}
                        className={`flex items-center gap-1 text-[12px] cursor-pointer ${isLight ? 'text-slate-600' : 'text-slate-400'}`}
                      >
                        <input
                          type="checkbox"
                          checked={klineSubModeEnabled[lineKey][subKey]}
                          onChange={() => updateKlineSubMode(lineKey, subKey)}
                        />
                        {KLINE_SUBMODE_LABELS[subKey]}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className={`pt-2 border-t ${dividerClass}`}>
              <div className={`text-[12px] ${bodyText} mb-1`}>
                金字塔倍數:勾選要一起嘗試的預設組合(不逐條均線展開範圍,避免組合數三次方成長)
              </div>
              <div className="flex flex-wrap gap-2">
                {KLINE_PYRAMID_PRESETS.map((preset, idx) => (
                  <label
                    key={preset.name}
                    className={`flex items-center gap-1.5 text-[12px] cursor-pointer px-2 py-1 rounded border ${
                      isLight ? 'border-slate-300 text-slate-600' : 'border-slate-600 text-slate-300'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={klinePyramidPresetChecked[idx]}
                      onChange={() => togglePyramidPreset(idx)}
                    />
                    {preset.name}
                  </label>
                ))}
                <label
                  className={`flex items-center gap-1.5 text-[12px] cursor-pointer px-2 py-1 rounded border ${
                    isLight ? 'border-slate-300 text-slate-600' : 'border-slate-600 text-slate-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={klineCustomPyramid.enabled}
                    onChange={() =>
                      setKlineCustomPyramid((prev) => ({ ...prev, enabled: !prev.enabled }))
                    }
                  />
                  自訂組合
                </label>
              </div>
              {klineCustomPyramid.enabled && (
                <div className="grid grid-cols-3 gap-2 mt-2 max-w-md">
                  {MA_LINE_KEYS.map((lineKey) => (
                    <div key={lineKey}>
                      <div className={`text-[11px] ${subText}`}>{MA_LINE_LABELS[lineKey]}</div>
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        value={klineCustomPyramid.values[lineKey]}
                        onChange={(e) =>
                          setKlineCustomPyramid((prev) => ({
                            ...prev,
                            values: { ...prev.values, [lineKey]: e.target.value },
                          }))
                        }
                        className={inputClass + ' w-full'}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t ${dividerClass}`}>
              <div>
                <div className={`text-[12px] ${bodyText} mb-1`}>
                  冷卻天數(交易日,所有已啟用均線/子模式統一套用)
                </div>
                <RangeInputGroup
                  isLight={isLight}
                  unit="日"
                  value={klineCooldownRange}
                  onChange={setKlineCooldownRange}
                />
              </div>
              <div>
                <div className={`text-[12px] ${bodyText} mb-1`}>回檔:上升趨勢回看天數</div>
                <RangeInputGroup
                  isLight={isLight}
                  unit="日"
                  value={klinePullbackLookbackRange}
                  onChange={setKlinePullbackLookbackRange}
                />
              </div>
              <div>
                <div className={`text-[12px] ${bodyText} mb-1`}>回檔:均線接近容忍度(±%)</div>
                <RangeInputGroup
                  isLight={isLight}
                  unit="%"
                  value={klinePullbackToleranceRange}
                  onChange={setKlinePullbackToleranceRange}
                />
              </div>
              <div>
                <div className={`text-[12px] ${bodyText} mb-1`}>
                  站回:確認天數(0=站上當天立刻買進)
                </div>
                <RangeInputGroup
                  isLight={isLight}
                  unit="日"
                  value={klineRecoveryConfirmRange}
                  onChange={setKlineRecoveryConfirmRange}
                />
              </div>
              <div>
                <div className={`text-[12px] ${bodyText} mb-1`}>距上次遞減:折扣視窗(交易日)</div>
                <RangeInputGroup
                  isLight={isLight}
                  unit="日"
                  value={klineDecayWindowRange}
                  onChange={setKlineDecayWindowRange}
                />
              </div>
              <div>
                <div className={`text-[12px] ${bodyText} mb-1`}>距上次遞減:折扣下限(%)</div>
                <RangeInputGroup
                  isLight={isLight}
                  unit="%"
                  value={klineDecayFloorRange}
                  onChange={setKlineDecayFloorRange}
                />
              </div>
            </div>

            <div className={`pt-2 border-t ${dividerClass} space-y-2`}>
              <label className={`flex items-center gap-2 cursor-pointer text-[13px] ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>
                <input
                  type="checkbox"
                  checked={klineChopEnabled}
                  onChange={() => setKlineChopEnabled((v) => !v)}
                />
                啟用盤整偵測(範圍搜尋視窗天數與閾值)
              </label>
              {klineChopEnabled && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <div className={`text-[12px] ${bodyText} mb-1`}>盤整判斷視窗(交易日)</div>
                    <RangeInputGroup
                      isLight={isLight}
                      unit="日"
                      value={klineChopWindowRange}
                      onChange={setKlineChopWindowRange}
                    />
                  </div>
                  <div>
                    <div className={`text-[12px] ${bodyText} mb-1`}>盤整閾值(%)</div>
                    <RangeInputGroup
                      isLight={isLight}
                      unit="%"
                      value={klineChopThresholdRange}
                      onChange={setKlineChopThresholdRange}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className={`pt-2 border-t ${dividerClass} space-y-2`}>
              <label className={`flex items-center gap-2 cursor-pointer text-[13px] ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>
                <input
                  type="checkbox"
                  checked={klineTotalCapEnabled}
                  onChange={() => setKlineTotalCapEnabled((v) => !v)}
                />
                啟用總量保護機制(固定值,不參與範圍搜尋)
              </label>
              {klineTotalCapEnabled && (
                <div className="max-w-xs">
                  <div className={`text-[12px] ${bodyText} mb-1`}>
                    所有均線/子模式合計加碼次數上限
                  </div>
                  <input
                    type="number"
                    min={1}
                    value={klineTotalCapCount}
                    onChange={(e) => setKlineTotalCapCount(e.target.value)}
                    className={`w-full ${inputClass}`}
                  />
                </div>
              )}
            </div>

            <div className={`pt-2 border-t ${dividerClass} max-w-xs`}>
              <div className={`text-[12px] ${bodyText} mb-1`}>配息再投入比例</div>
              <RangeInputGroup
                isLight={isLight}
                unit="%"
                value={reinvestRatioRange}
                onChange={setReinvestRatioRange}
              />
            </div>
          </div>
        )}
      </div>

      <div className={`${cardClass} space-y-3`}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <label className={labelClass}>最佳化目標</label>
            <select
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              className={`w-full sm:w-auto mt-1 ${inputClass}`}
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
                  ? isLight
                    ? 'text-amber-600'
                    : 'text-amber-400'
                  : isLight
                  ? 'text-slate-600'
                  : 'text-slate-300'
              }`}
            >
              目前參數組合數:{previewCombinationCount.toLocaleString()} 組
            </div>
            {previewCombinationCount > COMBINATION_COUNT_WARNING_THRESHOLD && (
              <div
                className={`${
                  isLight ? 'text-amber-600' : 'text-amber-400/80'
                } text-[12px] flex items-center gap-1 justify-end`}
              >
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
              ? isLight
                ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                : 'bg-slate-700 text-slate-500 cursor-not-allowed'
              : 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white'
          }`}
        >
          {loading ? (
            <RefreshCw className="animate-spin w-5 h-5" />
          ) : (
            <>
              <Zap className="w-5 h-5 fill-current" />
              {symbolsToRun.length > 1 ? `開始比較(${symbolsToRun.length} 檔)` : '開始最佳化'}
            </>
          )}
        </button>

        {loading && (
          <div>
            <div className={`w-full ${isLight ? 'bg-slate-200' : 'bg-slate-700'} rounded-full h-2 overflow-hidden`}>
              <div
                className="bg-emerald-500 h-2 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className={`text-[12px] ${bodyText} mt-1`}>{loadingStage}</div>
          </div>
        )}

        {errorMsg && (
          <div className={errorBoxClass}>
            <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

      </div>

      {runResults && runResults.length === 1 && !runResults[0].error && (
        <div className="space-y-3">
          <h3 className={`font-bold text-lg ${headingClass}`}>
            {runResults[0].symbol}
            {runResults[0].stockName ? ` ${runResults[0].stockName}` : ''} · 成效前{' '}
            {runResults[0].results.length} 名策略({OPTIMIZE_OBJECTIVE_LABELS[objective]})
          </h3>
          {runResults[0].dataSourceInfo && (
            <div className={`text-[12px] ${subText} flex items-center gap-1.5`}>
              <Info className="w-3 h-3 flex-shrink-0" />
              資料來源:
              {runResults[0].dataSourceInfo.fromCache
                ? '本機快取'
                : runResults[0].dataSourceInfo.source || '即時抓取'}
              ,共 {runResults[0].dataSourceInfo.dataPoints} 筆(
              {runResults[0].dataSourceInfo.firstDate} ~ {runResults[0].dataSourceInfo.lastDate})
            </div>
          )}
          {runResults[0].results.map((item, idx) => (
            <ResultDetailCard
              key={idx}
              item={item}
              isLight={isLight}
              badge={
                <span className="bg-yellow-500 text-slate-900 text-xs px-2 py-0.5 rounded font-bold">
                  第 {idx + 1} 名
                </span>
              }
            />
          ))}
        </div>
      )}

      {runResults && runResults.length === 1 && runResults[0].error && (
        <div className={errorBoxClassLg}>
          <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
          <span>
            {runResults[0].symbol}:{runResults[0].error}
          </span>
        </div>
      )}

      {runResults && runResults.length > 1 && (
        <div className="space-y-3">
          <h3 className={`font-bold text-lg ${headingClass}`}>
            {runResults.length} 檔股票比較(各取最佳一組,{OPTIMIZE_OBJECTIVE_LABELS[objective]})
          </h3>

          <div className={cardClass}>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className={`${isLight ? 'text-slate-500' : 'text-slate-500'} border-b ${tableBorder}`}>
                    <th className="text-left py-1">排名</th>
                    <th className="text-left py-1">股票</th>
                    <th className="text-right py-1">含息報酬率</th>
                    <th className="text-right py-1">CAGR</th>
                    <th className="text-right py-1">最大回撤</th>
                    <th className="text-right py-1">總投入</th>
                    <th className="text-right py-1">目前市值</th>
                    <th className="text-right py-1">累計配息</th>
                    <th className="text-left py-1">回測區間</th>
                  </tr>
                </thead>
                <tbody>
                  {runResults
                    .filter((r) => !r.error)
                    .slice()
                    .sort((a, b) => b.results[0].score - a.results[0].score)
                    .map((r, idx) => {
                      const item = r.results[0];
                      return (
                        <tr key={r.symbol} className={`border-b ${rowBorder}`}>
                          <td className="py-1">{idx + 1}</td>
                          <td className={`py-1 font-bold ${isLight ? 'text-slate-700' : 'text-slate-200'}`}>
                            {r.symbol}
                            {r.stockName && (
                              <span className={`font-normal ${isLight ? 'text-slate-500' : 'text-slate-400'}`}> {r.stockName}</span>
                            )}
                          </td>
                          <td
                            className={`text-right py-1 font-mono ${
                              item.result.dividendReturnPct >= 0
                                ? isLight
                                  ? 'text-emerald-600'
                                  : 'text-emerald-400'
                                : isLight
                                ? 'text-rose-600'
                                : 'text-rose-400'
                            }`}
                          >
                            {item.result.dividendReturnPct >= 0 ? '+' : ''}
                            {item.result.dividendReturnPct.toFixed(2)}%
                          </td>
                          <td className="text-right py-1 font-mono">
                            {item.result.cagr.toFixed(2)}%
                          </td>
                          <td className="text-right py-1 font-mono">
                            {item.result.maxDrawdownPct.toFixed(2)}%
                          </td>
                          <td className="text-right py-1 font-mono">
                            ${Math.round(item.result.totalInvested).toLocaleString()}
                          </td>
                          <td className="text-right py-1 font-mono">
                            ${Math.round(item.result.finalMarketValue).toLocaleString()}
                          </td>
                          <td className="text-right py-1 font-mono">
                            ${Math.round(item.result.totalDividends).toLocaleString()}
                          </td>
                          <td className="py-1">
                            {item.result.startDate} ~ {item.result.endDate}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
            {runResults.some((r) => r.error) && (
              <div className={`mt-2 text-[12px] ${isLight ? 'text-rose-600' : 'text-rose-400'} space-y-0.5`}>
                {runResults
                  .filter((r) => r.error)
                  .map((r) => (
                    <div key={r.symbol}>
                      {r.symbol}:{r.error}
                    </div>
                  ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            {runResults
              .filter((r) => !r.error)
              .slice()
              .sort((a, b) => b.results[0].score - a.results[0].score)
              .map((r, idx) => (
                <details key={r.symbol} className={nestedCardShellClass}>
                  <summary
                    className={`cursor-pointer select-none p-3 text-sm font-bold ${
                      isLight ? 'text-slate-700' : 'text-slate-200'
                    } flex flex-wrap items-center gap-2`}
                  >
                    <span className={rankBadgeClass}>
                      第 {idx + 1} 名
                    </span>
                    <span>
                      {r.symbol}
                      {r.stockName ? ` ${r.stockName}` : ''}
                    </span>
                    {r.dataSourceInfo && (
                      <span className={`text-[11px] ${isLight ? 'text-slate-500' : 'text-slate-500'} font-normal ml-auto`}>
                        資料來源:
                        {r.dataSourceInfo.fromCache
                          ? '本機快取'
                          : r.dataSourceInfo.source || '即時抓取'}
                        ,共 {r.dataSourceInfo.dataPoints} 筆
                      </span>
                    )}
                  </summary>
                  <div className="p-3 pt-0">
                    <ResultDetailCard
                      item={r.results[0]}
                      isLight={isLight}
                      badge={
                        <span className="bg-yellow-500 text-slate-900 text-xs px-2 py-0.5 rounded font-bold">
                          最佳組合
                        </span>
                      }
                    />
                  </div>
                </details>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
