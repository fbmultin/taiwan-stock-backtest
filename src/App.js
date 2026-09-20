import React, { useState, useEffect, useMemo, useRef } from 'react';
import TW_STOCK_NAMES from './data/twStockNames';
import TW_STOCK_SPLITS from './data/twStockSplits';
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

// --- 內建常見 ETF 股名清單 ---
const STATIC_STOCK_NAMES = {
  '0050': '元大台灣50',
  '006208': '富邦台50',
  '006203': '元大MSCI台灣',
  '0057': '富邦摩台',
  '006204': '永豐臺灣加權',
  '0056': '元大高股息',
  '00878': '國泰永續高股息',
  '00929': '復華台灣科技優息',
  '00919': '群益台灣精選高息',
  '00940': '元大台灣價值高息',
  '00939': '統一台灣高息動能',
  '00713': '元大台灣高息低波',
  '00900': '富邦特選高股息30',
  '00915': '凱基優選高股息30',
  '00918': '大華優利高填息30',
  '00934': '中信成長高股息',
  '00936': '台新永續高息中小',
  '00944': '野村趨勢動能高息',
  '00946': '群益科技高息成長',
  '00891': '中信關鍵半導體',
  '00892': '富邦台灣半導體',
  '00881': '國泰台灣5G+',
  '00935': '野村臺灣新科技50',
  '00757': '統一FANG+',
  '00830': '國泰費城半導體',
  '00904': '新光臺灣半導體30',
  '00903': '富邦元宇宙',
  '00876': '元大未來關鍵科技',
  '00941': '中信上游半導體',
  '00949': '復華日本龍頭',
  '00951': '台新日本半導體',
  '00952': '凱基台灣AI50',
  '00991A': '主動復華未來50',
  '00981A': '主動統一台股增長',
  '00982A': '主動群益台灣強棒',
  '00980A': '主動野村臺灣優選',
  '00984A': '主動安聯台灣高息',
  '00985A': '主動野村台灣50',
  '00988A': '主動統一全球創新',
  '009805': '新光美國電力基建',
  '00662': '富邦NASDAQ',
  '00924': '復華S&P500成長',
  '009813': '貝萊德標普卓越50',
  '009815': '大華美國MAG7+',
  '00981T': '平衡凱基雙核收息',
  '00679B': '元大美債20年',
  '00687B': '國泰20年美債',
  '00937B': '群益ESG投等債20+',
  '00933B': '國泰10Y+金融債',
  '00945B': '凱基美國非投等債',
  '00953B': '群益優選非投等債',
  '00720B': '元大投資級公司債',
  '00725B': '國泰投資級公司債',
  '00740B': '富邦全球投等債',
  '00772B': '中信高評級公司債',
  '00751B': '元大AAA至A公司債',
  '00981B': '第一金優選非投債',
  '00696B': '富邦美債20年',
  '00694B': '富邦美債1-3',
  '00632R': '元大台灣50反1',
  '00631L': '元大台灣50正2',
};

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

