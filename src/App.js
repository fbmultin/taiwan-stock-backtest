import React, { useState, useEffect, useMemo, useRef } from 'react';
import TW_STOCK_NAMES from './data/twStockNames';
import TW_STOCK_SPLITS from './data/twStockSplits';
import DcaOptimizer from './DcaOptimizer';
import {
  fetchStockPriceData,
  fetchIndexPriceData,
  fetchStockDisplayName,
} from './dataCache';
import { isNonTradingDay, getLastCompletedTradingDay } from './tradingCalendar';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  ReferenceLine,
} from 'recharts';
import {
  Calendar,
  TrendingUp,
  AlertTriangle,
  DollarSign,
  Clock,
  CloudLightning,
  RefreshCw,
  Wallet,
  Zap,
  Shield,
  Activity,
  Flame,
  ChevronUp,
  ChevronDown,
  Printer,
  X,
  CheckSquare,
  Square,
  MousePointerClick,
  Loader2,
  CalendarDays,
  Table2,
  Ban,
  Info,
  Database,
  SkipForward,
  CheckCircle2,
  XCircle,
  Star,
  Save,
  Scissors,
} from 'lucide-react';

const COLORS = [
  '#3b82f6',
  '#ef4444',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#6366f1',
  '#ec4899',
];

const PRESETS = [
  {
    name: '1. 原科技成長',
    stocks: ['00935', '00904', '00891', '00991A', '00981A', '00982A'],
  },
  {
    name: '2. 美國科技股',
    stocks: ['00662', '00757', '00924', '009815', '009813'],
  },
  {
    name: '3. 國民高股息',
    stocks: ['0056', '00878', '00919', '00929', '00713', '00915'],
  },
];

const MY_PRESET_STORAGE_KEY = 'twBacktestMyPresetStocks';

const RISK_TYPES = {
  CONSERVATIVE: 'conservative',
  STABLE: 'stable',
  AGGRESSIVE: 'aggressive',
};

const calculateRiskProfile = (prices, printMode) => {
  if (!prices || prices.length < 2)
    return {
      label: '資料不足',
      type: 'unknown',
      color: 'bg-slate-100 text-slate-500',
      icon: AlertTriangle,
      volatility: 0,
    };
  const dailyReturns = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0)
      dailyReturns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  }
  if (dailyReturns.length === 0)
    return {
      label: '資料不足',
      type: 'unknown',
      color: 'bg-slate-100 text-slate-500',
      icon: AlertTriangle,
      volatility: 0,
    };
  const mean =
    dailyReturns.reduce((acc, val) => acc + val, 0) / dailyReturns.length;
  const variance =
    dailyReturns.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) /
    dailyReturns.length;
  let annualizedVol = Math.sqrt(Math.max(0, variance)) * Math.sqrt(252) * 100;
  if (isNaN(annualizedVol)) annualizedVol = 0;

  if (annualizedVol < 12)
    return {
      label: '保守型',
      type: RISK_TYPES.CONSERVATIVE,
      color: printMode
        ? 'bg-blue-100 text-blue-800 border-blue-300'
        : 'bg-blue-100 text-blue-700 border-blue-200',
      icon: Shield,
      volatility: annualizedVol,
    };
  if (annualizedVol < 25)
    return {
      label: '穩健型',
      type: RISK_TYPES.STABLE,
      color: printMode
        ? 'bg-amber-100 text-amber-800 border-amber-300'
        : 'bg-amber-100 text-amber-700 border-amber-200',
      icon: Activity,
      volatility: annualizedVol,
    };
  return {
    label: '積極型',
    type: RISK_TYPES.AGGRESSIVE,
    color: printMode
      ? 'bg-rose-100 text-rose-800 border-rose-300'
      : 'bg-rose-100 text-rose-700 border-rose-200',
    icon: Flame,
    volatility: annualizedVol,
  };
};

const buildDailyReturnsByDate = (data) => {
  const map = new Map();
  if (!data || data.length < 2) return map;
  for (let i = 1; i < data.length; i++) {
    const prev = data[i - 1].price;
    const curr = data[i].price;
    if (prev > 0 && curr !== null && curr !== undefined) {
      map.set(data[i].date, (curr - prev) / prev);
    }
  }
  return map;
};

