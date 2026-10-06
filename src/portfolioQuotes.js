// 「我的持股」的現價管理:上一次數據的保存/墊檔,以及日收盤與即時報價的取捨。
//
// 為什麼要有這個檔案:
//   1. 開啟「我的持股」時,畫面原本只拿 localStorage 的股價歷史快取(stock_price_<代號>)
//      墊檔。但那份快取一檔就有約 50 萬字元(20 年日資料),幾檔就把瀏覽器 localStorage
//      的空間塞滿(手機 Safari 約 5MB),dataCache 只好把「最久沒更新」的那幾檔刪掉騰空間——
//      被刪掉的那幾檔,下次開啟時就沒有東西可以墊,畫面先是空白,要等網路抓完才出現。
//      另外,墊檔原本只看本機那份持股資料;登入後雲端多出來的代號(在別台裝置新增的)
//      也不會被墊到。
//      改成另外存一份很小的「上一次顯示的現價」(每檔只有現價、昨收、時間,幾十檔也不到
//      幾 KB),key 用 portfolio_ 開頭、不在 stock_price_ 的淘汰範圍內,不會被擠掉。
//   2. 現價有兩種來源:日收盤(FinMind/證交所/櫃買,收盤後才有當天那筆)與即時報價
//      (盤中也有)。兩者可能先後到達,所以每筆都帶「資料時間 asOf」,一律保留比較新的,
//      避免晚到的昨收蓋掉剛拿到的盤中價。

export const LAST_QUOTES_KEY = 'portfolio_last_quotes_v1';

// 台股收盤時間:日收盤資料的那一天,視為當天 13:30:00 的價格
const CLOSE_TIME = '13:30:00';

// 從日資料陣列(dataCache 格式)取出現價
export function quoteFromDaily(data) {
  const d = Array.isArray(data) ? data : [];
  const last = d[d.length - 1];
  if (!last || typeof last.price !== 'number' || !(last.price > 0)) return null;
  const prev = d[d.length - 2];
  return {
    price: last.price,
    prevClose: prev && typeof prev.price === 'number' ? prev.price : null,
    asOf: `${last.date}T${CLOSE_TIME}`,
  };
}

// 即時報價(fetchLiveQuotes 的單筆)→ 現價
export function quoteFromLive(q) {
  if (!q || typeof q.price !== 'number' || !(q.price > 0) || !q.date) return null;
  return {
    price: q.price,
    prevClose: typeof q.prevClose === 'number' ? q.prevClose : null,
    asOf: `${q.date}T${q.time || '00:00:00'}`,
  };
}

// 取比較新的那一筆;時間相同時用新來的(b),例如收盤後即時報價與日收盤同為 13:30。
// 沒有 asOf 的舊資料一律視為最舊。
export function pickNewer(a, b) {
  if (!b) return a || null;
  if (!a) return b;
  const ta = a.asOf || '';
  const tb = b.asOf || '';
  return tb >= ta ? b : a;
}

const safeParse = (raw) => {
  try {
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === 'object' ? v : null;
  } catch (e) {
    return null;
  }
};

export function loadLastQuotes(storage) {
  try {
    const v = safeParse(storage && storage.getItem(LAST_QUOTES_KEY));
    return v || {};
  } catch (e) {
    return {};
  }
}

// 只存有現價的代號;寫入失敗(私密瀏覽、空間不足)安靜放棄,不影響畫面
export function saveLastQuotes(storage, prices) {
  const out = {};
  Object.keys(prices || {}).forEach((sym) => {
    const p = prices[sym];
    if (p && typeof p.price === 'number' && p.price > 0) {
      out[sym] = { price: p.price, prevClose: p.prevClose == null ? null : p.prevClose, asOf: p.asOf || '' };
    }
  });
  try {
    if (storage) storage.setItem(LAST_QUOTES_KEY, JSON.stringify(out));
  } catch (e) {
    // 略過
  }
  return out;
}

// 開啟時的墊檔:上一次顯示的現價 vs 股價歷史快取,取比較新的
export function seedQuote(symbol, { lastQuotes, loadPriceCache }) {
  const saved = lastQuotes && lastQuotes[symbol];
  const fromSaved = saved && typeof saved.price === 'number' && saved.price > 0 ? saved : null;
  let fromCache = null;
  try {
    const cached = loadPriceCache ? loadPriceCache(symbol) : null;
    fromCache = cached ? quoteFromDaily(cached.data) : null;
  } catch (e) {
    fromCache = null;
  }
  return pickNewer(fromSaved, fromCache);
}

// 把一筆新的現價套到 prices 狀態上:比畫面上的舊,就不覆蓋(只清掉 loading/error)
export function applyQuote(prev, symbol, q) {
  const cur = prev[symbol] || {};
  if (!q) return { ...prev, [symbol]: { ...cur, loading: false } };
  const curQuote = typeof cur.price === 'number' && cur.price > 0 ? cur : null;
  const best = pickNewer(curQuote, q);
  return {
    ...prev,
    [symbol]: { ...cur, price: best.price, prevClose: best.prevClose, asOf: best.asOf, loading: false, error: false },
  };
}