// --- 台灣證券交易所國定假日 / 休市日 ---
// 整理自 TWSE 公告與財經媒體彙整的開休市日期表 (2025-2027)。
// 2027 年之後遇到跨年份時，農曆假期等浮動假日需每年底依官方公告更新。
// 週末已由 isWeekend 另行判斷，此表僅需列出「非週末」的休市日即可，
// 但為求對照方便，仍將部分本身為週末的假日一併列出（不影響判斷結果）。
const TW_MARKET_HOLIDAYS = {
  // 2025（民國114年）
  '2025-01-01': '元旦',
  '2025-01-23': '春節調整假',
  '2025-01-24': '春節調整假',
  '2025-01-27': '春節',
  '2025-01-28': '除夕',
  '2025-01-29': '春節初一',
  '2025-01-30': '春節初二',
  '2025-01-31': '春節初三',
  '2025-02-28': '和平紀念日',
  '2025-04-03': '兒童節補假',
  '2025-04-04': '清明節',
  '2025-05-01': '勞動節',
  '2025-05-30': '端午節',
  '2025-09-29': '教師節補假',
  '2025-10-06': '中秋節',
  '2025-10-10': '國慶日',
  '2025-10-24': '台灣光復節補假',
  '2025-12-25': '行憲紀念日',
  // 2026（民國115年）
  '2026-01-01': '元旦',
  '2026-02-12': '春節調整假',
  '2026-02-13': '春節調整假',
  '2026-02-16': '除夕前一日',
  '2026-02-17': '除夕',
  '2026-02-18': '春節初一',
  '2026-02-19': '春節初二',
  '2026-02-20': '春節初三',
  '2026-02-27': '和平紀念日補假',
  '2026-04-03': '兒童節補假',
  '2026-04-05': '民族掃墓節',
  '2026-04-06': '民族掃墓節補假',
  '2026-05-01': '勞動節',
  '2026-06-19': '端午節',
  '2026-09-25': '中秋節',
  '2026-09-28': '教師節',
  '2026-10-09': '國慶日補假',
  '2026-10-26': '台灣光復節補假',
  '2026-12-25': '行憲紀念日',
  // 2027（民國116年，暫為推估值，請於官方公告後校正）
  '2027-01-01': '元旦',
  '2027-02-02': '春節調整假',
  '2027-02-03': '春節調整假',
  '2027-02-04': '春節',
  '2027-02-05': '除夕',
  '2027-02-08': '春節初一',
  '2027-02-09': '春節初二',
  '2027-02-10': '春節初三',
  '2027-03-01': '和平紀念日補假',
  '2027-04-05': '清明節',
  '2027-04-06': '兒童節補假',
  '2027-04-30': '勞動節補假',
  '2027-06-09': '端午節',
  '2027-09-15': '中秋節',
  '2027-09-28': '教師節',
  '2027-10-11': '國慶日補假',
  '2027-10-25': '台灣光復節',
  '2027-12-24': '行憲紀念日補假',
};

const isWeekend = (date) => date.getDay() === 0 || date.getDay() === 6;

const isTaiwanMarketHoliday = (date) => {
  const dateStr = date.toISOString().split('T')[0];
  return Boolean(TW_MARKET_HOLIDAYS[dateStr]);
};

// 非交易日 = 週末 或 台股國定假日/休市日
const isNonTradingDay = (date) => isWeekend(date) || isTaiwanMarketHoliday(date);

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

// 幫所有外部網路請求加上逾時保護:部分 CORS 代理服務故障時不會直接回錯誤，
// 而是整個連線卡住不回應，若不設定逾時，原生 fetch 可能會一路卡到瀏覽器自己的
// 逾時上限(可能長達數十秒到數分鐘),讓使用者感覺整個回測「卡住不動」。
// 這裡統一用 AbortController 幫每一次嘗試設一個較短的上限,逾時就自動放棄、
// 換下一個代理或資料源,而不是無止盡等待。
const fetchWithTimeout = (url, options = {}, timeoutMs = 7000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
};

