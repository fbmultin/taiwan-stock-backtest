// 回檔雷達(第一層)的資料層:取得完整歷史、分割校正、含息還原價、資料來源警示、
// 唯讀讀取持股。規格依據:設計文件 13.11、14.5。
//
// 設計重點(為什麼這樣寫):
//   1. 不改 dataCache.js(其他三個分頁依賴它)。近 20 年照常用 fetchStockPriceData,
//      和其他分頁共用同一份快取;dataCache 只抓 20 年,所以 20 年之前的舊段另外向
//      FinMind 補抓,存在自己的 localStorage key(pullback_hist_<代號>)。舊段是不會
//      再變的歷史,抓一次就好;失敗時只用近 20 年,並標示「僅含近 20 年資料」。
//      舊段不退到 Yahoo:Yahoo 的 0050 從 2009 年才有資料、2013 年以前沒有配息紀錄
//      (設計文件 10.1.3 的資料品質抽驗)。
//   2. 分割校正沿用 App.js applySplitAdjustments 的判斷邏輯,但寫成「不改傳入資料」的版本:
//      App.js 那份沒有 export、而且會直接改傳進來的物件;為了不動 App.js 的主程式,
//      這裡重寫一份,行為對照見 pullbackData.test.js。
//   3. 持股只讀不寫:只呼叫 loadPortfolioData() 與 fetchRemoteDataOnce(),
//      不呼叫任何 save*、也不呼叫 subscribeRemoteData(13.11 補充要求 3)。

import TW_STOCK_SPLITS from './data/twStockSplits';
import { holdingEpisode } from './pullbackStats';

export const HIST_CACHE_PREFIX = 'pullback_hist_';
export const SETTINGS_KEY = 'pullback_settings';
const HIST_SCHEMA = 1;
const DATACACHE_HISTORY_YEARS = 20; // 必須和 dataCache.js 的 FETCH_HISTORY_YEARS 一致
// 近 20 年那段的第一筆日期如果落在「20 年錨點 + 這麼多天」之內,代表資料是被
// 20 年上限截斷的,前面可能還有更早的歷史 → 需要補抓舊段。
const ANCHOR_SLACK_DAYS = 20;
// 台股單日漲跌幅限制 10%;接縫處超過這個幅度又沒有除息或分割可以解釋,就判定是假跳空。
const SEAM_MAX_JUMP = 0.105;
// 接縫兩邊相隔超過這麼多個日曆天,判定為遺漏(正常最長的連假約 9 天)。
const SEAM_MAX_GAP_DAYS = 12;

export const WARN_TEXT = {
  yahoo: '資料來自備援來源，可能有誤差（Yahoo 在部分期間缺配息或價格錯位）',
  unknownSource: '最近一次更新來源未記錄（舊版快取），無法確認資料來源',
  dividendIncomplete: '配息資料可能不完整，含息回檔可能有誤差',
  histFailed: '僅含近 20 年資料',
  seamRejected: '20 年前的舊段資料與近期資料銜接異常，已改用近 20 年資料',
};
export const staleText = (date) => `最新資料抓取失敗，資料只更新到 ${date}`;

const isoDate = (ts) => new Date(ts).toISOString().split('T')[0];
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

// dataCache 的 dividendsMap 有的用毫秒、有的用秒當 key(依資料來源而定),
// 沿用既有程式(App.js、dcaEngine.js)的三種查法。
function lookupDividend(dividendsMap, ts) {
  if (!dividendsMap) return null;
  const keySec = Math.floor(ts / 1000);
  return dividendsMap[keySec.toString()] || dividendsMap[keySec] || dividendsMap[ts] || null;
}

// 把 dataCache 格式的除息資料轉成「日期 → 金額」
export function dividendsByDate(result) {
  const map = new Map();
  (result.divDates || []).forEach((ts) => {
    const info = lookupDividend(result.dividendsMap, ts);
    const amount = info && typeof info.amount === 'number' ? info.amount : 0;
    if (amount > 0) map.set(isoDate(ts), (map.get(isoDate(ts)) || 0) + amount);
  });
  return map;
}

