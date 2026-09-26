// 股價/配息資料的抓取與快取模組。
//
// 資料策略(ETF回測比較、定期定額策略最佳化兩個分頁共用):
//   1. 所有計算終點固定為「前一個交易日」，不計算當天資料(見 tradingCalendar.js)。
//   2. 讀取順序:優先讀 localStorage 快取；但每次都會檢查快取的最後一筆日期
//      是否已經跟得上目前的「前一個交易日」，跟得上才直接用、完全不打 API。
//   3. 該股票代碼從來沒有成功查詢過、或快取的最後一筆日期比「前一個交易日」
//      還舊(表示已經過了至少一個新的交易日，快取沒有涵蓋到)，都會發出即時
//      抓取，依序嘗試 FinMind → 證交所(TWSE)官方資料 → Yahoo Finance 三層
//      備援，抓到後覆蓋快取。三個來源都失敗時(例如離線、或資料源當天還沒
//      更新)才退回使用現有的舊快取繼續計算，並標記 stale:true，讓呼叫端
//      可以在結果頁提示使用者「資料只更新到某天」，不會又靜默用了過期資料。
//      （這是之前的已知問題：舊版快取一旦存在就永久沿用、完全不管多舊，
//      導致換了新的一天之後，回測抓到的還是好幾天前的舊資料。）
//   4. 快取範圍:第一次成功抓取(或判定需要更新)時，一次抓最近
//      FETCH_HISTORY_YEARS 年的完整歷史，之後不論回測期間怎麼調整，
//      只要落在這個範圍內都直接從快取切片，不用每次都重新請求整段歷史。
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

// 快取格式版本號:每次改版都幫舊快取蓋一個版本戳記,讀取時只要版本對不上
// 就直接當作沒有快取(不是「跟得上最新交易日」的判斷,是更前面一關)。
// 用意是修正「大盤指數改走證交所官方資料」那次以前,使用者瀏覽器裡已經
// 存在的舊快取(可能是透過不穩定 Yahoo 代理抓到、內容本身就有問題的資料)——
// 舊版邏輯只看「日期有沒有跟上」,即使資料內容是錯的也會被當成可用快取,
// 之後每次只補最新幾天的缺口,錯誤的歷史數字永遠不會被重新抓取覆蓋掉,
// 導致β值算出來一直不對,使用者只能自己手動清瀏覽器 localStorage 才能修正。
// 現在改成:只要版本號不符(包含完全沒有這個欄位的舊快取),一律視同沒有
// 快取,強制整檔重新即時抓取一次(走新的、已修正的資料來源管道),抓到後
// 用新版本號重新存檔,之後就正常沿用「只補缺口」的邏輯,不需要使用者自己
// 動手清快取。日後如果又發現快取內容本身有問題,把這個數字再往上加一即可。
const CACHE_SCHEMA_VERSION = 2;

export const loadPriceCache = (symbol) => {
  try {
    const raw = localStorage.getItem(cacheKeyFor(symbol));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.schemaVersion !== CACHE_SCHEMA_VERSION) return null;
    return parsed;
  } catch (e) {
    return null;
  }
};

