// 股價/配息資料的抓取與快取模組。
//
// 資料策略(ETF回測比較、定期定額策略最佳化兩個分頁共用):
//   1. 所有計算終點固定為「前一個交易日」，不計算當天資料(見 tradingCalendar.js)。
//   2. 讀取順序:優先讀 localStorage 快取；但每次都會檢查快取的最後一筆日期
//      是否已經跟得上目前的「前一個交易日」，跟得上才直接用、完全不打 API。
//   2.5. 本機快取沒跟上、但使用者已經登入 Google 的話，接著查一次 Firestore
//      裡的「共用雲端快取」(sharedPriceCache，跟「我的持股」用的登入狀態共用,
//      不需要在這兩頁另外登入一次)——只要雲端那份也跟得上最新交易日，就直接
//      用它、順便寫回本機，不用再自己即時抓一次。這是為了解決「換一台新裝置
//      要整個重新抓」的問題：只要曾經有任何一個登入的使用者在任何一台裝置上
//      抓過某檔股票，之後全部登入使用者的裝置都能直接讀這份共用結果。沒登入、
//      雲端沒有、或雲端那份也還沒跟上，都會安靜放棄，繼續走下面第3步。
//   3. 該股票代碼從來沒有成功查詢過、或快取的最後一筆日期比「前一個交易日」
//      還舊(表示已經過了至少一個新的交易日，快取沒有涵蓋到)，都會發出即時
//      抓取，依序嘗試 FinMind → 證交所(TWSE)官方資料 → Yahoo Finance 三層
//      備援，抓到後覆蓋本機快取；如果當下是登入狀態，也會順手把這次抓到的
//      結果同步寫一份到 Firestore 共用快取，造福之後其他登入裝置。三個來源
//      都失敗時(例如離線、或資料源當天還沒更新)才退回使用現有的舊快取繼續
//      計算，並標記 stale:true，讓呼叫端可以在結果頁提示使用者「資料只更新
//      到某天」，不會又靜默用了過期資料。
//      （這是之前的已知問題：舊版快取一旦存在就永久沿用、完全不管多舊，
//      導致換了新的一天之後，回測抓到的還是好幾天前的舊資料。）
//   4. 快取範圍:第一次成功抓取(或判定需要更新)時，一次抓最近
//      FETCH_HISTORY_YEARS 年的完整歷史，之後不論回測期間怎麼調整，
//      只要落在這個範圍內都直接從快取切片，不用每次都重新請求整段歷史。
//   5. localStorage 的 key 統一用 `stock_price_<代碼>` 命名，兩個分頁共用同一份資料，
//      彼此都看得到對方已經抓過的標的、不會重複打 API。Firestore 共用快取則是用
//      代碼本身當文件ID(sharedPriceCache/<代碼>)，所有登入使用者共用同一份。
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import TW_STOCK_NAMES from './data/twStockNames';
import { getLastCompletedTradingDay } from './tradingCalendar';
import { auth, db } from './firebase';

// 共用雲端快取用的 Firestore collection 名稱,文件ID是股票代碼。跟「我的持股」
// 共用同一個 auth 登入狀態(整個網站是同一個 SPA、同一份 Firebase 連線),所以
// 這裡不用另外做登入 UI——只要使用者曾經在「我的持股」登入過 Google,這裡的
// currentUid 就會自動是登入狀態,兩個分頁即時共享。安全性規則需要另外在
// Firebase 主控台設定(允許已登入使用者讀寫 sharedPriceCache/* ),不是靠這裡
// 的程式碼控管。
const SHARED_CACHE_COLLECTION = 'sharedPriceCache';
let currentUid = null;
onAuthStateChanged(auth, (user) => {
  currentUid = user ? user.uid : null;
});

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
      // 只有 !== null/undefined 還不夠:Yahoo 偶爾會對非交易日/資料異常的
      // 那天回傳 0,若照單全收會讓後續「金額 / 股價」的計算除以0變成Infinity,
      // 所以這裡額外擋掉非有限數與 <= 0 的異常價格。
      if (
        typeof closePrice === 'number' &&
        Number.isFinite(closePrice) &&
        closePrice > 0
      ) {
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
    // p.close 原本完全沒做合理性檢查:FinMind 偶爾會對交易量稀薄的標的
    // (例如債券ETF)回傳 0 或非數字的收盤價,若照單全收,後面「金額 / 股價」
    // 的加碼計算會除以0變成Infinity,一路污染到最終顯示的配息金額。
    // 這裡直接濾掉價格無效的那一天,而不是留著壞資料讓下游各自防呆。
    const data = priceJson.data
      .map((p) => {
        const price = p.close;
        if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
          return null;
        }
        const high = p.max;
        const low = p.min;
        return {
          date: p.date,
          timestamp: new Date(p.date).getTime(),
          price,
          high: typeof high === 'number' && Number.isFinite(high) ? high : undefined,
          low: typeof low === 'number' && Number.isFinite(low) ? low : undefined,
          accumulatedDividend: 0,
        };
      })
      .filter((r) => r !== null);

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
        // close <= 0 也一併擋掉(不只擋 NaN):避免萬一交易所對某天回傳
        // 「0」這種異常值時,被當成有效股價流入後續的加碼/除以股價計算。
        if (!dateStr || !Number.isFinite(close) || close <= 0) return null;
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