// ── 分割校正(不改傳入資料)──
// 判斷邏輯與 App.js applySplitAdjustments 相同:先看「恢復買賣日前最後一筆價格」
// 比較接近分割前或分割後參考價,判斷資料源是否已經調整過,再決定要不要校正。
export function applySplitsPure(symbol, rows, divMap) {
  const pure = String(symbol || '').split('.')[0];
  const events = TW_STOCK_SPLITS.filter((e) => e.symbol === pure).sort((a, b) => (a.date < b.date ? -1 : 1));
  let out = rows.map((r) => ({ ...r }));
  const divs = new Map(divMap);
  const notes = [];
  events.forEach((ev) => {
    const prior = out.filter((d) => d.date < ev.date);
    const after = out.filter((d) => d.date >= ev.date);
    if (!prior.length || !after.length) return;
    const lastPre = prior[prior.length - 1];
    const diffAfter = Math.abs(lastPre.price - ev.priceAfter) / ev.priceAfter;
    const diffBefore = Math.abs(lastPre.price - ev.priceBefore) / ev.priceBefore;
    if (diffAfter <= 0.05 && diffAfter < diffBefore) {
      notes.push({ ...ev, status: 'already_adjusted' });
      return;
    }
    if (diffBefore > 0.5 && diffAfter > 0.5) {
      notes.push({ ...ev, status: 'ambiguous' });
      return;
    }
    const factor = ev.type === 'split' ? 1 / ev.ratio : ev.ratio;
    out = out.map((d) => (d.date < ev.date ? { ...d, price: d.price * factor } : d));
    for (const [date, amt] of divs) if (date < ev.date) divs.set(date, amt * factor);
    notes.push({ ...ev, status: 'corrected' });
  });
  return { rows: out, divMap: divs, notes };
}

// ── 含息還原價 ──
// P̃_t = P̃_{t−1} × (P_t + 當日除息) ÷ P_{t−1}(14.5,和 Step 0 資料快照同一公式)。
// P̃ 的起點設成第一天的價格;比例關係(回檔、報酬)和起點無關。
export function totalReturnIndex(prices, divs) {
  const adj = new Array(prices.length);
  if (!prices.length) return adj;
  adj[0] = prices[0];
  for (let i = 1; i < prices.length; i++) adj[i] = (adj[i - 1] * (prices[i] + (divs[i] || 0))) / prices[i - 1];
  return adj;
}

// dataCache 格式 → 計算用序列
export function toSeries(symbol, result) {
  const rows = (result.data || []).filter((d) => typeof d.price === 'number' && d.price > 0);
  const { rows: adjRows, divMap, notes } = applySplitsPure(symbol, rows, dividendsByDate(result));
  const dates = adjRows.map((d) => d.date);
  const prices = adjRows.map((d) => d.price);
  const divs = dates.map((d) => divMap.get(d) || 0);
  return {
    dates,
    prices, // 分割校正後的收盤價(最後一筆就是目前市價)
    adj: totalReturnIndex(prices, divs),
    divs,
    splitNotes: notes,
    lastDate: dates[dates.length - 1] || null,
    lastMarketPrice: rows.length ? rows[rows.length - 1].price : null,
  };
}

// ── 舊段與近 20 年的接縫 ──
// 規則:舊段只取「早於近期第一天」的資料(去掉重複日期);接縫兩邊相隔太久視為遺漏;
// 接縫價格跳動超過單日漲跌幅限制、又沒有除息或分割可以解釋,視為假跳空。
// 任何一種異常都不合併,改用近 20 年(寧可少資料,也不要讓假跳空變成假的回檔事件)。
export function mergeOldSegment(symbol, oldSeg, recent) {
  if (!oldSeg || !oldSeg.data || !oldSeg.data.length) return { merged: recent, status: 'noOld', dupes: 0 };
  const firstRecent = recent.data[0];
  const kept = oldSeg.data.filter((d) => d.date < firstRecent.date);
  const dupes = oldSeg.data.length - kept.length;
  if (!kept.length) return { merged: recent, status: 'noOld', dupes };
  const lastOld = kept[kept.length - 1];
  const gap = daysBetween(lastOld.date, firstRecent.date);
  if (gap > SEAM_MAX_GAP_DAYS) return { merged: recent, status: 'seamRejected', reason: 'gap', gap, dupes };
  const divOnSeam = dividendsByDate(recent).get(firstRecent.date) || 0;
  const splitOnSeam = TW_STOCK_SPLITS.some((e) => e.symbol === String(symbol).split('.')[0] && e.date > lastOld.date && e.date <= firstRecent.date);
  const jump = (firstRecent.price + divOnSeam) / lastOld.price - 1;
  if (Math.abs(jump) > SEAM_MAX_JUMP && !splitOnSeam) {
    return { merged: recent, status: 'seamRejected', reason: 'jump', jump, dupes };
  }
  const cut = new Date(firstRecent.date).getTime();
  const oldDivDates = (oldSeg.divDates || []).filter((ts) => ts < cut);
  const dividendsMap = { ...(recent.dividendsMap || {}) };
  oldDivDates.forEach((ts) => {
    const info = lookupDividend(oldSeg.dividendsMap, ts);
    if (info) dividendsMap[ts] = info;
  });
  return {
    merged: {
      ...recent,
      data: [...kept, ...recent.data],
      divDates: [...oldDivDates, ...(recent.divDates || [])].sort((a, b) => a - b),
      dividendsMap,
    },
    status: 'included',
    gap,
    jump,
    dupes,
  };
}