export const savePriceCache = (symbol, result) => {
  try {
    localStorage.setItem(
      cacheKeyFor(symbol),
      JSON.stringify({
        schemaVersion: CACHE_SCHEMA_VERSION,
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

// 股價/配息資料的對外主要入口:cache-first、但加上「快取是否跟得上最新交易日」
// 的檢查,不是原本那種「快取一旦存在就永久沿用、完全不管多舊」的做法(那樣會
// 導致像 09/18 之後就再也抓不到新資料的問題:同一天內重複執行回測直接吃快取,
// 但只要換了一天、有新的交易日資料,就會嘗試重新即時抓取(FinMind → TWSE →
// Yahoo 三層備援)來補上快取沒有的最新資料,抓到後覆蓋快取;
// 只有在即時抓取三個來源都失敗時(例如離線、或當天資料源都還沒更新),才會
// 退回使用現有的舊快取繼續計算,並標記 stale:true,讓呼叫端可以在結果頁
// 提示使用者「資料只更新到某天」,而不是又靜默用了過期資料。
export const fetchStockPriceData = async (symbol) => {
  const cached = loadPriceCache(symbol);
  const cacheUsable =
    cached && cached.data && cached.data.length > 0 && !priceCacheMissingHighLow(cached.data);
  const lastCompletedTradingDay = getLastCompletedTradingDay();
  const latestNeededDateStr = lastCompletedTradingDay.toISOString().split('T')[0];
  const cacheLastDateStr = cacheUsable
    ? cached.data[cached.data.length - 1].date
    : null;
  const cacheIsFresh = cacheUsable && cacheLastDateStr >= latestNeededDateStr;

  if (cacheIsFresh) {
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
  const endDate = lastCompletedTradingDay;
  const result = await attemptLiveFetch(symbol, startDate, endDate);
  if (result && result.data.length > 0) {
    const newLastDateStr = result.data[result.data.length - 1].date;
    // 避免資料源這次剛好抓到比現有快取還舊/還少的異常結果,反而把好的快取蓋掉。
    if (!cacheUsable || newLastDateStr > cacheLastDateStr) {
      savePriceCache(symbol, result);
      return { ...result, fromCache: false };
    }
  }

  if (cacheUsable) {
    // 即時抓取沒有拿到更新的資料(三個來源都失敗,或抓到的反而更舊),
    // 退回使用現有快取繼續計算,並標記 stale,讓呼叫端知道這不是最新資料。
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
      stale: true,
    };
  }
  return null;
};

// 大盤加權指數(^TWII)官方資料來源:證交所「每日市場成交資訊」(FMTQIK),
// 跟個股用的 STOCK_DAY 同一個 /exchangeReport/ 家族、免金鑰、CORS 開放,
// 不需要透過容易逾時故障的公用代理伺服器(下面 fetchWithSuffix 那條 Yahoo
// 管道就得繞這些代理,常常是整次回測抓資料最慢、也最容易整個失敗的一步——
// 一旦失敗就完全抓不到大盤資料,所有標的的β值都會顯示「資料不足」)。
// 回傳格式跟個股資料相同的 {date, timestamp, price} 陣列,只是指數沒有
// 高低價、也沒有除息,β值計算只需要 date/price 兩個欄位,故不補這兩者。
// 一次全歷史冷抓要對 TWSE 連續發出上百個月份的請求,實際跑在真實使用者的
// 瀏覽器/網路環境下,偶爾會有個別月份逾時或被暫時拒絕(跟乾淨測試環境下
// 100% 成功不同)。單一月份失敗不會拋錯,只會讓那個月「看起來沒有交易日」,
// 但後面 buildDailyReturnsByDate 是用「陣列中相鄰兩筆」而不是「相鄰兩個
// 日曆天」在算報酬率,一旦有整月資料漏抓,前後兩筆實際上差了快一個月,
// 卻會被誤算成「一天」的報酬率,把β值的變異數嚴重灌水、算出離譜偏低的β值。
// 這裡先在來源端加一次重試,盡量把缺口補起來;下面 buildDailyReturnsByDate
// 另外還會擋掉重試後仍然存在的異常大缺口,兩層一起防呆。
const fetchTWSEIndexMonth = async (year, month, attempt = 0) => {
  const dateParam = `${year}${String(month).padStart(2, '0')}01`;
  const url = `https://www.twse.com.tw/exchangeReport/FMTQIK?response=json&date=${dateParam}`;
  try {
    const res = await fetchWithTimeout(url, {}, 10000);
    const json = await res.json();
    if (json.stat !== 'OK' || !Array.isArray(json.data)) {
      if (attempt < 1) {
        await new Promise((resolve) => setTimeout(resolve, 600));
        return fetchTWSEIndexMonth(year, month, attempt + 1);
      }
      return [];
    }
    return json.data
      .map((row) => {
        const dateStr = rocDateToISO(row[0]);
        // 「發行量加權股價指數」欄位(FMTQIK 固定第5欄,index 4)。
        const close = parseFloat(String(row[4]).replace(/,/g, ''));
        if (!dateStr || !Number.isFinite(close)) return null;
        return {
          date: dateStr,
          timestamp: new Date(dateStr).getTime(),
          price: close,
        };
      })
      .filter((r) => r !== null);
  } catch (e) {
    if (attempt < 1) {
      await new Promise((resolve) => setTimeout(resolve, 600));
      return fetchTWSEIndexMonth(year, month, attempt + 1);
    }
    return [];
  }
};

// 一次最多同時對證交所發出這麼多個月的並發請求、分批循序等待,避免一次
// 送出過多並發請求;實際上絕大多數情況(已有快取、只補最近幾天缺口)
// 只會落在第一批就結束,並不會真的跑到很多批。
const TWSE_INDEX_BATCH_MONTHS = 12;

const fetchIndexFromTWSERange = async (startDate, endDate) => {
  const months = [];
  const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const last = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
  while (cursor <= last) {
    months.push({ year: cursor.getFullYear(), month: cursor.getMonth() + 1 });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  if (months.length === 0) return [];

  const merged = [];
  for (let i = 0; i < months.length; i += TWSE_INDEX_BATCH_MONTHS) {
    const batch = months.slice(i, i + TWSE_INDEX_BATCH_MONTHS);
    const batchResults = await Promise.all(
      batch.map((m) => fetchTWSEIndexMonth(m.year, m.month))
    );
    merged.push(...batchResults.flat());
  }
  return merged.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
};

// 大盤指數(預設為加權指數 ^TWII)走同一套「快取但檢查新舊」邏輯(同上
// fetchStockPriceData 的說明),但抓取策略跟個股不同:優先用上面的證交所
// FMTQIK 管道,而且只補抓快取缺少的部分(已有快取時通常只差幾天,幾乎
// 立即完成);只有完全沒有快取(第一次用)或這次 TWSE 抓取失敗時,才退回
// 原本效率較差、也較不穩定的 Yahoo Finance 管道(整段 20 年歷史一次抓)。
export const fetchIndexPriceData = async (symbol = '^TWII') => {
  const cached = loadPriceCache(symbol);
  const cacheUsable = cached && cached.data && cached.data.length > 0;
  const lastCompletedTradingDay = getLastCompletedTradingDay();
  const latestNeededDateStr = lastCompletedTradingDay.toISOString().split('T')[0];
  const cacheLastDateStr = cacheUsable
    ? cached.data[cached.data.length - 1].date
    : null;
  const cacheIsFresh = cacheUsable && cacheLastDateStr >= latestNeededDateStr;

  if (cacheIsFresh) {
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

  const anchorStartDate = getFetchAnchorStartDate();
  const endDate = lastCompletedTradingDay;
  // 已有快取時只補抓快取最後一天之後的缺口;完全沒有快取時才需要抓整段
  // 20 年歷史(逐月分批向 TWSE 要,不受下面 Yahoo 那條路徑的並發限制)。
  const gapStartDate = cacheUsable
    ? new Date(new Date(cacheLastDateStr).getTime() + 24 * 60 * 60 * 1000)
    : anchorStartDate;

  let mergedData = null;
  let usedSource = null;

  if (gapStartDate <= endDate) {
    const twseData = await fetchIndexFromTWSERange(gapStartDate, endDate).catch(
      () => []
    );
    if (twseData && twseData.length > 0) {
      const byDate = new Map();
      if (cacheUsable) cached.data.forEach((d) => byDate.set(d.date, d));
      twseData.forEach((d) => byDate.set(d.date, d));
      mergedData = Array.from(byDate.values()).sort((a, b) =>
        a.date < b.date ? -1 : a.date > b.date ? 1 : 0
      );
      usedSource = 'TWSE';
    }
  }

  if (!mergedData) {
    // TWSE 這次沒補到新資料(缺口本身沒有新交易日、或 TWSE 這次抓取失敗),
    // 退回原本的 Yahoo Finance 管道,一樣抓整段 20 年歷史。
    const result = await fetchWithSuffix(
      symbol,
      symbol,
      anchorStartDate,
      endDate
    ).catch(() => null);
    if (result && result.data.length > 0) {
      const newLastDateStr = result.data[result.data.length - 1].date;
      if (!cacheUsable || newLastDateStr > cacheLastDateStr) {
        mergedData = result.data;
        usedSource = 'Yahoo';
      }
    }
  }

  if (mergedData) {
    const withSource = {
      symbol,
      data: mergedData,
      divDates: [],
      dividendsMap: {},
      usedSymbol: symbol,
      source: usedSource,
    };
    savePriceCache(symbol, withSource);
    return { ...withSource, fromCache: false };
  }

  if (cacheUsable) {
    return {
      symbol,
      data: cached.data,
      divDates: cached.divDates || [],
      dividendsMap: cached.dividendsMap || {},
      usedSymbol: cached.usedSymbol || symbol,
      source: cached.source || 'Yahoo',
      fromCache: true,
      cachedAt: cached.cachedAt,
      stale: true,
    };
  }
  return null;
};

// --- 個股股本 / ETF基金規模(供卡片顯示用,不影響回測本身的計算) ---
//
// 跟股價不同,這兩份資料證交所/櫃買中心是用「一次性快照」的方式公開整批資料
// (一次拿到全部上市公司或全部基金,不用像股價那樣逐檔、逐月分別查詢),所以
// 不管使用者這次比較幾檔標的,都只需要各打一次 API,速度是毫秒等級,不會
// 像β值那樣因為要抓大量歷史資料而變慢。這兩份資料本身變動也很不頻繁(只有
// 公司辦理增減資、基金合併/新增受益權單位才會變),所以用「一天內共用同一份
// 快照,隔天才重新抓」的方式快取,同一天內查詢幾次都不會重複打 API。
const SNAPSHOT_CACHE_TTL_DAYS = 1;

const loadSnapshotCache = (key) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.fetchedAt || !parsed.map) return null;
    const ageDays = (Date.now() - new Date(parsed.fetchedAt).getTime()) / 86400000;
    if (ageDays > SNAPSHOT_CACHE_TTL_DAYS) return null;
    return parsed.map;
  } catch (e) {
    return null;
  }
};

const saveSnapshotCache = (key, map) => {
  try {
    localStorage.setItem(
      key,
      JSON.stringify({ fetchedAt: new Date().toISOString(), map })
    );
  } catch (e) {
    // localStorage 不可用或空間不足時安靜忽略,不影響本次計算本身
  }
};

const CAPITAL_SNAPSHOT_CACHE_KEY = 'capital_snapshot_v1';

// 個股股本(實收資本額)。這份資料的來源(openapi.twse.com.tw、
// tpex.org.tw/openapi)完全沒有開放 CORS(不像股價用的 www.twse.com.tw/
// exchangeReport 那個舊網域有開放),瀏覽器沒辦法直接呼叫;原本考慮拿專案裡
// 既有的公用 CORS 代理(fetchProxy)繞過去,但實測那幾個代理對這兩個政府
// 網域的網址完全打不通(代理伺服器自己連不上、逾時,或現在要收費金鑰),
// 不是穩定可用的路。改成呼叫部署在同一個 Vercel 專案底下的伺服器端函式
// (/api/marketSnapshot,見 api/marketSnapshot.js),由它代為抓取、整理成
// 查表格式再回傳——前端呼叫自己網域底下的路徑是同源請求,完全不會有 CORS
// 問題,伺服器對伺服器的請求也不受瀏覽器的 CORS 政策限制。
export const fetchCapitalSnapshot = async () => {
  const cached = loadSnapshotCache(CAPITAL_SNAPSHOT_CACHE_KEY);
  if (cached) return cached;

  let map = {};
  try {
    const res = await fetchWithTimeout('/api/marketSnapshot?type=capital', {}, 15000);
    if (res.ok) {
      const json = await res.json();
      if (json && typeof json === 'object') map = json;
    }
  } catch (e) {
    // 抓失敗就回傳空表,呼叫端「查不到就不顯示」,不影響回測本身
  }

  if (Object.keys(map).length > 0) {
    saveSnapshotCache(CAPITAL_SNAPSHOT_CACHE_KEY, map);
  }
  return map;
};

const ETF_UNITS_SNAPSHOT_CACHE_KEY = 'etf_units_snapshot_v1';

// ETF發行單位數(受益權單位數)。跟股本一樣,來源網域(openapi.twse.com.tw)
// 沒有開放 CORS、公用代理也打不通,改呼叫同專案的 /api/marketSnapshot 伺服器
// 端函式取得(見上面 fetchCapitalSnapshot 的說明、api/marketSnapshot.js)。
// 只有「單位數」,官方沒有公開每日淨值或基金總規模的資料,所以規模只能用
// 「單位數 × 最新收盤價」估算(ETF市價會透過造市/申贖套利機制緊貼淨值,
// 估算誤差通常很小),不是官方公布的精確數字,卡片顯示時要標示「(估)」。
export const fetchEtfUnitsSnapshot = async () => {
  const cached = loadSnapshotCache(ETF_UNITS_SNAPSHOT_CACHE_KEY);
  if (cached) return cached;

  let map = {};
  try {
    const res = await fetchWithTimeout('/api/marketSnapshot?type=etfUnits', {}, 15000);
    if (res.ok) {
      const json = await res.json();
      if (json && typeof json === 'object') map = json;
    }
  } catch (e) {
    // 抓失敗就回傳空表,呼叫端「查不到就不顯示」,不影響回測本身
  }

  if (Object.keys(map).length > 0) {
    saveSnapshotCache(ETF_UNITS_SNAPSHOT_CACHE_KEY, map);
  }
  return map;
};