// --- 櫃買中心(TPEx)官方資料(上櫃股票在 FinMind 失敗時的第二資料源) ---
//
// 為什麼要加:上面的證交所 STOCK_DAY 只有「上市」股票。上櫃股票(例如金居 8358、
// 元大美債20年 00679B)在 FinMind 失敗時(免費額度每個 IP 每小時 300 次,手機電信的
// 共用 IP 常常被別人用完)原本只剩下面的 Yahoo,而 Yahoo 要繞的四個公用 CORS 代理
// 2026-10 實測全部打不通——等於上櫃股票沒有任何能用的備援,這就是「金居怎麼刷新都
// 不會更新」的原因。櫃買中心的官方資料沒有開放 CORS,所以改呼叫同專案的
// /api/twPrice(Vercel 伺服器端函式,見 api/twPrice.js)代抓。
// 跟證交所一樣一次只能查一個月,月數上限也沿用 TWSE_MAX_MONTHS_LIMIT;本機開發
// (npm start)沒有 /api,會拿到 index.html、解析 JSON 失敗,這裡安靜當成沒資料。
const fetchTPExMonth = async (symbol, year, month) => {
  const m = `${year}-${String(month).padStart(2, '0')}`;
  try {
    const res = await fetchWithTimeout(
      `/api/twPrice?type=tpexMonth&symbol=${encodeURIComponent(symbol)}&month=${m}`,
      {},
      10000
    );
    if (!res.ok) return [];
    const json = await res.json();
    if (!json || !Array.isArray(json.rows)) return [];
    return json.rows
      .filter((r) => r && r.date && typeof r.close === 'number' && r.close > 0)
      .map((r) => ({
        date: r.date,
        timestamp: new Date(r.date).getTime(),
        price: r.close,
        high: typeof r.high === 'number' ? r.high : undefined,
        low: typeof r.low === 'number' ? r.low : undefined,
        accumulatedDividend: 0,
      }));
  } catch (e) {
    return [];
  }
};