// ── 向 FinMind 補抓舊段(和 dataCache 第一層同一組免費資料集)──
export async function fetchFinMindRange(symbol, startStr, endStr, fetchFn = fetch) {
  const base = 'https://api.finmindtrade.com/api/v4/data';
  const get = async (dataset) => {
    const id = String(symbol).split('.')[0]; // FinMind 只認純代號(0050,不是 0050.TW)
    const res = await fetchFn(`${base}?dataset=${dataset}&data_id=${id}&start_date=${startStr}&end_date=${endStr}`);
    return res.json();
  };
  const pj = await get('TaiwanStockPrice');
  if (pj.msg !== 'success' || !Array.isArray(pj.data)) return null;
  const dj = await get('TaiwanStockDividendResult');
  const dividendsMap = {};
  const divDates = [];
  if (dj.msg === 'success' && Array.isArray(dj.data)) {
    dj.data.forEach((d) => {
      const amount = d.stock_and_cache_dividend || d.cash_dividend || d.stock_dividend || 0;
      if (amount > 0) {
        const ts = new Date(d.date).getTime();
        dividendsMap[ts] = { amount };
        divDates.push(ts);
      }
    });
  }
  const data = pj.data
    .filter((p) => typeof p.close === 'number' && Number.isFinite(p.close) && p.close > 0)
    .map((p) => ({ date: p.date, timestamp: new Date(p.date).getTime(), price: p.close }));
  return { data, divDates: divDates.sort((a, b) => a - b), dividendsMap, source: 'FinMind' };
}

