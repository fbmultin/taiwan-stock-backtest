import React, { useState, useEffect, useMemo, useRef } from 'react';
import TW_STOCK_NAMES from './data/twStockNames';
import TW_STOCK_SPLITS from './data/twStockSplits';
import DcaOptimizer from './DcaOptimizer';
import {
  buildMonthlyInvestDates,
  preprocessPriceSeries,
  MA_LINE_KEYS,
  MA_LINE_LABELS,
} from './dcaEngine';
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

// 「K線穿越均線加碼」開關(klineTopUpEnabled)開啟時的規則寫死、不提供額外設定:
// 月線(MA20)/季線(MA60)/半年線(MA120)共用同一個「每個月最多觸發幾次」的額度,
// 詳見 runBacktest 內的計算邏輯與 dcaEngine.js 的同名規則。
const KLINE_TOPUP_MONTHLY_CAP = 1;

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

// 「我的常用標的」用瀏覽器 localStorage 記住使用者自己常用的標的組合，
// 一鍵套用即可取代目前輸入,不用每次都重打;使用者也可隨時按「設為常用」更新這組合。
const MY_PRESET_STORAGE_KEY = 'twBacktestMyPresetStocks';

// --- 全域工具函式 ---

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

// 把價格序列轉成「日期 -> 當日報酬率」的對照表,供計算β值時依日期比對用。
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

// 個股β值(系統性風險係數):以個股日報酬對大盤加權指數(^TWII)日報酬做迴歸估算,
// β = Cov(個股日報酬, 大盤日報酬) / Var(大盤日報酬),只取兩邊日期對得上的交易日。
// β > 1 代表這檔標的波動比大盤劇烈,β < 1 代表較平緩;大盤資料缺失或可比對的
// 交易日數不足時回傳 null,卡片上改顯示「資料不足」而非硬湊一個不可靠的數字。
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

// 自訂區間下方的「日/月/季 -/+ 格子」:以「保持區間長度不變、整段往前或往後平移」的方式,
// 用 setDate()/setMonth() 直接調整 customStart/customEnd,不需要額外的滑桿索引換算。
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

// 依 src/data/twStockSplits.js 這份對照表,校正股票分割/反分割造成的股價斷點。
// 不同資料源(FinMind、Yahoo)是否已經把歷史股價回溯調整過並不一致,
// 所以不會無條件套用比例,而是先用「恢復買賣日前最後一筆價格」跟對照表的
// 分割前/分割後參考價比對,比較接近哪一邊,再決定要不要校正、以及往哪個方向校正:
//   - 接近分割後參考價(誤差 5% 內) → 資料源已經調整過,不再重複處理
//   - 其餘情況(含誤差稍大者)→ 依對照表比例校正,並以對照表的官方數字為準
//   - 兩邊都差很多(50% 以上) → 無法確認,不自動校正,只標記為「無法確認」讓卡片提示使用者
// 除了股價,同一段期間內的除息金額也會用同一個比例換算,避免舊股本的配息
// 相對校正後的新股本股價被放大或縮小,污染含息報酬率的計算。
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
        // 這次查詢的資料範圍沒有橫跨這次分割事件,跟這次回測無關
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

      // 分割:股數變多、股價變小 → 除以倍數;反分割:股數變少、股價變大 → 乘以倍數
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