const fetchFromTPEx = async (symbol, startDate, endDate) => {
  const months = [];
  const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const last = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
  while (cursor <= last && months.length <= TWSE_MAX_MONTHS_LIMIT) {
    months.push({ year: cursor.getFullYear(), month: cursor.getMonth() + 1 });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  if (months.length === 0 || months.length > TWSE_MAX_MONTHS_LIMIT) return null;
  const monthResults = await Promise.all(months.map((m) => fetchTPExMonth(symbol, m.year, m.month)));
  const startStr = startDate.toISOString().split('T')[0];
  const data = monthResults
    .flat()
    .filter((d) => d.date >= startStr)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (data.length === 0) return null;
  const divResult = await fetchDividendsFromFinMindOnly(symbol, startDate, endDate);
  return {
    symbol,
    data,
    divDates: divResult ? divResult.divDates : [],
    dividendsMap: divResult ? divResult.dividendsMap : {},
    usedSymbol: symbol,
    source: 'TPEx',
    dividendDataIncomplete: !divResult,
  };
};

// --- 即時報價(盤中/當日收盤,上市上櫃都有) ---
//
// 「我的持股」的更新鈕要「不管是不是盤中,按下去就拿到最新股價」。上面的日資料
// 來源(FinMind/證交所/櫃買)都要收盤後才有當天那一筆,盤中按更新只會拿到昨天的
// 收盤價。證交所的即時報價(mis.twse.com.tw)上市、上櫃都查得到,一次可以查很多檔,
// 但沒有開放 CORS,一樣透過 /api/twPrice 代抓。
// 回傳 { 代號: { price, prevClose, date:'YYYY-MM-DD', time:'HH:MM:SS' } };
// 失敗(離線、本機開發沒有 /api、上游逾時)一律回傳 {},呼叫端照用日資料。
const LIVE_QUOTE_CHUNK = 100;
export const fetchLiveQuotes = async (symbols) => {
  const list = Array.from(new Set((symbols || []).map((s) => String(s).trim().toUpperCase()))).filter((s) =>
    /^[0-9A-Z]{4,6}$/.test(s)
  );
  const out = {};
  for (let i = 0; i < list.length; i += LIVE_QUOTE_CHUNK) {
    const chunk = list.slice(i, i + LIVE_QUOTE_CHUNK);
    try {
      const res = await fetchWithTimeout(
        `/api/twPrice?type=quote&symbols=${encodeURIComponent(chunk.join(','))}`,
        { cache: 'no-store' },
        12000
      );
      if (!res.ok) continue;
      const json = await res.json();
      const quotes = (json && json.quotes) || {};
      Object.keys(quotes).forEach((sym) => {
        const q = quotes[sym];
        if (q && typeof q.price === 'number' && q.price > 0 && q.date) {
          out[sym] = {
            price: q.price,
            prevClose: typeof q.prevClose === 'number' ? q.prevClose : null,
            date: q.date,
            time: q.time || '00:00:00',
          };
        }
      });
    } catch (e) {
      // 這一批失敗就略過,其他批次照常
    }
  }
  return out;
};

// --- 即時抓取的完整重試鏈(FinMind → TWSE → TPEx → Yahoo) ---
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

    // 證交所查不到(上櫃股票),再試櫃買中心官方資料,不要直接落到幾乎打不通的 Yahoo 代理。
    const tpexResult = await fetchFromTPEx(pureSymbol, startDate, endDate);
    if (tpexResult && tpexResult.data.length > 0) {
      return tpexResult;
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

// 判斷 setItem 失敗是不是「空間不足」(不同瀏覽器的 name/code 不完全一致,
// 保守多比對幾種寫法,避免漏判)。
const isQuotaExceededError = (e) =>
  e &&
  (e.name === 'QuotaExceededError' ||
    e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    e.code === 22 ||
    e.code === 1014);

// 找出目前所有「個股/大盤股價」快取(stock_price_ 開頭)裡最舊的一筆並刪除,
// 用來在空間不足時騰出空間。用 cachedAt(存檔時間)判斷新舊,不是用資料
// 本身涵蓋的交易日期——目的是優先淘汰「最久沒有被重新整理過」的快取,不是
// 淘汰「歷史資料涵蓋範圍比較早」的快取。
// 找過程中若剛好遇到已經損毀、解析不出來的快取,直接視為最該優先清除的
// 對象(反正也讀不了、留著沒用),不需要再比較 cachedAt。
const evictOldestPriceCacheEntry = () => {
  let oldestKey = null;
  let oldestTime = Infinity;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(PRICE_CACHE_PREFIX)) continue;
    try {
      const parsed = JSON.parse(localStorage.getItem(key));
      const t = parsed && parsed.cachedAt ? new Date(parsed.cachedAt).getTime() : 0;
      if (!Number.isFinite(t) || t < oldestTime) {
        oldestTime = Number.isFinite(t) ? t : 0;
        oldestKey = key;
      }
    } catch (e) {
      oldestKey = key;
      break;
    }
  }
  if (!oldestKey) return false;
  localStorage.removeItem(oldestKey);
  return true;
};

// 空間不足時「先騰空間、再重試」最多這麼多次才放棄——理論上遇到單一筆
// 過大的新資料(例如超長史的個股)才需要連續淘汰好幾筆舊快取才夠位置,
// 正常情況通常淘汰1、2筆就夠了。
const SAVE_RETRY_ON_QUOTA_LIMIT = 30;

