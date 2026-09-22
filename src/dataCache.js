// 股價/配息資料的抓取與快取模組。
//
// 資料策略(ETF回測比較、定期定額策略最佳化兩個分頁共用):
//   1. 所有計算終點固定為「前一個交易日」，不計算當天資料(見 tradingCalendar.js)。
//   2. 讀取順序:優先讀 localStorage 快取，快取有資料就直接用，完全不打 API。
//   3. 只有該股票代碼從來沒有成功查詢過，才會發出即時抓取，依序嘗試
//      FinMind → 證交所(TWSE)官方資料 → Yahoo Finance 三層備援。
//   4. 快取「永久有效」，不設時效限制、也不因為快取涵蓋的區間不同而失效；
//      第一次成功抓取時就一次抓最近 FETCH_HISTORY_YEARS 年的完整歷史，
//      之後不論回測期間怎麼調整，只要落在這個範圍內都直接從快取切片。
//   5. localStorage 的 key 統一用 `stock_price_<代碼>` 命名，兩個分頁共用同一份資料，
//      彼此都看得到對方已經抓過的標的、不會重複打 API。
import TW_STOCK_NAMES from './data/twStockNames';
import { getLastCompletedTradingDay } from './tradingCalendar';

// --- 基礎網路工具 ---

// 幫所有外部網路請求加上逾時保護:部分 CORS 代理服務故障時不會直接回錯誤，
// 而是整個連線卡住不回應，若不設定逾時，原生 fetch 可能會一路卡到瀏覽器自己的
// 逾時上限(可能長達數十秒到數分鐘),讓使用者感覺整個流程「卡住不動」。
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

// --- 股票名稱查詢 ---

