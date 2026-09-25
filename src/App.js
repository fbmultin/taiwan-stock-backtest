import React, { useState, useEffect, useMemo, useRef } from 'react';
import TW_STOCK_NAMES from './data/twStockNames';
import TW_STOCK_SPLITS from './data/twStockSplits';
import TW_ETF_FEES from './data/twEtfFees';
import DcaOptimizer from './DcaOptimizer';
import {
  buildMonthlyInvestDates,
  preprocessPriceSeries,
  MA_LINE_KEYS,
  MA_LINE_LABELS,
  KLINE_SUBMODE_KEYS,
  KLINE_SUBMODE_LABELS,
  DEFAULT_KLINE_SUBMODE_ENABLED,
  KLINE_PYRAMID_PRESETS,
  buildKlineMaSeries,
  createKlineTopUpEngine,
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
  Sun,
  Moon,
  ArrowLeft,
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

// 標的組合排名表:固定使用這裡列出的一組區間,完全跟左欄「回測投資年限」脫鉤——
// 不論使用者目前選了哪個投資年限,排名表永遠同時計算這幾組固定區間的排名。
const RANKING_PERIODS = [
  { key: 'ytd', label: '今年' },
  { key: '1q', label: '近1季', months: 3 },
  { key: '2q', label: '近2季', months: 6 },
  { key: '3q', label: '近3季', months: 9 },
  { key: '12m', label: '近1年', months: 12 },
  { key: '18m', label: '近1.5年', months: 18 },
  { key: '2y', label: '近2年', months: 24 },
  { key: '30m', label: '近2.5年', months: 30 },
  { key: '3y', label: '近3年', months: 36 },
  { key: '4y', label: '近4年', months: 48 },
  { key: '5y', label: '近5年', months: 60 },
];

// 算法跟 runBacktest 裡「無加碼」時的起訖日推算完全同一套邏輯(結束日固定為
// 前一個交易日、起訖日都避開非交易日),只是這裡一次算 RANKING_PERIODS 這組固定
// 區間、跟使用者目前實際選的「回測投資年限」無關。
const computeRankingPeriodRange = (period) => {
  const rangeEnd = getLastCompletedTradingDay();
  let rangeStart;
  if (period.fixedStart) {
    rangeStart = new Date(period.fixedStart);
  } else if (period.key === 'ytd') {
    // 全程用 UTC 基準建構/位移日期,原因同 tradingCalendar.js:股價資料的日期
    // 一律是 UTC 午夜基準,這裡若改用本地時區(getFullYear/setMonth/setDate)
    // 在台灣(UTC+8)執行時會跟股價資料的日期基準對不齊,少算/多算一天。
    rangeStart = new Date(Date.UTC(rangeEnd.getUTCFullYear(), 0, 1));
  } else {
    rangeStart = new Date(rangeEnd);
    rangeStart.setUTCMonth(rangeStart.getUTCMonth() - period.months);
  }
  while (isNonTradingDay(rangeEnd)) rangeEnd.setUTCDate(rangeEnd.getUTCDate() - 1);
  while (isNonTradingDay(rangeStart)) rangeStart.setUTCDate(rangeStart.getUTCDate() + 1);
  return { rangeStart, rangeEnd };
};

// 排名表用的單一標的、單一區間報酬率:採簡單一次性買進、含息(不含加碼),
// 算法跟主要回測「關閉定期定額加碼」時的 periodDividends/totalReturnPct 公式相同。
// 資料起始日明顯晚於這個區間的起點時,代表這檔標的在這段期間內還沒有資料(例如
// 近5年但標的3年前才上市),回傳 null 顯示「—」,不硬湊一個其實較短期間的報酬率。
const computeStockReturnForRange = (stock, rangeStart, rangeEnd) => {
  if (!stock.data || stock.data.length === 0) return null;
  const firstDataDate = new Date(stock.data[0].date);
  if (firstDataDate.getTime() > rangeStart.getTime() + 86400000 * 5) return null;

  const startIdx = stock.data.findIndex(
    (d) => new Date(d.date) >= rangeStart
  );
  if (startIdx === -1) return null;
  let endIdx = -1;
  for (let i = stock.data.length - 1; i >= 0; i--) {
    if (new Date(stock.data[i].date) <= rangeEnd) {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1 || endIdx <= startIdx) return null;

  const startData = stock.data[startIdx];
  const endData = stock.data[endIdx];
  const initialPrice = startData.price;
  const finalPrice = endData.price;
  if (!(initialPrice > 0)) return null;

  const periodStartTs = new Date(startData.date).getTime();
  const periodEndTs = new Date(endData.date).getTime();
  let periodDividends = 0;
  (stock.divDates || []).forEach((ts) => {
    if (ts >= periodStartTs && ts <= periodEndTs) {
      const keySec = Math.floor(ts / 1000);
      const divInfo =
        stock.dividendsMap[keySec.toString()] ||
        stock.dividendsMap[keySec] ||
        stock.dividendsMap[ts];
      if (divInfo) periodDividends += divInfo.amount;
    }
  });
  if (periodDividends < 0) periodDividends = 0;

  return ((finalPrice - initialPrice + periodDividends) / initialPrice) * 100;
};

// 排名表(含加碼)每一檔標的假設投入的本金:固定 100 萬,不隨畫面上「總投入本金」
// 設定值變動,讓每一檔在同一個固定基準下互相比較排名,不受目前總本金/勾選標的
// 檔數的影響。
const RANKING_TABLE_STOCK_PRINCIPAL = 1000000;

// 排名表(含加碼)用的單一標的、單一區間報酬率:套用目前畫面上「加碼策略設定」
// 當下的設定值(每月固定日期加碼/K線穿越均線加碼,可以只開一個、兩個都開),
// 逐日模擬股數/投入金額/配息現金的變化,算法跟主要回測 runBacktest 開啟加碼時
// 完全相同,只是這裡假設每一檔各自投入固定 RANKING_TABLE_STOCK_PRINCIPAL
// (不依實際多檔配置權重去分攤、也不隨畫面上的「總投入本金」變動),
// 讓每一檔在同一組金額基準下互相比較排名。
// klineMaSeries 是呼叫端(updateRankingTable)針對這檔標的的完整歷史預先算好一次
// 的均線序列查詢結構(buildKlineMaSeries 的回傳值,klineTopUpEnabled 關閉時傳 null
// 即可),避免同一檔標的的 9 個區間各自重算一次均線;klineConfig 則是目前畫面上
// 的 K 線加碼參數(getKlineConfig 的回傳值)。資料不足、或這個區間內完全沒有
// 實際加碼買進時回傳 null。
const computeStockReturnForRangeWithTopUp = (
  stock,
  rangeStart,
  rangeEnd,
  config
) => {
  const {
    totalCapital,
    monthlyTopUpEnabled,
    monthlyTopUpDay,
    monthlyTopUpAmount,
    monthlyTopUpIncludeLumpSum,
    klineTopUpEnabled,
    klineMaSeries,
    klineConfig,
  } = config;

  if (!stock.data || stock.data.length === 0) return null;
  const firstDataDate = new Date(stock.data[0].date);
  if (firstDataDate.getTime() > rangeStart.getTime() + 86400000 * 5) return null;

  const startIdx = stock.data.findIndex((d) => new Date(d.date) >= rangeStart);
  if (startIdx === -1) return null;
  let endIdx = -1;
  for (let i = stock.data.length - 1; i >= 0; i--) {
    if (new Date(stock.data[i].date) <= rangeEnd) {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1 || endIdx <= startIdx) return null;

  const filteredData = stock.data.slice(startIdx, endIdx + 1);
  const initialPrice = filteredData[0].price;
  const finalPrice = filteredData[filteredData.length - 1].price;
  if (!(initialPrice > 0)) return null;

  const periodStartTs = new Date(filteredData[0].date).getTime();
  const periodEndTs = new Date(
    filteredData[filteredData.length - 1].date
  ).getTime();

  // 除息當天可能剛好也是加碼日,配息入帳要用「當天加碼買進之前」持有的股數,
  // 所以先建好「日期 -> 配息金額」對照表,逐日模擬時才能先算配息、再處理加碼。
  const divAmountByDate = new Map();
  (stock.divDates || []).forEach((ts) => {
    if (ts >= periodStartTs && ts <= periodEndTs) {
      const keySec = Math.floor(ts / 1000);
      const divInfo =
        stock.dividendsMap[keySec.toString()] ||
        stock.dividendsMap[keySec] ||
        stock.dividendsMap[ts];
      if (divInfo) {
        divAmountByDate.set(
          new Date(ts).toISOString().split('T')[0],
          divInfo.amount
        );
      }
    }
  });

  const anyTopUp = monthlyTopUpEnabled || klineTopUpEnabled;
  const useLumpSum = !anyTopUp || monthlyTopUpIncludeLumpSum;
  let shares = useLumpSum && initialPrice > 0 ? totalCapital / initialPrice : 0;
  let totalInvested = useLumpSum ? totalCapital : 0;
  let dividendCash = 0;
  let hadTopUpEvent = false;

  const topUpDateSet =
    monthlyTopUpEnabled && monthlyTopUpAmount > 0
      ? buildMonthlyInvestDates(filteredData, monthlyTopUpDay)
      : null;

  const klineEngine =
    klineTopUpEnabled && klineMaSeries && klineConfig
      ? createKlineTopUpEngine(klineMaSeries, klineConfig)
      : null;

  filteredData.forEach((day, dayIndex) => {
    const divAmount = divAmountByDate.get(day.date);
    if (divAmount) {
      dividendCash += shares * divAmount;
    }

    if (topUpDateSet && topUpDateSet.has(day.date)) {
      shares += monthlyTopUpAmount / day.price;
      totalInvested += monthlyTopUpAmount;
      hadTopUpEvent = true;
    }

    if (klineEngine && monthlyTopUpAmount > 0) {
      const events = klineEngine.evaluateDay(day, dayIndex);
      events.forEach((ev) => {
        if (ev.skipReason) return;
        const amount = monthlyTopUpAmount * ev.ratio;
        if (amount <= 0) return;
        shares += amount / day.price;
        totalInvested += amount;
        hadTopUpEvent = true;
      });
    }
  });

  // useLumpSum 為 false(不列入一次性本金)時,如果這段區間內一次加碼都沒觸發到,
  // totalInvested 會是 0,代表這個區間根本沒有任何實際投入,回傳 null 顯示「—」,
  // 不要硬套用「無加碼」時的起訖價公式(那是完全不同的情境,湊出來的數字沒有意義)。
  if (totalInvested <= 0) return null;
  if (!useLumpSum && !hadTopUpEvent) return null;

  const finalMarketValue = shares * finalPrice;
  const netProfit = finalMarketValue + dividendCash - totalInvested;
  return {
    pct: (netProfit / totalInvested) * 100,
    netProfit,
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

const ManualInputModal = ({ missingData, onConfirm, onCancel, isLight = false }) => {
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
      <div
        className={`${
          isLight ? 'bg-white border-slate-300 text-black' : 'bg-slate-800 border-slate-600'
        } border rounded-xl shadow-2xl max-w-md w-full p-6 animate-in fade-in zoom-in duration-200`}
      >
        <div className={`flex items-center gap-3 mb-4 ${isLight ? 'text-amber-600' : 'text-amber-400'}`}>
          <div className={isLight ? 'bg-amber-100 p-2 rounded-full' : 'bg-amber-900/30 p-2 rounded-full'}>
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold">需要人工補正資料</h3>
            <p className="text-xs opacity-80">多重數據源皆無法取得以下資料</p>
          </div>
        </div>

        <p className={`${isLight ? 'text-slate-600' : 'text-slate-300'} text-sm mb-4`}>
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
                className={`flex items-center justify-between p-3 rounded-lg border ${
                  isLight ? 'bg-slate-100 border-slate-300' : 'bg-slate-900/50 border-slate-700'
                }`}
              >
                <div>
                  <div className={`font-bold text-lg ${isLight ? 'text-black' : 'text-white'}`}>
                    {item.symbol}
                    {stockNameDisplay && (
                      <span className={`text-xs font-normal ml-1 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                        {stockNameDisplay}
                      </span>
                    )}
                  </div>
                  <div className={`text-xs font-mono ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                    {item.date}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>收盤價:</span>
                  <SmartNumberInput
                    value={inputs[key] || ''}
                    onChange={(val) => handleInputChange(key, val)}
                    className={`w-24 rounded px-2 py-1 text-right font-mono focus:border-emerald-500 outline-none border ${
                      isLight
                        ? 'bg-white border-slate-300 text-black'
                        : 'bg-slate-700 border-slate-500 text-white'
                    }`}
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
            className={`flex-1 px-4 py-2 rounded-lg text-sm font-bold transition-colors ${
              isLight
                ? 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
            }`}
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
const SituationDecisionModal = ({ situations, onConfirm, onCancel, isLight = false }) => {
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
      <div
        className={`${
          isLight ? 'bg-white border-slate-300 text-black' : 'bg-slate-800 border-slate-600'
        } border rounded-xl shadow-2xl max-w-lg w-full p-6 animate-in fade-in zoom-in duration-200`}
      >
        <div className={`flex items-center gap-3 mb-4 ${isLight ? 'text-amber-600' : 'text-amber-400'}`}>
          <div className={isLight ? 'bg-amber-100 p-2 rounded-full' : 'bg-amber-900/30 p-2 rounded-full'}>
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
              className={`p-3 rounded-lg border ${
                isLight ? 'bg-slate-100 border-slate-300' : 'bg-slate-900/50 border-slate-700'
              }`}
            >
              <div className={`font-bold text-sm mb-1 ${isLight ? 'text-black' : 'text-white'}`}>
                {s.title}
              </div>
              <p className={`text-xs mb-3 leading-relaxed ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                {s.description}
              </p>
              <div className="space-y-1.5">
                {s.options.map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition-colors text-xs ${
                      choices[s.key] === opt.value
                        ? isLight
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                          : 'border-emerald-500 bg-emerald-900/20 text-emerald-300'
                        : isLight
                        ? 'border-slate-300 hover:bg-slate-100 text-slate-600'
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
                        <span className={`ml-1.5 text-[14px] ${isLight ? 'text-emerald-600' : 'text-emerald-500'}`}>
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
            className={`flex-1 px-4 py-2 rounded-lg text-sm font-bold transition-colors ${
              isLight
                ? 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
            }`}
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
  // 亮色/暗色雙主題:預設暗色(維持原本外觀),使用者按右上角按鈕切換,並記住在瀏覽器裡
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('theme');
      return saved === 'light' || saved === 'dark' ? saved : 'dark';
    } catch {
      return 'dark';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('theme', theme);
    } catch {
      // 私密瀏覽或儲存空間被封鎖時,略過即可,不影響切換功能
    }
  }, [theme]);
  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  // 列印預覽本來就會強制切成亮色樣式,跟使用者自己選的亮色主題共用同一套樣式判斷
  const isLight = printMode || theme === 'light';
  // 兩個分頁:'backtest'=既有的「ETF回測比較」、'dca'=新增的「定期定額策略最佳化」
  const [activeTab, setActiveTab] = useState('backtest');

  const textClass = {
    main: isLight ? 'text-black' : 'text-white',
    sub: isLight ? 'text-slate-600' : 'text-slate-400',
    highlight: isLight ? 'text-emerald-700 font-bold' : 'text-emerald-400',
    warn: isLight ? 'text-rose-700 font-bold' : 'text-rose-400',
    blue: isLight ? 'text-blue-700' : 'text-blue-300',
    amber: isLight ? 'text-amber-700' : 'text-amber-400',
  };

  const containerClass = isLight
    ? 'min-h-screen bg-white text-black font-sans p-4 md:p-8'
    : 'min-h-screen bg-slate-900 text-slate-100 font-sans pb-12';

  const cardClass = isLight
    ? 'bg-white border border-slate-300 rounded-xl shadow-sm'
    : 'bg-slate-800 border border-slate-700 rounded-xl shadow-lg';

  const [inputs, setInputs] = useState([
    '00981A',
    '00904',
    '00891',
    '00913',
    '00947',
    '00935',
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
  const [showMonthlyTopUpInfo, setShowMonthlyTopUpInfo] = useState(false);
  const [showKlineTopUpInfo, setShowKlineTopUpInfo] = useState(false);
  // 「K線穿越均線加碼細部設定」裡,簡易模式的規則說明文字預設收合,
  // 按下「說明」展開鈕才顯示,避免每次都佔掉一大塊畫面空間。
  const [showKlineSimpleModeInfo, setShowKlineSimpleModeInfo] = useState(false);
  const [monthlyTopUpDay, setMonthlyTopUpDay] = useState(5);
  const [monthlyTopUpAmount, setMonthlyTopUpAmount] = useState(10000);
  const [monthlyTopUpIncludeLumpSum, setMonthlyTopUpIncludeLumpSum] =
    useState(true);
  const anyTopUpEnabled = monthlyTopUpEnabled || klineTopUpEnabled;

  // 「K線穿越均線加碼」重新設計後的參數,詳見「K線穿越均線加碼規則重新設計」文件。
  // 三種子模式(跌破/回檔/站回)每條均線各自獨立開關;跌破加碼延用最初就有的邏輯,
  // 預設開啟,回檔/站回是新增子模式,預設關閉。
  // 預設值直接採用「簡易模式(維持原規則)」的組合(見 KLINE_LEGACY_PRESET):只開
  // 跌破加碼、三線權重相同、不遞減、不做盤整偵測、無總量上限,只是把冷卻期從舊版
  // 「三線共用每月最多1次」改成「每條均線各自獨立21個交易日」以修正跨月重複觸發
  // 的漏洞。使用者切到「進階模式」後可另外套用更細緻的建議組合。
  const [klineSimpleMode, setKlineSimpleMode] = useState(true);
  const [klineSubModeEnabled, setKlineSubModeEnabled] = useState(() => ({
    ma20: DEFAULT_KLINE_SUBMODE_ENABLED(),
    ma60: DEFAULT_KLINE_SUBMODE_ENABLED(),
    ma120: DEFAULT_KLINE_SUBMODE_ENABLED(),
  }));
  // 每條均線各自獨立的交易日冷卻期(取代原本三線共用的「每月最多1次」)。
  const [klineCooldownDays, setKlineCooldownDays] = useState({
    ma20: 21,
    ma60: 21,
    ma120: 21,
  });
  // 均線層級倍數(金字塔配置):簡易模式預設三線權重相同(等同原規則),使用者可在
  // 進階模式透過預設按鈕快速套用「溫和遞增/陡升」等組合,或個別覆寫任一均線的數字
  // (自訂欄位)。
  const [klinePyramidMultiplier, setKlinePyramidMultiplier] = useState({
    ma20: 1,
    ma60: 1,
    ma120: 1,
  });
  // 回檔加碼:上升趨勢判斷回看天數、均線接近容忍度(±X%)。
  const [klinePullbackLookbackDays, setKlinePullbackLookbackDays] = useState(20);
  const [klinePullbackTolerancePct, setKlinePullbackTolerancePct] = useState(1);
  // 站回加碼:站上均線後需維持幾個交易日才算確認(0 = 站上當天立刻買進)。
  const [klineRecoveryConfirmDays, setKlineRecoveryConfirmDays] = useState(2);
  // 距上次加碼折扣係數(遞減):距上次成功加碼未滿此天數,金額依比例打折,
  // 下限為 decayFloorPct;滿此天數(或首次加碼)則不打折。簡易模式預設關閉遞減
  // (decayWindowDays=0 等同永遠不打折)。
  const [klineDecayWindowDays, setKlineDecayWindowDays] = useState(0);
  const [klineDecayFloorPct, setKlineDecayFloorPct] = useState(100);
  // 盤整偵測(避開情境二):trailing window 內均線最高最低差幅低於門檻即判定盤整,
  // 該均線本次所有子模式全部跳過。簡易模式預設關閉。
  const [klineChopEnabled, setKlineChopEnabled] = useState(false);
  const [klineChopWindowDays, setKlineChopWindowDays] = useState(10);
  const [klineChopThresholdPct, setKlineChopThresholdPct] = useState(2);
  // 總量保護機制(第三層):所有均線/子模式合計加碼次數上限,達到後即使符合
  // 子模式與冷卻期條件也不再加碼。簡易模式預設關閉(沿用原規則,無總量上限)。
  const [klineTotalCapEnabled, setKlineTotalCapEnabled] = useState(false);
  const [klineTotalCapCount, setKlineTotalCapCount] = useState(12);

  // 簡易模式(維持原規則)的固定參數組合:只偵測跌破加碼、三線權重相同、不遞減、
  // 不做盤整偵測、無總量上限,冷卻期為每條均線各自 21 個交易日(約一個月),藉此
  // 修正舊版「三線共用每月最多1次額度」在跨月時可能被同一次假突破重複計入的漏洞。
  const KLINE_LEGACY_PRESET = {
    subModeConfig: {
      ma20: { breakdown: true, pullback: false, recovery: false },
      ma60: { breakdown: true, pullback: false, recovery: false },
      ma120: { breakdown: true, pullback: false, recovery: false },
    },
    cooldownDays: { ma20: 21, ma60: 21, ma120: 21 },
    pyramidMultiplier: { ma20: 1, ma60: 1, ma120: 1 },
    decayWindowDays: 0,
    decayFloorPct: 100,
    chopEnabled: false,
    totalCapEnabled: false,
  };
  const applyKlineLegacyPreset = () => {
    setKlineSubModeEnabled(KLINE_LEGACY_PRESET.subModeConfig);
    setKlineCooldownDays(KLINE_LEGACY_PRESET.cooldownDays);
    setKlinePyramidMultiplier(KLINE_LEGACY_PRESET.pyramidMultiplier);
    setKlineDecayWindowDays(KLINE_LEGACY_PRESET.decayWindowDays);
    setKlineDecayFloorPct(KLINE_LEGACY_PRESET.decayFloorPct);
    setKlineChopEnabled(KLINE_LEGACY_PRESET.chopEnabled);
    setKlineTotalCapEnabled(KLINE_LEGACY_PRESET.totalCapEnabled);
  };
  // 進階模式的建議起始組合(即先前版本曾經預設過的那組較積極的參數),方便使用者
  // 切到進階模式後一鍵套用,而不用從零開始逐項調整。
  const applyKlineAdvancedSuggestedPreset = () => {
    setKlinePyramidMultiplier({ ma20: 1, ma60: 1.5, ma120: 2 });
    setKlineDecayWindowDays(20);
    setKlineDecayFloorPct(50);
    setKlineChopEnabled(true);
    setKlineChopWindowDays(10);
    setKlineChopThresholdPct(2);
    setKlineTotalCapEnabled(true);
    setKlineTotalCapCount(12);
  };

  // 把目前畫面上的 K 線加碼參數彙整成 createKlineTopUpEngine 要吃的設定物件,
  // updateRankingTable 與 runBacktest 共用,避免兩處各自組一次容易漏改。
  const getKlineConfig = () => ({
    subModeConfig: klineSubModeEnabled,
    cooldownDays: klineCooldownDays,
    pyramidMultiplier: klinePyramidMultiplier,
    pullbackLookbackDays: klinePullbackLookbackDays,
    pullbackTolerancePct: klinePullbackTolerancePct,
    recoveryConfirmDays: klineRecoveryConfirmDays,
    decayWindowDays: klineDecayWindowDays,
    decayFloorPct: klineDecayFloorPct,
    chopEnabled: klineChopEnabled,
    chopWindowDays: klineChopWindowDays,
    chopThresholdPct: klineChopThresholdPct,
    totalCapEnabled: klineTotalCapEnabled,
    totalCapCount: klineTotalCapCount,
  });

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

  // 標的組合排名表:只在按下「更新排名表」時才重新計算,詳見下方 updateRankingTable。
  const [rankingLoading, setRankingLoading] = useState(false);
  const [rankingError, setRankingError] = useState('');
  const [rankingData, setRankingData] = useState(null);
  // 排名表區塊的捲動錨點:按下「更新排名表」(尤其是常駐浮動鈕)算完後,自動
  // 捲到這裡讓使用者能快速看到表格,不用自己找。
  const rankingTableAnchorRef = useRef(null);
  // 排名表(含加碼):只在目前有勾選任一加碼開關時才會一併計算,套用當下的
  // 加碼策略設定(每月固定日期加碼/K線穿越均線加碼)。
  const [rankingDataTopUp, setRankingDataTopUp] = useState(null);

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

  // 標的組合排名表:獨立於主要回測流程之外,只在使用者按下「更新排名表」時才會
  // 重新抓資料、重新計算,不會隨著「開始回測」或改變回測投資年限而跟著變動。
  const updateRankingTable = async () => {
    const activeStocks = inputs
      .map((s, idx) => ({ s, idx }))
      .filter((item) => item.s !== '' && enabledInputs[item.idx]);
    if (activeStocks.length === 0) {
      setRankingError('請至少勾選一檔標的');
      return;
    }
    setRankingLoading(true);
    setRankingError('');
    try {
      const rawResults = await Promise.all(
        activeStocks.map((item) => fetchStockPriceData(item.s))
      );
      const successfulData = rawResults
        .map((r, i) => (r ? { ...r, inputIndex: activeStocks[i].idx } : null))
        .filter((r) => r && r.data.length > 0);

      if (successfulData.length === 0) {
        setRankingError('無法抓取任何有效數據,請檢查代碼或網路。');
        setRankingLoading(false);
        return;
      }

      successfulData.forEach((stock) => {
        applySplitAdjustments(stock);
      });

      await Promise.all(
        successfulData.map(async (stock) => {
          if (stockNames[stock.symbol]) {
            stock.stockName = stockNames[stock.symbol];
          } else {
            try {
              const name = await fetchStockDisplayName(stock.symbol);
              stock.stockName = name || '';
            } catch (e) {
              stock.stockName = '';
            }
          }
        })
      );
      const newNamesMap = {};
      successfulData.forEach((s) => {
        if (s.stockName) newNamesMap[s.symbol] = s.stockName;
      });
      setStockNames((prev) => ({ ...prev, ...newNamesMap }));

      // 每個區間各自排名(報酬率高到低,1 = 表現最好),缺資料(null)的標的不參與排名。
      // 純本金、含加碼兩份排名表共用同一套排名邏輯,差別只在 rows 是怎麼算出來的。
      const buildRanks = (rows) => {
        const ranksByRow = rows.map(() => ({}));
        RANKING_PERIODS.forEach((period) => {
          rows
            .map((row, i) => ({ i, val: row.returns[period.key] }))
            .filter((x) => typeof x.val === 'number' && Number.isFinite(x.val))
            .sort((a, b) => b.val - a.val)
            .forEach((x, rankIdx) => {
              ranksByRow[x.i][period.key] = rankIdx + 1;
            });
        });
        return ranksByRow;
      };

      const rows = successfulData.map((stock) => {
        const returns = {};
        RANKING_PERIODS.forEach((period) => {
          const { rangeStart, rangeEnd } = computeRankingPeriodRange(period);
          returns[period.key] = computeStockReturnForRange(
            stock,
            rangeStart,
            rangeEnd
          );
        });
        return { symbol: stock.symbol, stockName: stock.stockName, returns };
      });
      const ranksByRow = buildRanks(rows);
      setRankingData({
        rows: rows.map((row, i) => ({ ...row, ranks: ranksByRow[i] })),
        updatedAt: new Date(),
      });

      // 排名表(含加碼):只有目前畫面上「加碼策略設定」有勾選任一個開關時才一併算,
      // 套用當下實際的設定值(每月固定日期加碼/K線穿越均線加碼,可以只開一個、
      // 兩個都開)。K線用的均線每檔標的只算一次(用完整歷史),9 個區間共用,
      // 不用每個區間各自重算一次均線。
      if (anyTopUpEnabled) {
        const klineMaSeriesByStock = new Map();
        if (klineTopUpEnabled) {
          successfulData.forEach((stock) => {
            klineMaSeriesByStock.set(stock.symbol, buildKlineMaSeries(stock));
          });
        }
        const klineConfig = klineTopUpEnabled ? getKlineConfig() : null;

        const topUpRows = successfulData.map((stock) => {
          const returns = {};
          const netProfits = {};
          RANKING_PERIODS.forEach((period) => {
            const { rangeStart, rangeEnd } = computeRankingPeriodRange(period);
            const result = computeStockReturnForRangeWithTopUp(
              stock,
              rangeStart,
              rangeEnd,
              {
                totalCapital: RANKING_TABLE_STOCK_PRINCIPAL,
                monthlyTopUpEnabled,
                monthlyTopUpDay,
                monthlyTopUpAmount,
                monthlyTopUpIncludeLumpSum,
                klineTopUpEnabled,
                klineMaSeries: klineTopUpEnabled
                  ? klineMaSeriesByStock.get(stock.symbol)
                  : null,
                klineConfig,
              }
            );
            returns[period.key] = result ? result.pct : null;
            netProfits[period.key] = result ? result.netProfit : null;
          });
          return {
            symbol: stock.symbol,
            stockName: stock.stockName,
            returns,
            netProfits,
          };
        });
        const topUpRanksByRow = buildRanks(topUpRows);
        setRankingDataTopUp({
          rows: topUpRows.map((row, i) => ({
            ...row,
            ranks: topUpRanksByRow[i],
          })),
          updatedAt: new Date(),
        });
      } else {
        setRankingDataTopUp(null);
      }

      // 算完後自動捲到排名表區塊,方便從畫面任何位置按浮動鈕更新後能馬上看到結果,
      // 不用自己找表格在哪裡。
      rankingTableAnchorRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    } catch (e) {
      setRankingError('計算排名時發生錯誤,請稍後再試。');
    } finally {
      setRankingLoading(false);
    }
  };

  // 標的組合排名表的表格本體:純本金、含加碼兩份表格共用同一套渲染邏輯,
  // 差別只在傳入的 data(rankingData 或 rankingDataTopUp)。
  // 走勢比較圖(報酬率/加碼策略)共用:圖例與提示框裡,股代碼後面加上股名方便辨識,
  // 查不到股名(例如尚未抓取過)就只顯示代碼。
  const formatLineLabel = (symbol) =>
    stockNames[symbol] ? `${symbol} ${stockNames[symbol]}` : symbol;

  // highlightMaxNetProfit:每個時間區間(列)裡,把淨損益金額最高的那個標的用紅色
  // 標示,只給「標的組合排名表(含加碼)」使用;純本金的排名表不受影響。
  const renderRankingTable = (data, { highlightMaxNetProfit = false } = {}) => (
    <div className="overflow-x-auto">
      <table className="text-xs text-center border-collapse min-w-full">
        <thead>
          <tr>
            <th
              className={`px-2 py-1.5 border sticky left-0 ${
                isLight ? 'bg-slate-200 text-slate-700 border-slate-300' : 'bg-slate-700 text-slate-200 border-slate-600'
              }`}
            ></th>
            {data.rows.map((row) => (
              <th
                key={row.symbol}
                title={row.stockName}
                className={`px-2 py-1.5 border whitespace-nowrap font-mono ${
                  isLight ? 'bg-slate-200 text-slate-700 border-slate-300' : 'bg-slate-700 text-slate-200 border-slate-600'
                }`}
              >
                {row.symbol}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {RANKING_PERIODS.map((p, i) => {
            const periodMaxNetProfit = highlightMaxNetProfit
              ? data.rows.reduce((max, row) => {
                  const v = row.netProfits ? row.netProfits[p.key] : null;
                  return typeof v === 'number' && Number.isFinite(v) && (max === null || v > max)
                    ? v
                    : max;
                }, null)
              : null;
            return (
              <tr
                key={p.key}
                className={
                  isLight
                    ? i % 2 === 0
                      ? 'bg-white'
                      : 'bg-slate-50'
                    : i % 2 === 0
                    ? 'bg-slate-800/70'
                    : 'bg-slate-800/30'
                }
              >
                <td
                  className={`px-2 py-1.5 border font-mono font-bold sticky left-0 bg-inherit whitespace-nowrap ${
                    isLight ? 'border-slate-300 text-slate-700' : 'border-slate-700 text-slate-200'
                  }`}
                >
                  {p.label}
                </td>
                {data.rows.map((row) => {
                  const rank = row.ranks[p.key];
                  const retPct = row.returns[p.key];
                  const netProfit = row.netProfits ? row.netProfits[p.key] : null;
                  const isMaxNetProfit =
                    highlightMaxNetProfit &&
                    typeof netProfit === 'number' &&
                    Number.isFinite(netProfit) &&
                    periodMaxNetProfit !== null &&
                    netProfit === periodMaxNetProfit;
                  return (
                    <td
                      key={row.symbol}
                      className={`px-2 py-1.5 border font-mono whitespace-nowrap ${
                        isLight ? 'border-slate-300' : 'border-slate-700'
                      }`}
                    >
                      <div className="flex flex-col items-center leading-tight">
                        <span
                          className={`font-bold ${
                            rank === 1
                              ? isLight
                                ? 'text-rose-600'
                                : 'text-rose-400'
                              : isLight
                              ? 'text-slate-600'
                              : 'text-slate-300'
                          }`}
                        >
                          {rank ?? '—'}
                        </span>
                        {typeof retPct === 'number' &&
                          Number.isFinite(retPct) && (
                            <span className={`text-[10px] ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                              {retPct > 0 ? '+' : ''}
                              {retPct.toFixed(1)}%
                            </span>
                          )}
                        {typeof netProfit === 'number' &&
                          Number.isFinite(netProfit) && (
                            <span
                              className={`text-[10px] ${
                                isMaxNetProfit
                                  ? `font-bold ${isLight ? 'text-rose-600' : 'text-rose-400'}`
                                  : isLight
                                  ? 'text-slate-400'
                                  : 'text-slate-600'
                              }`}
                            >
                              {netProfit >= 0 ? '+' : '-'}$
                              {Math.round(Math.abs(netProfit)).toLocaleString()}
                            </span>
                          )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className={`text-[13px] mt-1 ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
        更新時間: {data.updatedAt.toLocaleString('zh-TW')}
      </div>
    </div>
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
        // 全程用 UTC 基準建構/位移日期:股價資料的日期一律是 UTC 午夜基準,
        // 這裡若改用本地時區(getFullYear/setMonth)在台灣(UTC+8)執行時,
        // 會跟股價資料的日期基準對不齊,導致抓到的結束日比預期少一天。
        rangeStart = new Date(Date.UTC(rangeStart.getUTCFullYear(), 0, 1));
      } else {
        const months =
          timeRange === '3m'
            ? 3
            : timeRange === '6m'
            ? 6
            : timeRange === '12m'
            ? 12
            : timeRange === '2y'
            ? 24
            : timeRange === '3y'
            ? 36
            : timeRange === '5y'
            ? 60
            : 12;
        rangeStart.setUTCMonth(rangeStart.getUTCMonth() - months);
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
    // (用 setUTCDate 而非 setDate,理由同上,確保跟股價資料的 UTC 日期基準一致)
    while (isNonTradingDay(rangeEnd)) {
      rangeEnd.setUTCDate(rangeEnd.getUTCDate() - 1);
    }
    // 起始日避開非交易日:如果起始日落在週末或國定假日,往後推到最近一個交易日
    while (isNonTradingDay(rangeStart)) {
      rangeStart.setUTCDate(rangeStart.getUTCDate() + 1);
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
      // 之前這裡完全沒有留下任何紀錄,使用者只會看到結果頁的截止日莫名比預期早,
      // 卻查不出原因(例如某標的資料來源當天還沒更新收盤價)。現在把是哪一檔、
      // 資料只到哪一天記下來,顯示在結果頁的「截止日由 XXX 限制」提示裡。
      let dataStaleLimiter = null;
      // 修改 2:從所有 ETF 的最後一筆資料,找出共同覆蓋到的最後日期
      // 這樣可以自動處理國定假日 / ETF 個別休市的情況
      if (successfulData && successfulData.length > 0) {
        const stocksWithData = successfulData.filter(
          (s) => s.data && s.data.length > 0
        );
        const lastDatesPerStock = stocksWithData.map(
          (s) => new Date(s.data[s.data.length - 1].date)
        );
        if (lastDatesPerStock.length > 0) {
          const earliestLastDate = new Date(
            Math.min(...lastDatesPerStock.map((d) => d.getTime()))
          );
          if (earliestLastDate < rangeEnd) {
            globalCalcEndDate = earliestLastDate;
            const laggingSymbols = stocksWithData
              .filter(
                (s) =>
                  new Date(s.data[s.data.length - 1].date).getTime() ===
                  earliestLastDate.getTime()
              )
              .map((s) => s.symbol);
            dataStaleLimiter = {
              symbols: laggingSymbols,
              lastDate: earliestLastDate.toISOString().split('T')[0],
            };
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
          // 用 setUTCDate 而非 setDate,理由同上:股價/配息資料的日期一律是 UTC
          // 午夜基準,這裡也要用同一基準位移,才能跟股價資料的日期精準對齊。
          pulledBackDate.setUTCDate(pulledBackDate.getUTCDate() - 1);
          // 除息日前一天也可能剛好落在週末/國定假日(非交易日),要再往前跳過
          // 非交易日,確保最後採用的結束日一定是實際有股價資料的交易日,
          // 避免抓到週末/假日這種根本不存在收盤價的日期(這正是先前
          // 00935 近1年報酬對不上、實際抓到非交易日期的原因)。
          while (isNonTradingDay(pulledBackDate)) {
            pulledBackDate.setUTCDate(pulledBackDate.getUTCDate() - 1);
          }
          const applyPullback = () => {
            globalLatestDivDate = new Date(maxDivTs);
            globalCalcEndDate = pulledBackDate;
            endDateLimiter = candidateEndLimiter;
            // 除息日限制是比資料只更新到某天更明確的原因,兩者衝突時以這個為準顯示
            dataStaleLimiter = null;
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
        dataStaleLimiter: dataStaleLimiter,
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

          // 查得到公開年化管理費率(經理費+保管費,%)才會有值,查不到就是 undefined,
          // 下面逐日模擬時只有查得到才會另外累計管理費成本、算出「扣管理費後」的報酬。
          const feeRatePct = TW_ETF_FEES[stock.symbol];

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

          // K線穿越均線加碼:由獨立的 klineTopUpEnabled 開關控制,實際規則(三種
          // 子模式、每條均線各自獨立的冷卻期/倍數、盤整偵測、總量上限)由使用者在
          // 「加碼策略設定」面板調整,詳見 createKlineTopUpEngine。月線(MA20)/
          // 季線(MA60)/半年線(MA120)都用 stock.data 的完整歷史算均線(跟定期
          // 定額最佳化分頁算法相同),才能在回測區間剛開始的幾天也看得到足夠的
          // 歷史資料做趨勢/盤整判斷。
          const klineMaSeries = klineTopUpEnabled
            ? buildKlineMaSeries(stock)
            : null;
          const klineConfig = klineTopUpEnabled ? getKlineConfig() : null;
          const klineEngine =
            klineMaSeries && klineConfig
              ? createKlineTopUpEngine(klineMaSeries, klineConfig)
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

          // 逐日累計管理費成本(只有查得到 feeRatePct 才會累計):用「前一天收盤時
          // 持有的股數與市值」乘上「這兩個交易日之間經過的實際曆日天數/365」乘上
          // 年化費率,近似模擬基金公司每天從淨值提列費用的做法;股數隨加碼增加時,
          // 之後的區間自然會用增加後的股數去算,不需要另外處理。
          let feeCostAccrued = 0;

          filteredData.forEach((day, dayIndex) => {
            if (feeRatePct !== undefined && dayIndex > 0 && shares > 0) {
              const prevDay = filteredData[dayIndex - 1];
              const daysElapsed =
                (day.timestamp - prevDay.timestamp) / (1000 * 60 * 60 * 24);
              if (daysElapsed > 0) {
                feeCostAccrued +=
                  (daysElapsed / 365) *
                  (feeRatePct / 100) *
                  shares *
                  prevDay.price;
              }
            }

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

            if (klineEngine && monthlyTopUpAmount > 0) {
              const events = klineEngine.evaluateDay(day, dayIndex);
              events.forEach((ev) => {
                const amount = monthlyTopUpAmount * ev.ratio;
                if (!ev.skipReason && amount > 0) {
                  const boughtShares = amount / day.price;
                  shares += boughtShares;
                  totalInvested += amount;
                  topUpOnlyShares += boughtShares;
                  topUpOnlyInvested += amount;
                  topUpEvents.push({
                    date: day.date,
                    symbol: stock.symbol,
                    stockName: stock.stockName,
                    source: 'kline',
                    lineKey: ev.lineKey,
                    lineLabel: MA_LINE_LABELS[ev.lineKey],
                    subMode: ev.subMode,
                    subModeLabel: KLINE_SUBMODE_LABELS[ev.subMode],
                    multiplier: ev.multiplier,
                    decayRatio: ev.decayRatio,
                    price: day.price,
                    shares: boughtShares,
                    amount,
                    skipped: false,
                    ...makeReturnPct(day.price),
                  });
                } else {
                  // 冷卻期未滿/判定為盤整/已達總量上限,這次觸發不會真的買進,
                  // 但仍記錄下來讓使用者知道「有觸發、但沒成交」與原因。
                  topUpEvents.push({
                    date: day.date,
                    symbol: stock.symbol,
                    stockName: stock.stockName,
                    source: 'kline',
                    lineKey: ev.lineKey,
                    lineLabel: MA_LINE_LABELS[ev.lineKey],
                    subMode: ev.subMode,
                    subModeLabel: KLINE_SUBMODE_LABELS[ev.subMode],
                    price: day.price,
                    shares: 0,
                    amount: 0,
                    skipped: true,
                    skipReason: ev.skipReason,
                  });
                }
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

          // 扣除管理費成本後的含息報酬:用上面逐日累計的 feeCostAccrued(估算的管理費
          // 總成本金額)直接從期末含息總值裡再扣一次,只有查得到 feeRatePct 才會算,
          // 查不到就是 undefined,卡片那邊不顯示這個數字。
          const feeCostAdjustedReturnPct =
            feeRatePct !== undefined && totalInvested > 0
              ? ((finalMarketValue +
                  finalStockDividends -
                  feeCostAccrued -
                  totalInvested) /
                  totalInvested) *
                100
              : undefined;
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
              isLight
            ),
            // 未勾選「計算β值」時完全不放這個欄位(而不是塞 null),
            // 讓卡片能區分「沒算」(不顯示徽章)跟「算了但資料不足」(顯示「資料不足」)。
            ...(calcBeta
              ? { beta: calculateBeta(filteredData, benchmarkReturnsByDate) }
              : {}),
            // 只有查得到公開費率的 ETF 才會有這幾個欄位,查不到就不放(而不是塞 0/null),
            // 卡片那邊用「有沒有這些欄位」決定要不要顯示管理費徽章、扣管理費後報酬。
            ...(feeRatePct !== undefined
              ? {
                  feeRate: feeRatePct,
                  feeCostAccrued,
                  feeCostAdjustedReturnPct,
                }
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
      {/* 分頁切換:既有的「ETF回測比較」與新增的「定期定額策略最佳化」並排;右上角放亮/暗主題切換鈕,兩個分頁都看得到、按得到 */}
      <div
        className={`no-print sticky top-0 z-40 flex items-center justify-between gap-1 px-2 sm:px-4 border-b ${
          isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-700'
        }`}
      >
        <div className="flex gap-1">
          <button
            onClick={() => setActiveTab('backtest')}
            className={`px-3 sm:px-4 py-2.5 text-sm sm:text-base font-medium border-b-2 transition-colors ${
              activeTab === 'backtest'
                ? 'border-emerald-400 text-emerald-400'
                : isLight
                ? 'border-transparent text-slate-500 hover:text-slate-700'
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
                : isLight
                ? 'border-transparent text-slate-500 hover:text-slate-700'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            定期定額策略最佳化
          </button>
        </div>
        <button
          onClick={toggleTheme}
          title={theme === 'dark' ? '切換成亮色模式' : '切換成暗色模式'}
          className={`flex items-center justify-center w-9 h-9 rounded-full transition-colors border shrink-0 ${
            isLight
              ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300'
              : 'bg-slate-700 hover:bg-slate-600 text-amber-300 border-slate-600'
          }`}
        >
          {theme === 'dark' ? (
            <Moon className="w-4 h-4" />
          ) : (
            <Sun className="w-4 h-4" />
          )}
        </button>
      </div>

      {activeTab === 'dca' && (
        <div className={containerClass}>
          <div className="max-w-6xl mx-auto p-4 sm:p-6">
            <DcaOptimizer isLight={isLight} />
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
          isLight={isLight}
        />
      )}

      {!missingDataList.length && pendingSituations && pendingSituations.length > 0 && (
        <SituationDecisionModal
          situations={pendingSituations}
          onConfirm={handleResolveSituations}
          onCancel={handleCancelSituations}
          isLight={isLight}
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

      {/* 浮動按鈕(最上面,bottom-36):依目前是「設定頁」還是「結果頁」切換內容,
          不論電腦版或手機版都常駐顯示。設定區展開中(設定頁,isConfigExpanded)時
          是「更新排名表」,方便不用捲到排名表區塊就能隨時重新抓資料計算;設定區
          已收合(結果頁)時,換成「回去改設定」,按下直接展開設定區並捲回最上方,
          不用自己往上滑找 */}
      {!loading && !printMode && (isConfigExpanded ? (
        <button
          onClick={updateRankingTable}
          disabled={rankingLoading || !hasSelectedStock}
          className={`fixed bottom-36 right-4 z-30 w-12 h-12 rounded-full text-white shadow-xl flex items-center justify-center no-print transition-colors ${
            rankingLoading || !hasSelectedStock
              ? 'bg-slate-700 text-slate-500 cursor-not-allowed shadow-slate-900/40'
              : 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-900/40'
          }`}
          title="更新排名表"
        >
          {rankingLoading ? (
            <RefreshCw className="w-6 h-6 animate-spin" />
          ) : (
            <Table2 className="w-6 h-6" />
          )}
        </button>
      ) : (
        <button
          onClick={() => {
            setIsConfigExpanded(true);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          className="fixed bottom-36 right-4 z-30 w-12 h-12 rounded-full bg-violet-600 hover:bg-violet-500 text-white shadow-xl shadow-violet-900/40 flex items-center justify-center no-print"
          title="回去改設定"
        >
          <ArrowLeft className="w-6 h-6" />
        </button>
      ))}

      {/* 浮動按鈕(中間,bottom-20):「重新執行回測」,不論設定頁或結果頁、電腦版或
          手機版都常駐顯示,方便隨時重新執行回測,按下即直接(重新)開始回測;沿用
          主要開始回測按鈕的 disabled 判斷,避免在設定不合法時誤觸 */}
      {!loading && !printMode && (
        <button
          onClick={() => runBacktest()}
          disabled={!hasSelectedStock}
          className={`fixed bottom-20 right-4 z-30 w-12 h-12 rounded-full text-white shadow-xl flex items-center justify-center no-print ${
            !hasSelectedStock
              ? 'bg-slate-700 text-slate-500 cursor-not-allowed shadow-slate-900/40'
              : 'bg-gradient-to-r from-emerald-500 to-teal-600 shadow-emerald-900/40'
          }`}
          title="重新執行回測"
        >
          <Zap className="w-6 h-6 fill-current" />
        </button>
      )}

      {/* 浮動按鈕(最下面,bottom-5):「快速跳到最底」,不論設定頁或結果頁、電腦版或
          手機版都常駐顯示,提供快速跳到頁面最底部的捷徑 */}
      {!loading && !printMode && (
        <button
          onClick={() =>
            window.scrollTo({
              top: document.body.scrollHeight,
              behavior: 'smooth',
            })
          }
          className="fixed bottom-5 right-4 z-30 w-12 h-12 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white shadow-xl shadow-emerald-900/40 flex items-center justify-center no-print"
          title="快速跳到最底"
        >
          <ChevronDown className="w-6 h-6" />
        </button>
      )}

      <header
        className={`border-b shadow-xl sm:sticky sm:top-0 z-20 no-print ${
          isLight
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
                  ? isLight
                    ? 'bg-slate-100 hover:bg-slate-200 text-slate-600 border-slate-300'
                    : 'bg-slate-700 hover:bg-slate-600 text-slate-300 border-slate-600'
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
                ? 'max-h-[8000px] opacity-100'
                : 'max-h-0 opacity-0'
            }`}
          >
            <div
              className={`grid lg:grid-cols-12 lg:items-start gap-6 p-4 rounded-xl border min-w-0 ${
                isLight ? 'bg-slate-50 border-slate-300' : 'bg-slate-900/50 border-slate-700'
              }`}
            >
              <div
                className={`lg:col-span-4 min-w-0 space-y-4 border-b lg:border-b-0 lg:border-r pb-4 lg:pb-0 pr-0 lg:pr-4 ${
                  isLight ? 'border-slate-300' : 'border-slate-700'
                }`}
              >
                <div className="flex flex-col gap-2">
                  <label className={`text-xs font-bold ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
                    總投入本金 (萬元)
                  </label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <DollarSign className={`w-4 h-4 absolute left-3 top-2.5 ${isLight ? 'text-slate-400' : 'text-slate-500'}`} />
                      <SmartNumberInput
                        value={Math.round((totalCapital / 10000) * 10) / 10}
                        onChange={handleTotalCapitalChange}
                        className={`w-full rounded-lg py-2 pl-9 pr-3 focus:ring-2 focus:ring-emerald-500 font-mono border ${
                          isLight
                            ? 'bg-white border-slate-300 text-slate-900'
                            : 'bg-slate-800 border-slate-600 text-white'
                        }`}
                      />
                    </div>
                    <button
                      onClick={setAllEnabledTo100W}
                      className={`text-[14px] px-2 rounded border transition-colors whitespace-nowrap ${
                        isLight
                          ? 'bg-slate-200 hover:bg-slate-300 text-slate-700 border-slate-300'
                          : 'bg-slate-700 hover:bg-slate-600 text-white border-slate-600'
                      }`}
                      title="將所有已勾選的標的金額設為100萬"
                    >
                      全設
                      <br />
                      100萬
                    </button>
                  </div>
                  <div className={`text-[14px] text-right ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                    = {Math.round(totalCapital).toLocaleString()} 元
                  </div>
                </div>
                <div
                  className={`flex flex-col gap-2 rounded-lg p-3 border ${
                    isLight ? 'bg-slate-100 border-slate-300' : 'bg-slate-800/60 border-slate-700'
                  }`}
                >
                  <div className={`text-xs font-bold ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>
                    加碼策略設定
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={monthlyTopUpEnabled}
                      onChange={() => setMonthlyTopUpEnabled((v) => !v)}
                    />
                    <span className={`text-xs ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>
                      每月固定日期加碼
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowMonthlyTopUpInfo((v) => !v)}
                      title="說明"
                      className={`flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded border transition-colors ${
                        isLight
                          ? 'text-slate-500 border-slate-300 hover:bg-slate-200'
                          : 'text-slate-400 border-slate-600 hover:bg-slate-700'
                      }`}
                    >
                      <Info className="w-3 h-3" />
                      說明
                    </button>
                  </label>
                  {showMonthlyTopUpInfo && (
                    <div className={`text-[11px] leading-relaxed ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                      開啟後,每個月固定日期額外加碼投入一筆金額,直到回測結束日,所有比較中的標的都套用同一組設定。
                    </div>
                  )}
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={klineTopUpEnabled}
                      onChange={() => setKlineTopUpEnabled((v) => !v)}
                    />
                    <span className={`text-xs ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>
                      K線穿越均線加碼
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowKlineTopUpInfo((v) => !v)}
                      title="說明"
                      className={`flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded border transition-colors ${
                        isLight
                          ? 'text-slate-500 border-slate-300 hover:bg-slate-200'
                          : 'text-slate-400 border-slate-600 hover:bg-slate-700'
                      }`}
                    >
                      <Info className="w-3 h-3" />
                      說明
                    </button>
                  </label>
                  {showKlineTopUpInfo && (
                    <div className={`text-[11px] leading-relaxed ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                      預設為「簡易模式」,直接沿用先前版本的規則(只偵測跌破加碼,三線權重相同,不打折、不做盤整偵測、無總量上限),只修正了舊版「每月最多1次」額度可能跨月被同一次假跌破重複計入的漏洞。若想細部調整,可切換到「進階模式」:分別針對月線(MA20)/季線(MA60)/半年線(MA120)勾選三種加碼子模式:跌破加碼(股價跌破均線)、回檔加碼(上升趨勢中拉回接近均線)、站回加碼(跌破後收復均線),加碼金額 = 下面設定的「每次加碼金額」× 該均線的金字塔倍數 × 距上次加碼的遞減折扣係數,並可另外開啟盤整偵測(避免盤整期間頻繁小幅加碼)與總量保護機制(合計加碼次數上限)。這兩個加碼開關(定期定額/K線)可以各自獨立開關,也可以同時開啟。
                    </div>
                  )}
                  {anyTopUpEnabled && (
                    <>
                      <div
                        className={`grid gap-2 ${
                          monthlyTopUpEnabled ? 'grid-cols-2' : 'grid-cols-1'
                        }`}
                      >
                        {monthlyTopUpEnabled && (
                          <div>
                            <div className={`text-[11px] mb-1 ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
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
                              className={`w-full rounded p-1.5 text-sm border ${isLight ? 'bg-white border-slate-300 text-slate-900' : 'bg-slate-800 border-slate-600'}`}
                            />
                          </div>
                        )}
                        <div>
                          <div className={`text-[11px] mb-1 ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                            每次加碼金額(元)
                          </div>
                          <input
                            type="number"
                            min={0}
                            value={monthlyTopUpAmount}
                            onChange={(e) =>
                              setMonthlyTopUpAmount(parseFloat(e.target.value) || 0)
                            }
                            className={`w-full rounded p-1.5 text-sm border ${isLight ? 'bg-white border-slate-300 text-slate-900' : 'bg-slate-800 border-slate-600'}`}
                          />
                        </div>
                      </div>
                      <div>
                        <div className={`text-[11px] mb-1 ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                          最上面設定的一次性本金
                        </div>
                        <div className="grid grid-cols-2 gap-1">
                          <button
                            type="button"
                            onClick={() => setMonthlyTopUpIncludeLumpSum(true)}
                            className={`text-xs rounded p-1.5 border ${
                              monthlyTopUpIncludeLumpSum
                                ? 'bg-emerald-600 border-emerald-500 text-white font-bold'
                                : (isLight ? 'bg-slate-100 border-slate-300 text-slate-500' : 'bg-slate-800 border-slate-600 text-slate-400')
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
                                : (isLight ? 'bg-slate-100 border-slate-300 text-slate-500' : 'bg-slate-800 border-slate-600 text-slate-400')
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
                  {klineTopUpEnabled && (
                    <div
                      className={`flex flex-col gap-3 rounded-lg p-2.5 border ${
                        isLight ? 'bg-white border-slate-300' : 'bg-slate-900/60 border-slate-700'
                      }`}
                    >
                      <div className={`text-[11px] font-bold ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
                        K線穿越均線加碼細部設定
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setKlineSimpleMode(true);
                            applyKlineLegacyPreset();
                          }}
                          className={`text-xs rounded p-1.5 border ${
                            klineSimpleMode
                              ? 'bg-emerald-600 border-emerald-500 text-white font-bold'
                              : (isLight ? 'bg-slate-100 border-slate-300 text-slate-500' : 'bg-slate-800 border-slate-600 text-slate-400')
                          }`}
                        >
                          簡易模式(維持原規則)
                        </button>
                        <button
                          type="button"
                          onClick={() => setKlineSimpleMode(false)}
                          className={`text-xs rounded p-1.5 border ${
                            !klineSimpleMode
                              ? 'bg-emerald-600 border-emerald-500 text-white font-bold'
                              : (isLight ? 'bg-slate-100 border-slate-300 text-slate-500' : 'bg-slate-800 border-slate-600 text-slate-400')
                          }`}
                        >
                          進階模式(自訂子模式/遞減/盤整)
                        </button>
                      </div>
                      {klineSimpleMode ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setShowKlineSimpleModeInfo((v) => !v)}
                            title="說明"
                            className={`self-start flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded border transition-colors ${
                              isLight
                                ? 'text-slate-500 border-slate-300 hover:bg-slate-200'
                                : 'text-slate-400 border-slate-600 hover:bg-slate-700'
                            }`}
                          >
                            <Info className="w-3 h-3" />
                            說明
                          </button>
                          {showKlineSimpleModeInfo && (
                            <div className={`text-[11px] leading-relaxed ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                              簡易模式=延續先前版本的規則:只偵測「跌破加碼」,MA20/60/120 權重相同、金額不打折、不做盤整偵測、也沒有總量上限;冷卻期改為每條均線各自 21 個交易日(約一個月),修正了先前「同一次假跌破可能跨月被重複計入兩次」的漏洞。想調整細部規則(回檔/站回子模式、金字塔倍數、遞減折扣、盤整偵測、總量上限)請切換到「進階模式」。
                            </div>
                          )}
                        </>
                      ) : (
                      <>
                      <button
                        type="button"
                        onClick={applyKlineAdvancedSuggestedPreset}
                        className={`text-[11px] rounded p-1.5 border ${
                          isLight
                            ? 'bg-slate-100 border-slate-300 text-slate-600 hover:bg-slate-200'
                            : 'bg-slate-800 border-slate-600 text-slate-400 hover:bg-slate-700'
                        }`}
                      >
                        套用進階建議組合(金字塔1/1.5/2x + 遞減折扣 + 盤整偵測 + 總量上限12次)
                      </button>
                      {MA_LINE_KEYS.map((lineKey) => (
                        <div key={lineKey} className="flex flex-col gap-1.5">
                          <div className={`text-[11px] font-bold ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>
                            {MA_LINE_LABELS[lineKey]}
                          </div>
                          <div className="flex flex-wrap gap-x-3 gap-y-1">
                            {KLINE_SUBMODE_KEYS.map((subKey) => (
                              <label
                                key={subKey}
                                className={`flex items-center gap-1 text-[11px] cursor-pointer ${isLight ? 'text-slate-600' : 'text-slate-400'}`}
                              >
                                <input
                                  type="checkbox"
                                  checked={klineSubModeEnabled[lineKey][subKey]}
                                  onChange={() =>
                                    setKlineSubModeEnabled((prev) => ({
                                      ...prev,
                                      [lineKey]: {
                                        ...prev[lineKey],
                                        [subKey]: !prev[lineKey][subKey],
                                      },
                                    }))
                                  }
                                />
                                {KLINE_SUBMODE_LABELS[subKey]}
                              </label>
                            ))}
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <div className={`text-[10px] mb-0.5 ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                                冷卻天數(交易日)
                              </div>
                              <input
                                type="number"
                                min={0}
                                value={klineCooldownDays[lineKey]}
                                onChange={(e) =>
                                  setKlineCooldownDays((prev) => ({
                                    ...prev,
                                    [lineKey]: parseInt(e.target.value, 10) || 0,
                                  }))
                                }
                                className={`w-full rounded p-1 text-xs border ${isLight ? 'bg-white border-slate-300 text-slate-900' : 'bg-slate-800 border-slate-600'}`}
                              />
                            </div>
                            <div>
                              <div className={`text-[10px] mb-0.5 ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                                金字塔倍數
                              </div>
                              <input
                                type="number"
                                min={0}
                                step={0.1}
                                value={klinePyramidMultiplier[lineKey]}
                                onChange={(e) =>
                                  setKlinePyramidMultiplier((prev) => ({
                                    ...prev,
                                    [lineKey]: parseFloat(e.target.value) || 0,
                                  }))
                                }
                                className={`w-full rounded p-1 text-xs border ${isLight ? 'bg-white border-slate-300 text-slate-900' : 'bg-slate-800 border-slate-600'}`}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                      <div>
                        <div className={`text-[10px] mb-1 ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                          金字塔倍數常用組合
                        </div>
                        <div className="grid grid-cols-1 gap-1">
                          {KLINE_PYRAMID_PRESETS.map((preset) => (
                            <button
                              key={preset.name}
                              type="button"
                              onClick={() => setKlinePyramidMultiplier(preset.values)}
                              className={`text-[11px] rounded p-1.5 border ${
                                isLight
                                  ? 'bg-slate-100 border-slate-300 text-slate-600 hover:bg-slate-200'
                                  : 'bg-slate-800 border-slate-600 text-slate-400 hover:bg-slate-700'
                              }`}
                            >
                              {preset.name}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <div className={`text-[10px] mb-0.5 ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                            回檔:上升趨勢回看天數
                          </div>
                          <input
                            type="number"
                            min={1}
                            value={klinePullbackLookbackDays}
                            onChange={(e) =>
                              setKlinePullbackLookbackDays(parseInt(e.target.value, 10) || 1)
                            }
                            className={`w-full rounded p-1 text-xs border ${isLight ? 'bg-white border-slate-300 text-slate-900' : 'bg-slate-800 border-slate-600'}`}
                          />
                        </div>
                        <div>
                          <div className={`text-[10px] mb-0.5 ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                            回檔:均線接近容忍度(±%)
                          </div>
                          <input
                            type="number"
                            min={0}
                            step={0.1}
                            value={klinePullbackTolerancePct}
                            onChange={(e) =>
                              setKlinePullbackTolerancePct(parseFloat(e.target.value) || 0)
                            }
                            className={`w-full rounded p-1 text-xs border ${isLight ? 'bg-white border-slate-300 text-slate-900' : 'bg-slate-800 border-slate-600'}`}
                          />
                        </div>
                      </div>
                      <div>
                        <div className={`text-[10px] mb-0.5 ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                          站回:確認天數(0=站上當天立刻買進)
                        </div>
                        <input
                          type="number"
                          min={0}
                          value={klineRecoveryConfirmDays}
                          onChange={(e) =>
                            setKlineRecoveryConfirmDays(parseInt(e.target.value, 10) || 0)
                          }
                          className={`w-full rounded p-1 text-xs border ${isLight ? 'bg-white border-slate-300 text-slate-900' : 'bg-slate-800 border-slate-600'}`}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <div className={`text-[10px] mb-0.5 ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                            距上次遞減:折扣視窗(交易日)
                          </div>
                          <input
                            type="number"
                            min={0}
                            value={klineDecayWindowDays}
                            onChange={(e) =>
                              setKlineDecayWindowDays(parseInt(e.target.value, 10) || 0)
                            }
                            className={`w-full rounded p-1 text-xs border ${isLight ? 'bg-white border-slate-300 text-slate-900' : 'bg-slate-800 border-slate-600'}`}
                          />
                        </div>
                        <div>
                          <div className={`text-[10px] mb-0.5 ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                            距上次遞減:折扣下限(%)
                          </div>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={klineDecayFloorPct}
                            onChange={(e) =>
                              setKlineDecayFloorPct(parseFloat(e.target.value) || 0)
                            }
                            className={`w-full rounded p-1 text-xs border ${isLight ? 'bg-white border-slate-300 text-slate-900' : 'bg-slate-800 border-slate-600'}`}
                          />
                        </div>
                      </div>
                      <label className={`flex items-center gap-2 cursor-pointer text-[11px] ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>
                        <input
                          type="checkbox"
                          checked={klineChopEnabled}
                          onChange={() => setKlineChopEnabled((v) => !v)}
                        />
                        啟用盤整偵測(避開情境二)
                      </label>
                      {klineChopEnabled && (
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <div className={`text-[10px] mb-0.5 ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                              盤整判斷視窗(交易日)
                            </div>
                            <input
                              type="number"
                              min={1}
                              value={klineChopWindowDays}
                              onChange={(e) =>
                                setKlineChopWindowDays(parseInt(e.target.value, 10) || 1)
                              }
                              className={`w-full rounded p-1 text-xs border ${isLight ? 'bg-white border-slate-300 text-slate-900' : 'bg-slate-800 border-slate-600'}`}
                            />
                          </div>
                          <div>
                            <div className={`text-[10px] mb-0.5 ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                              盤整閾值(%)
                            </div>
                            <input
                              type="number"
                              min={0}
                              step={0.1}
                              value={klineChopThresholdPct}
                              onChange={(e) =>
                                setKlineChopThresholdPct(parseFloat(e.target.value) || 0)
                              }
                              className={`w-full rounded p-1 text-xs border ${isLight ? 'bg-white border-slate-300 text-slate-900' : 'bg-slate-800 border-slate-600'}`}
                            />
                          </div>
                        </div>
                      )}
                      <label className={`flex items-center gap-2 cursor-pointer text-[11px] ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>
                        <input
                          type="checkbox"
                          checked={klineTotalCapEnabled}
                          onChange={() => setKlineTotalCapEnabled((v) => !v)}
                        />
                        啟用總量保護機制(合計加碼次數上限)
                      </label>
                      {klineTotalCapEnabled && (
                        <div>
                          <div className={`text-[10px] mb-0.5 ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                            所有均線/子模式合計加碼次數上限
                          </div>
                          <input
                            type="number"
                            min={1}
                            value={klineTotalCapCount}
                            onChange={(e) =>
                              setKlineTotalCapCount(parseInt(e.target.value, 10) || 1)
                            }
                            className={`w-full rounded p-1 text-xs border ${isLight ? 'bg-white border-slate-300 text-slate-900' : 'bg-slate-800 border-slate-600'}`}
                          />
                        </div>
                      )}
                      </>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <label className={`text-xs font-bold ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
                    回測投資年限
                  </label>
                  <div className="grid grid-cols-3 gap-1">
                    {['ytd', '3m', '6m', '12m', '2y', '3y', '5y'].map((t) => (
                      <button
                        key={t}
                        onClick={() => setTimeRange(t)}
                        className={`py-2 text-[14px] rounded border font-bold ${
                          timeRange === t
                            ? 'bg-emerald-600 border-emerald-500 text-white'
                            : (isLight ? 'bg-slate-100 border-slate-300 text-slate-500' : 'bg-slate-800 border-slate-600 text-slate-400')
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
                          : t === '2y'
                          ? '近2年'
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
                              : (isLight ? 'bg-slate-100 border-slate-300 text-slate-500' : 'bg-slate-800 border-slate-600 text-slate-400')
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
                        : (isLight ? 'bg-slate-100 border-slate-300 text-slate-500' : 'bg-slate-800 border-slate-600 text-slate-400')
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
                      className={`w-1/2 rounded text-xs p-1 ${isLight ? 'bg-white border border-slate-300 text-slate-900' : 'bg-slate-800 border-slate-600'}`}
                    />
                    <input
                      type="date"
                      value={customEnd}
                      onChange={(e) => {
                        setCustomEnd(e.target.value);
                        setTimeRange('custom');
                      }}
                      className={`w-1/2 rounded text-xs p-1 ${isLight ? 'bg-white border border-slate-300 text-slate-900' : 'bg-slate-800 border-slate-600'}`}
                    />
                  </div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <div className={`flex items-center rounded border overflow-hidden shrink-0 ${isLight ? 'border-slate-300' : 'border-slate-600'}`}>
                      <button
                        type="button"
                        onClick={() => shiftCustomRange(-1, 'day')}
                        title="起始日往前推1天"
                        className={`px-2 py-1 text-xs font-bold ${isLight ? 'bg-slate-100 hover:bg-slate-200 text-slate-600' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'}`}
                      >
                        −
                      </button>
                      <span className={`px-2 py-1 text-[11px] border-x ${isLight ? 'text-slate-500 bg-slate-100 border-slate-300' : 'text-slate-400 bg-slate-900 border-slate-600'}`}>
                        日
                      </span>
                      <button
                        type="button"
                        onClick={() => shiftCustomRange(1, 'day')}
                        title="起始日往後推1天"
                        className={`px-2 py-1 text-xs font-bold ${isLight ? 'bg-slate-100 hover:bg-slate-200 text-slate-600' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'}`}
                      >
                        ＋
                      </button>
                    </div>
                    <div className={`flex items-center rounded border overflow-hidden shrink-0 ${isLight ? 'border-slate-300' : 'border-slate-600'}`}>
                      <button
                        type="button"
                        onClick={() => shiftCustomRange(-1)}
                        title="整段區間往前推1個月"
                        className={`px-2 py-1 text-xs font-bold ${isLight ? 'bg-slate-100 hover:bg-slate-200 text-slate-600' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'}`}
                      >
                        −
                      </button>
                      <span className={`px-2 py-1 text-[11px] border-x ${isLight ? 'text-slate-500 bg-slate-100 border-slate-300' : 'text-slate-400 bg-slate-900 border-slate-600'}`}>
                        月
                      </span>
                      <button
                        type="button"
                        onClick={() => shiftCustomRange(1)}
                        title="整段區間往後推1個月"
                        className={`px-2 py-1 text-xs font-bold ${isLight ? 'bg-slate-100 hover:bg-slate-200 text-slate-600' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'}`}
                      >
                        ＋
                      </button>
                    </div>
                    <div className={`flex items-center rounded border overflow-hidden shrink-0 ${isLight ? 'border-slate-300' : 'border-slate-600'}`}>
                      <button
                        type="button"
                        onClick={() => shiftCustomRange(-3)}
                        title="整段區間往前推1季(3個月)"
                        className={`px-2 py-1 text-xs font-bold ${isLight ? 'bg-slate-100 hover:bg-slate-200 text-slate-600' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'}`}
                      >
                        −
                      </button>
                      <span className={`px-2 py-1 text-[11px] border-x ${isLight ? 'text-slate-500 bg-slate-100 border-slate-300' : 'text-slate-400 bg-slate-900 border-slate-600'}`}>
                        季
                      </span>
                      <button
                        type="button"
                        onClick={() => shiftCustomRange(3)}
                        title="整段區間往後推1季(3個月)"
                        className={`px-2 py-1 text-xs font-bold ${isLight ? 'bg-slate-100 hover:bg-slate-200 text-slate-600' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'}`}
                      >
                        ＋
                      </button>
                    </div>
                  </div>
                  <div
                    className={`mt-1.5 text-[13px] font-mono text-center rounded py-1 border ${
                      isLight
                        ? 'text-emerald-600 bg-slate-100 border-slate-300'
                        : 'text-emerald-400 bg-slate-900/60 border-slate-700'
                    }`}
                  >
                    {formatDateForDisplay(customStart)} ～{' '}
                    {formatDateForDisplay(customEnd)}
                  </div>
                </div>
              </div>

              <div className="lg:col-span-6 min-w-0 space-y-3">
                <div
                  className={`flex flex-wrap items-center gap-2 mb-4 p-2 rounded-lg border ${
                    isLight ? 'bg-slate-100 border-slate-300' : 'bg-slate-800/50 border-slate-700/50'
                  }`}
                >
                  <span className={`text-xs font-bold mr-2 ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
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
                    className={`text-xs px-3 py-1.5 rounded-md transition-colors border flex items-center gap-1 font-bold ${
                      isLight
                        ? 'bg-amber-50 hover:bg-amber-600 hover:text-white text-amber-700 border-amber-300 hover:border-amber-500'
                        : 'bg-amber-900/30 hover:bg-amber-600 hover:text-white text-amber-300 border-amber-700/60 hover:border-amber-500'
                    }`}
                  >
                    <Star className="w-3.5 h-3.5" /> 我的常用標的
                  </button>
                  <button
                    onClick={handleSaveMyPreset}
                    title="將目前輸入的標的組合儲存為「我的常用標的」"
                    className={`text-xs px-2 py-1.5 rounded-md transition-colors border flex items-center gap-1 ${
                      isLight
                        ? 'bg-slate-200 hover:bg-slate-300 text-slate-700 border-slate-300'
                        : 'bg-slate-700 hover:bg-slate-600 text-slate-300 border-slate-600'
                    }`}
                  >
                    <Save className="w-3.5 h-3.5" /> 設為常用
                  </button>
                  {PRESETS.map((preset, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleApplyPreset(preset.stocks)}
                      className={`text-xs px-3 py-1.5 rounded-md transition-colors border hover:bg-emerald-600 hover:text-white hover:border-emerald-500 ${
                        isLight
                          ? 'bg-slate-200 text-slate-700 border-slate-300'
                          : 'bg-slate-700 text-slate-300 border-slate-600'
                      }`}
                    >
                      {preset.name}
                    </button>
                  ))}
                  <button
                    onClick={() => handleApplyPreset(['', '', '', '', '', ''])}
                    className={`text-xs px-3 py-1.5 rounded-md transition-colors border hover:bg-rose-600 hover:text-white ml-auto ${
                      isLight
                        ? 'bg-rose-50 text-rose-600 border-rose-300 hover:border-rose-500'
                        : 'bg-rose-900/40 text-rose-300 border-rose-800 hover:border-rose-500'
                    }`}
                  >
                    全部清空
                  </button>
                </div>

                <div className="flex justify-between items-end mb-1">
                  <label className={`text-xs font-bold ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
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
                          className={`shrink-0 ${isLight ? 'text-slate-400 hover:text-black' : 'text-slate-500 hover:text-white'}`}
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
                            className={`w-full rounded-md py-1.5 pl-2 pr-2 text-sm font-mono uppercase border ${
                              isLight
                                ? 'bg-white border-slate-300 text-slate-900'
                                : 'bg-slate-800 border-slate-600 text-white'
                            }`}
                          />
                          {stockNames[val] && (
                            <div
                              className={`absolute left-0 -bottom-4 text-[13px] whitespace-nowrap overflow-hidden text-ellipsis w-full ${
                                isLight ? 'text-slate-500' : 'text-slate-400'
                              }`}
                            >
                              {stockNames[val]}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* 排名表區塊的捲動錨點,見上方 rankingTableAnchorRef 註解 */}
                <div ref={rankingTableAnchorRef} />

                {anyTopUpEnabled && (
                  <div className={`mt-4 pt-3 border-t ${isLight ? 'border-slate-300' : 'border-slate-700/60'}`}>
                    <div className="flex items-center justify-between mb-1 gap-2">
                      <label className={`text-xs font-bold ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
                        標的組合排名表(含加碼)
                      </label>
                      <button
                        onClick={updateRankingTable}
                        disabled={rankingLoading || !hasSelectedStock}
                        className={`text-xs px-3 py-1.5 rounded-md border transition-colors flex items-center gap-1 shrink-0 disabled:opacity-50 disabled:cursor-not-allowed ${
                          isLight
                            ? 'bg-slate-200 hover:bg-slate-300 disabled:hover:bg-slate-200 text-slate-700 border-slate-300'
                            : 'bg-slate-700 hover:bg-slate-600 disabled:hover:bg-slate-700 text-white border-slate-600'
                        }`}
                      >
                        {rankingLoading ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Table2 className="w-3.5 h-3.5" />
                        )}
                        更新排名表
                      </button>
                    </div>
                    <div className="text-[11px] text-slate-500 leading-relaxed mb-2">
                      套用目前的加碼策略設定(
                      {[
                        monthlyTopUpEnabled && '每月固定日期加碼',
                        klineTopUpEnabled && 'K線穿越均線加碼',
                      ]
                        .filter(Boolean)
                        .join('+')}
                      ,{monthlyTopUpIncludeLumpSum ? '含' : '不含'}
                      最上面的一次性本金),假設每一檔各自固定投入 100 萬計算(不受上方「總投入本金」與勾選標的檔數影響),
                      跟下面純本金的排名表用同一組「更新排名表」按鈕一起更新,不用另外按。
                      這段區間內完全沒有實際加碼買進時顯示「—」。該區間損益金額最高的標的以紅色標示。
                    </div>
                    {rankingError && (
                      <div className={`text-[13px] mb-2 ${isLight ? 'text-rose-600' : 'text-rose-400'}`}>
                        {rankingError}
                      </div>
                    )}
                    {rankingDataTopUp &&
                      renderRankingTable(rankingDataTopUp, { highlightMaxNetProfit: true })}
                  </div>
                )}

                <div className={`mt-4 pt-3 border-t ${isLight ? 'border-slate-300' : 'border-slate-700/60'}`}>
                  <div className="flex items-center justify-between mb-1 gap-2">
                    <label className={`text-xs font-bold ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
                      標的組合排名表
                    </label>
                    {!anyTopUpEnabled && (
                      <button
                        onClick={updateRankingTable}
                        disabled={rankingLoading || !hasSelectedStock}
                        className={`text-xs px-3 py-1.5 rounded-md border transition-colors flex items-center gap-1 shrink-0 disabled:opacity-50 disabled:cursor-not-allowed ${
                          isLight
                            ? 'bg-slate-200 hover:bg-slate-300 disabled:hover:bg-slate-200 text-slate-700 border-slate-300'
                            : 'bg-slate-700 hover:bg-slate-600 disabled:hover:bg-slate-700 text-white border-slate-600'
                        }`}
                      >
                        {rankingLoading ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Table2 className="w-3.5 h-3.5" />
                        )}
                        更新排名表
                      </button>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 leading-relaxed mb-2">
                    列出目前已勾選標的,在「回測投資年限」的 7 個區間及 2 個固定起始日下的含息報酬率排名(1
                    =表現最好,以紅字標示)。只算已勾選的標的、不含加碼{anyTopUpEnabled ? ',跟上面含加碼的排名表用同一組「更新排名表」按鈕一起更新,不用另外按' : ''}
                    ,只有按下「更新排名表」才會重新抓資料計算,不會隨著「開始回測」或切換回測投資年限自動更新。
                  </div>
                  {!anyTopUpEnabled && rankingError && (
                    <div className={`text-[13px] mb-2 ${isLight ? 'text-rose-600' : 'text-rose-400'}`}>
                      {rankingError}
                    </div>
                  )}
                  {rankingData && renderRankingTable(rankingData)}
                </div>
              </div>

              <div className="lg:col-span-2 min-w-0 mt-4 lg:mt-0">
                <div className="flex flex-col gap-2">
                  <label className={`flex items-center gap-2 cursor-pointer border p-2 rounded-lg transition-colors ${isLight ? 'bg-white border-slate-300 hover:bg-slate-50' : 'bg-slate-800 border-slate-600 hover:bg-slate-700/50'}`}>
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
                    <div className={`text-[14px] sm:text-xs leading-tight ${isLight ? 'text-slate-600' : 'text-slate-300'}`}>
                      <div>依除息日對齊週期</div>
                      <div className={`text-[13px] ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                        獨立計算每檔績效 (近12次)
                      </div>
                    </div>
                  </label>
                  <label className={`flex items-center gap-2 cursor-pointer border p-2 rounded-lg transition-colors ${isLight ? 'bg-white border-slate-300 hover:bg-slate-50' : 'bg-slate-800 border-slate-600 hover:bg-slate-700/50'}`}>
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
                    <div className={`text-[14px] sm:text-xs leading-tight ${isLight ? 'text-slate-600' : 'text-slate-300'}`}>
                      <div>強制固定區間</div>
                      <div className={`text-[13px] ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                        忽略除息對齊 (時間優先)
                      </div>
                    </div>
                  </label>
                  <label className={`flex items-center gap-2 cursor-pointer border p-2 rounded-lg transition-colors ${isLight ? 'bg-white border-slate-300 hover:bg-slate-50' : 'bg-slate-800 border-slate-600 hover:bg-slate-700/50'}`}>
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
                    <div className={`text-[14px] sm:text-xs leading-tight ${isLight ? 'text-slate-600' : 'text-slate-300'}`}>
                      <div>計算β值</div>
                      <div className={`text-[13px] ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                        額外抓取大盤指數比對,較耗時 (預設關閉)
                      </div>
                    </div>
                  </label>
                  {independentCycleMode && !strictTimeMode && (
                    <div
                      className={`text-[14px] sm:text-[14.5px] leading-snug rounded-lg p-2 flex items-start gap-1.5 border ${
                        isLight
                          ? 'text-purple-700 bg-purple-50 border-purple-300'
                          : 'text-purple-300 bg-purple-900/20 border-purple-800/50'
                      }`}
                    >
                      <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
                      <span>
                        此模式會以「配息次數最少 / 上市最晚」的標的為基準，用它近
                        12 次除息紀錄反推實際計算區間，
                        <span className={`font-bold ${isLight ? 'text-purple-800' : 'text-purple-200'}`}>
                          可能大幅覆蓋您手動選擇的起訖日期
                        </span>
                        。若想強制使用您指定的日期區間，請改勾選下方「強制固定區間」，或執行後於報告上方用「調整日期」手動校正。
                      </span>
                    </div>
                  )}
                  {!independentCycleMode && !strictTimeMode && (
                    <div
                      className={`text-[14px] sm:text-[14.5px] leading-snug rounded-lg p-2 flex items-start gap-1.5 border ${
                        isLight
                          ? 'text-slate-500 bg-slate-100 border-slate-300'
                          : 'text-slate-500 bg-slate-800/60 border-slate-700'
                      }`}
                    >
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
                isLight
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
                      : timeRange === '2y'
                      ? '近2年'
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
                        {comparisonInfo.dataStaleLimiter && (
                          <span
                            className="text-amber-500 ml-1"
                            title={`${comparisonInfo.dataStaleLimiter.symbols.join('、')} 的股價資料目前只更新到 ${comparisonInfo.dataStaleLimiter.lastDate},其餘標的的截止日因此被限制到同一天,才能公平比較`}
                          >
                            (截止日由 {comparisonInfo.dataStaleLimiter.symbols.join('、')} 資料只更新到{' '}
                            {comparisonInfo.dataStaleLimiter.lastDate} 限制)
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
                    className={`flex-1 sm:flex-none text-xs px-3 py-2 rounded flex justify-center items-center gap-1.5 ${
                      isLight
                        ? 'bg-slate-200 hover:bg-slate-300 text-slate-700'
                        : 'bg-slate-700 hover:bg-slate-600 text-white'
                    }`}
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
                    isLight ? 'border-gray-200' : 'border-slate-700'
                  }`}
                >
                  <span className={`font-bold ${textClass.sub}`}>
                    手動校正實際計算區間:
                  </span>
                  <input
                    type="date"
                    value={adjustStart}
                    onChange={(e) => setAdjustStart(e.target.value)}
                    className={`rounded px-2 py-1 border ${isLight ? 'bg-white border-slate-300 text-slate-900' : 'bg-slate-800 border-slate-600 text-white'}`}
                  />
                  <span className={textClass.sub}>~</span>
                  <input
                    type="date"
                    value={adjustEnd}
                    onChange={(e) => setAdjustEnd(e.target.value)}
                    className={`rounded px-2 py-1 border ${isLight ? 'bg-white border-slate-300 text-slate-900' : 'bg-slate-800 border-slate-600 text-white'}`}
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
                    className={`px-2 ${isLight ? 'text-slate-500 hover:text-slate-700' : 'text-slate-500 hover:text-slate-300'}`}
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
          <div
            className={`p-4 rounded-xl border flex items-center gap-2 no-print ${
              isLight ? 'bg-rose-50 text-rose-700 border-rose-300' : 'bg-rose-900/30 text-rose-300 border-rose-800'
            }`}
          >
            <AlertTriangle className="w-5 h-5" /> {errorMsg}
          </div>
        )}
        {dateAdjustmentNote && results && (
          <div
            className={`p-4 rounded-xl border flex items-start gap-2 no-print text-sm ${
              isLight ? 'bg-blue-50 text-blue-700 border-blue-300' : 'bg-blue-900/30 text-blue-300 border-blue-800'
            }`}
          >
            <Info className="w-5 h-5 mt-0.5 shrink-0" />
            <div>
              <span className="font-bold">
                系統已自動調整日期(避開週末/國定假日):
              </span>
              <div className={`mt-0.5 space-y-0.5 ${isLight ? 'text-blue-600' : 'text-blue-300/90'}`}>
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
          <div
            className={`p-4 rounded-xl border flex flex-col gap-2 no-print ${
              isLight ? 'bg-amber-50 text-amber-700 border-amber-300' : 'bg-amber-900/30 text-amber-300 border-amber-800'
            }`}
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" />
              <span className="font-bold">
                部分標的無法取得歷史資料，已自動排除：{failedTickers.join(', ')}
              </span>
            </div>
            <div className={`text-xs ml-7 space-y-1 ${isLight ? 'text-amber-600' : 'text-amber-400/80'}`}>
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
          <div
            className={`min-h-[55vh] sm:h-64 flex flex-col items-center justify-center border-2 border-dashed rounded-xl no-print m-4 gap-2 ${
              isLight ? 'text-slate-500 border-slate-300' : 'text-slate-600 border-slate-800'
            }`}
          >
            <CloudLightning className="w-12 h-12 mb-2 opacity-30" />
            <p>設定上方投資組合後，點擊「開始回測」</p>
            <p className={`sm:hidden text-xs ${isLight ? 'text-slate-500' : 'text-slate-700'}`}>
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
                  <span
                    className={`text-xs px-2 py-0.5 rounded border ${
                      isLight
                        ? 'text-purple-700 bg-purple-50 border-purple-300'
                        : 'text-purple-400 bg-purple-900/20 border-purple-800/50'
                    }`}
                  >
                    {cycleInfoText}
                  </span>
                )}
                {comparisonInfo?.limitingStock && !strictTimeMode && comparisonInfo?.mode !== 'cycle' && (
                  <span
                    className={`text-xs px-2 py-0.5 rounded border flex items-center gap-1 ${
                      isLight
                        ? 'text-amber-700 bg-amber-50 border-amber-300'
                        : 'text-amber-400 bg-amber-900/20 border-amber-800/50'
                    }`}
                  >
                    <Info className="w-3 h-3" />
                    起始日由 {comparisonInfo.limitingStock} 資料起始較晚限制
                  </span>
                )}
                {comparisonInfo?.endDateLimiter && !strictTimeMode && (
                  <span
                    className={`text-xs px-2 py-0.5 rounded border flex items-center gap-1 ${
                      isLight
                        ? 'text-amber-700 bg-amber-50 border-amber-300'
                        : 'text-amber-400 bg-amber-900/20 border-amber-800/50'
                    }`}
                  >
                    <Info className="w-3 h-3" />
                    截止日由 {comparisonInfo.endDateLimiter} 近期除息限制
                  </span>
                )}
                {comparisonInfo?.dataStaleLimiter && (
                  <span
                    className={`text-xs px-2 py-0.5 rounded border flex items-center gap-1 ${
                      isLight
                        ? 'text-amber-700 bg-amber-50 border-amber-300'
                        : 'text-amber-400 bg-amber-900/20 border-amber-800/50'
                    }`}
                    title={`${comparisonInfo.dataStaleLimiter.symbols.join('、')} 的股價資料目前只更新到 ${comparisonInfo.dataStaleLimiter.lastDate}`}
                  >
                    <Info className="w-3 h-3" />
                    截止日由 {comparisonInfo.dataStaleLimiter.symbols.join('、')} 資料只更新到{' '}
                    {comparisonInfo.dataStaleLimiter.lastDate} 限制
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

            <div
              className={`p-3 sm:p-4 rounded-2xl shadow-xl flex flex-wrap items-center gap-x-5 gap-y-2 animate-in fade-in slide-in-from-bottom-4 print-grid ${cardClass}`}
            >
              <div className="flex items-baseline gap-1.5">
                <span className={`text-[14px] ${textClass.sub}`}>
                  期末資產總值(含息)
                </span>
                <span className={`font-mono font-bold text-base sm:text-lg ${textClass.main}`}>
                  $
                  {Math.round(
                    portfolioSummary.grandTotalValue
                  ).toLocaleString()}
                </span>
              </div>
              <div className={`hidden sm:block w-px h-5 ${isLight ? 'bg-slate-300' : 'bg-slate-700'}`} />
              <div className="flex items-baseline gap-1.5">
                <span className={`text-[14px] ${textClass.sub}`}>總投入本金</span>
                <span className={`font-mono font-bold text-base sm:text-lg ${textClass.main}`}>
                  $
                  {Math.round(
                    portfolioSummary.totalInvested
                  ).toLocaleString()}
                </span>
              </div>
              <div className={`hidden sm:block w-px h-5 ${isLight ? 'bg-slate-300' : 'bg-slate-700'}`} />
              <div className="flex items-baseline gap-1.5">
                <span className={`text-[14px] ${textClass.blue}`}>資本利得(價差)</span>
                <span className={`font-mono font-bold text-base sm:text-lg ${textClass.blue}`}>
                  $
                  {Math.round(
                    portfolioSummary.grandTotalMarketValue -
                      portfolioSummary.totalInvested
                  ).toLocaleString()}
                </span>
              </div>
              <div className={`hidden sm:block w-px h-5 ${isLight ? 'bg-slate-300' : 'bg-slate-700'}`} />
              <div className="flex items-baseline gap-1.5">
                <span className={`text-[14px] ${textClass.highlight}`}>總領股息</span>
                <span className={`font-mono font-bold text-base sm:text-lg ${textClass.highlight}`}>
                  +$
                  {Math.round(
                    portfolioSummary.grandTotalDividends
                  ).toLocaleString()}
                </span>
              </div>
              <div className={`hidden sm:block w-px h-5 ${isLight ? 'bg-slate-300' : 'bg-slate-700'}`} />
              <div className="flex items-baseline gap-1.5 sm:ml-auto">
                <span className={`text-[14px] ${textClass.sub}`}>組合總報酬率</span>
                <span
                  className={`font-mono font-bold text-base sm:text-lg ${
                    portfolioSummary.grandTotalRoi >= 0
                      ? textClass.highlight
                      : textClass.warn
                  }`}
                >
                  {portfolioSummary.grandTotalRoi > 0 ? '+' : ''}
                  {portfolioSummary.grandTotalRoi.toFixed(1)}%
                </span>
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
                            isLight
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
                                <span className={`text-xs font-normal ml-1 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
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
                              isLight
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
                                  <span className={`text-xs font-normal ml-1 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                                    {item.stockName}
                                  </span>
                                )}
                              </div>
                              <div className="flex gap-1 flex-wrap">
                                {(item.isShortHistory || item.isYoungStock) && (
                                  <span
                                    className={`text-[14px] px-1.5 py-0.5 rounded border flex items-center gap-1 ${
                                      isLight
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
                                      isLight
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
                                    colorClass = isLight
                                      ? 'text-teal-700 border-teal-200 bg-teal-50'
                                      : 'text-teal-400 border-teal-900/50 bg-teal-900/20';
                                  } else if (ev.status === 'already_adjusted') {
                                    text = `${ev.date} ${typeLabel} ${ratioLabel} (資料已調整)`;
                                    title = `${ev.label}\n${ev.date} 恢復買賣\n分割前收盤 ${ev.priceBefore} 元 → 分割後參考價 ${ev.priceAfter} 元\n資料源已經回溯調整過歷史股價，未再重複處理。`;
                                    colorClass = isLight
                                      ? 'text-slate-600 border-slate-300 bg-slate-100'
                                      : 'text-slate-400 border-slate-600 bg-slate-800';
                                  } else {
                                    text = `${ev.date} 疑似${typeLabel} (未校正)`;
                                    title = `${ev.label}\n${ev.date} 恢復買賣\n分割前收盤 ${ev.priceBefore} 元 → 分割後參考價 ${ev.priceAfter} 元\n實際資料價位與這兩個參考值都對不上，無法自動判斷是否已調整，故未自動校正，建議自行確認。`;
                                    colorClass = isLight
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
                                      isLight
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
                                      isLight
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
                                      isLight
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
                              {item.feeCostAdjustedReturnPct !== undefined && (
                                <div
                                  className={`text-[14px] font-mono ${
                                    item.feeCostAdjustedReturnPct >= 0
                                      ? textClass.warn
                                      : textClass.highlight
                                  }`}
                                  title={`用年化管理費率 ${item.feeRate.toFixed(2)}% 換算逐日累計的管理費成本(約 $${Math.round(item.feeCostAccrued).toLocaleString()}),從含息總報酬再扣一次估算出來的數字,僅供參考。`}
                                >
                                  扣管理費後{' '}
                                  {item.feeCostAdjustedReturnPct > 0 ? '+' : ''}
                                  {item.feeCostAdjustedReturnPct.toFixed(2)}%
                                </div>
                              )}
                              <div
                                className={`text-[14px] font-mono ${
                                  item.finalTotalValue - item.allocatedCapital >= 0
                                    ? textClass.warn
                                    : textClass.highlight
                                }`}
                                title="淨報酬:含配息後的損益金額(期末含息值 - 投入本金)"
                              >
                                淨報酬{' '}
                                {item.finalTotalValue - item.allocatedCapital >= 0
                                  ? '+'
                                  : '-'}
                                $
                                {Math.round(
                                  Math.abs(
                                    item.finalTotalValue - item.allocatedCapital
                                  )
                                ).toLocaleString()}
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
                                  isLight
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
                            <div className={`space-y-1 sm:border-l sm:pl-2 ${isLight ? 'border-slate-300' : 'border-slate-700/50'}`}>
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
                                  isLight
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
                            <div className={`space-y-1 sm:border-l sm:pl-2 border-t sm:border-t-0 pt-2 sm:pt-0 ${isLight ? 'border-slate-300' : 'border-slate-700/50'}`}>
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
                              {item.feeRate !== undefined && (
                                <div
                                  className={`flex justify-between border-t border-dashed pt-1 mt-1 ${
                                    isLight
                                      ? 'border-gray-300'
                                      : 'border-slate-600/50'
                                  }`}
                                >
                                  <span
                                    className={textClass.sub}
                                    title="這檔 ETF 公開揭露的年化內扣管理費率(經理費+保管費)。右上角「扣管理費後」的含息報酬,是把這個費率換算成逐日累計的管理費成本金額,從期末含息總值裡再扣一次估算出來的。"
                                  >
                                    管理費(年化)
                                  </span>
                                  <span className="font-mono text-fuchsia-500/70">
                                    {item.feeRate.toFixed(2)}%
                                  </span>
                                </div>
                              )}
                            </div>
                            <div className={`space-y-0.5 sm:border-l sm:pl-2 border-t sm:border-t-0 pt-2 sm:pt-0 flex flex-col justify-center ${isLight ? 'border-slate-300' : 'border-slate-700/50'}`}>
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
                              isLight
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
                                  isLight
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
                              <div className={`mt-2 pt-1 border-t ${isLight ? 'border-slate-200' : 'border-slate-700/30'}`}>
                                <details
                                  className="group"
                                  open={independentCycleMode}
                                >
                                  <summary className={`text-[15px] cursor-pointer flex items-center gap-1 mb-1 ${isLight ? 'text-slate-500 hover:text-slate-700' : 'text-slate-500 hover:text-slate-300'}`}>
                                    <Table2 className="w-3 h-3" /> 近{' '}
                                    {item.dividendDetails.length} 次配息明細
                                  </summary>
                                  <div
                                    className={`mt-1 overflow-x-auto rounded border ${
                                      isLight
                                        ? 'border-gray-200'
                                        : 'border-slate-700/50'
                                    }`}
                                  >
                                    <table className="w-full text-[16px] leading-normal text-left">
                                      <thead
                                        className={`${
                                          isLight
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
                                          isLight
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
                                                : isLight
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
                                              className={`py-2 px-1 text-[14px] text-center italic ${isLight ? 'text-slate-500 bg-slate-100' : 'text-slate-500 bg-slate-800/50'}`}
                                            >
                                              <Info className="w-2 h-2 inline mr-0.5" />{' '}
                                              ⚠️ 本次除息不計入
                                              (為求公平，區間截止於除息前一日)
                                            </td>
                                          </tr>
                                        )}
                                        <tr
                                          className={`font-bold ${
                                            isLight
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
                            <div className={`mt-2 pt-1 border-t ${isLight ? 'border-slate-200' : 'border-slate-700/30'}`}>
                              <details className="group">
                                <summary className={`text-[15px] cursor-pointer flex items-center gap-1 mb-1 ${isLight ? 'text-slate-500 hover:text-slate-700' : 'text-slate-500 hover:text-slate-300'}`}>
                                  <Table2 className="w-3 h-3" /> 共{' '}
                                  {
                                    item.topUpEvents.filter((e) => !e.skipped)
                                      .length
                                  }{' '}
                                  次加碼明細(定期定額 + K線穿越均線)
                                </summary>
                                <div
                                  className={`mt-1 overflow-x-auto rounded border ${
                                    isLight
                                      ? 'border-gray-200'
                                      : 'border-slate-700/50'
                                  }`}
                                >
                                  <table className="w-full text-[16px] leading-normal text-left">
                                    <thead
                                      className={`${
                                        isLight
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
                                          金額
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
                                        isLight
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
                                              : isLight
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
                                              <span className={`text-xs font-normal ml-1 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                                                {e.stockName}
                                              </span>
                                            )}
                                          </td>
                                          <td className={`py-2 ${textClass.sub}`}>
                                            {e.source === 'monthly'
                                              ? '定期定額'
                                              : `K線·${e.lineLabel}·${e.subModeLabel || ''}`}
                                          </td>
                                          <td
                                            className={`py-2 font-mono text-right ${textClass.main}`}
                                          >
                                            {e.price.toFixed(2)}
                                          </td>
                                          {e.skipped ? (
                                            <td
                                              colSpan="3"
                                              className="py-2 pr-2 text-center text-slate-500 italic"
                                            >
                                              {e.skipReason || '未達加碼門檻,未成交'}
                                            </td>
                                          ) : (
                                            <>
                                              <td
                                                className={`py-2 font-mono text-right ${textClass.main}`}
                                              >
                                                {Math.round(e.amount).toLocaleString()}
                                                {e.source === 'kline' &&
                                                  (e.multiplier !== 1 ||
                                                    (e.decayRatio !== undefined &&
                                                      e.decayRatio !== 1)) && (
                                                    <div className="text-[10px] font-normal text-slate-500">
                                                      {e.multiplier?.toFixed(1)}x層級
                                                      {e.decayRatio !== undefined
                                                        ? ` × ${Math.round(e.decayRatio * 100)}%遞減`
                                                        : ''}
                                                    </div>
                                                  )}
                                              </td>
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
                      stroke={isLight ? '#e5e7eb' : '#334155'}
                    />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(s) => s.slice(5)}
                      minTickGap={30}
                      tick={{
                        fill: isLight ? '#333' : '#94a3b8',
                        fontSize: 10,
                      }}
                    />
                    <YAxis
                      tickFormatter={(v) => `${v}%`}
                      tick={{
                        fill: isLight ? '#333' : '#94a3b8',
                        fontSize: 10,
                      }}
                      width={35}
                    />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload || payload.length === 0)
                          return null;
                        // 比照「加碼策略報酬率走勢比較」的規則:依報酬率由高到低排序,
                        // 且股代碼後面加上股名方便辨識,而不是只顯示代碼、照線條原本順序。
                        const sortedPayload = [...payload]
                          .filter((p) => typeof p.value === 'number')
                          .sort((a, b) => b.value - a.value);
                        return (
                          <div
                            style={{
                              backgroundColor: isLight ? '#fff' : '#1e293b',
                              border: isLight
                                ? '1px solid #ccc'
                                : '1px solid #475569',
                              color: isLight ? '#000' : '#f8fafc',
                              borderRadius: '8px',
                              padding: '8px 12px',
                              fontSize: '12px',
                            }}
                          >
                            <div style={{ marginBottom: 4, fontWeight: 'bold' }}>
                              日期: {label}
                            </div>
                            {sortedPayload.map((p) => (
                              <div key={p.dataKey} style={{ color: p.color }}>
                                {Number(p.value).toFixed(2)}%{' '}
                                {p.dataKey === '綜合績效'
                                  ? '綜合績效'
                                  : formatLineLabel(p.dataKey)}
                              </div>
                            ))}
                          </div>
                        );
                      }}
                    />
                    <Legend />
                    <ReferenceLine y={0} stroke="#64748b" />
                    {results.map((r, i) => (
                      <Line
                        key={r.symbol}
                        type="monotone"
                        dataKey={r.symbol}
                        name={formatLineLabel(r.symbol)}
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
                        stroke={isLight ? '#e5e7eb' : '#334155'}
                      />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(s) => s.slice(5)}
                        minTickGap={30}
                        tick={{
                          fill: isLight ? '#333' : '#94a3b8',
                          fontSize: 10,
                        }}
                      />
                      <YAxis
                        tickFormatter={(v) => `${v}%`}
                        tick={{
                          fill: isLight ? '#333' : '#94a3b8',
                          fontSize: 10,
                        }}
                        width={35}
                      />
                      <Tooltip
                        content={({ active, payload, label }) => {
                          if (!active || !payload || payload.length === 0)
                            return null;
                          // 依需求把提示框內容改成「百分比在前、股代號在後」,
                          // 並依百分比由高到低排序,而不是照線條原本的順序顯示。
                          const sortedPayload = [...payload]
                            .filter((p) => typeof p.value === 'number')
                            .sort((a, b) => b.value - a.value);
                          return (
                            <div
                              style={{
                                backgroundColor: isLight ? '#fff' : '#1e293b',
                                border: isLight
                                  ? '1px solid #ccc'
                                  : '1px solid #475569',
                                color: isLight ? '#000' : '#f8fafc',
                                borderRadius: '8px',
                                padding: '8px 12px',
                                fontSize: '12px',
                              }}
                            >
                              <div style={{ marginBottom: 4, fontWeight: 'bold' }}>
                                日期: {label}
                              </div>
                              {sortedPayload.map((p) => (
                                <div key={p.dataKey} style={{ color: p.color }}>
                                  {Number(p.value).toFixed(2)}%{' '}
                                  {p.dataKey === '綜合績效'
                                    ? '綜合績效'
                                    : formatLineLabel(p.dataKey)}
                                </div>
                              ))}
                            </div>
                          );
                        }}
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
                            name={formatLineLabel(r.symbol)}
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