// 每次都用同一把 key(stock_price_<代碼>)存檔,理論上「覆蓋自己這一筆」
// 不會讓總用量變大很多,但實測發現使用者瀏覽器裡長期累積下來的舊快取
// (許多不同代碼、每筆都動輒上千個交易日)還是可能把 localStorage 的
// 空間(多數瀏覽器每個網域 5-10MB 上下)填滿,一旦填滿,新代碼(或需要
// 整檔重新即時抓取的既有代碼)的 setItem 就會拋出 QuotaExceededError,
// 而這裡原本是整個安靜吞掉、不重試——這會導致某個代碼「每次都抓得到最新
// 資料、但永遠存不進快取」,每次重新整理都要重新即時抓一次,使用者會覺得
// 這檔特別慢、也永遠不會顯示「使用暫存資料」,而且因為抓取本身其實有成功、
// 不會被當成錯誤回報,很難察覺是空間問題。改成:空間不足時,先淘汰現有
// 快取裡最舊的一筆,騰出空間後再重試存檔,最多重試到 SAVE_RETRY_ON_QUOTA_LIMIT
// 次;真的整個 localStorage 都被清空還存不下(資料本身超大或瀏覽器完全
// 不給用),才維持原本「安靜放棄」的行為,不影響本次計算結果本身。
export const savePriceCache = (symbol, result) => {
  const payload = JSON.stringify({
    schemaVersion: CACHE_SCHEMA_VERSION,
    data: result.data,
    divDates: result.divDates,
    dividendsMap: result.dividendsMap,
    usedSymbol: result.usedSymbol,
    source: result.source || '',
    dividendDataIncomplete: result.dividendDataIncomplete || false,
    cachedAt: new Date().toISOString(),
  });
  const key = cacheKeyFor(symbol);
  for (let attempt = 0; attempt <= SAVE_RETRY_ON_QUOTA_LIMIT; attempt++) {
    try {
      localStorage.setItem(key, payload);
      return;
    } catch (e) {
      if (!isQuotaExceededError(e)) return; // 非空間問題,沿用原本安靜放棄的行為
      if (!evictOldestPriceCacheEntry()) return; // 已經沒有更舊的快取可以淘汰了
    }
  }
};

// --- Firestore 共用快取(跨裝置)---
//
// 完全是「不登入也能用、登入了會更方便」的加分項,不是必要條件:
// - 沒登入(currentUid 是 null)時,下面兩個函式直接什麼都不做、安靜放棄,
//   ETF回測比較/定期定額策略最佳化兩頁的行為跟原本一模一樣,不會跳出任何
//   登入畫面,也不會因此變慢或卡住。
// - 讀取/寫入失敗(規則還沒設定好、離線、單筆資料超過 Firestore 1MiB上限等)
//   也都安靜放棄,絕對不能讓共用快取的問題去影響到這次抓取本身的結果。
// 文件結構刻意跟 localStorage 那份幾乎一樣,方便互相轉換;sanitizeForFirestore
// 用 JSON 來回轉一次,把 high/low 可能存在的 undefined 值清掉(Firestore 不接受
// 欄位值是 undefined,直接寫入會整次失敗)。
const sanitizeForFirestore = (payload) => JSON.parse(JSON.stringify(payload));

// 查一次雲端共用快取,只有「使用者已登入」且「雲端那份也已經跟得上最新交易日」
// 才會拿來用——雲端那份要是也是舊的,不如直接自己即時抓一次比較準。
const loadSharedCacheIfUsable = async (symbol, latestNeededDateStr) => {
  if (!currentUid) return null;
  try {
    const snap = await getDoc(doc(db, SHARED_CACHE_COLLECTION, symbol));
    if (!snap.exists()) return null;
    const shared = snap.data();
    if (!shared || shared.schemaVersion !== CACHE_SCHEMA_VERSION) return null;
    if (!Array.isArray(shared.data) || shared.data.length === 0) return null;
    const sharedLastDateStr = shared.data[shared.data.length - 1].date;
    if (sharedLastDateStr < latestNeededDateStr) return null;
    return shared;
  } catch (e) {
    // 沒有讀取權限(規則還沒設定)、離線、或其他任何例外,都當成「雲端沒有
    // 可用的資料」處理,讓呼叫端照原本邏輯繼續走即時抓取,不要讓這裡的失敗
    // 擋住整個流程。
    return null;
  }
};