const safeGet = (storage, key) => {
  try {
    const raw = storage && storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
};
const safeSet = (storage, key, value) => {
  try {
    if (storage) storage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // 空間不足或私密瀏覽:不快取也不影響這次的計算
  }
};

// 近 20 年那段是否被 20 年上限截斷(也就是前面可能還有資料)
export function looksTruncated(firstDate, lastCompletedTradingDay) {
  const anchor = new Date(lastCompletedTradingDay);
  anchor.setFullYear(anchor.getFullYear() - DATACACHE_HISTORY_YEARS);
  return daysBetween(isoDate(anchor.getTime()), firstDate) <= ANCHOR_SLACK_DAYS;
}

// ── 對外主入口:完整歷史 + 警示 ──
// deps 可注入,方便測試(不打網路、不碰真的 localStorage)。
// withOldSegment=false:持股提醒用。持股提醒只需要最近的回看窗口與持有期間,
// 不需要 20 年前的舊段;每檔持股都補抓舊段會多打很多次 FinMind(免費額度有限)。
export async function loadFullHistory(symbol, deps) {
  const { fetchStockPriceData, fetchFinMind = fetchFinMindRange, storage, lastCompletedTradingDay, withOldSegment = true } = deps;
  const recent = await fetchStockPriceData(symbol);
  if (!recent || !recent.data || !recent.data.length) return null;

  let merged = recent;
  let histStatus = 'notNeeded';
  let seam = null;
  if (!withOldSegment) histStatus = 'skipped';
  else if (looksTruncated(recent.data[0].date, lastCompletedTradingDay)) {
    const key = `${HIST_CACHE_PREFIX}${symbol}`;
    const firstRecent = recent.data[0].date;
    let old = safeGet(storage, key);
    // 快取的舊段必須涵蓋到近期第一天之前;近期那段若因重建快取而往後移,舊段就要重抓
    if (!old || old.schema !== HIST_SCHEMA || old.endBefore < firstRecent) {
      old = null;
      try {
        const end = new Date(new Date(firstRecent).getTime() - 86400000);
        const got = await fetchFinMind(symbol, '1990-01-01', isoDate(end.getTime()));
        if (got) {
          old = { schema: HIST_SCHEMA, endBefore: firstRecent, ...got, fetchedAt: new Date().toISOString() };
          safeSet(storage, key, old);
        }
      } catch (e) {
        old = null;
      }
    }
    if (!old) histStatus = 'failed';
    else {
      seam = mergeOldSegment(symbol, old, recent);
      merged = seam.merged;
      histStatus = seam.status;
    }
  }

  const series = toSeries(symbol, merged);
  const source = recent.source || '';
  const warnings = [];
  if (source === 'Yahoo') warnings.push({ level: 'warn', text: WARN_TEXT.yahoo });
  if (!source) warnings.push({ level: 'warn', text: WARN_TEXT.unknownSource });
  if (recent.dividendDataIncomplete) warnings.push({ level: 'warn', text: WARN_TEXT.dividendIncomplete });
  if (recent.stale) warnings.push({ level: 'warn', text: staleText(series.lastDate) });
  if (histStatus === 'failed') warnings.push({ level: 'info', text: WARN_TEXT.histFailed });
  if (histStatus === 'seamRejected') warnings.push({ level: 'warn', text: WARN_TEXT.seamRejected });
  return { symbol, series, source, histStatus, seam, warnings, stale: !!recent.stale };
}

// ── 持股:唯讀 ──
// 已登入:讀一次雲端(不訂閱、不寫回);未登入或讀取失敗:用本機資料。
export async function loadPortfolioReadOnly({ uid, loadPortfolioData, fetchRemoteDataOnce }) {
  const local = loadPortfolioData();
  if (!uid) return { data: local, from: 'local' };
  try {
    const remote = await fetchRemoteDataOnce(uid);
    if (remote && Array.isArray(remote.transactions)) return { data: remote, from: 'cloud' };
  } catch (e) {
    // 讀不到雲端就用本機資料,不影響畫面
  }
  return { data: local, from: 'local' };
}

// 各群組、各代號分開(13.11 第 3 項):回傳目前持有中的 (群組, 代號) 清單與起點。
export function holdingRows(portfolio) {
  const groups = (portfolio && portfolio.groups) || [];
  const txs = (portfolio && portfolio.transactions) || [];
  const byKey = new Map();
  txs.forEach((tx) => {
    if (!tx || !tx.symbol || !tx.groupId) return;
    const k = `${tx.groupId}|${tx.symbol}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(tx);
  });
  const rows = [];
  for (const [k, list] of byKey) {
    const [groupId, symbol] = k.split('|');
    const ep = holdingEpisode(list);
    if (!ep.holding) continue;
    const g = groups.find((x) => x.id === groupId);
    rows.push({ key: k, groupId, groupName: g ? g.name : '(未知群組)', groupColor: g ? g.color : null, symbol, shares: ep.shares, startDate: ep.startDate });
  }
  return rows.sort((a, b) => (a.symbol === b.symbol ? (a.groupName < b.groupName ? -1 : 1) : a.symbol < b.symbol ? -1 : 1));
}

// ── 本機設定(停利回落%、窗口)──
export function loadSettings(storage) {
  const s = safeGet(storage, SETTINGS_KEY) || {};
  return {
    defaultStopPct: typeof s.defaultStopPct === 'number' ? s.defaultStopPct : 10,
    overrides: s.overrides && typeof s.overrides === 'object' ? s.overrides : {},
    window: s.window === 60 ? 60 : 252,
  };
}
export function saveSettings(storage, settings) {
  safeSet(storage, SETTINGS_KEY, settings);
}
export const stopPctFor = (settings, groupId, symbol) => {
  const v = settings.overrides[`${groupId}|${symbol}`];
  return typeof v === 'number' ? v : settings.defaultStopPct;
};
