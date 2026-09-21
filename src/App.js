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

// 個股β值(系統性風險係數):以個股日報酬對大盤加權指數(^TWII)日報酬做迴歸估算
// ϲ = Cov(個股日報酬, 大盤日報酬) / Var(大盤日報酬),只取喩邊斗�期對得上的交易日
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

// 依 src/data/twStockSplits.js 這份對照表,���ꭣ股票分割/反分割造成的股價斷點。
// 不同資料源(FinMind、Yahoo)是否已經把歷史股價回溯調整過並不一致,
// 所以不會無條件套用比例,而是先用「恢復買賣日前最後一筆價格」跟對照表的
// 分割前/分割後參考價比對,比較接近哪一邊,再決定要不要校正、以及往哪個方向校正:
//   - 接近分割後參考價(誤差 5% 內) → 資料源已經調整過,不再重複處理
//   - 其餘情況(含誤差稍大者)→ 依對照表比例校正,並以對照表的官方數字為準
//   - 兩邊都差很多(50% 以上) → 無法確認,不自動校正,只標記為「無法確認」讓卡片提示使用者
// 除了股價,同一段期間內的除息金額也會用同一個比例換算,避免舊股本的配息
// 相對校正後的新股本股價被放大或縮小,污染含息報酬率的計算
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
    <div className="fixed inset-0 bg-slate-900/95 z-[60] fle