// 執行過程中遇到需要決定的狀況(例如標的資料起始日晚於指定日期、除息日太靠近結束日)時彈出的詢問視窗。
// 取代先前「依除息日對齊週期/強制固定區間」這類事先勾選好的隱藏規則:改成當下發生了什麼、
// 有哪些處理方式,直接列出來讓使用者選,選完才繼續往下算。
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
              請選擇要怎麼處理,選完後會用您的選擇繼續計算
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
  // 兩個分頁:'backtest'=既有的「ETF回測比較」、'dca'=新增的「定期定額策略最佳化」
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
  // 先以內建的台股代號對照表(src/data/twStockNames.js)當作初始值,
  // 已知代號可直接顯示名稱、無需每次都打 API 查詢;查不到的代號才會照舊呼叫線上 API。
  const [stockNames, setStockNames] = useState(() => ({ ...TW_STOCK_NAMES }));

  const [timeRange, setTimeRange] = useState('12m');
  const [customStart, setCustomStart] = useState('');
  // 結束日預設帶入今天,使用者不用每次都手動選today
  const [customEnd, setCustomEnd] = useState(
    () => new Date().toISOString().split('T')[0]
  );

  const [totalCapital, setTotalCapital] = useState(6000000);

  // 加碼策略:「每月固定日期加碼」與「K線穿越均線加碼」是兩個各自獨立的開關,
  // 可以分別自由開關(單獨開一個、兩個都開、或都關),兩者共用同一個「每次加碼金額」
  // (monthlyTopUpAmount)。K線穿越均線的規則本身寫死、不提供額外設定:
  // 月線(MA20)/季線(MA60)/半年線(MA120)共用「每月最多觸發1次」的額度。
  // monthlyTopUpIncludeLumpSum 控制「最上面設定的一次性本金」是否也列入(只要任一
  // 加碼開關開啟就適用):true(預設)= 一次性本金照常投入,加碼是額外加上去的;
  // false = 不做一次性投入,完全從零開始,只靠加碼逐步建立部位。
  const [monthlyTopUpEnabled, setMonthlyTopUpEnabled] = useState(false);
  const [klineTopUpEnabled, setKlineTopUpEnabled] = useState(false);
  const [monthlyTopUpDay, setMonthlyTopUpDay] = useState(5);
  const [monthlyTopUpAmount, setMonthlyTopUpAmount] = useState(10000);
  const [monthlyTopUpIncludeLumpSum, setMonthlyTopUpIncludeLumpSum] =
    useState(true);
  const anyTopUpEnabled = monthlyTopUpEnabled || klineTopUpEnabled;

  // 標的選擇 & 配置:已移除手動拉桿/百分比/金額調整,一律採「已勾選標的平均分配本金」,
  // enabledInputs 一變動就由下面的 useEffect 自動重新平均分配 allocations。
  const [allocations, setAllocations] = useState({
    0: 16.6666,
    1: 16.6666,
    2: 16.6666,
    3: 16.6666,
    4: 16.6666,
    5: 16.667,
  });

  const [isConfigExpanded, setIsConfigExpanded] = useState(true);

  const [results, setResults] = useState(null);
  const [comparisonInfo, setComparisonInfo] = useState(null);
  const [failedTickers, setFailedTickers] = useState([]);

  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  // 執行狀態顯示:目前階段文字說明 + 每檔標的抓取進度,讓使用者知道卡在哪裡
  const [loadingStage, setLoadingStage] = useState('');
  const [fetchStatusList, setFetchStatusList] = useState([]);
  // 目前所在的資料階段(price/name/quote/compute),用來顯示「這個階段跳過會怎樣」的具體說明
  const [loadingStagePhase, setLoadingStagePhaseState] = useState('');
  const loadingStagePhaseRef = useRef('');
  const setLoadingStagePhase = (phase) => {
    loadingStagePhaseRef.current = phase;
    setLoadingStagePhaseState(phase);
  };
  // 點擊「跳過等待」當下所在的階段,用來讓「已跳過」提示文字維持在那個階段的說明,
  // 不會因為後續階段接著推進而跟著變動
  const [skippedAtPhase, setSkippedAtPhase] = useState('');
  // 各階段跳過後的具體影響說明,顯示在跳過按鈕旁邊,讓使用者知道「跳過會少什麼資料」
  const STAGE_SKIP_INFO = {
    params: { label: '參數準備', consequence: '此步驟為本機運算，通常瞬間完成。' },
    price: {
      label: '股價與配息資料抓取',
      consequence:
        '這是回測用的核心資料。跳過的標的會被視為抓取失敗，可能被排除在回測結果之外，或需要之後手動補值。',
    },
    name: {
      label: '股票名稱查詢',
      consequence:
        '不影響回測數據，此階段的資料只有「公司名稱」，跳過只會讓尚未查到名稱的股票代號旁邊沒有顯示公司名稱，價格、配息、報酬率等計算完全不受影響。',
    },
    compute: { label: '績效與配息週期計算', consequence: '此步驟為本機運算，通常瞬間完成。' },
  };
  // 卡住點跳過機制:等待超過門檻時間後開放「跳過等待」按鈕,由使用者手動決定是否放棄仍在等待中的項目、直接用現有資料繼續
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
  // β值需要額外抓取大盤加權指數、且逐檔跑迴歸計算,會拖慢回測速度,
  // 預設關閉,使用者主動勾選才執行,一般情況不需要。
  const [calcBeta, setCalcBeta] = useState(false);

  const [missingDataList, setMissingDataList] = useState([]);
  const [manualPriceData, setManualPriceData] = useState({});

  // 執行過程中遇到需要決定的狀況(例如某標的資料起始日晚於指定日期、或除息日太靠近結束日)時,
  // 在「一般模式」下(未勾選任何進階選項)改為暫停執行、主動詢問使用者要怎麼調整,
  // 而不是套用事先設定好的規則靜默調整。進階選項(依除息日對齊週期/強制固定區間)維持原本自動行為。
  const [pendingSituations, setPendingSituations] = useState(null);
  const pendingRunArgsRef = useRef({ overrideManualData: null, dateOverride: null });

  // 假日自動迴避通知(系統將使用者選取的日期自動調整為最近交易日時顯示)
  const [dateAdjustmentNote, setDateAdjustmentNote] = useState(null);
  // 回測後日期調整 UI
  const [showDateAdjustPanel, setShowDateAdjustPanel] = useState(false);
  const [adjustStart, setAdjustStart] = useState('');
  const [adjustEnd, setAdjustEnd] = useState('');

  // 我的常用標的(存在瀏覽器 localStorage,僅此裝置/瀏覽器有效)
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
      // localStorage 不可用(例如無痕模式)時安靜忽略,不影響其餘功能
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

  // 一鍵套用「我的常用標的」,取代目前輸入,不用每次重打
  const handleApplyMyPreset = () => {
    if (!myPresetStocks || myPresetStocks.length === 0) {
      alert(
        '尚未設定「我的常用標的」。請先輸入想要的標的組合,再按旁邊的「設為常用」儲存,之後就能一鍵套用。'
      );
      return;
    }
    handleApplyPreset(myPresetStocks);
  };

  // 將目前已啟用的標的組合儲存為「我的常用標的」(存在瀏覽器 localStorage)
  const handleSaveMyPreset = () => {
    const current = inputs.filter((s, i) => s !== '' && enabledInputs[i]);
    if (current.length === 0) {
      alert('目前沒有已啟用的標的可以儲存,請先輸入至少一檔標的。');
      return;
    }
    try {
      localStorage.setItem(MY_PRESET_STORAGE_KEY, JSON.stringify(current));
      setMyPresetStocks(current);
      alert(
        `已將目前 ${current.length} 檔標的(${current.join(
          '、'
        )})設為常用組合,之後按「我的常用標的」即可一鍵套用。`
      );
    } catch (e) {
      alert('儲存失敗,可能是瀏覽器不支援或已停用本機儲存功能。');
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

  const handleTotalCapitalChange = (newTotalWan) => {
    setTotalCapital(Math.round(newTotalWan) * 10000);
  };

  // 已勾選的標的一律平均分配本金,enabledInputs 一變動就自動重算 allocations,
  // 不再提供手動拉桿/百分比/金額調整。
  useEffect(() => {
    const enabledCount = inputs.reduce(
      (count, _, idx) => count + (enabledInputs[idx] ? 1 : 0),
      0
    );
    const equalWeight = enabledCount > 0 ? 100 / enabledCount : 0;
    const newAllocations = {};
    inputs.forEach((_, idx) => {
      newAllocations[idx] = enabledInputs[idx] ? equalWeight : 0;
    });
    setAllocations(newAllocations);
  }, [enabledInputs]);

  const toggleEnabled = (index) => {
    setEnabledInputs((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const setAllEnabledTo100W = () => {
    const enabledCount = inputs.reduce(
      (count, _, idx) => count + (enabledInputs[idx] ? 1 : 0),
      0
    );
    setTotalCapital(enabledCount * 1000000);
  };

  const hasSelectedStock = inputs.some(
    (val, idx) => val && enabledInputs[idx]
  );

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

  const runBacktest = async (
    overrideManualData = null,
    dateOverride = null,
    situationResolutions = null
  ) => {
    setLoading(true);
    setResults(null);
    setPeriodStats(null);
    setErrorMsg('');
    setDebugInfo('');
    setCycleInfoText('');
    setComparisonInfo(null);
    setFailedTickers([]);
    setMissingDataList([]);
    setPendingSituations(null);
    setDateAdjustmentNote(null);
    setIsConfigExpanded(false);
    setProgress(0);
    setLoadingStage('準備回測參數...');
    setLoadingStagePhase('params');
    setFetchStatusList([]);
    setSkipAvailable(false);
    setSkipTriggered(false);
    setSkippedAtPhase('');

    // 卡住點跳過機制:建立一個共用的「跳過訊號」。
    // 等待超過門檻時間後會開放畫面上的「跳過等待」按鈕,使用者按下後
    // 所有仍在等待中的網路請求(股價/配息、股票名稱、即時報價)會立刻視為放棄,
    // 直接用當下已取得的資料繼續往下算,藉此手動加快執行速度。
    const SKIP_MARKER = Symbol('skip');
    let skipResolve;
    const skipPromise = new Promise((resolve) => {
      skipResolve = resolve;
    });
    skipResolverRef.current = () => {
      setSkippedAtPhase(loadingStagePhaseRef.current);
      setSkipTriggered(true);
      setSkipAvailable(false);
      skipResolve(SKIP_MARKER);
    };
    if (skipTimerRef.current) clearTimeout(skipTimerRef.current);
    skipTimerRef.current = setTimeout(() => setSkipAvailable(true), 6000);

    const raceWithSkip = (promise) =>
      Promise.race([promise, skipPromise]).then((res) => ({
        value: res === SKIP_MARKER ? null : res,
        wasSkipped: res === SKIP_MARKER,
      }));

    const finishLoading = () => {
      if (skipTimerRef.current) {
        clearTimeout(skipTimerRef.current);
        skipTimerRef.current = null;
      }
      setSkipAvailable(false);
      setLoadingStage('');
      setLoadingStagePhase('');
    };

    let rangeStart, rangeEnd;

    // 若由「回測後日期調整 UI」直接帶入指定區間,優先使用該區間
    // (不透過 timeRange/customStart/customEnd 狀態,避免 setState 非同步造成的時序問題)
    if (dateOverride && dateOverride.start && dateOverride.end) {
      const d1 = new Date(dateOverride.start);
      const d2 = new Date(dateOverride.end);
      if (d1 > d2) {
        rangeStart = d2;
        rangeEnd = d1;
      } else {
        rangeStart = d1;
        rangeEnd = d2;
      }
    } else if (timeRange === 'custom') {
      if (!customStart || !customEnd) {
        setErrorMsg('請選擇起始與結束日期');
        setLoading(false);
        finishLoading();
        return;
      }
      const d1 = new Date(customStart);
      const d2 = new Date(customEnd);
      if (d1 > d2) {
        rangeStart = d2;
        rangeEnd = d1;
      } else {
        rangeStart = d1;
        rangeEnd = d2;
      }
    } else {
      rangeEnd = getLastCompletedTradingDay();
      rangeStart = new Date(rangeEnd);
      if (timeRange === 'ytd') {
        rangeStart = new Date(rangeStart.getFullYear(), 0, 1);
      } else {
        const months =
          timeRange === '3m'
            ? 3
            : timeRange === '6m'
            ? 6
            : timeRange === '12m'
            ? 12
            : timeRange === '3y'
            ? 36
            : timeRange === '5y'
            ? 60
            : 12;
        rangeStart.setMonth(rangeStart.getMonth() - months);
      }
    }

    // 記錄使用者實際請求的日期(調整前),供之後比對是否被自動迴避邏輯調整
    const rawRequestedStart = new Date(rangeStart);
    const rawRequestedEnd = new Date(rangeEnd);

    // 所有計算終點固定為前一個交易日,不計算當天資料(不論現在是否已經收盤,
    // 一律不採當天的價格,避免尾盤價/即時報價跟隔天資料源正式收錄的收盤價對不上)。
    const lastCompletedTradingDay = getLastCompletedTradingDay();
    if (rangeEnd > lastCompletedTradingDay) {
      rangeEnd = new Date(lastCompletedTradingDay);
    }
    // 結束日若仍落在非交易日(例如自訂區間或日期覆寫指定到假日),往前推到最近一個交易日
    while (isNonTradingDay(rangeEnd)) {
      rangeEnd.setDate(rangeEnd.getDate() - 1);
    }
    // 起始日避開非交易日:如果起始日落在週末或國定假日,往後推到最近一個交易日
    while (isNonTradingDay(rangeStart)) {
      rangeStart.setDate(rangeStart.getDate() + 1);
    }
    setRequestedStartDate(rangeStart);

    // 若日期因假日迴避邏輯而被自動調整,記錄下來以便在 UI 上提示使用者
    const adjustedStartStr = rangeStart.toISOString().split('T')[0];
    const adjustedEndStr = rangeEnd.toISOString().split('T')[0];
    const rawStartStr = rawRequestedStart.toISOString().split('T')[0];
    const rawEndStr = rawRequestedEnd.toISOString().split('T')[0];
    const startShifted = rawStartStr !== adjustedStartStr;
    const endShifted = rawEndStr !== adjustedEndStr;
    if (startShifted || endShifted) {
      setDateAdjustmentNote({
        originalStart: rawStartStr,
        adjustedStart: adjustedStartStr,
        originalEnd: rawEndStr,
        adjustedEnd: adjustedEndStr,
        startShifted,
        endShifted,
      });
    }

    const activeStocks = inputs
      .map((s, idx) => ({ s, idx }))
      .filter((item) => item.s !== '' && enabledInputs[item.idx]);
    if (activeStocks.length === 0) {
      setLoading(false);
      finishLoading();
      return;
    }

    setFetchStatusList(
      activeStocks.map((item) => ({ symbol: item.s, status: 'pending' }))
    );
    const updateFetchStatus = (symbol, status) => {
      setFetchStatusList((prev) =>
        prev.map((f) => (f.symbol === symbol ? { ...f, status } : f))
      );
    };

    try {
      // 階段 1:抓取股價與配息資料(通常是整體耗時最久的步驟)。
      // 每檔標的各自race「跳過訊號」,單一標的卡住不會拖住其他標的的顯示進度。
      let fetchedCount = 0;
      const totalStocks = activeStocks.length;
      setLoadingStage(`正在抓取股價與配息資料 (0/${totalStocks})...`);
      setLoadingStagePhase('price');
      setProgress(5);
      const promises = activeStocks.map((item) =>
        raceWithSkip(fetchStockPriceData(item.s)).then(
          ({ value, wasSkipped }) => {
            fetchedCount++;
            updateFetchStatus(
              item.s,
              wasSkipped
                ? 'skipped'
                : value && value.fromCache
                ? 'cached'
                : value && value.data.length > 0
                ? 'done'
                : 'failed'
            );
            setProgress(5 + (fetchedCount / totalStocks) * 55);
            setLoadingStage(
              `正在抓取股價與配息資料 (${fetchedCount}/${totalStocks})...`
            );
            return value;
          }
        )
      );
      // 同時抓取大盤加權指數(^TWII)同期的收盤價,供之後計算各標的的β值使用;
      // 逐檔迴歸運算+多一次抓取會拖慢回測速度,故只在使用者勾選「計算β值」時才發出;
      // 未勾選就直接跳過。走跟個股相同的 cache-first 共用快取,抓取失敗也不影響回測本身。
      const benchmarkPromise = calcBeta
        ? fetchIndexPriceData('^TWII')
        : Promise.resolve(null);
      const [rawResults, benchmarkResult] = await Promise.all([
        Promise.all(promises),
        benchmarkPromise,
      ]);
      const benchmarkReturnsByDate = buildDailyReturnsByDate(
        benchmarkResult?.data
      );

      const failures = [];
      activeStocks.forEach((item, idx) => {
        if (!rawResults[idx] || rawResults[idx].data.length === 0) {
          failures.push(item.s);
        }
      });
      if (failures.length > 0) {
        setFailedTickers(failures);
      }

      const successfulData = rawResults
        .map((r, i) => (r ? { ...r, inputIndex: activeStocks[i].idx } : null))
        .filter((r) => r && r.data.length > 0);

      if (successfulData.length === 0) {
        setErrorMsg('無法抓取任何有效數據，請檢查代碼或網路。');
        setLoading(false);
        finishLoading();
        return;
      }

      // 分割/反分割校正:若此標的在查詢區間內曾經分割過,依對照表判斷資料源是否已經
      // 回溯調整、需要的話自動校正股價與除息金額,並記錄下來供卡片顯示說明徽章。
      successfulData.forEach((stock) => {
        stock.splitEvents = applySplitAdjustments(stock);
      });

      // 階段 2:查詢股票名稱(非關鍵資料,卡住時同樣可被「跳過」訊號放行)
      // 沿用 fetchStatusList 顯示每檔的即時狀態,讓畫面能清楚指出「目前是哪一檔還在查」
      setLoadingStage('正在查詢股票名稱...');
      setLoadingStagePhase('name');
      setProgress(65);
      setFetchStatusList(
        successfulData.map((stock) => ({
          symbol: stock.symbol,
          status: stockNames[stock.symbol] ? 'done' : 'pending',
        }))
      );
      await Promise.all(
        successfulData.map(async (stock) => {
          try {
            if (stockNames[stock.symbol]) {
              stock.stockName = stockNames[stock.symbol];
            } else {
              const { value: name, wasSkipped } = await raceWithSkip(
                fetchStockDisplayName(stock.symbol)
              );
              stock.stockName = name || '';
              updateFetchStatus(stock.symbol, wasSkipped ? 'skipped' : 'done');
            }
          } catch (e) {
            stock.stockName = '';
            updateFetchStatus(stock.symbol, 'failed');
          }
        })
      );

      const newNamesMap = {};
      successfulData.forEach((s) => {
        if (s.stockName) newNamesMap[s.symbol] = s.stockName;
      });
      setStockNames((prev) => ({ ...prev, ...newNamesMap }));
      setProgress(78);

      // 所有計算終點固定為前一個交易日,不計算當天資料,因此不再另外檢查/補上
      // 當天尚未被資料源正式收錄的即時報價(舊版「階段 3」已移除)。
      setProgress(90);

      const currentManualData = overrideManualData || manualPriceData;
      successfulData.forEach((stock) => {
        Object.keys(currentManualData).forEach((key) => {
          if (key.startsWith(stock.symbol + '_')) {
            const dateStr = key.split('_')[1];
            const price = parseFloat(currentManualData[key]);
            const existingIdx = stock.data.findIndex((d) => d.date === dateStr);
            if (existingIdx !== -1) {
              stock.data[existingIdx].price = price;
            } else {
              const targetTs = new Date(dateStr).getTime();
              let insertPos = 0;
              while (
                insertPos < stock.data.length &&
                stock.data[insertPos].timestamp < targetTs
              ) {
                insertPos++;
              }
              let prevAccDiv = 0;
              if (insertPos > 0)
                prevAccDiv = stock.data[insertPos - 1].accumulatedDividend;

              const newPoint = {
                date: dateStr,
                timestamp: targetTs,
                price: price,
                accumulatedDividend: prevAccDiv,
              };
              stock.data.splice(insertPos, 0, newPoint);
            }
          }
        });
      });

      const finalAllocations = allocations;

      const analyzedStocks = successfulData.map((stock) => {
        const firstDataDate = new Date(stock.data[0].date);
        const daysHistory = (rangeEnd - firstDataDate) / (1000 * 60 * 60 * 24);
        const isMonthly = checkIsMonthly(stock.divDates);
        return {
          ...stock,
          daysHistory,
          isMonthly,
          firstDataDate,
        };
      });

      let maxMinDate = rangeStart;
      let finalStockList = [];
      let commonCycles = 12;

      let globalLatestDivDate = null;
      let globalCalcEndDate = rangeEnd;
      // 修改 2:從所有 ETF 的最後一筆資料,找出共同覆蓋到的最後日期
      // 這樣可以自動處理國定假日 / ETF 個別休市的情況
      if (successfulData && successfulData.length > 0) {
        const lastDatesPerStock = successfulData
          .filter((s) => s.data && s.data.length > 0)
          .map((s) => new Date(s.data[s.data.length - 1].date));
        if (lastDatesPerStock.length > 0) {
          const earliestLastDate = new Date(
            Math.min(...lastDatesPerStock.map((d) => d.getTime()))
          );
          if (earliestLastDate < rangeEnd) {
            globalCalcEndDate = earliestLastDate;
          }
        }
      }
      let endDateLimiter = null;

      // 需要使用者決定的狀況清單。一般模式(未勾選任何進階選項)下,遇到需要調整日期
      // 的情況不再依規則靜默套用,而是先收集起來、暫停執行,交由使用者確認怎麼處理。
      // 進階選項(依除息日對齊週期/強制固定區間)維持原本的自動行為,不會被詢問。
      const situations = [];

      // 情況 A:某標的的除息日太靠近指定的結束日,除權息當天股價缺口可能影響比較公平性
      if (!strictTimeMode) {
        let maxDivTs = 0;
        let candidateEndLimiter = null;
        analyzedStocks.forEach((s) => {
          const divsInRange = s.divDates.filter(
            (ts) => ts <= rangeEnd.getTime()
          );
          if (divsInRange.length > 0) {
            const lastDiv = divsInRange[divsInRange.length - 1];
            const daysDiff =
              (rangeEnd.getTime() - lastDiv) / (1000 * 60 * 60 * 24);
            if (daysDiff <= 7 && lastDiv > maxDivTs) {
              maxDivTs = lastDiv;
              candidateEndLimiter = s.symbol;
            }
          }
        });

        if (maxDivTs > 0) {
          const pulledBackDate = new Date(maxDivTs);
          pulledBackDate.setDate(pulledBackDate.getDate() - 1);
          const applyPullback = () => {
            globalLatestDivDate = new Date(maxDivTs);
            globalCalcEndDate = pulledBackDate;
            endDateLimiter = candidateEndLimiter;
          };

          if (independentCycleMode) {
            // 進階選項「依除息日對齊週期」:維持原本自動行為,不詢問
            applyPullback();
          } else if (situationResolutions?.endDateNearDividend) {
            if (situationResolutions.endDateNearDividend === 'pullback') {
              applyPullback();
            }
            // 'keep' -> 保留使用者指定的結束日,不調整
          } else {
            situations.push({
              key: 'endDateNearDividend',
              title: `${candidateEndLimiter} 的除息日太靠近您指定的結束日`,
              description: `${candidateEndLimiter} 的除息日為 ${
                new Date(maxDivTs).toISOString().split('T')[0]
              },距離您指定的結束日 ${
                rangeEnd.toISOString().split('T')[0]
              } 只差 ${Math.round(
                (rangeEnd.getTime() - maxDivTs) / (1000 * 60 * 60 * 24)
              )} 天。除息當天股價會出現除權息缺口,可能影響報酬率比較的公平性,要怎麼處理?`,
              options: [
                {
                  value: 'pullback',
                  label: `結束日往前調整到 ${
                    pulledBackDate.toISOString().split('T')[0]
                  }(除息日前一天)`,
                  recommended: true,
                },
                {
                  value: 'keep',
                  label: `仍使用您指定的結束日 ${
                    rangeEnd.toISOString().split('T')[0]
                  }`,
                },
              ],
            });
          }
        }
      }

      let limitingStockSymbol = null;

      if (independentCycleMode && !strictTimeMode) {
        const minDaysThreshold = 180;
        const validCandidates = analyzedStocks.filter(
          (s) => s.daysHistory >= minDaysThreshold
        );
        const tooNewStocks = analyzedStocks
          .filter((s) => s.daysHistory < minDaysThreshold)
          .map((s) => ({
            ...s,
            isExcluded: true,
            exclusionReason: '排除: 上市未滿180日',
          }));

        const finalCandidates = [];
        const midTermExcluded = [];

        validCandidates.forEach((s) => {
          if (s.daysHistory < 390) {
            if (s.isMonthly) {
              finalCandidates.push(s);
            } else {
              midTermExcluded.push({
                ...s,
                isExcluded: true,
                exclusionReason: '排除: 上市未滿390日且非月配',
              });
            }
          } else {
            finalCandidates.push(s);
          }
        });

        const allExcluded = [...tooNewStocks, ...midTermExcluded];

        let benchmarkStock = null;
        const intermediateStocks = finalCandidates.filter(
          (s) => s.daysHistory < 390
        );

        if (intermediateStocks.length > 0) {
          benchmarkStock = intermediateStocks.reduce((prev, curr) =>
            prev.daysHistory < curr.daysHistory ? prev : curr
          );
          limitingStockSymbol = benchmarkStock.symbol;
        } else if (finalCandidates.length > 0) {
          const monthlyOlds = finalCandidates.filter((s) => s.isMonthly);
          if (monthlyOlds.length > 0) benchmarkStock = monthlyOlds[0];
          else benchmarkStock = finalCandidates[0];
        }

        if (benchmarkStock) {
          const benchmarkDivs = [...benchmarkStock.divDates].sort(
            (a, b) => b - a
          );
          const baseEndDateTs = globalCalcEndDate.getTime();
          const latestDivIdx = benchmarkDivs.findIndex(
            (ts) => ts <= baseEndDateTs
          );

          if (latestDivIdx !== -1) {
            const availableCycles = benchmarkDivs.length - latestDivIdx;
            commonCycles = Math.min(12, availableCycles);
            const targetDivIdx = Math.min(
              latestDivIdx + commonCycles - 1,
              benchmarkDivs.length - 1
            );
            const targetStartDivTs = benchmarkDivs[targetDivIdx];
            maxMinDate = new Date(targetStartDivTs);

            setCycleInfoText(
              `基準: ${
                benchmarkStock.symbol
              } (近${commonCycles}次除息, 結算至 ${
                globalCalcEndDate.toISOString().split('T')[0]
              })`
            );
          } else {
            maxMinDate = rangeStart;
            setCycleInfoText('基準標的無配息紀錄');
          }
        } else {
          maxMinDate = rangeStart;
        }

        setCyclesUsed(commonCycles);
        finalStockList = [...finalCandidates, ...allExcluded];
      } else {
        // 情況 B:某些標的的資料起始日晚於指定的起始日(可能上市較晚,或資料庫尚未收錄更早資料)
        // 注意:candidateStart/candidateLimiter 只是用running-max找出「最晚」的那一檔,
        // 用來當作 pushForward 的建議日期;實際判斷「哪些標的不合格」必須另外用固定的
        // rangeStart 逐一比對每一檔,否則只會抓到最極端的那一檔,其餘同樣不合格的標的會被漏掉。
        let excludedSymbols = [];
        if (!strictTimeMode) {
          const validStocksForDate = successfulData.filter(
            (s) => s.data.length > 10
          );
          let candidateStart = rangeStart;
          let candidateLimiter = null;
          const shortHistoryStocks = [];
          validStocksForDate.forEach((stock) => {
            const firstDate = new Date(stock.data[0].date);
            if (firstDate > rangeStart) {
              shortHistoryStocks.push({
                symbol: stock.symbol,
                firstDateStr: firstDate.toISOString().split('T')[0],
              });
            }
            if (firstDate > candidateStart) {
              candidateStart = firstDate;
              candidateLimiter = stock.symbol;
            }
          });
          if (validStocksForDate.length === 0 && successfulData.length > 0) {
            candidateStart = new Date(successfulData[0].data[0].date);
            candidateLimiter = successfulData[0].symbol;
            if (candidateStart.getTime() !== rangeStart.getTime()) {
              shortHistoryStocks.push({
                symbol: candidateLimiter,
                firstDateStr: candidateStart.toISOString().split('T')[0],
              });
            }
          }

          if (
            candidateLimiter &&
            candidateStart.getTime() !== rangeStart.getTime()
          ) {
            const candidateStartStr = candidateStart
              .toISOString()
              .split('T')[0];
            const rangeStartStr = rangeStart.toISOString().split('T')[0];
            const resolution = situationResolutions?.startDateShortHistory;
            const shortHistoryLabel = shortHistoryStocks
              .map((s) => `${s.symbol}(${s.firstDateStr})`)
              .join('、');
            const isMultiple = shortHistoryStocks.length > 1;

            if (resolution === 'pushForward') {
              maxMinDate = candidateStart;
              limitingStockSymbol = candidateLimiter;
            } else if (resolution === 'exclude') {
              excludedSymbols = shortHistoryStocks.map((s) => s.symbol);
              maxMinDate = rangeStart;
            } else if (resolution === 'keepPartial') {
              maxMinDate = rangeStart;
            } else {
              situations.push({
                key: 'startDateShortHistory',
                title: isMultiple
                  ? `有 ${shortHistoryStocks.length} 檔標的的資料起始日晚於您指定的起始日`
                  : `${candidateLimiter} 的資料起始日晚於您指定的起始日`,
                description: `${shortHistoryLabel} 最早的資料如上,晚於您指定的起始日 ${rangeStartStr}(可能是上市較晚,或資料庫尚未收錄更早的資料),要怎麼處理?`,
                options: [
                  {
                    value: 'pushForward',
                    label: `全部標的統一從 ${candidateStartStr} 開始比較`,
                    recommended: true,
                  },
                  {
                    value: 'exclude',
                    label: isMultiple
                      ? `排除以上 ${shortHistoryStocks.length} 檔(${shortHistoryLabel}),其餘標的維持從 ${rangeStartStr} 開始`
                      : `排除 ${candidateLimiter},其餘標的維持從 ${rangeStartStr} 開始`,
                  },
                  {
                    value: 'keepPartial',
                    label: isMultiple
                      ? `維持 ${rangeStartStr},以上標的從其各自實際起始日開始比較(各標的起點不同)`
                      : `維持 ${rangeStartStr},${candidateLimiter} 從其實際起始日開始比較(各標的起點不同)`,
                  },
                ],
              });
            }
          }
        }
        finalStockList = excludedSymbols.length
          ? successfulData.map((s) =>
              excludedSymbols.includes(s.symbol)
                ? {
                    ...s,
                    isExcluded: true,
                    exclusionReason: '使用者選擇排除(資料起始日晚於指定起始日)',
                  }
                : s
            )
          : successfulData;
        setCycleInfoText('');
      }

      // 若有任何狀況需要使用者決定,暫停執行、彈出詢問視窗,等使用者確認後再繼續計算
      if (situations.length > 0) {
        pendingRunArgsRef.current = { overrideManualData, dateOverride };
        setPendingSituations(situations);
        setLoading(false);
        finishLoading();
        return;
      }

      setComparisonInfo({
        startDate: maxMinDate.toISOString().split('T')[0],
        endDate: globalCalcEndDate.toISOString().split('T')[0],
        limitingStock: limitingStockSymbol,
        endDateLimiter: endDateLimiter,
        mode: strictTimeMode
          ? 'strict'
          : independentCycleMode
          ? 'cycle'
          : 'normal',
      });

      const missingList = [];
      const requiredEndDateStr = globalCalcEndDate.toISOString().split('T')[0];
      const activeCheckList = finalStockList.filter((s) => !s.isExcluded);

      activeCheckList.forEach((stock) => {
        const hasEndData = stock.data.find(
          (d) => d.date === requiredEndDateStr
        );
        if (!hasEndData) {
          const lastData = stock.data[stock.data.length - 1];
          const lastDateTs = new Date(lastData.date).getTime();
          const reqEndTs = globalCalcEndDate.getTime();
          const diffDays = (reqEndTs - lastDateTs) / (1000 * 60 * 60 * 24);

          if (diffDays > 0) {
            missingList.push({
              symbol: stock.symbol,
              stockName: stock.stockName,
              date: requiredEndDateStr,
              type: 'end',
            });
          }
        }
      });

      if (missingList.length > 0) {
        setMissingDataList(missingList);
        setLoading(false);
        finishLoading();
        return;
      }

      setLoadingStage('正在計算績效與配息週期...');
      setLoadingStagePhase('compute');
      setProgress(96);

      const finalResults = finalStockList
        .map((stock) => {
          if (stock.isExcluded) {
            return {
              symbol: stock.symbol,
              stockName: stock.stockName,
              isExcluded: true,
              exclusionReason: stock.exclusionReason,
              inputIndex: stock.inputIndex,
              weight: finalAllocations[stock.inputIndex] || 0,
            };
          }

          let effectiveStartDate = maxMinDate;
          let effectiveEndDate = globalCalcEndDate;
          let snapToExDiv = independentCycleMode && !strictTimeMode;
          let dividendDetails = [];

          let startIndex = stock.data.findIndex(
            (d) => new Date(d.date) >= effectiveStartDate
          );

          if (startIndex === -1) {
            if (new Date(stock.data[0].date) > effectiveStartDate)
              startIndex = 0;
            else return null;
          }

          let rawData = stock.data.slice(startIndex);
          let endIndex = rawData.findIndex(
            (d) => new Date(d.date) > effectiveEndDate
          );
          if (endIndex !== -1) {
            rawData = rawData.slice(0, endIndex);
          }

          const filteredData = rawData;
          if (filteredData.length < 1) return null;

          const startData = filteredData[0];
          const endData = filteredData[filteredData.length - 1];

          const today = new Date();
          const fiveYearsAgo = new Date(
            today.getFullYear() - 5,
            today.getMonth(),
            today.getDate()
          );
          const firstDataDate = new Date(stock.data[0].date);
          const isYoungStock = stock.firstDataDate > fiveYearsAgo;
          const isShortHistory =
            firstDataDate > new Date(rangeStart.getTime() + 86400000 * 5);

          const initialPrice = startData.price;
          const finalPrice = endData.price;

          const periodStartTs = new Date(startData.date).getTime();
          const periodEndTs = effectiveEndDate.getTime();
          const rawPeriodEndTs = rangeEnd.getTime();
          const validDivTimestamps = stock.divDates
            .filter((ts) => ts >= periodStartTs && ts <= periodEndTs)
            .sort((a, b) => a - b);

          let periodDividends = 0;
          validDivTimestamps.forEach((ts) => {
            const keySec = Math.floor(ts / 1000);
            const divInfo =
              stock.dividendsMap[keySec.toString()] ||
              stock.dividendsMap[keySec] ||
              stock.dividendsMap[ts];
            if (divInfo) periodDividends += divInfo.amount;
          });
          if (periodDividends < 0) periodDividends = 0;

          // 加碼開關:計算「實際投入本金/股數/配息現金」。「每月固定日期加碼」與
          // 「K線穿越均線加碼」是兩個各自獨立的開關,可以只開一個、兩個都開、或都關。
          // 兩者都關時邏輯與過去完全相同(shares 固定 = allocated/initialPrice,
          // dividendCash = shares * periodDividends);只要開了任一個,就改成逐日模擬——
          // 觸發時加碼買進、股數隨時間增加,配息現金則依「當下實際持有股數」
          // 逐次入帳,而不是用回測結束時的股數去回推整個期間的配息。
          // useLumpSum 為 false 時(使用者選擇「不列入本金」),不做一開始的一次性投入,
          // 完全從零股數開始,只靠加碼逐步建立部位。
          const weight = finalAllocations[stock.inputIndex] || 0;
          const allocated = totalCapital * (weight / 100);
          const useLumpSum = !anyTopUpEnabled || monthlyTopUpIncludeLumpSum;
          let shares = useLumpSum && initialPrice > 0 ? allocated / initialPrice : 0;
          let totalInvested = useLumpSum ? allocated : 0;
          let dividendCash = 0;

          const topUpDateSet =
            monthlyTopUpEnabled && monthlyTopUpAmount > 0
              ? buildMonthlyInvestDates(filteredData, monthlyTopUpDay)
              : null;

          // K線穿越均線加碼(規則寫死,由獨立的 klineTopUpEnabled 開關控制,
          // 不提供額外設定):月線(MA20)/季線(MA60)/半年線(MA120)都用
          // stock.data 的完整歷史算均線(跟定期定額最佳化分頁算法相同),
          // 再依日期對回 filteredData 使用。
          const maByDate = klineTopUpEnabled
            ? new Map(
                preprocessPriceSeries(stock).map((d) => [
                  d.date,
                  { ma20: d.ma20, ma60: d.ma60, ma120: d.ma120 },
                ])
              )
            : null;
          const divAmountByDate = new Map();
          validDivTimestamps.forEach((ts) => {
            const keySec = Math.floor(ts / 1000);
            const divInfo =
              stock.dividendsMap[keySec.toString()] ||
              stock.dividendsMap[keySec] ||
              stock.dividendsMap[ts];
            divAmountByDate.set(
              new Date(ts).toISOString().split('T')[0],
              divInfo?.amount || 0
            );
          });

          // 預先算好「某一天之後(不含當天)」還會發生多少配息(每股),
          // 用來推算「某一筆加碼的股數,從買進那天到回測結束為止,總共能領到多少配息」——
          // 跟主迴圈一樣,買進當天不算,要隔天以後的配息才算這筆加碼的。
          const dailyDivAmounts = filteredData.map(
            (day) => divAmountByDate.get(day.date) || 0
          );
          const suffixDivSum = new Array(filteredData.length + 1).fill(0);
          for (let i = filteredData.length - 1; i >= 0; i--) {
            suffixDivSum[i] = suffixDivSum[i + 1] + dailyDivAmounts[i];
          }

          const topUpEvents = [];
          // 「加碼策略」報酬率走勢(不含本金):跟主要的 shares/totalInvested 平行,
          // 另外單獨追蹤「只靠加碼(定期定額+K線)買進的股數與投入金額」,完全不含
          // 最上面的一次性本金,不論 monthlyTopUpIncludeLumpSum 設定為何都一樣——
          // 用來單獨畫出「加碼策略本身」的報酬率走勢圖。
          let topUpOnlyShares = 0;
          let topUpOnlyInvested = 0;
          let topUpOnlyDividendCash = 0;
          const topUpValueSeries = [];
          // K線加碼:記錄「前一天」最低價與各均線值(每檔標的自己一組狀態),
          // 邏輯與 dcaEngine.js 的 runDcaStrategy 完全相同——前一天最低價要高於
          // 前一天均線(代表前一天整天沒碰到均線),今天最低價才跌破今天均線時觸發,
          // 避免股價與均線糾結、來回穿越時天天觸發。
          let klinePrevLow = null;
          const klinePrevMaByLine = { ma20: null, ma60: null, ma120: null };
          let klineMonthKey = null;
          let klineMonthlyTriggerCount = 0;

          filteredData.forEach((day, dayIndex) => {
            // 配息入帳要用「當天加碼買進之前」持有的股數:除息當天才買進的這一筆,
            // 現實中還沒資格領當天的配息,所以要先算配息、再處理當天的加碼買進,
            // 順序對調的話,萬一加碼日剛好跟除息日同一天,會多算到不該有的配息。
            const divAmount = divAmountByDate.get(day.date);
            if (divAmount) {
              dividendCash += shares * divAmount;
              topUpOnlyDividendCash += topUpOnlyShares * divAmount;
            }

            const futureDivPerShare = suffixDivSum[dayIndex + 1];
            const makeReturnPct = (entryPrice) => ({
              priceReturnPct: ((finalPrice - entryPrice) / entryPrice) * 100,
              totalReturnPct:
                ((finalPrice - entryPrice + futureDivPerShare) / entryPrice) *
                100,
            });

            if (topUpDateSet && topUpDateSet.has(day.date)) {
              const boughtShares = monthlyTopUpAmount / day.price;
              shares += boughtShares;
              totalInvested += monthlyTopUpAmount;
              topUpOnlyShares += boughtShares;
              topUpOnlyInvested += monthlyTopUpAmount;

              // 這一筆加碼「從買進那天到回測結束」自己的報酬率,跟是否列入本金無關——
              // 不含息只看股價漲跌,含息則再加上買進後(不含當天)實際能領到的配息。
              topUpEvents.push({
                date: day.date,
                symbol: stock.symbol,
                stockName: stock.stockName,
                source: 'monthly',
                price: day.price,
                shares: boughtShares,
                amount: monthlyTopUpAmount,
                skipped: false,
                ...makeReturnPct(day.price),
              });
            }

            if (maByDate) {
              const monthKey = day.date.slice(0, 7);
              if (monthKey !== klineMonthKey) {
                klineMonthKey = monthKey;
                klineMonthlyTriggerCount = 0;
              }
              const mas = maByDate.get(day.date);
              const hasLow =
                typeof day.low === 'number' && Number.isFinite(day.low);

              MA_LINE_KEYS.forEach((lineKey) => {
                const ma = mas ? mas[lineKey] : null;
                if (ma === null || ma === undefined || !(ma > 0)) return;
                const prevMa = klinePrevMaByLine[lineKey];
                const triggeredToday =
                  klinePrevLow !== null &&
                  prevMa !== null &&
                  prevMa > 0 &&
                  klinePrevLow > prevMa &&
                  hasLow &&
                  day.low <= ma;
                if (!triggeredToday) return;

                const withinCap =
                  klineMonthlyTriggerCount < KLINE_TOPUP_MONTHLY_CAP;
                if (withinCap && monthlyTopUpAmount > 0) {
                  const boughtShares = monthlyTopUpAmount / day.price;
                  shares += boughtShares;
                  totalInvested += monthlyTopUpAmount;
                  topUpOnlyShares += boughtShares;
                  topUpOnlyInvested += monthlyTopUpAmount;
                  klineMonthlyTriggerCount += 1;
                  topUpEvents.push({
                    date: day.date,
                    symbol: stock.symbol,
                    stockName: stock.stockName,
                    source: 'kline',
                    lineKey,
                    lineLabel: MA_LINE_LABELS[lineKey],
                    price: day.price,
                    shares: boughtShares,
                    amount: monthlyTopUpAmount,
                    skipped: false,
                    ...makeReturnPct(day.price),
                  });
                } else {
                  // 當月三線共用的加碼額度已被用掉,這次穿越不會真的買進,
                  // 但仍記錄下來讓使用者知道「有觸發、但沒成交」。
                  topUpEvents.push({
                    date: day.date,
                    symbol: stock.symbol,
                    stockName: stock.stockName,
                    source: 'kline',
                    lineKey,
                    lineLabel: MA_LINE_LABELS[lineKey],
                    price: day.price,
                    shares: 0,
                    amount: 0,
                    skipped: true,
                  });
                }
              });

              klinePrevLow = hasLow ? day.low : null;
              MA_LINE_KEYS.forEach((lineKey) => {
                const ma = mas ? mas[lineKey] : null;
                klinePrevMaByLine[lineKey] =
                  ma !== null && ma !== undefined && ma > 0 ? ma : null;
              });
            }

            // 加碼策略走勢:第一筆加碼成交之前沒有基準可算報酬率,pct 先留 null;
            // 之後每天都用「當下加碼部位市值+已領配息」相對「累計加碼投入金額」計算。
            topUpValueSeries.push({
              date: day.date,
              pct:
                topUpOnlyInvested > 0
                  ? ((topUpOnlyShares * day.price +
                      topUpOnlyDividendCash -
                      topUpOnlyInvested) /
                      topUpOnlyInvested) *
                    100
                  : null,
            });
          });

          const finalMarketValue = shares * finalPrice;
          const finalStockDividends = dividendCash;

          // 報酬率(含息/不含息)改用「實際投入本金」(totalInvested)當分母的金額加權報酬,
          // 不再只用起始價/終值價計算——這樣「定期定額加碼」開啟、以及「一次性本金是否列入」
          // 的設定不同時,含息報酬才會正確反映股數與投入時間點的差異。
          // 關閉定期定額加碼時,totalInvested = allocated、shares = allocated/initialPrice,
          // 數學上與過去的起始價/終值價公式完全等價,結果不變。
          // totalInvested 為 0(僅在「不列入本金」且每月加碼金額也是 0 的退化情況下發生)時,
          // 退回用起始/終值價計算,避免除以 0。
          const totalReturnPct =
            totalInvested > 0
              ? ((finalMarketValue + finalStockDividends - totalInvested) /
                  totalInvested) *
                100
              : ((finalPrice - initialPrice + periodDividends) /
                  initialPrice) *
                100;
          const priceReturnPct =
            totalInvested > 0
              ? ((finalMarketValue - totalInvested) / totalInvested) * 100
              : ((finalPrice - initialPrice) / initialPrice) * 100;
          const dividendYield = (periodDividends / initialPrice) * 100;

          let annualizedDividendYield = 0;
          if (validDivTimestamps.length >= 2) {
            const firstDiv = validDivTimestamps[0];
            const lastDiv = validDivTimestamps[validDivTimestamps.length - 1];
            const spanDays = (lastDiv - firstDiv) / (1000 * 60 * 60 * 24);
            if (spanDays > 0) {
              const avgInterval = spanDays / (validDivTimestamps.length - 1);
              const estFreq = 365 / avgInterval;
              const avgDivAmount = periodDividends / validDivTimestamps.length;
              const estAnnualDiv = avgDivAmount * estFreq;
              annualizedDividendYield = (estAnnualDiv / initialPrice) * 100;
            }
          } else {
            const daysHeld =
              (effectiveEndDate - new Date(startData.date)) /
              (1000 * 60 * 60 * 24);
            annualizedDividendYield =
              daysHeld > 0 ? (dividendYield / daysHeld) * 365 : 0;
          }

          const trendData = filteredData.map((d) => ({
            date: d.date,
            returnPct:
              ((d.price -
                initialPrice +
                (d.accumulatedDividend - startData.accumulatedDividend)) /
                initialPrice) *
              100,
          }));

          const dividendCount = validDivTimestamps.length;
          let fillCount = 0;
          let lastDivDate = null;
          let lastDivAmount = null;
          let lastPreDivPrice = null;
          let recentExDivClosePrice = null;

          if (dividendCount > 0) {
            const lastTs = validDivTimestamps[validDivTimestamps.length - 1];
            lastDivDate = new Date(lastTs).toISOString().split('T')[0];
            const keySec = Math.floor(lastTs / 1000);
            const divInfo =
              stock.dividendsMap[keySec.toString()] ||
              stock.dividendsMap[keySec] ||
              stock.dividendsMap[lastTs];
            lastDivAmount = divInfo?.amount;

            const divDateIndex = stock.data.findIndex(
              (d) => d.date === lastDivDate
            );
            if (divDateIndex !== -1) {
              recentExDivClosePrice = stock.data[divDateIndex].price;
              if (divDateIndex > 0) {
                lastPreDivPrice = stock.data[divDateIndex - 1].price;
              }
            }
          }

          const allDivsInRange = stock.divDates
            .filter((ts) => ts >= periodStartTs && ts <= rawPeriodEndTs)
            .sort((a, b) => a - b);

          allDivsInRange.forEach((divTs) => {
            const divDateStr = new Date(divTs).toISOString().split('T')[0];
            const rawIndex = stock.data.findIndex((d) => d.date === divDateStr);
            let isFilled = false;
            let prePrice = null;
            let currentDivAmount = 0;
            const isExcludedDiv = !strictTimeMode && divTs > periodEndTs;
            const keySec = Math.floor(divTs / 1000);
            const divInfo =
              stock.dividendsMap[keySec.toString()] ||
              stock.dividendsMap[keySec] ||
              stock.dividendsMap[divTs];
            currentDivAmount = divInfo?.amount || 0;

            if (rawIndex > 0) {
              prePrice = stock.data[rawIndex - 1].price;
              if (!isExcludedDiv) {
                const checkData = filteredData.slice(
                  filteredData.findIndex((d) => d.date === divDateStr)
                );
                isFilled = checkData.some((d) => d.price >= prePrice);
                if (isFilled) fillCount++;
              }
            }

            const exDivPrice =
              rawIndex !== -1 ? stock.data[rawIndex].price : null;
            // 兩種單次配息殖利率基準:
            // costYieldPct  以「買進成本價」(這次回測起始價 initialPrice)為分母,
            //               反映這筆配息相對於實際投入成本的報酬率。
            // exDivYieldPct 以「除息前一日收盤價」(prePrice)為分母,
            //               反映市場慣用、當次除息當下的殖利率水準。
            const costYieldPct =
              initialPrice > 0 ? (currentDivAmount / initialPrice) * 100 : null;
            const exDivYieldPct =
              prePrice && prePrice > 0
                ? (currentDivAmount / prePrice) * 100
                : null;
            dividendDetails.push({
              date: divDateStr,
              prePrice: prePrice,
              exDivPrice: exDivPrice,
              amount: currentDivAmount,
              isFilled: isFilled,
              isExcludedDiv,
              costYieldPct,
              exDivYieldPct,
            });
          });

          let isDataLagging = false;
          let actualEndDateStr = '';
          if (endData) {
            const endDateTs = new Date(endData.date).getTime();
            const targetEndTs = effectiveEndDate.getTime();
            const diffTime = targetEndTs - endDateTs;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            if (diffDays > 3) {
              isDataLagging = true;
              actualEndDateStr = endData.date;
            }
          }

          return {
            symbol: stock.symbol,
            stockName: stock.stockName,
            inputIndex: stock.inputIndex,
            startDate: startData.date,
            endDate: effectiveEndDate.toISOString().split('T')[0],
            initialPrice,
            finalPrice,
            totalDividends: periodDividends,
            dividendCount,
            fillCount,
            lastDivDate,
            lastDivAmount,
            lastPreDivPrice,
            recentExDivClosePrice,
            totalReturnPct,
            priceReturnPct,
            dividendYield,
            annualizedDividendYield,
            trendData,
            dataPoints: filteredData.length,
            riskProfile: calculateRiskProfile(
              filteredData.map((d) => d.price),
              printMode
            ),
            // 未勾選「計算β值」時完全不放這個欄位(而不是塞 null),
            // 讓卡片能區分「沒算」(不顯示徽章)跟「算了但資料不足」(顯示「資料不足」)。
            ...(calcBeta
              ? { beta: calculateBeta(filteredData, benchmarkReturnsByDate) }
              : {}),
            frequencyLabel: getFrequencyLabel(stock.divDates),
            weight,
            divDates: stock.divDates,
            isShortHistory,
            isYoungStock,
            actualInceptionDate: stock.data[0].date,
            snapToExDiv,
            dividendDetails: dividendDetails.reverse(),
            isDataLagging,
            actualEndDateStr,
            // 分割日必須落在「這次回測實際比較的區間」內才顯示徽章;
            // 校正股價/除息金額時用的是完整抓取範圍(可能含前後緩衝資料),
            // 但緩衝範圍內發生的分割跟這次回測結果無關,不需要在卡片上特別標註。
            splitEvents: (stock.splitEvents || []).filter(
              (ev) =>
                ev.date >= startData.date &&
                ev.date <= effectiveEndDate.toISOString().split('T')[0]
            ),
            usedCache: !!stock.fromCache,
            cachedAt: stock.cachedAt || null,
            dividendDataIncomplete: !!stock.dividendDataIncomplete,
            allocatedCapital: totalInvested,
            finalMarketValue,
            finalStockDividends,
            finalTotalValue: finalMarketValue + finalStockDividends,
            topUpEvents,
            topUpValueSeries,
          };
        })
        .filter((r) => r !== null);

      setResults(finalResults);
      finishLoading();
      setProgress(100);
      setTimeout(() => setLoading(false), 500);
    } catch (err) {
      setErrorMsg('發生錯誤');
      console.error(err);
      setLoading(false);
      finishLoading();
    }
  };

  const handleManualInputConfirm = (newInputs) => {
    const updatedData = { ...manualPriceData, ...newInputs };
    setManualPriceData(updatedData);
    setMissingDataList([]);
    runBacktest(updatedData);
  };

  const handleManualInputCancel = () => {
    setMissingDataList([]);
    setLoading(false);
  };

  const handleResolveSituations = (choices) => {
    const args = pendingRunArgsRef.current || {};
    setPendingSituations(null);
    runBacktest(args.overrideManualData, args.dateOverride, choices);
  };

  const handleCancelSituations = () => {
    pendingRunArgsRef.current = { overrideManualData: null, dateOverride: null };
    setPendingSituations(null);
    setLoading(false);
  };

  const chartData = useMemo(() => {
    if (!results || results.length === 0) return [];
    const validResults = results.filter((r) => !r.isExcluded);
    const dateMap = {};

    validResults.forEach((stock) => {
      stock.trendData.forEach((point) => {
        if (!dateMap[point.date]) dateMap[point.date] = { date: point.date };
        dateMap[point.date][stock.symbol] = point.returnPct;
      });
    });

    const sortedData = Object.values(dateMap).sort(
      (a, b) => new Date(a.date) - new Date(b.date)
    );

    sortedData.forEach((dayData) => {
      let weightedSum = 0;
      let activeWeight = 0;

      validResults.forEach((stock) => {
        if (dayData[stock.symbol] !== undefined) {
          weightedSum += dayData[stock.symbol] * stock.weight;
          activeWeight += stock.weight;
        }
      });

      dayData['綜合績效'] = activeWeight > 0 ? weightedSum / activeWeight : 0;
    });

    return sortedData;
  }, [results]);

  // 「加碼策略」報酬率走勢比較(不含本金):跟 chartData 同樣的組合邏輯,
  // 但資料來源改成每檔標的的 topUpValueSeries(只有加碼部位、不含一次性本金),
  // 只有實際發生過加碼的標的才會被畫進來與計入加權綜合績效。
  const topUpChartData = useMemo(() => {
    if (!results || results.length === 0) return [];
    const validResults = results.filter(
      (r) => !r.isExcluded && r.topUpEvents && r.topUpEvents.length > 0
    );
    if (validResults.length === 0) return [];
    const dateMap = {};

    validResults.forEach((stock) => {
      (stock.topUpValueSeries || []).forEach((point) => {
        if (point.pct === null) return;
        if (!dateMap[point.date]) dateMap[point.date] = { date: point.date };
        dateMap[point.date][stock.symbol] = point.pct;
      });
    });

    const sortedData = Object.values(dateMap).sort(
      (a, b) => new Date(a.date) - new Date(b.date)
    );

    sortedData.forEach((dayData) => {
      let weightedSum = 0;
      let activeWeight = 0;

      validResults.forEach((stock) => {
        if (dayData[stock.symbol] !== undefined) {
          weightedSum += dayData[stock.symbol] * stock.weight;
          activeWeight += stock.weight;
        }
      });

      dayData['綜合績效'] = activeWeight > 0 ? weightedSum / activeWeight : 0;
    });

    return sortedData;
  }, [results]);

  const portfolioSummary = useMemo(() => {
    if (!results) return null;
    let totalInvested = 0;
    let grandTotalValue = 0;
    let grandTotalDividends = 0;
    let grandTotalMarketValue = 0;

    const details = results.map((r) => {
      if (r.isExcluded) {
        return {
          ...r,
          allocatedCapital: 0,
          finalMarketValue: 0,
          finalStockDividends: 0,
          totalReturnPct: 0,
        };
      }

      totalInvested += r.allocatedCapital;
      grandTotalValue += r.finalTotalValue;
      grandTotalDividends += r.finalStockDividends;
      grandTotalMarketValue += r.finalMarketValue;

      return r;
    });

    const grandTotalRoi =
      totalInvested > 0
        ? ((grandTotalValue - totalInvested) / totalInvested) * 100
        : 0;

    return {
      details,
      totalWeight: 100,
      totalInvested,
      grandTotalMarketValue,
      grandTotalDividends,
      grandTotalValue,
      grandTotalRoi,
    };
  }, [results, totalCapital, fairMode]);

  // 自訂區間下方的「日/月/季 -/+ 格子」:只調整起始日(customStart),
  // 終點日固定為今天,不隨按鈕移動;「-」把起始日往前推(拉長區間),「+」把起始日往後推(縮短區間)。
  // 「+」最多只能把起始日推到昨天為止,避免起始日追上或超過固定為今天的終點日。
  const shiftCustomRange = (amount, unit = 'month') => {
    const startBase = customStart
      ? new Date(customStart)
      : (() => {
          const d = new Date();
          d.setFullYear(d.getFullYear() - 1);
          return d;
        })();
    const shifted = new Date(
      shiftDateStr(startBase.toISOString().split('T')[0], amount, unit)
    );
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const clamped = shifted.getTime() > yesterday.getTime() ? yesterday : shifted;
    setCustomStart(clamped.toISOString().split('T')[0]);
    setCustomEnd(new Date().toISOString().split('T')[0]);
    setTimeRange('custom');
  };

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

      {/* 手機版浮動按鈕:不論設定頁或結果頁、頁面內容多長,都常駐顯示,方便隨時重新執行回測,
          按下即直接(重新)開始回測;沿用主要開始回測按鈕的 disabled 判斷,避免在設定不合法時誤觸 */}
      {!loading && !printMode && (
        <button
          onClick={() => runBacktest()}
          disabled={!hasSelectedStock}
          className={`sm:hidden fixed bottom-20 right-4 z-30 w-12 h-12 rounded-full text-white shadow-xl flex items-center justify-center no-print ${
            !hasSelectedStock
              ? 'bg-slate-700 text-slate-500 cursor-not-allowed shadow-slate-900/40'
              : 'bg-gradient-to-r from-emerald-500 to-teal-600 shadow-emerald-900/40'
          }`}
          title="重新執行回測"
        >
          <Zap className="w-6 h-6 fill-current" />
        </button>
      )}

      {/* 手機版浮動按鈕:不論設定頁或結果頁,都常駐顯示,提供快速跳到頁面最底部的捷徑 */}
      {!loading && !printMode && (
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

          <div
            className={`transition-all duration-300 ease-in-out overflow-hidden ${
              isConfigExpanded
                ? 'max-h-[1500px] opacity-100'
                : 'max-h-0 opacity-0'
            }`}
          >
            <div className="grid lg:grid-cols-12 lg:items-start gap-6 bg-slate-900/50 p-4 rounded-xl border border-slate-700">
              <div className="lg:col-span-4 space-y-4 border-b lg:border-b-0 lg:border-r border-slate-700 pb-4 lg:pb-0 pr-0 lg:pr-4">
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
                <div className="flex flex-col gap-2 bg-slate-800/60 border border-slate-700 rounded-lg p-3">
                  <div className="text-xs text-slate-300 font-bold">
                    加碼策略設定
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={monthlyTopUpEnabled}
                      onChange={() => setMonthlyTopUpEnabled((v) => !v)}
                    />
                    <span className="text-xs text-slate-300">
                      每月固定日期加碼
                    </span>
                  </label>
                  <div className="text-[11px] text-slate-500 leading-relaxed">
                    開啟後,每個月固定日期額外加碼投入一筆金額,直到回測結束日,所有比較中的標的都套用同一組設定。
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={klineTopUpEnabled}
                      onChange={() => setKlineTopUpEnabled((v) => !v)}
                    />
                    <span className="text-xs text-slate-300">
                      K線穿越均線加碼
                    </span>
                  </label>
                  <div className="text-[11px] text-slate-500 leading-relaxed">
                    開啟後套用「K線穿越均線」加碼規則(規則寫死,不額外提供設定):月線
                    (MA20)/季線 (MA60)/半年線
                    (MA120)三條均線共用「每月最多加碼1次」的額度,只要前一天最低價還在均線之上、當天最低價跌破均線就視為觸發,加碼金額與下面設定的「每次加碼金額」相同。這兩個開關可以各自獨立開關,也可以同時開啟。
                  </div>
                  {anyTopUpEnabled && (
                    <>
                      <div
                        className={`grid gap-2 ${
                          monthlyTopUpEnabled ? 'grid-cols-2' : 'grid-cols-1'
                        }`}
                      >
                        {monthlyTopUpEnabled && (
                          <div>
                            <div className="text-[11px] text-slate-500 mb-1">
                              每月投入日(1~31)
                            </div>
                            <input
                              type="number"
                              min={1}
                              max={31}
                              value={monthlyTopUpDay}
                              onChange={(e) =>
                                setMonthlyTopUpDay(
                                  parseInt(e.target.value, 10) || 1
                                )
                              }
                              className="w-full bg-slate-800 border border-slate-600 rounded p-1.5 text-sm"
                            />
                          </div>
                        )}
                        <div>
                          <div className="text-[11px] text-slate-500 mb-1">
                            每次加碼金額(元)
                          </div>
                          <input
                            type="number"
                            min={0}
                            value={monthlyTopUpAmount}
                            onChange={(e) =>
                              setMonthlyTopUpAmount(parseFloat(e.target.value) || 0)
                            }
                            className="w-full bg-slate-800 border border-slate-600 rounded p-1.5 text-sm"
                          />
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-500 mb-1">
                          最上面設定的一次性本金
                        </div>
                        <div className="grid grid-cols-2 gap-1">
                          <button
                            type="button"
                            onClick={() => setMonthlyTopUpIncludeLumpSum(true)}
                            className={`text-xs rounded p-1.5 border ${
                              monthlyTopUpIncludeLumpSum
                                ? 'bg-emerald-600 border-emerald-500 text-white font-bold'
                                : 'bg-slate-800 border-slate-600 text-slate-400'
                            }`}
                          >
                            列入(本金+加碼)
                          </button>
                          <button
                            type="button"
                            onClick={() => setMonthlyTopUpIncludeLumpSum(false)}
                            className={`text-xs rounded p-1.5 border ${
                              !monthlyTopUpIncludeLumpSum
                                ? 'bg-emerald-600 border-emerald-500 text-white font-bold'
                                : 'bg-slate-800 border-slate-600 text-slate-400'
                            }`}
                          >
                            不列入(只用加碼)
                          </button>
                        </div>
                        <div className="text-[11px] text-slate-500 leading-relaxed mt-1">
                          {monthlyTopUpIncludeLumpSum
                            ? '一開始會照常投入一次性本金,之後再額外加碼。'
                            : '一開始不投入一次性本金,完全從零股數開始,只靠加碼逐步買進。'}
                        </div>
                      </div>
                    </>
                  )}
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
                    {/* 常用的固定起始日快捷鈕:點擊即把起始日設為該固定日期、結束日固定為今天,
                        沿用「自訂區間」既有邏輯,不需另外新增 timeRange 狀態 */}
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

              <div className="lg:col-span-5 space-y-3">
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
                    標的選擇
                  </label>
                  <span className="text-xs font-mono font-bold text-emerald-400">
                    已勾選 {inputs.filter((v, i) => v && enabledInputs[i]).length} 檔
                    (平均分配本金)
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5">
                  {inputs.map((val, idx) => {
                    const isEnabled = enabledInputs[idx];

                    return (
                      <div
                        key={idx}
                        className={`flex items-center gap-2 transition-opacity ${
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
                        <div className="relative flex-1">
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
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="lg:col-span-3 mt-4 lg:mt-0">
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
                    disabled={loading || !hasSelectedStock}
                    className={`w-full py-4 rounded-xl font-bold shadow-lg flex items-center justify-center gap-2 transition-all ${
                      !hasSelectedStock
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
          <div className="min-h-[55vh] sm:h-64 flex flex-col items-center justify-center text-slate-600 border-2 border-dashed border-slate-800 rounded-xl no-print m-4 gap-2">
            <CloudLightning className="w-12 h-12 mb-2 opacity-30" />
            <p>設定上方投資組合後，點擊「開始回測」</p>
            <p className="sm:hidden text-xs text-slate-700">
              也可以點擊右下角 ⚡ 浮動按鈕快速開始回測
            </p>
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

            <div>
              <h3
                className={`font-bold text-lg sm:text-xl mb-4 flex items-center gap-2 ${textClass.main}`}
              >
                <DollarSign className={`w-6 h-6 ${textClass.highlight}`} />
                個別標的績效
                {independentCycleMode && (
                  <span className="text-xs bg-purple-900/50 text-purple-300 px-2 py-0.5 rounded border border-purple-700/50 ml-2">
                    基準: {cyclesUsed} 次配息週期
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
                                    title = `${ev.label}\n${ev.date} 恢復買賣\n分割前收盤 ${ev.priceBefore} 元 → 分割後參考價 ${ev.priceAfter} 元\n資料源尚未回溯調整，已依此比例自動校正 ${ev.date} 以前的股價與除息金額。`;
                                    colorClass = printMode
                                      ? 'text-teal-700 border-teal-200 bg-teal-50'
                                      : 'text-teal-400 border-teal-900/50 bg-teal-900/20';
                                  } else if (ev.status === 'already_adjusted') {
                                    text = `${ev.date} ${typeLabel} ${ratioLabel} (資料已調整)`;
                                    title = `${ev.label}\n${ev.date} 恢復買賣\n分割前收盤 ${ev.priceBefore} 元 → 分割後參考價 ${ev.priceAfter} 元\n資料源已經回溯調整過歷史股價，未再重複處理。`;
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

                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[17px]">
                            <div className="space-y-1">
                              <div className="flex justify-between">
                                <span className={textClass.sub}>本金</span>
                                <span className={`font-mono ${textClass.main}`}>
                                  $
                                  {Math.round(
                                    item.allocatedCapital
                                  ).toLocaleString()}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className={textClass.sub}>市值</span>
                                <span className="text-blue-300 font-mono">
                                  $
                                  {Math.round(
                                    item.finalMarketValue
                                  ).toLocaleString()}
                                </span>
                              </div>
                              <div
                                className={`flex justify-between border-t border-dashed pt-1 mt-1 ${
                                  printMode
                                    ? 'border-gray-300'
                                    : 'border-slate-600/50'
                                }`}
                              >
                                <span className={textClass.sub}>含息值</span>
                                <span
                                  className={`font-mono font-bold ${
                                    item.finalTotalValue >=
                                    item.allocatedCapital
                                      ? textClass.highlight
                                      : textClass.warn
                                  }`}
                                >
                                  $
                                  {Math.round(
                                    item.finalTotalValue
                                  ).toLocaleString()}
                                </span>
                              </div>
                            </div>
                            <div className="space-y-1 sm:border-l border-slate-700/50 sm:pl-2">
                              <div className="flex justify-between">
                                <span className={textClass.sub}>始</span>
                                <span className={`font-mono ${textClass.sub}`}>
                                  {item.initialPrice.toFixed(2)}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className={textClass.sub}>終</span>
                                <span className={`font-mono ${textClass.sub}`}>
                                  {item.finalPrice.toFixed(2)}
                                </span>
                              </div>
                              <div
                                className={`flex justify-between border-t border-dashed pt-1 mt-1 ${
                                  printMode
                                    ? 'border-gray-300'
                                    : 'border-slate-600/50'
                                }`}
                              >
                                <span className={textClass.sub}>不含息報酬</span>
                                <span
                                  className={`font-mono ${
                                    item.priceReturnPct >= 0
                                      ? textClass.warn
                                      : textClass.highlight
                                  }`}
                                >
                                  {item.priceReturnPct > 0 ? '+' : ''}
                                  {item.priceReturnPct.toFixed(2)}%
                                </span>
                              </div>
                            </div>
                            <div className="space-y-1 sm:border-l border-slate-700/50 sm:pl-2 border-t sm:border-t-0 pt-2 sm:pt-0">
                              <div className="flex justify-between">
                                <span className={textClass.sub}>配息</span>
                                <span
                                  className={`font-mono font-bold ${
                                    fairMode
                                      ? textClass.amber
                                      : textClass.highlight
                                  }`}
                                >
                                  +$
                                  {Math.round(
                                    item.finalStockDividends
                                  ).toLocaleString()}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className={textClass.sub}>年化</span>
                                <span className="text-emerald-500/70 font-mono">
                                  {item.annualizedDividendYield.toFixed(1)}%
                                </span>
                              </div>
                            </div>
                            <div className="space-y-0.5 sm:border-l border-slate-700/50 sm:pl-2 border-t sm:border-t-0 pt-2 sm:pt-0 flex flex-col justify-center">
                              <div
                                className={`text-[17px] font-bold ${textClass.sub} mb-0.5`}
                              >
                                除 {item.lastDivDate || '--'}
                              </div>
                              <div className={`text-[17px] ${textClass.sub}`}>
                                配{' '}
                                <span
                                  className={`font-mono ${textClass.highlight}`}
                                >
                                  {item.lastDivAmount !== undefined &&
                                  item.lastDivAmount !== null
                                    ? String(item.lastDivAmount)
                                    : '-'}
                                </span>
                                / 收{' '}
                                <span className={`font-mono ${textClass.main}`}>
                                  {item.recentExDivClosePrice
                                    ? Number(
                                        item.recentExDivClosePrice
                                      ).toFixed(2)
                                    : '-'}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div
                            className={`text-[15px] ${
                              textClass.sub
                            } mt-2 border-t ${
                              printMode
                                ? 'border-gray-200'
                                : 'border-slate-700/30'
                            } pt-1 flex justify-between items-center`}
                          >
                            <span>
                              統計區間: {item.startDate} ~ {item.endDate}{' '}
                              <span className="text-slate-500/80 ml-1">
                                (
                                {getDurationLabel(item.startDate, item.endDate)}
                                )
                              </span>
                            </span>
                            {item.isDataLagging ? (
                              <span
                                className="text-amber-500 flex items-center gap-1"
                                title={`實際資料僅更新至 ${item.actualEndDateStr}`}
                              >
                                <AlertTriangle className="w-3 h-3" /> 資料僅至{' '}
                                {item.actualEndDateStr} (延用收盤價)
                              </span>
                            ) : (
                              <span
                                className={`px-1.5 py-0.5 rounded ${
                                  printMode
                                    ? 'bg-gray-100'
                                    : 'bg-slate-700 text-slate-300'
                                }`}
                              >
                                共配息 {item.dividendCount} 次
                              </span>
                            )}
                          </div>

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

                          {item.topUpEvents && item.topUpEvents.length > 0 && (
                            <div className="mt-2 pt-1 border-t border-slate-700/30">
                              <details className="group">
                                <summary className="text-[15px] text-slate-500 cursor-pointer hover:text-slate-300 flex items-center gap-1 mb-1">
                                  <Table2 className="w-3 h-3" /> 共{' '}
                                  {
                                    item.topUpEvents.filter((e) => !e.skipped)
                                      .length
                                  }{' '}
                                  次加碼明細(定期定額 + K線穿越均線)
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
                                        <th className="py-2 pl-2">加碼日期</th>
                                        <th className="py-2">股票</th>
                                        <th className="py-2">方式</th>
                                        <th className="py-2 text-right">
                                          進場價
                                        </th>
                                        <th className="py-2 text-right">
                                          至期末不含息報酬
                                        </th>
                                        <th className="py-2 pr-2 text-right">
                                          至期末含息報酬
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
                                      {item.topUpEvents.map((e, i) => (
                                        <tr
                                          key={i}
                                          className={
                                            e.skipped
                                              ? 'italic text-slate-500 bg-slate-800/40'
                                              : printMode
                                              ? 'hover:bg-gray-50'
                                              : 'hover:bg-slate-700/20'
                                          }
                                        >
                                          <td
                                            className={`py-2 pl-2 font-mono ${textClass.sub}`}
                                          >
                                            {e.date}
                                          </td>
                                          <td className={`py-2 ${textClass.sub}`}>
                                            {e.symbol}
                                            {e.stockName && (
                                              <span className="text-xs font-normal text-slate-400 ml-1">
                                                {e.stockName}
                                              </span>
                                            )}
                                          </td>
                                          <td className={`py-2 ${textClass.sub}`}>
                                            {e.source === 'monthly'
                                              ? '定期定額'
                                              : `K線·${e.lineLabel}`}
                                          </td>
                                          <td
                                            className={`py-2 font-mono text-right ${textClass.main}`}
                                          >
                                            {e.price.toFixed(2)}
                                          </td>
                                          {e.skipped ? (
                                            <td
                                              colSpan="2"
                                              className="py-2 pr-2 text-center text-slate-500 italic"
                                            >
                                              當月加碼額度已滿,未成交
                                            </td>
                                          ) : (
                                            <>
                                              <td
                                                className={`py-2 font-mono text-right ${
                                                  e.priceReturnPct >= 0
                                                    ? textClass.warn
                                                    : textClass.highlight
                                                }`}
                                              >
                                                {e.priceReturnPct > 0 ? '+' : ''}
                                                {e.priceReturnPct.toFixed(2)}%
                                              </td>
                                              <td
                                                className={`py-2 pr-2 font-mono text-right ${
                                                  e.totalReturnPct >= 0
                                                    ? textClass.warn
                                                    : textClass.highlight
                                                }`}
                                              >
                                                {e.totalReturnPct > 0 ? '+' : ''}
                                                {e.totalReturnPct.toFixed(2)}%
                                              </td>
                                            </>
                                          )}
                                        </tr>
                                      ))}
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

            {topUpChartData.length > 0 && (
              <div className={`p-6 rounded-xl shadow-lg no-print ${cardClass}`}>
                <h3
                  className={`font-bold mb-1 flex items-center gap-2 ${textClass.sub}`}
                >
                  <Flame className={`w-5 h-5 ${textClass.warn}`} />
                  加碼策略報酬率走勢比較(不含本金)
                </h3>
                <div className={`text-[13px] mb-4 ${textClass.sub} opacity-80`}>
                  只計算「每月固定日期加碼」與「K線穿越均線加碼」買進的股數與報酬,不含最上面的一次性本金,用來單獨檢視加碼策略本身的績效。
                </div>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer>
                    <LineChart data={topUpChartData}>
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
                      {results.map((r, i) =>
                        !r.isExcluded &&
                        r.topUpEvents &&
                        r.topUpEvents.length > 0 ? (
                          <Line
                            key={r.symbol}
                            type="monotone"
                            dataKey={r.symbol}
                            stroke={COLORS[i % COLORS.length]}
                            dot={false}
                            activeDot={{ r: 6 }}
                            strokeWidth={1.5}
                            connectNulls
                          />
                        ) : null
                      )}
                      <Line
                        type="monotone"
                        dataKey="綜合績效"
                        name="⭐ 綜合績效 (加碼部位)"
                        stroke="#facc15"
                        strokeWidth={3}
                        dot={false}
                        activeDot={{ r: 8 }}
                        connectNulls
                      />
                    </LineChart>
                  </ResponsiveContainer>
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