const fetchProxy = async (url) => {
  const proxies = [
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
    (u) => `https://thingproxy.freeboard.io/fetch/${encodeURIComponent(u)}`,
    (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  ];

  for (const proxyGen of proxies) {
    try {
      const response = await fetchWithTimeout(proxyGen(url), {
        cache: 'no-store',
      });
      if (!response.ok) continue;

      const text = await response.text();
      if (text.includes('<html') || text.includes('Are you a human')) continue;

      try {
        const parsed = JSON.parse(text);
        if (parsed.contents) {
          return typeof parsed.contents === 'string'
            ? JSON.parse(parsed.contents)
            : parsed.contents;
        }
        return parsed;
      } catch {
        continue;
      }
    } catch (e) {
      continue;
    }
  }
  return null;
};

const fetchStockName = async (yahooSymbol) => {
  const pureSymbol = yahooSymbol.split('.')[0];
  if (STATIC_STOCK_NAMES[pureSymbol]) {
    return STATIC_STOCK_NAMES[pureSymbol];
  }

  const url = `https://tw.stock.yahoo.com/quote/${pureSymbol}`;
  const proxies = [
    (u) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
    (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  ];

  for (const proxyGen of proxies) {
    try {
      const response = await fetchWithTimeout(proxyGen(url));
      if (!response.ok) continue;
      const data = await response.json();
      const html = data.contents || (typeof data === 'string' ? data : '');

      if (html) {
        const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
        if (titleMatch && titleMatch[1]) {
          return titleMatch[1].trim();
        }
        const pageTitleMatch = html.match(/<title>([^<]+)<\/title>/);
        if (pageTitleMatch && pageTitleMatch[1]) {
          const titleText = pageTitleMatch[1];
          const splitText = titleText.split('(');
          if (splitText.length > 0) return splitText[0].trim();
        }
      }
    } catch (e) {
      continue;
    }
  }

  const symbolContainsDot = (s) => s.includes('.');
  const yahooSymbolForApi = symbolContainsDot(yahooSymbol)
    ? yahooSymbol
    : yahooSymbol + '.TW';
  const baseUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${yahooSymbolForApi}`;
  const json = await fetchProxy(baseUrl);
  try {
    const quoteResponse =
      json?.quoteResponse ||
      (json?.contents && JSON.parse(json.contents)?.quoteResponse);
    if (quoteResponse?.result?.[0]) {
      const res = quoteResponse.result[0];
      const name = res.longName || res.shortName || '';
      return String(name);
    }
  } catch (e) {}
  return '';
};

const getStockNameFromAPI = async (symbol) => {
  const symbolContainsDot = (s) => s.includes('.');
  const suffixes = ['.TW', '.TWO'];
  let name = await fetchStockName(symbol);
  if (name) return name;

  for (const suffix of suffixes) {
    if (!symbolContainsDot(symbol)) {
      name = await fetchStockName(symbol + suffix);
      if (name) return name;
    }
  }
  return '';
};

const fetchWithSuffix = async (
  originalSymbol,
  yahooSymbol,
  startDate,
  endDate
) => {
  const period1 = Math.floor(startDate.getTime() / 1000);
  const period2 = Math.floor(endDate.getTime() / 1000);

  const urls = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?period1=${period1}&period2=${period2}&interval=1d&events=div`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?period1=${period1}&period2=${period2}&interval=1d&events=div`,
  ];

  for (const baseUrl of urls) {
    const json = await fetchProxy(baseUrl);
    if (!json) continue;

    const result = json.chart?.result?.[0];
    if (!result || json.chart?.error) continue;

    const quotes = result.indicators.quote[0];
    const timestamps = result.timestamp;
    if (!timestamps || timestamps.length === 0) continue;

    const dividends = result.events?.dividends || {};
    const data = [];
    const divDates = Object.keys(dividends)
      .map((ts) => new Date(ts * 1000).getTime())
      .sort((a, b) => a - b);
    for (let i = 0; i < timestamps.length; i++) {
      const ts = timestamps[i];
      const dateStr = new Date(ts * 1000).toISOString().split('T')[0];
      const closePrice = quotes.close[i];
      if (closePrice !== null && closePrice !== undefined) {
        data.push({
          date: dateStr,
          timestamp: ts * 1000,
          price: closePrice,
          accumulatedDividend: 0,
        });
      }
    }
    return {
      symbol: originalSymbol,
      data,
      divDates,
      dividendsMap: dividends,
      usedSymbol: yahooSymbol,
    };
  }
  return null;
};

const fetchQuoteData = async (yahooSymbol) => {
  const baseUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${yahooSymbol}`;
  const json = await fetchProxy(baseUrl);

  const quoteResponse =
    json?.quoteResponse ||
    (json?.contents && JSON.parse(json.contents)?.quoteResponse);
  const result = quoteResponse?.result?.[0];

  if (!result) return null;

  const marketTime = result.regularMarketTime * 1000;
  const price = result.regularMarketPrice;
  const dateStr = new Date(marketTime).toISOString().split('T')[0];

  return { date: dateStr, price, timestamp: marketTime };
};

const fetchFromFinMind = async (symbol, startDate, endDate) => {
  try {
    const formatD = (d) => d.toISOString().split('T')[0];
    const startStr = formatD(startDate);
    const endStr = formatD(endDate);

    const priceUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${symbol}&start_date=${startStr}&end_date=${endStr}`;
    const priceRes = await fetchWithTimeout(priceUrl, {}, 10000);
    const priceJson = await priceRes.json();
    if (
      priceJson.msg !== 'success' ||
      !priceJson.data ||
      priceJson.data.length === 0
    ) {
      return null;
    }

    const divUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockDividendResult&data_id=${symbol}&start_date=${startStr}&end_date=${endStr}`;
    const divRes = await fetchWithTimeout(divUrl, {}, 10000);
    const divJson = await divRes.json();

    const dividendsMap = {};
    const divDates = [];

    if (divJson.msg === 'success' && divJson.data) {
      divJson.data.forEach((d) => {
        const ts = new Date(d.date).getTime();
        const amount =
          d.stock_and_cache_dividend ||
          d.cash_dividend ||
          d.stock_dividend ||
          0;
        if (amount > 0) {
          dividendsMap[ts] = { amount };
          divDates.push(ts);
        }
      });
    }

    const data = priceJson.data.map((p) => ({
      date: p.date,
      timestamp: new Date(p.date).getTime(),
      price: p.close,
      accumulatedDividend: 0,
    }));

    return {
      symbol,
      data,
      divDates: divDates.sort((a, b) => a - b),
      dividendsMap,
      usedSymbol: symbol,
      source: 'FinMind',
    };
  } catch (e) {
    return null;
  }
};

// 資料快取:把最近成功抓到的股價/配息資料存進瀏覽器 localStorage,
// 當即時資料源(FinMind、Yahoo)當下都抓不到某檔標的時,改用上次成功快取的
// 資料當最後備援,讓使用者至少能看到「舊一點但還能用」的結果,而不是直接失敗。
// 每個標的只保留最新一次成功結果(不留歷史多筆版本),並限制最多保留最近用過
// 的 60 檔標的,避免 localStorage 空間被無限占用。
const DATA_CACHE_STORAGE_KEY = 'twBacktestDataCacheV1';
const DATA_CACHE_MAX_SYMBOLS = 60;

const loadDataCache = () => {
  try {
    const raw = localStorage.getItem(DATA_CACHE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
};

const saveToDataCache = (symbol, result) => {
  try {
    const cache = loadDataCache();
    cache[symbol] = {
      data: result.data,
      divDates: result.divDates,
      dividendsMap: result.dividendsMap,
      usedSymbol: result.usedSymbol,
      source: result.source || '',
      cachedAt: new Date().toISOString(),
    };
    const entries = Object.entries(cache).sort(
      (a, b) => new Date(b[1].cachedAt) - new Date(a[1].cachedAt)
    );
    localStorage.setItem(
      DATA_CACHE_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(entries.slice(0, DATA_CACHE_MAX_SYMBOLS)))
    );
  } catch (e) {
    // localStorage 不可用或空間不足時安靜忽略,不影響本次回測本身
  }
};

const useCacheFallback = (symbol) => {
  try {
    const cached = loadDataCache()[symbol];
    if (!cached || !cached.data || cached.data.length === 0) return null;
    return {
      symbol,
      data: cached.data,
      divDates: cached.divDates || [],
      dividendsMap: cached.dividendsMap || {},
      usedSymbol: cached.usedSymbol || symbol,
      source: cached.source || '',
      usedCache: true,
      cachedAt: cached.cachedAt,
    };
  } catch (e) {
    return null;
  }
};

const fetchStockData = async (symbol, startDate, endDate) => {
  const symbolContainsDot = (s) => s.includes('.');
  const pureSymbol = symbol.split('.')[0];

  if (!symbolContainsDot(symbol)) {
    const finmindResult = await fetchFromFinMind(
      pureSymbol,
      startDate,
      endDate
    );
    if (finmindResult && finmindResult.data.length > 0) {
      saveToDataCache(pureSymbol, finmindResult);
      return finmindResult;
    }
  }

  if (symbolContainsDot(symbol)) {
    const dotResult = await fetchWithSuffix(symbol, symbol, startDate, endDate);
    if (dotResult && dotResult.data.length > 0) {
      saveToDataCache(symbol, dotResult);
      return dotResult;
    }
    return useCacheFallback(symbol);
  }

  let targets = [`${pureSymbol}.TW`, `${pureSymbol}.TWO`];
  for (const target of targets) {
    const result = await fetchWithSuffix(
      pureSymbol,
      target,
      startDate,
      endDate
    );
    if (result && result.data.length > 0) {
      result.source = 'Yahoo';
      saveToDataCache(pureSymbol, result);
      return result;
    }
  }
  return useCacheFallback(pureSymbol);
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
    '009805',
    '00981A',
    '00988A',
    '00991A',
    '00935',
    '00904',
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
  const [customEnd, setCustomEnd] = useState('');

  const [totalCapital, setTotalCapital] = useState(5000000);

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
    quote: {
      label: '即時報價查詢',
      consequence:
        '不影響歷史數據，此步驟只是嘗試補上「今天」這一天尚未收盤的最新股價。跳過的標的資料就會停在上一個交易日，其餘歷史資料完整不受影響。',
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
        getStockNameFromAPI(s).then((name) => {
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

    const name = await getStockNameFromAPI(val);
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
    const now = new Date();

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
      rangeEnd = new Date();
      rangeStart = new Date();
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

    // 1. 如果結束日落在非交易日(週末或國定假日),往前推到最近一個交易日
    while (isNonTradingDay(rangeEnd)) {
      rangeEnd.setDate(rangeEnd.getDate() - 1);
    }
    // 2. 如果今天是交易日但盤中(下午 2 點前),也往前推一天
    const todayStr = now.toISOString().split('T')[0];
    const rangeEndStr = rangeEnd.toISOString().split('T')[0];
    if (rangeEndStr === todayStr && now.getHours() < 14) {
      rangeEnd.setDate(rangeEnd.getDate() - 1);
      // 推完再檢查一次是否落在非交易日
      while (isNonTradingDay(rangeEnd)) {
        rangeEnd.setDate(rangeEnd.getDate() - 1);
      }
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

    let fetchStart = new Date();
    fetchStart.setFullYear(fetchStart.getFullYear() - 5);
    if (rangeStart < fetchStart) {
      fetchStart = new Date(rangeStart);
      fetchStart.setMonth(fetchStart.getMonth() - 1);
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
        raceWithSkip(fetchStockData(item.s, fetchStart, rangeEnd)).then(
          ({ value, wasSkipped }) => {
            fetchedCount++;
            updateFetchStatus(
              item.s,
              wasSkipped
                ? 'skipped'
                : value && value.usedCache
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
      const rawResults = await Promise.all(promises);

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
                getStockNameFromAPI(stock.symbol)
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

      const targetEndDate = rangeEnd.toISOString().split('T')[0];
      const isEndingNearToday =
        targetEndDate >= todayStr || now - rangeEnd < 86400000 * 3;
      const allowRealtimeQuote =
        now.getHours() >= 14 || targetEndDate < todayStr;

      // 階段 3:檢查即時報價(補當日尚未收盤的最新價,同樣可被跳過)
      // 只有真的需要補即時價的標的才會顯示為「等待中」,其餘直接標記完成
      setLoadingStage('正在檢查即時報價...');
      setLoadingStagePhase('quote');
      const quoteCandidateSymbols = new Set(
        successfulData
          .filter((stock) => {
            const lastData = stock.data[stock.data.length - 1];
            return (
              isEndingNearToday &&
              allowRealtimeQuote &&
              lastData.date < targetEndDate
            );
          })
          .map((stock) => stock.symbol)
      );
      setFetchStatusList(
        successfulData.map((stock) => ({
          symbol: stock.symbol,
          status: quoteCandidateSymbols.has(stock.symbol) ? 'pending' : 'done',
        }))
      );
      await Promise.all(
        successfulData.map(async (stock) => {
          const lastData = stock.data[stock.data.length - 1];
          if (
            isEndingNearToday &&
            allowRealtimeQuote &&
            lastData.date < targetEndDate
          ) {
            try {
              const { value: quote, wasSkipped } = await raceWithSkip(
                fetchQuoteData(stock.usedSymbol)
              );
              if (quote && quote.date > lastData.date) {
                stock.data.push({
                  date: quote.date,
                  timestamp: quote.timestamp,
                  price: quote.price,
                  accumulatedDividend: 0,
                });
                stock.data.sort((a, b) => a.timestamp - b.timestamp);
              }
              updateFetchStatus(stock.symbol, wasSkipped ? 'skipped' : 'done');
            } catch (e) {
              updateFetchStatus(stock.symbol, 'failed');
            }
          }
        })
      );
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
        // 情況 B:某標的的資料起始日晚於指定的起始日(可能上市較晚,或資料庫尚未收錄更早資料)
        let excludedSymbol = null;
        if (!strictTimeMode) {
          const validStocksForDate = successfulData.filter(
            (s) => s.data.length > 10
          );
          let candidateStart = rangeStart;
          let candidateLimiter = null;
          validStocksForDate.forEach((stock) => {
            const firstDate = new Date(stock.data[0].date);
            if (firstDate > candidateStart) {
              candidateStart = firstDate;
              candidateLimiter = stock.symbol;
            }
          });
          if (validStocksForDate.length === 0 && successfulData.length > 0) {
            candidateStart = new Date(successfulData[0].data[0].date);
            candidateLimiter = successfulData[0].symbol;
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

            if (resolution === 'pushForward') {
              maxMinDate = candidateStart;
              limitingStockSymbol = candidateLimiter;
            } else if (resolution === 'exclude') {
              excludedSymbol = candidateLimiter;
              maxMinDate = rangeStart;
            } else if (resolution === 'keepPartial') {
              maxMinDate = rangeStart;
            } else {
              situations.push({
                key: 'startDateShortHistory',
                title: `${candidateLimiter} 的資料起始日晚於您指定的起始日`,
                description: `${candidateLimiter} 最早的資料是 ${candidateStartStr},晚於您指定的起始日 ${rangeStartStr}(可能是上市較晚,或資料庫尚未收錄更早的資料),要怎麼處理?`,
                options: [
                  {
                    value: 'pushForward',
                    label: `全部標的統一從 ${candidateStartStr} 開始比較`,
                    recommended: true,
                  },
                  {
                    value: 'exclude',
                    label: `排除 ${candidateLimiter},其餘標的維持從 ${rangeStartStr} 開始`,
                  },
                  {
                    value: 'keepPartial',
                    label: `維持 ${rangeStartStr},${candidateLimiter} 從其實際起始日開始比較(各標的起點不同)`,
                  },
                ],
              });
            }
          }
        }
        finalStockList = excludedSymbol
          ? successfulData.map((s) =>
              s.symbol === excludedSymbol
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

      const periods = [3, 6, 12, 36, 60];
      const stats = periods.map((m) =>
        calculatePeriodStats(successfulData, m, finalAllocations, totalCapital)
      );
      setPeriodStats(stats);

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

          const totalReturnVal = finalPrice - initialPrice + periodDividends;
          const totalReturnPct = (totalReturnVal / initialPrice) * 100;
          const priceReturnPct =
            ((finalPrice - initialPrice) / initialPrice) * 100;
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
            dividendDetails.push({
              date: divDateStr,
              prePrice: prePrice,
              exDivPrice: exDivPrice,
              amount: currentDivAmount,
              isFilled: isFilled,
              isExcludedDiv,
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

          const weight = finalAllocations[stock.inputIndex] || 0;

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
            usedCache: !!stock.usedCache,
            cachedAt: stock.cachedAt || null,
          };
        })
        .filter((r) => r !== null);

      const resultsWithValues = finalResults.map((r) => {
        const allocated = totalCapital * (r.weight / 100);
        const shares = allocated / r.initialPrice;
        const finalMarketValue = shares * r.finalPrice;
        const finalStockDividends = shares * r.totalDividends;
        return {
          ...r,
          allocatedCapital: allocated,
          finalMarketValue,
          finalStockDividends,
          finalTotalValue: finalMarketValue + finalStockDividends,
        };
      });

      setResults(resultsWithValues);
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

  return (
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
                    title={f.status === 'cached' ? '即時資料抓取失敗，改用先前快取的資料' : undefined}
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

      {/* 手機版初始設定頁的浮動按鈕:設定項目多、頁面拉很長,提供快速跳到最底部(開始回測按鈕)的捷徑 */}
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
                  {timeRange === 'custom' && (
                    <div className="flex gap-1 mt-1">
                      <input
                        type="date"
                        value={customStart}
                        onChange={(e) => setCustomStart(e.target.value)}
                        className="w-1/2 bg-slate-800 border-slate-600 rounded text-xs p-1"
                      />
                      <input
                        type="date"
                        value={customEnd}
                        onChange={(e) => setCustomEnd(e.target.value)}
                        className="w-1/2 bg-slate-800 border-slate-600 rounded text-xs p-1"
                      />
                    </div>
                  )}
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
                                    title={`即時資料抓取失敗，此檔改用先前暫存的資料${
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
                                <span
                                  className={`text-[14px] px-1.5 py-0.5 rounded border flex items-center gap-1 ${riskColor}`}
                                >
                                  <RiskIcon className="w-3 h-3" />
                                  {riskLabel}
                                </span>
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
                                    <table className="w-full text-[13px] text-left">
                                      <thead
                                        className={`${
                                          printMode
                                            ? 'bg-gray-100'
                                            : 'bg-slate-700/30'
                                        } text-slate-500`}
                                      >
                                        <tr>
                                          <th className="p-1 pl-2">除息日</th>
                                          <th className="p-1">前價</th>
                                          <th className="p-1">配息</th>
                                          <th className="p-1 pr-2 text-right">
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
                                              className={`p-1 pl-2 font-mono ${
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
                                              className={`p-1 font-mono ${textClass.sub}`}
                                            >
                                              {d.prePrice
                                                ? d.prePrice.toFixed(2)
                                                : '-'}
                                            </td>
                                            <td
                                              className={`p-1 font-mono ${
                                                d.isExcludedDiv
                                                  ? ''
                                                  : textClass.highlight
                                              }`}
                                            >
                                              ${d.amount}
                                            </td>
                                            <td
                                              className={`p-1 pr-2 font-mono text-right ${textClass.main}`}
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
                                              colSpan="4"
                                              className="p-1 text-[12.5px] text-center text-slate-500 italic bg-slate-800/50"
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
                                          <td className="p-1 pl-2" colSpan="2">
                                            計入總計
                                          </td>
                                          <td
                                            className={`p-1 ${textClass.highlight}`}
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
                                          <td className="p-1"></td>
                                        </tr>
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

            {periodStats && (
              <div className={`p-6 rounded-xl shadow-lg no-print ${cardClass}`}>
                <h3
                  className={`font-bold mb-4 flex items-center gap-2 ${textClass.sub}`}
                >
                  <Clock className="w-5 h-5 text-purple-400" />
                  資產配置多週期總報酬
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left whitespace-nowrap">
                    <thead
                      className={`border-b ${
                        printMode
                          ? 'bg-gray-100 border-gray-200'
                          : 'bg-slate-900/50 border-slate-700'
                      }`}
                    >
                      <tr>
                        <th className="px-4 py-3">期間</th>
                        <th className="px-4 py-3">起始日期</th>
                        <th className="px-4 py-3 text-right">總報酬率</th>
                      </tr>
                    </thead>
                    <tbody
                      className={`divide-y ${
                        printMode ? 'divide-gray-200' : 'divide-slate-700'
                      }`}
                    >
                      {periodStats.map((stat, i) => {
                        if (!stat) return null;
                        const label =
                          stat.months >= 12
                            ? `${stat.months / 12} 年`
                            : `${stat.months} 個月`;
                        return (
                          <tr
                            key={i}
                            className={`transition-colors ${
                              printMode
                                ? 'hover:bg-gray-50'
                                : 'hover:bg-slate-700/30'
                            }`}
                          >
                            <td
                              className={`px-4 py-3 font-bold ${textClass.main}`}
                            >
                              {label}
                            </td>
                            <td
                              className={`px-4 py-3 font-mono ${textClass.sub}`}
                            >
                              {stat.startDate}{' '}
                              {stat.isPartial && (
                                <span className="text-[14px] opacity-70">
                                  (成立以來)
                                </span>
                              )}
                            </td>
                            <td
                              className={`px-4 py-3 text-right font-mono font-bold ${
                                stat.roi >= 0
                                  ? textClass.warn
                                  : textClass.highlight
                              }`}
                            >
                              {stat.roi > 0 ? '+' : ''}
                              {stat.roi.toFixed(2)}%
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default App;