const fetchStockNameFromWeb = async (yahooSymbol) => {
  const pureSymbol = yahooSymbol.split('.')[0];
  if (TW_STOCK_NAMES[pureSymbol]) {
    return TW_STOCK_NAMES[pureSymbol];
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

// 依序試「不含後綴」「.TW」「.TWO」三種代號組合查詢股票名稱。
export const fetchStockDisplayName = async (symbol) => {
  const symbolContainsDot = (s) => s.includes('.');
  const suffixes = ['.TW', '.TWO'];
  let name = await fetchStockNameFromWeb(symbol);
  if (name) return name;

  for (const suffix of suffixes) {
    if (!symbolContainsDot(symbol)) {
      name = await fetchStockNameFromWeb(symbol + suffix);
      if (name) return name;
    }
  }
  return '';
};

// --- Yahoo Finance ---

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
        const highPrice = quotes.high?.[i];
        const lowPrice = quotes.low?.[i];
        data.push({
          date: dateStr,
          timestamp: ts * 1000,
          price: closePrice,
          high: highPrice !== null && highPrice !== undefined ? highPrice : undefined,
          low: lowPrice !== null && lowPrice !== undefined ? lowPrice : undefined,
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

// --- FinMind ---

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

    // FinMind TaiwanStockPrice 欄位用 max/min 代表當天最高/最低價(不是 high/low)。
    const data = priceJson.data.map((p) => {
      const high = p.max;
      const low = p.min;
      return {
        date: p.date,
        timestamp: new Date(p.date).getTime(),
        price: p.close,
        high: typeof high === 'number' && Number.isFinite(high) ? high : undefined,
        low: typeof low === 'number' && Number.isFinite(low) ? low : undefined,
        accumulatedDividend: 0,
      };
    });

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

// --- 證交所(TWSE)官方資料(FinMind 失敗時的第二資料源) ---

// 證交所(TWSE)官方「個股日成交資訊」,作為 FinMind 失敗時的第二資料源:
// 免金鑰、CORS 開放(可直接呼叫、不必透過代理伺服器),但只提供「上市」個股/ETF,
// 且一次只能查一個月,長區間需要逐月分別呼叫再合併。日期欄位是民國年格式,
// 需轉換成西元 YYYY-MM-DD 才能跟其他資料源的格式一致。
const rocDateToISO = (rocDateStr) => {
  const parts = String(rocDateStr).split('/');
  if (parts.length !== 3) return null;
  const year = parseInt(parts[0], 10) + 1911;
  if (!Number.isFinite(year)) return null;
  const mm = parts[1].padStart(2, '0');
  const dd = parts[2].padStart(2, '0');
  return `${year}-${mm}-${dd}`;
};

const fetchTWSEMonth = async (symbol, year, month) => {
  const dateParam = `${year}${String(month).padStart(2, '0')}01`;
  const url = `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${dateParam}&stockNo=${symbol}`;
  try {
    const res = await fetchWithTimeout(url, {}, 10000);
    const json = await res.json();
    if (json.stat !== 'OK' || !Array.isArray(json.data)) return [];
    return json.data
      .map((row) => {
        const dateStr = rocDateToISO(row[0]);
        const close = parseFloat(String(row[6]).replace(/,/g, ''));
        const high = parseFloat(String(row[4]).replace(/,/g, ''));
        const low = parseFloat(String(row[5]).replace(/,/g, ''));
        if (!dateStr || !Number.isFinite(close)) return null;
        return {
          date: dateStr,
          timestamp: new Date(dateStr).getTime(),
          price: close,
          high: Number.isFinite(high) ? high : undefined,
          low: Number.isFinite(low) ? low : undefined,
          accumulatedDividend: 0,
        };
      })
      .filter((r) => r !== null);
  } catch (e) {
    return [];
  }
};

// TWSE 只有股價、沒有除息資訊,所以價格拿到後仍會盡量另外呼叫 FinMind 的
// 除息端點補上除息資料(獨立呼叫、跟股價抓取互不影響);萬一連這個也失敗,
// 就照實際拿到的股價回傳、除息視為 0,並標記 dividendDataIncomplete,
// 讓卡片可以提醒使用者這次的配息資訊可能不完整。
const fetchDividendsFromFinMindOnly = async (symbol, startDate, endDate) => {
  const formatD = (d) => d.toISOString().split('T')[0];
  try {
    const divUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockDividendResult&data_id=${symbol}&start_date=${formatD(
      startDate
    )}&end_date=${formatD(endDate)}`;
    const divRes = await fetchWithTimeout(divUrl, {}, 8000);
    const divJson = await divRes.json();
    if (divJson.msg !== 'success' || !divJson.data) return null;
    const dividendsMap = {};
    const divDates = [];
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
    return { divDates: divDates.sort((a, b) => a - b), dividendsMap };
  } catch (e) {
    return null;
  }
};

// 逐月上限:超長區間逐月呼叫 TWSE 太慢、也可能造成請求量過大,
// 超過這個月數上限就直接放棄這個備援管道、改交給後面的 Yahoo 管道處理。
const TWSE_MAX_MONTHS_LIMIT = 24;

const fetchFromTWSE = async (symbol, startDate, endDate) => {
  const months = [];
  const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const last = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
  while (cursor <= last && months.length <= TWSE_MAX_MONTHS_LIMIT) {
    months.push({ year: cursor.getFullYear(), month: cursor.getMonth() + 1 });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  if (months.length === 0 || months.length > TWSE_MAX_MONTHS_LIMIT) return null;

  const monthResults = await Promise.all(
    months.map((m) => fetchTWSEMonth(symbol, m.year, m.month))
  );
  const data = monthResults
    .flat()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (data.length === 0) return null;

  const divResult = await fetchDividendsFromFinMindOnly(
    symbol,
    startDate,
    endDate
  );

  return {
    symbol,
    data,
    divDates: divResult ? divResult.divDates : [],
    dividendsMap: divResult ? divResult.dividendsMap : {},
    usedSymbol: symbol,
    source: 'TWSE',
    dividendDataIncomplete: !divResult,
  };
};

// --- 即時抓取的完整重試鏈(FinMind → TWSE → Yahoo) ---
// 這裡只負責「抓」，不處理快取存取；快取的讀寫統一交給呼叫端
// (fetchStockPriceData / fetchIndexPriceData)處理，避免同一份資料
// 因為抓取路徑不同而被存成不一致的內容。
const attemptLiveFetch = async (symbol, startDate, endDate) => {
  const symbolContainsDot = (s) => s.includes('.');
  const pureSymbol = symbol.split('.')[0];

  if (!symbolContainsDot(symbol)) {
    const finmindResult = await fetchFromFinMind(
      pureSymbol,
      startDate,
      endDate
    );
    if (finmindResult && finmindResult.data.length > 0) {
      return finmindResult;
    }

    // FinMind 失敗時,先試證交所(TWSE)官方資料源(只有上市個股/ETF才查得到,
    // 上櫃/興櫃代號會查不到、直接落到下面的 Yahoo 管道)。
    const twseResult = await fetchFromTWSE(pureSymbol, startDate, endDate);
    if (twseResult && twseResult.data.length > 0) {
      return twseResult;
    }
  }

  if (symbolContainsDot(symbol)) {
    const dotResult = await fetchWithSuffix(symbol, symbol, startDate, endDate);
    if (dotResult && dotResult.data.length > 0) {
      dotResult.source = 'Yahoo';
      return dotResult;
    }
    return null;
  }

  let targets = [`${pureSymbol}.TW`, `${pureSymbol}.TWO`];
  for (const target of targets) {
    const result = await fetchWithSuffix(pureSymbol, target, startDate, endDate);
    if (result && result.data.length > 0) {
      result.source = 'Yahoo';
      return result;
    }
  }
  return null;
};

// --- 永久快取(cache-first) ---

export const PRICE_CACHE_PREFIX = 'stock_price_';

const cacheKeyFor = (symbol) => `${PRICE_CACHE_PREFIX}${symbol}`;

export const loadPriceCache = (symbol) => {
  try {
    const raw = localStorage.getItem(cacheKeyFor(symbol));
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
};

export const savePriceCache = (symbol, result) => {
  try {
    localStorage.setItem(
      cacheKeyFor(symbol),
      JSON.stringify({
        data: result.data,
        divDates: result.divDates,
        dividendsMap: result.dividendsMap,
        usedSymbol: result.usedSymbol,
        source: result.source || '',
        dividendDataIncomplete: result.dividendDataIncomplete || false,
        cachedAt: new Date().toISOString(),
      })
    );
  } catch (e) {
    // localStorage 不可用或空間不足時安靜忽略,不影響本次計算本身
  }
};

// 抓取歷史股價時的起始錨點:第一次抓某檔代碼時，一次往回抓這麼多年的
// 完整歷史、一次快取到位，之後不管回測起訖日怎麼調整，只要落在這個範圍
// 內都不需要再打 API。20 年已足夠涵蓋絕大多數實際會用到的回測區間；
// 若之後真的需要抓更早的歷史，可以調整這個常數。
const FETCH_HISTORY_YEARS = 20;

const getFetchAnchorStartDate = () => {
  const end = getLastCompletedTradingDay();
  const start = new Date(end);
  start.setFullYear(start.getFullYear() - FETCH_HISTORY_YEARS);
  return start;
};

// 舊版程式抓的快取只有收盤價,沒有當天最高/最低價(K線穿越均線判斷需要這兩個
// 欄位)。用這個判斷「這份快取是不是舊格式」,只要有任何一天缺 high 或 low
// 就視為不完整,整檔重新即時抓取以補齊(不是逐天補,因為三層資料源都是整段
// 歷史一起回傳,重抓一次最省事也最不會欄位對不齊)。
const priceCacheMissingHighLow = (data) =>
  !Array.isArray(data) ||
  data.length === 0 ||
  data.some((d) => typeof d.high !== 'number' || typeof d.low !== 'number');

// 股價/配息資料的對外主要入口:cache-first。
// 只要 localStorage 已經有這檔代碼的快取(不論是多久以前存的)且格式完整,
// 就直接回傳、完全不打 API;「這檔代碼從來沒有成功查詢過」或「快取是舊格式
// 缺高低價」都會發出即時抓取(FinMind → TWSE → Yahoo 三層備援),一次抓最近
// FETCH_HISTORY_YEARS 年的完整歷史,抓到後永久存快取(覆蓋舊格式快取)。
export const fetchStockPriceData = async (symbol) => {
  const cached = loadPriceCache(symbol);
  if (cached && cached.data && cached.data.length > 0 && !priceCacheMissingHighLow(cached.data)) {
    return {
      symbol,
      data: cached.data,
      divDates: cached.divDates || [],
      dividendsMap: cached.dividendsMap || {},
      usedSymbol: cached.usedSymbol || symbol,
      source: cached.source || '',
      dividendDataIncomplete: cached.dividendDataIncomplete || false,
      fromCache: true,
      cachedAt: cached.cachedAt,
    };
  }

  const startDate = getFetchAnchorStartDate();
  const endDate = getLastCompletedTradingDay();
  const result = await attemptLiveFetch(symbol, startDate, endDate);
  if (result && result.data.length > 0) {
    savePriceCache(symbol, result);
    return { ...result, fromCache: false };
  }
  return null;
};

// 大盤指數(預設為加權指數 ^TWII)走同一套「永久快取、只查一次」邏輯,
// 但指數代號在 FinMind / TWSE 都查不到資料,直接走 Yahoo Finance 這條管道。
export const fetchIndexPriceData = async (symbol = '^TWII') => {
  const cached = loadPriceCache(symbol);
  if (cached && cached.data && cached.data.length > 0) {
    return {
      symbol,
      data: cached.data,
      divDates: cached.divDates || [],
      dividendsMap: cached.dividendsMap || {},
      usedSymbol: cached.usedSymbol || symbol,
      source: cached.source || 'Yahoo',
      fromCache: true,
      cachedAt: cached.cachedAt,
    };
  }
  const startDate = getFetchAnchorStartDate();
  const endDate = getLastCompletedTradingDay();
  const result = await fetchWithSuffix(symbol, symbol, startDate, endDate).catch(
    () => null
  );
  if (result && result.data.length > 0) {
    const withSource = { ...result, source: 'Yahoo' };
    savePriceCache(symbol, withSource);
    return { ...withSource, fromCache: false };
  }
  return null;
};