// 即時抓取成功後,登入狀態下順手把這次的結果也同步寫一份到雲端共用快取,
// 造福之後其他登入裝置/使用者。刻意不 await 這個函式(呼叫端用 fire-and-
// forget 的方式呼叫),寫入雲端不應該拖慢這次使用者正在等待的回測結果。
const saveSharedPriceCache = (symbol, result) => {
  if (!currentUid) return;
  try {
    const payload = sanitizeForFirestore({
      schemaVersion: CACHE_SCHEMA_VERSION,
      data: result.data,
      divDates: result.divDates,
      dividendsMap: result.dividendsMap,
      usedSymbol: result.usedSymbol,
      source: result.source || '',
      dividendDataIncomplete: result.dividendDataIncomplete || false,
      cachedAt: new Date().toISOString(),
    });
    setDoc(doc(db, SHARED_CACHE_COLLECTION, symbol), payload).catch(() => {
      // 寫入失敗(規則、額度、單筆超過1MiB等)安靜放棄,不影響這次的抓取結果。
    });
  } catch (e) {
    // sanitizeForFirestore 理論上不會丟例外,保守起見還是包一層,避免萬一真的
    // 出錯時影響到呼叫端。
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

// 「我的持股」強制刷新(force:true)用的輕量抓取範圍:只回抓這麼多天,
// 不是像正常更新快取那樣整個 FETCH_HISTORY_YEARS 年歷史都重抓一次。
// 原本 force 模式沒有這層,每次按刷新/每次自動刷新都對所有持股代號各自
// 重新發動一次完整20年歷史的 FinMind→TWSE→Yahoo 三層備援抓取,實際上線後
// 發現這樣又慢又容易把資料源/CORS代理搞到逾時卡住(尤其持股檔數多的時候
// 全部平行發動),而且偶爾某個來源在高併發下回傳到不完整的資料,蓋過快取
// 裡原本正確的數字,導致「按了刷新之後數字反而不準」。改成只抓最近這幾天
// (台股這幾天內一定看得到最新收盤價),再跟既有快取合併(見下面
// mergeRecentPriceData),大幅縮小抓取範圍跟出錯機會。
const FORCE_REFRESH_LOOKBACK_DAYS = 10;

const getForceRefreshStartDate = () => {
  const d = new Date();
  d.setDate(d.getDate() - FORCE_REFRESH_LOOKBACK_DAYS);
  return d;
};

// 把 force 模式新抓回來的「最近幾天」資料,合併進既有的完整歷史快取裡:
// 用日期當 key,新資料覆蓋掉舊資料裡同一天的值(收盤價以剛抓到的為準),
// 其餘沒抓到的舊日期全部保留,最後依日期排序回傳。這樣既能拿到最新收盤價,
// 又不會把20年的歷史資料整個丟掉重抓。
const mergeRecentPriceData = (oldData, newData) => {
  const byDate = new Map();
  (oldData || []).forEach((d) => byDate.set(d.date, d));
  (newData || []).forEach((d) => byDate.set(d.date, d));
  return Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
};

// 舊版程式抓的快取只有收盤價,沒有當天最高/最低價(K線穿越均線判斷需要這兩個
// 欄位)。用這個判斷「這份快取是不是舊格式」,原本是只要有任何一天缺 high 或
// low 就視為不完整、整檔重新即時抓取以補齊。
//
// 但實際發現有些標的(例如00913)在證交所/FinMind的官方歷史資料裡,個別
// 交易日本身就是缺值(例如那天只有零股成交、官方資料的當日最高/最低價欄位
// 直接就是「--」),不是我們的資料源接不到,是官方資料本身那天就沒有正常
// 的高低價可以查。這種情況下「只要有一天缺就整檔判定過期」會導致每次都重新
// 抓取、抓回來的還是同一筆缺值資料、永遠存不進「跟得上最新交易日」的快取,
// 使用者會一直看到「抓取中」而不是「已使用暫存資料」。
// 改成看「缺值的比例」:真正的舊格式快取是完全沒有 high/low 這兩個欄位
// (100%都缺),個別交易日的官方資料缺值只會是少數幾天,用 5% 當門檻,
// 足以區分這兩種情況,不會讓少數幾天的個別缺值造成快取永遠失效。
const MISSING_HIGH_LOW_RATIO_THRESHOLD = 0.05;
const priceCacheMissingHighLow = (data) => {
  if (!Array.isArray(data) || data.length === 0) return true;
  const missingCount = data.filter(
    (d) => typeof d.high !== 'number' || typeof d.low !== 'number'
  ).length;
  return missingCount / data.length > MISSING_HIGH_LOW_RATIO_THRESHOLD;
};

// 股價/配息資料的對外主要入口:cache-first、但加上「快取是否跟得上最新交易日」
// 的檢查,不是原本那種「快取一旦存在就永久沿用、完全不管多舊」的做法(那樣會
// 導致像 09/18 之後就再也抓不到新資料的問題:同一天內重複執行回測直接吃快取,
// 但只要換了一天、有新的交易日資料,就會嘗試重新即時抓取(FinMind → TWSE →
// Yahoo 三層備援)來補上快取沒有的最新資料,抓到後覆蓋快取;
// 只有在即時抓取三個來源都失敗時(例如離線、或當天資料源都還沒更新),才會
// 退回使用現有的舊快取繼續計算,並標記 stale:true,讓呼叫端可以在結果頁
// 提示使用者「資料只更新到某天」,而不是又靜默用了過期資料。
// 這個函式的「需要抓到哪一天」一律是 getLastCompletedTradingDay()(下午3:30後
// 才算今天的資料到位,否則算前一天),這是為了ETF回測比較/定期定額策略最佳化
// 兩個分頁的歷史資料穩定性(避免抓到資料源當天還沒正式收錄的尾盤價),不能
// 直接改掉——下面的 force:true 模式例外(給「我的持股」頁面的手動/自動刷新
// 按鈕用:使用者收盤後,例如下午1:35,就想看到今天的收盤價,不想等到3:30),
// 抓取終點改用「今天」而不是 getLastCompletedTradingDay(),才有機會真的抓到
// 資料源當天剛收錄的收盤價(抓不到的話,FinMind/TWSE/Yahoo 本來就只會回傳
// 實際存在的交易日資料,不會因為終點設成今天而出錯)。
//
// 只要本機已經有能用的歷史快取(cacheUsable)、快取沒跟上最新交易日,不管是不是
// force模式,一律只抓最近 FORCE_REFRESH_LOOKBACK_DAYS 天(見
// getForceRefreshStartDate),抓到後用 mergeRecentPriceData 合併回既有快取,
// 不是整個20年歷史重新抓一次——這段原本只有 force 模式(「我的持股」刷新鈕)
// 才會這樣做,非force模式(例如ETF回測比較頁、或背景偵測到快取少了今天的資料
// 時)一律直接沿用 getFetchAnchorStartDate()(20年前)當起點整個重抓,實測發現
// 不管哪個模式,持股/標的檔數一多、每天第一個碰到某檔的人都要承受一次完整
// 20年歷史的三層備援抓取,很容易把資料源/CORS代理搞到逾時卡住,偶爾高併發下
// 某個來源還會回傳不完整資料蓋掉快取裡原本正確的數字,才統一改成只要本機有
// 舊快取可以合併,就一律走這種輕量作法,不分force與否。完全沒有快取(第一次
// 抓這檔)時沒有舊資料可以合併,還是走完整歷史錨點。
export const fetchStockPriceData = async (symbol, { force = false } = {}) => {
  const cached = loadPriceCache(symbol);
  // cacheUsable:夠完整(high/low缺值比例在門檻內)才能拿來判斷「快取是否已經
  // 跟上最新交易日」、或當成 force 模式合併的底稿——這兩種用途都要求資料品質。
  // cacheHasAnyData 則單純只看「有沒有抓到過收盤價」,門檻低很多,只在最後
  // 關頭(即時抓取三個來源全部失敗)當退路用:即使是 high/low 缺值比例偏高
  // 的舊快取(常見於成交量稀薄的債券ETF),好歹收盤價還是真實抓到過的,
  // 拿來墊檔也比直接讓呼叫端收到 null、被畫面當成0處理好太多。
  const cacheUsable =
    cached && cached.data && cached.data.length > 0 && !priceCacheMissingHighLow(cached.data);
  const cacheHasAnyData = cached && cached.data && cached.data.length > 0;
  const lastCompletedTradingDay = getLastCompletedTradingDay();
  const latestNeededDateStr = lastCompletedTradingDay.toISOString().split('T')[0];
  const cacheLastDateStr = cacheUsable
    ? cached.data[cached.data.length - 1].date
    : null;
  const cacheIsFresh = !force && cacheUsable && cacheLastDateStr >= latestNeededDateStr;

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

  // 本機快取沒跟上(或這台裝置根本沒抓過這檔),登入狀態下先查一次雲端共用
  // 快取——只在非 force 模式才查,force 是「我的持股」刷新按鈕的即時需求,
  // 雲端那份不一定比本機新鮮,犯不著多一趟網路請求。
  if (!force) {
    const shared = await loadSharedCacheIfUsable(symbol, latestNeededDateStr);
    if (shared) {
      savePriceCache(symbol, shared); // 順便寫回本機,這台裝置下次就不用再查雲端
      return {
        symbol,
        data: shared.data,
        divDates: shared.divDates || [],
        dividendsMap: shared.dividendsMap || {},
        usedSymbol: shared.usedSymbol || symbol,
        source: shared.source || '',
        dividendDataIncomplete: shared.dividendDataIncomplete || false,
        fromCache: true,
        fromSharedCache: true,
        cachedAt: shared.cachedAt,
      };
    }
  }

  // 只要有舊快取可以合併(不分force與否)就走輕量增量抓取,只有完全沒快取過
  // 的全新標的才需要整段20年歷史錨點——詳細理由見本函式最上方的說明註解。
  const useIncrementalFetch = cacheUsable;
  const startDate = useIncrementalFetch ? getForceRefreshStartDate() : getFetchAnchorStartDate();
  const endDate = force ? new Date() : lastCompletedTradingDay;
  const result = await attemptLiveFetch(symbol, startDate, endDate);
  if (result && result.data.length > 0) {
    if (useIncrementalFetch) {
      // 輕量刷新:新抓到的最近幾天資料跟既有完整歷史合併,不是整個蓋掉。
      const mergedData = mergeRecentPriceData(cached.data, result.data);
      const mergedResult = {
        ...result,
        data: mergedData,
        divDates: Array.from(new Set([...(cached.divDates || []), ...(result.divDates || [])])),
        dividendsMap: { ...(cached.dividendsMap || {}), ...(result.dividendsMap || {}) },
      };
      const mergedLastDateStr = mergedData[mergedData.length - 1].date;
      // 合併後日期沒有變新、筆數也沒變多,代表這次沒抓到真正新的資料
      // (例如還沒到資料源收錄的時間),直接維持原本快取,避免白白寫入。
      if (mergedLastDateStr > cacheLastDateStr || mergedData.length !== cached.data.length) {
        savePriceCache(symbol, mergedResult);
        saveSharedPriceCache(symbol, mergedResult); // fire-and-forget,登入時才會真的寫
      }
      return { ...mergedResult, fromCache: false };
    }
    const newLastDateStr = result.data[result.data.length - 1].date;
    // 避免資料源這次剛好抓到比現有快取還舊/還少的異常結果,反而把好的快取蓋掉。
    if (!cacheUsable || newLastDateStr > cacheLastDateStr) {
      savePriceCache(symbol, result);
      saveSharedPriceCache(symbol, result); // fire-and-forget,登入時才會真的寫
      return { ...result, fromCache: false };
    }
  }

  if (cacheHasAnyData) {
    // 即時抓取沒有拿到更新的資料(三個來源都失敗,或抓到的反而更舊),
    // 退回使用現有快取繼續計算,並標記 stale,讓呼叫端知道這不是最新資料。
    // 這裡刻意放寬成 cacheHasAnyData(不要求 cacheUsable 那種 high/low 完整度),
    // 因為這是「真的沒有更好選擇」的最後一道防線,只要有抓到過收盤價,
    // 都比讓呼叫端拿到 null、畫面上把市值/損益算成0要好。
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

// ttlDays 可以個別覆寫(例如下面的ETF總費用率,資料源是第三方網站、
// 不想太頻繁去打對方伺服器,用一個月而不是預設的一天)。
const loadSnapshotCache = (key, ttlDays = SNAPSHOT_CACHE_TTL_DAYS) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.fetchedAt || !parsed.map) return null;
    const ageDays = (Date.now() - new Date(parsed.fetchedAt).getTime()) / 86400000;
    if (ageDays > ttlDays) return null;
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

const ETF_FEES_SNAPSHOT_CACHE_KEY = 'etf_fees_snapshot_v1';

// ETF總費用率快取多久才重新抓一次:官方完全沒有這份資料(見
// api/marketSnapshot.js 裡 buildEtfFeesMap 的完整說明),改抓第三方財經
// 網站(MoneyDJ)的排行頁面整理而成,這份資料本來就不是每天在變,加上不想
// 太頻繁去打對方網站,所以用一個月而不是股本/ETF規模那兩個用的一天。
// 這是瀏覽器端localStorage的快取時間,搭配 api/marketSnapshot.js 那邊
// Vercel 邊緣快取(30天+30天)一起用,兩層都拉長,實際重新抓取的頻率
// 大概就是一個月一次上下。
const ETF_FEES_SNAPSHOT_TTL_DAYS = 30;

// ETF總費用率。跟股本/ETF單位數一樣呼叫同專案的 /api/marketSnapshot 伺服器
// 端函式取得,只是這裡的資料源(第三方網站MoneyDJ的排行頁面)一次只列
// 「總費用率由低到高」或「由高到低」排序的前100檔,兩個方向合併大約可以
// 涵蓋境內ETF的七成多,不是每一檔都查得到——查不到的,呼叫端(App.js)會
// 退回用 twEtfFees.js 那份人工維護的小表當備援,兩邊都查不到才真的不顯示
// 這個資訊,不會因為這樣就卡住整個回測或跳錯誤訊息。
export const fetchEtfFeesSnapshot = async () => {
  const cached = loadSnapshotCache(ETF_FEES_SNAPSHOT_CACHE_KEY, ETF_FEES_SNAPSHOT_TTL_DAYS);
  if (cached) return cached;

  let map = {};
  try {
    const res = await fetchWithTimeout('/api/marketSnapshot?type=etfFees', {}, 15000);
    if (res.ok) {
      const json = await res.json();
      if (json && typeof json === 'object') map = json;
    }
  } catch (e) {
    // 抓失敗就回傳空表,呼叫端會退回用人工維護的小表,不影響回測本身
  }

  if (Object.keys(map).length > 0) {
    saveSnapshotCache(ETF_FEES_SNAPSHOT_CACHE_KEY, map);
  }
  return map;
};

// --- 單一ETF總費用率個別查詢(給上面那份批次快照沒收錄到的標的當備援) ---
//
// fetchEtfFeesSnapshot 那份批次快照一次只涵蓋境內約七成多的ETF(排行榜
// 只列費用率最低/最高各100檔,中間費用率不上不下的那些會漏掉,實測發現
// 剛好包含0056、00878這類存股族很常用的熱門ETF)。這裡改呼叫
// /api/marketSnapshot?type=etfFeeLookup 個別查一檔,不受排行榜前100名的
// 限制,查詢端(App.js)只在批次快照+twEtfFees.js人工小表都查不到某檔
// 標的時,才會呼叫這個個別查詢當最後備援。
//
// 快取用單一個localStorage鍵存所有查過的代碼(而不是像批次快照那樣整份
// 共用一個fetchedAt),因為每次呼叫只查一檔、不是整批一起抓新的,各自
// 記錄自己的查詢時間才能各自判斷是否過期;查不到(null,例如查的其實是
// 一般個股不是ETF)也一併快取,避免同一檔每次回測都重新打一次API。
const ETF_FEE_LOOKUP_CACHE_KEY = 'etf_fee_lookup_v1';
const ETF_FEE_LOOKUP_TTL_DAYS = 30;

const loadEtfFeeLookupCache = () => {
  try {
    const raw = localStorage.getItem(ETF_FEE_LOOKUP_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    return {};
  }
};

const saveEtfFeeLookupCache = (cache) => {
  try {
    localStorage.setItem(ETF_FEE_LOOKUP_CACHE_KEY, JSON.stringify(cache));
  } catch (e) {
    // 存不進去就算了,只是快取,下次回測同一檔會再查一次而已,不影響本次結果
  }
};

// 境內ETF代碼一律是「00」開頭(0050、0056、00878、00913...皆然),一般
// 個股代碼不會是這個開頭,先用這個規則過濾掉明顯不是ETF的代碼,不用浪費
// 一次網路請求去問第三方網站、也減少無謂打對方伺服器的次數。
const looksLikeEtfSymbol = (symbol) => /^00/.test(symbol || '');

export const fetchEtfFeeForSymbol = async (symbol) => {
  if (!looksLikeEtfSymbol(symbol)) return null;

  const cache = loadEtfFeeLookupCache();
  const entry = cache[symbol];
  if (entry && entry.cachedAt) {
    const ageDays = (Date.now() - new Date(entry.cachedAt).getTime()) / 86400000;
    if (ageDays <= ETF_FEE_LOOKUP_TTL_DAYS) {
      return typeof entry.value === 'number' ? entry.value : null;
    }
  }

  let value = null;
  try {
    const res = await fetchWithTimeout(
      `/api/marketSnapshot?type=etfFeeLookup&symbol=${encodeURIComponent(symbol)}`,
      {},
      10000
    );
    if (res.ok) {
      const json = await res.json();
      if (json && Number.isFinite(json.totalExpenseRatio)) {
        value = json.totalExpenseRatio;
      }
    }
  } catch (e) {
    // 查失敗就當作這次查不到(不快取失敗結果),回傳null,呼叫端會退回
    // 用人工小表或直接不顯示,不影響回測本身;下次回測會再試一次
    return null;
  }

  cache[symbol] = { value, cachedAt: new Date().toISOString() };
  saveEtfFeeLookupCache(cache);
  return value;
};