const MIN_BETA_SAMPLES = 20;
const calculateBeta = (priceData, benchmarkReturnsByDate) => {
  if (
    !priceData ||
    priceData.length < 2 ||
    !benchmarkReturnsByDate ||
    benchmarkReturnsByDate.size === 0
  )
    return null;
  const stockReturns = [];
  const benchReturns = [];
  for (let i = 1; i < priceData.length; i++) {
    const prev = priceData[i - 1].price;
    const curr = priceData[i].price;
    if (!(prev > 0)) continue;
    const benchReturn = benchmarkReturnsByDate.get(priceData[i].date);
    if (benchReturn === undefined) continue;
    stockReturns.push((curr - prev) / prev);
    benchReturns.push(benchReturn);
  }
  if (stockReturns.length < MIN_BETA_SAMPLES) return null;
  const meanStock =
    stockReturns.reduce((a, b) => a + b, 0) / stockReturns.length;
  const meanBench =
    benchReturns.reduce((a, b) => a + b, 0) / benchReturns.length;
  let covariance = 0;
  let varianceBench = 0;
  for (let i = 0; i < stockReturns.length; i++) {
    covariance += (stockReturns[i] - meanStock) * (benchReturns[i] - meanBench);
    varianceBench += (benchReturns[i] - meanBench) ** 2;
  }
  covariance /= stockReturns.length;
  varianceBench /= stockReturns.length;
  if (varianceBench === 0) return null;
  return covariance / varianceBench;
};

const checkIsMonthly = (dates) => {
  if (!dates || dates.length < 2) return false;
  let intervals = [];
  for (let i = 1; i < dates.length; i++) {
    const diffTime = Math.abs(dates[i] - dates[i - 1]);
    const diffDays = Math.ceil(diffTime / 86400000);
    intervals.push(diffDays);
  }
  const avgDays = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  return avgDays <= 35;
};

const getFrequencyLabel = (dates) => {
  if (!dates || dates.length < 2) return '不定期';
  if (checkIsMonthly(dates)) return '月配息';

  let intervals = [];
  for (let i = 1; i < dates.length; i++) {
    const diffTime = Math.abs(dates[i] - dates[i - 1]);
    const diffDays = Math.ceil(diffTime / 86400000);
    intervals.push(diffDays);
  }
  const avgDays = intervals.reduce((a, b) => a + b, 0) / intervals.length;

  if (avgDays <= 120) return '季配息';
  if (avgDays <= 240) return '半年配';
  return '年配息';
};

const getDurationLabel = (startStr, endStr) => {
  if (!startStr || endStr) return '';
  const s = new Date(startStr);
  const e = new Date(endStr);
  const diffTime = Math.abs(e - s);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  const years = (diffDays / 365).toFixed(1);
  const months = (diffDays / 30.44).toFixed(1);
  return `${diffDays}天 / ${months}月 / ${years}年`;
};

const shiftDateStr = (dateStr, amount, unit = 'month') => {
  const d = new Date(dateStr);
  if (unit === 'day') {
    d.setDate(d.getDate() + amount);
  } else {
    d.setMonth(d.getMonth() + amount);
  }
  return d.toISOString().split('T')[0];
};

const formatDateForDisplay = (dateStr) => {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    '0'
  )}-${String(d.getDate()).padStart(2, '0')}`;
};

const applySplitAdjustments = (stock) => {
  if (!stock.data || stock.data.length === 0) return [];
  const pureSymbol = (stock.symbol || '').split('.')[0];
  const events = TW_STOCK_SPLITS.filter((e) => e.symbol === pureSymbol);
  if (events.length === 0) return [];

  const notes = [];
  events
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .forEach((event) => {
      const priorPoints = stock.data.filter((d) => d.date < event.date);
      const afterPoints = stock.data.filter((d) => d.date >= event.date);
      if (priorPoints.length === 0 || afterPoints.length === 0) {
        return;
      }

      const lastPre = priorPoints[priorPoints.length - 1];
      const diffAfter =
        Math.abs(lastPre.price - event.priceAfter) / event.priceAfter;
      const diffBefore =
        Math.abs(lastPre.price - event.priceBefore) / event.priceBefore;

      if (diffAfter <= 0.05 && diffAfter < diffBefore) {
        notes.push({ ...event, status: 'already_adjusted', observedPrice: lastPre.price });
        return;
      }

      if (diffBefore > 0.5 && diffAfter > 0.5) {
        notes.push({ ...event, status: 'ambiguous', observedPrice: lastPre.price });
        return;
      }

      const factor = event.type === 'split' ? 1 / event.ratio : event.ratio;
      const splitTs = new Date(event.date).getTime();

      stock.data.forEach((d) => {
        if (d.date < event.date) {
          d.price = d.price * factor;
        }
      });

      (stock.divDates || []).forEach((ts) => {
        if (ts < splitTs) {
          const keySec = Math.floor(ts / 1000);
          const divInfo =
            stock.dividendsMap[keySec.toString()] ||
            stock.dividendsMap[keySec] ||
            stock.dividendsMap[ts];
          if (divInfo && typeof divInfo.amount === 'number') {
            divInfo.amount = divInfo.amount * factor;
          }
        }
      });

      notes.push({ ...event, status: 'corrected', observedPrice: lastPre.price });
    });

  return notes;
};

const calculatePeriodStats = (
  allData,
  months,
  currentAllocations,
  currentCapital
) => {
  const endDateObj = new Date();
  const startDateObj = new Date();
  startDateObj.setMonth(startDateObj.getMonth() - months);
  let maxMinDate = startDateObj;
  let isPartial = false;
  const validStocks = allData.filter((s) => s.data.length > 5);
  validStocks.forEach((stock) => {
    const firstDate = new Date(stock.data[0].date);
    if (firstDate > maxMinDate) {
      maxMinDate = firstDate;
      isPartial = true;
    }
  });
  let totalStartValue = 0;
  let totalEndValue = 0;
  allData.forEach((stock) => {
    const weight = currentAllocations[stock.inputIndex] || 0;
    if (weight === 0) return;
    const allocated = currentCapital * (weight / 100);
    const startIndex = stock.data.findIndex(
      (d) => new Date(d.date) >= maxMinDate
    );
    if (startIndex !== -1 && startIndex < stock.data.length) {
      const startData = stock.data[startIndex];
      const endData = stock.data[stock.data.length - 1];
      if (startData && endData) {
        const shares = allocated / startData.price;
        const finalMarketVal = shares * endData.price;
        totalStartValue += allocated;
        totalEndValue += finalMarketVal;
      } else {
        totalStartValue += allocated;
        totalEndValue += allocated;
      }
    } else {
      totalStartValue += allocated;
      totalEndValue += allocated;
    }
  });
  if (totalStartValue === 0) return null;
  const roi = ((totalEndValue - totalStartValue) / totalStartValue) * 100;
  return {
    months,
    roi,
    isPartial,
    startDate: maxMinDate.toISOString().split('T')[0],
  };
};

const CustomizedDot = (props) => {
  const { cx, cy, payload, divDates } = props;
  const isExDiv =
    divDates &&
    divDates.some((ts) => {
      const divStr = new Date(ts).toISOString().split('T')[0];
      return divStr === payload.date;
    });

  if (isExDiv) {
    return (
      <circle
        cx={cx}
        cy={cy}
        r={4}
        stroke={props.stroke}
        strokeWidth={2}
        fill="white"
        className="recharts-dot-inner"
      />
    );
  }
  return null;
};

const SmartNumberInput = ({
  value,
  onChange,
  className,
  disabled,
  placeholder,
  autoFocus,
}) => {
  const [localValue, setLocalValue] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (!isEditing) {
      setLocalValue(
        value === 0 || value === undefined || value === null
          ? ''
          : String(value)
      );
    }
  }, [value, isEditing]);

  const handleChange = (e) => {
    const val = e.target.value;
    setLocalValue(val);
    if (val === '' || val === '-') {
      onChange('');
    } else {
      const num = parseFloat(val);
      if (!isNaN(num)) {
        onChange(num);
      }
    }
  };

  const handleFocus = (e) => {
    setIsEditing(true);
    e.target.select();
  };

  const handleBlur = () => {
    setIsEditing(false);
  };

  return (
    <input
      type="number"
      value={localValue}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      className={className}
      disabled={disabled}
      placeholder={placeholder}
      step="any"
      autoFocus={autoFocus}
    />
  );
};

const ManualInputModal = ({ missingData, onConfirm, onCancel }) => {
  const [inputs, setInputs] = useState({});

  const handleInputChange = (key, value) => {
    setInputs((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = () => {
    const allFilled = missingData.every((item) => {
      const key = `${item.symbol}_${item.date}`;
      return inputs[key] !== undefined && inputs[key] !== '';
    });

    if (allFilled) {
      onConfirm(inputs);
    } else {
      alert('請輸入所有缺漏的股價資訊以繼續回測。');
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/95 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-slate-800 border border-slate-600 rounded-xl shadow-2xl max-w-md w-full p-6 animate-in fade-in zoom-in duration-200">
        <div className="flex items-center gap-3 mb-4 text-amber-400">
          <div className="bg-amber-900/30 p-2 rounded-full">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold">需要人工補正資料</h3>
            <p className="text-xs opacity-80">多重數據源皆無法取得以下資料</p>
          </div>
        </div>

        <p className="text-slate-300 text-sm mb-4">
          系統偵測到以下標的在關鍵日期缺少股價。為確保回測準確性，請手動輸入收盤價：
        </p>

        <div className="space-y-3 mb-6 max-h-[40vh] overflow-y-auto pr-1">
          {missingData.map((item, idx) => {
            const key = `${item.symbol}_${item.date}`;
            const stockNameDisplay =
              item.stockName && typeof item.stockName === 'string'
                ? item.stockName
                : '';

            return (
              <div
                key={key}
                className="flex items-center justify-between bg-slate-900/50 p-3 rounded-lg border border-slate-700"
              >
                <div>
                  <div className="font-bold text-white text-lg">
                    {item.symbol}
                    {stockNameDisplay && (
                      <span className="text-xs font-normal text-slate-400 ml-1">
                        {stockNameDisplay}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 font-mono">
                    {item.date}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">收盤價:</span>
                  <SmartNumberInput
                    value={inputs[key] || ''}
                    onChange={(val) => handleInputChange(key, val)}
                    className="w-24 bg-slate-700 border border-slate-500 rounded px-2 py-1 text-right text-white font-mono focus:border-emerald-500 outline-none"
                    placeholder="0.00"
                    autoFocus={idx === 0}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg text-sm font-bold transition-colors"
          >
            取消回測
          </button>
          <button
            onClick={handleSubmit}
            className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-bold transition-colors flex items-center justify-center gap-2"
          >
            確認並繼續
          </button>
        </div>
      </div>
    </div>
  );
};

const SituationDecisionModal = ({ situations, onConfirm, onCancel }) => {
  const [choices, setChoices] = useState(() => {
    const initial = {};
    situations.forEach((s) => {
      const recommended = s.options.find((o) => o.recommended) || s.options[0];
      initial[s.key] = recommended.value;
    });
    return initial;
  });

  const handleChoose = (key, value) => {
    setChoices((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="fixed inset-0 bg-slate-900/95 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-slate-800 border border-slate-600 rounded-xl shadow-2xl max-w-lg w-full p-6 animate-in fade-in zoom-in duration-200">
        <div className="flex items-center gap-3 mb-4 text-amber-400">
          <div className="bg-amber-900/30 p-2 rounded-full">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold">執行中遇到需要您決定的狀況</h3>
            <p className="text-xs opacity-80">
              請選擇要怎麼處理，選完後會用您的選擇繼續計算
            </p>
          </div>
        </div>

        <div className="space-y-4 mb-6 max-h-[55vh] overflow-y-auto pr-1">
          {situations.map((s) => (
            <div
              key={s.key}
              className="bg-slate-900/50 p-3 rounded-lg border border-slate-700"
            >
              <div className="font-bold text-white text-sm mb-1">
                {s.title}
              </div>
              <p className="text-slate-400 text-xs mb-3 leading-relaxed">
                {s.description}
              </p>
              <div className="space-y-1.5">
                {s.options.map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition-colors text-xs ${
                      choices[s.key] === opt.value
                        ? 'border-emerald-500 bg-emerald-900/20 text-emerald-300'
                        : 'border-slate-700 hover:bg-slate-800 text-slate-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name={s.key}
                      className="mt-0.5 flex-shrink-0"
                      checked={choices[s.key] === opt.value}
                      onChange={() => handleChoose(s.key, opt.value)}
                    />
                    <span>
                      {opt.label}
                      {opt.recommended && (
                        <span className="ml-1.5 text-[14px] text-emerald-500">
                          (建議)
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg text-sm font-bold transition-colors"
          >
            取消回測
          </button>
          <button
            onClick={() => onConfirm(choices)}
            className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-bold transition-colors flex items-center justify-center gap-2"
          >
            確認並繼續
          </button>
        </div>
      </div>
    </div>
  );
};

const App = () => {
  const [printMode, setPrintMode] = useState(false);
  const [activeTab, setActiveTab] = useState('backtest');

  const textClass = {
    main: printMode ? 'text-black' : 'text-white',
    sub: printMode ? 'text-slate-600' : 'text-slate-400',
    highlight: printMode ? 'text-emerald-700 font-bold' : 'text-emerald-400',
    warn: printMode ? 'text-rose-700 font-bold' : 'text-rose-400',
    blue: printMode ? 'text-blue-700' : 'text-blue-300',
    amber: printMode ? 'text-amber-700' : 'text-amber-400',
  };

  const containerClass = printMode
    ? 'min-h-screen bg-white text-black font-sans p-4 md:p-8'
    : 'min-h-screen bg-slate-900 text-slate-100 font-sans pb-12';

  const cardClass = printMode
    ? 'bg-white border border-slate-300 rounded-xl shadow-sm'
    : 'bg-slate-800 border border-slate-700 rounded-xl shadow-lg';

  const [inputs, setInputs] = useState([
    '009816',
    '0052',
    '0050',
    '00935',
    '00904',
    '00891',
  ]);
  const [enabledInputs, setEnabledInputs] = useState({
    0: true,
    1: true,
    2: true,
    3: true,
    4: true,
    5: true,
  });
  const [stockNames, setStockNames] = useState(() => ({ ...TW_STOCK_NAMES }));

  const [timeRange, setTimeRange] = useState('12m');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState(
    () => new Date().toISOString().split('T')[0]
  );

  const [totalCapital, setTotalCapital] = useState(6000000);

  const [allocations, setAllocations] = useState({
    0: 16.6666,
    1: 16.6666,
    2: 16.6666,
    3: 16.6666,
    4: 16.6666,
    5: 16.667,
  });

  const [allocationError, setAllocationError] = useState(false);

  const [isConfigExpanded, setIsConfigExpanded] = useState(true);

  const [results, setResults] = useState(null);
  const [periodStats, setPeriodStats] = useState(null);
  const [comparisonInfo, setComparisonInfo] = useState(null);
  const [failedTickers, setFailedTickers] = useState([]);

  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [loadingStage, setLoadingStage] = useState('');
  const [fetchStatusList, setFetchStatusList] = useState([]);
  const [loadingStagePhase, setLoadingStagePhaseState] = useState('');
  const loadingStagePhaseRef = useRef('');
  const setLoadingStagePhase = (phase) => {
    loadingStagePhaseRef.current = phase;
    setLoadingStagePhaseState(phase);
  };
  const [skippedAtPhase, setSkippedAtPhase] = useState('');
  const STAGE_SKIP_INFO = {
    params: { label: '參數準備', consequence: '此步驟為本機運算，通常瞬間完成。' },
    price: {
      label: '股價與配息資料抓取',
      consequence:
        '這是回測用的核心資料。跳過的標的會被視為抓取失敗，可能被排除在回測結果之外，或需之後手動補值。',
    },
    name: {
      label: '股票名稱查詢',
      consequence:
        '不影響回測數據，此階段的資料只有「公司名稱」，跳過只會讓尚未查到名稱的股票代號旁邊沒有顯示公司名稱，價格、配息、報酬率等計算完全不受影響。',
    },
    compute: { label: '績效與配息周期計算', consequence: '此步驟為本機運算，通常瞬間完成。' },
  };
  const [skipAvailable, setSkipAvailable] = useState(false);
  const [skipTriggered, setSkipTriggered] = useState(false);
  const skipResolverRef = useRef(null);
  const skipTimerRef = useRef(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [debugInfo, setDebugInfo] = useState('');
  const [requestedStartDate, setRequestedStartDate] = useState(null);
  const [cycleInfoText, setCycleInfoText] = useState('');
  const [cyclesUsed, setCyclesUsed] = useState(0);

  const [fairMode, setFairMode] = useState(false);

  const [independentCycleMode, setIndependentCycleMode] = useState(false);
  const [strictTimeMode, setStrictTimeMode] = useState(false);
  const [calcBeta, setCalcBeta] = useState(false);

  const [missingDataList, setMissingDataList] = useState([]);
  const [manualPriceData, setManualPriceData] = useState({});

  const [pendingSituations, setPendingSituations] = useState(null);
  const pendingRunArgsRef = useRef({ overrideManualData: null, dateOverride: null });

  const [dateAdjustmentNote, setDateAdjustmentNote] = useState(null);
  const [showDateAdjustPanel, setShowDateAdjustPanel] = useState(false);
  const [adjustStart, setAdjustStart] = useState('');
  const [adjustEnd, setAdjustEnd] = useState('');

  const [myPresetStocks, setMyPresetStocks] = useState(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(MY_PRESET_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMyPresetStocks(parsed);
        }
      }
    } catch (e) {
    }
  }, []);

  const handleApplyPreset = (presetStocks) => {
    const newInputs = [...presetStocks];
    while (newInputs.length < 6) newInputs.push('');
    setInputs(newInputs);

    const newEnabled = {};
    const newAllocations = {};
    const activeCount = presetStocks.filter((s) => s !== '').length;
    const equalWeight = activeCount > 0 ? 100 / activeCount : 0;

    newInputs.forEach((s, idx) => {
      const isActive = s !== '';
      newEnabled[idx] = isActive;
      newAllocations[idx] = isActive ? equalWeight : 0;

      if (isActive && !stockNames[s]) {
        fetchStockDisplayName(s).then((name) => {
          if (name) setStockNames((prev) => ({ ...prev, [s]: name }));
        });
      }
    });

    setEnabledInputs(newEnabled);
    setAllocations(newAllocations);
  };

  const handleApplyMyPreset = () => {
    if (!myPresetStocks || myPresetStocks.length === 0) {
      alert(
        '尚未設定「我的常用標的」。請先輸入想要的標的組合，再按旁邊的「設為常用」儲存，之後就能一鍵套用。'
      );
      return;
    }
    handleApplyPreset(myPresetStocks);
  };

  const handleSaveMyPreset = () => {
    const current = inputs.filter((s, i) => s !== '' && enabledInputs[i]);
    if (current.length === 0) {
      alert('目前沒有已啟用的標的可以儲存，請先輸入至少一檔標的。');
      return;
    }
    try {
      localStorage.setItem(MY_PRESET_STORAGE_KEY, JSON.stringify(current));
      setMyPresetStocks(current);
      alert(
        `已將目前 ${current.length} 檔標的(${current.join(
          '、'
        )})設為常用組合，之後按「我的常用標的」即可一鍵套用。`
      );
    } catch (e) {
      alert('儲存失敗，可能是瀏覽器不支援或已停用本機儲存功能。');
    }
  };

  const toggleIndependentCycleMode = () => {
    if (!independentCycleMode) setStrictTimeMode(false);
    setIndependentCycleMode(!independentCycleMode);
  };

  const toggleStrictTimeMode = () => {
    if (!strictTimeMode) setIndependentCycleMode(false);
    setStrictTimeMode(!strictTimeMode);
  };

  const handleInputFocus = (e) => e.target.select();

  const handleInputChange = (index, value) => {
    const newInputs = [...inputs];
    newInputs[index] = value.trim().toUpperCase();
    setInputs(newInputs);
    if (value.trim() !== '' && !enabledInputs[index]) {
      setEnabledInputs((prev) => ({ ...prev, [index]: true }));
    }
  };

  const handleInputBlurInApp = async (index, val) => {
    if (!val) return;
    if (stockNames[val]) return;

    const name = await fetchStockDisplayName(val);
    if (name) {
      setStockNames((prev) => ({ ...prev, [val]: name }));
    }
  };

  const handleAllocationChange = (index, value) => {
    const newVal = Math.max(0, Math.min(100, Number(value)));
    setAllocations((prev) => ({ ...prev, [index]: newVal }));
  };

  const handleAmountChange = (index, amountWan) => {
    const newTargetAmount = Math.max(0, Math.round(Number(amountWan))) * 10000;
    let currentAmounts = {};
    inputs.forEach((_, idx) => {
      const weight = allocations[idx] || 0;
      currentAmounts[idx] = totalCapital * (weight / 100);
    });
    currentAmounts[index] = newTargetAmount;
    const newTotalCapital = inputs.reduce((sum, _, idx) => {
      return sum + (enabledInputs[idx] ? currentAmounts[idx] : 0);
    }, 0);
    const newAllocations = {};
    inputs.forEach((_, idx) => {
      if (newTotalCapital === 0) {
        newAllocations[idx] = 0;
      } else {
        newAllocations[idx] = (currentAmounts[idx] / newTotalCapital) * 100;
      }
    });
    setTotalCapital(newTotalCapital);
    setAllocations(newAllocations);
  };

  const handleTotalCapitalChange = (newTotalWan) => {
    setTotalCapital(Math.round(newTotalWan) * 10000);
  };

  const toggleEnabled = (index) => {
    const nextEnabled = { ...enabledInputs, [index]: !enabledInputs[index] };
    const currentAmounts = {};
    inputs.forEach((_, i) => {
      const weight = allocations[i] || 0;
      currentAmounts[i] = totalCapital * (weight / 100);
    });
    const newTotalCapital = inputs.reduce((sum, _, i) => {
      return sum + (nextEnabled[i] ? currentAmounts[i] : 0);
    }, 0);
    const newAllocations = {};
    inputs.forEach((_, i) => {
      if (newTotalCapital === 0) {
        newAllocations[i] = 0;
      } else {
        newAllocations[i] = (currentAmounts[i] / newTotalCapital) * 100;
      }
    });
    setEnabledInputs(nextEnabled);
    setTotalCapital(newTotalCapital);
    setAllocations(newAllocations);
  };

  const setAllEnabledTo100W = () => {
    const newAmounts = {};
    inputs.forEach((_, idx) => {
      const weight = allocations[idx] || 0;
      newAmounts[idx] = totalCapital * (weight / 100);
    });
    inputs.forEach((_, idx) => {
      if (enabledInputs[idx]) {
        newAmounts[idx] = 1000000;
      }
    });
    const newTotalCapital = inputs.reduce((sum, _, idx) => {
      return sum + (enabledInputs[idx] ? newAmounts[idx] : 0);
    }, 0);
    const newAllocations = {};
    inputs.forEach((_, idx) => {
      if (newTotalCapital === 0) {
        newAllocations[idx] = 0;
      } else {
        newAllocations[idx] = (newAmounts[idx] / newTotalCapital) * 100;
      }
    });
    setTotalCapital(newTotalCapital);
    setAllocations(newAllocations);
  };

  const currentRawTotalWeight = inputs.reduce((sum, _, idx) => {
    return sum + (enabledInputs[idx] ? allocations[idx] || 0 : 0);
  }, 0);

  useEffect(() => {
    const allChecked = Object.values(enabledInputs).every((v) => v);
    if (allChecked) {
      setAllocationError(Math.abs(currentRawTotalWeight - 100) > 0.1);
    } else {
      setAllocationError(false);
    }
  }, [currentRawTotalWeight, enabledInputs]);

  const handlePrint = () => {
    setIsConfigExpanded(false);
    setPrintMode(true);
    setTimeout(() => {
      try {
        window.print();
      } catch (e) {
        console.log(e);
      }
    }, 800);
  };

  useEffect(() => {
    const afterPrint = () => setPrintMode(false);
    window.addEventListener('afterprint', afterPrint);
    return () => window.removeEventListener('afterprint', afterPrint);
  }, []);
