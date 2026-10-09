// 「我的持股」功能的資料層與試算引擎。
//
// 本機一律先用 localStorage 當快取(離線、或還沒登入時也能馬上讀寫)。
// 登入 Google 帳號後,額外加上 Firestore 雲端同步:雲端那份資料是跨裝置的
// 「正本」,本機 localStorage 只是加速開啟、離線備援用的影子副本。

import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from './firebase';

const STORAGE_KEY = 'portfolio_tracker_v1';

// 雲端資料存放位置:每個登入的使用者(uid)各自一份文件,
// 存在 portfolios/{uid} 底下,彼此完全隔離。
const REMOTE_COLLECTION = 'portfolios';

// Firestore 不接受欄位值是 undefined,用 JSON 來回轉一次順便把這種值清掉
// (跟原本存 localStorage 時用的 JSON.stringify 邏輯一致,行為不會變)。
function sanitizeForFirestore(data) {
  return JSON.parse(JSON.stringify(data));
}

// 一次性讀取雲端現有資料;還沒有資料(帳號第一次登入)回傳 null。
export async function fetchRemoteDataOnce(uid) {
  if (!uid) return null;
  const snap = await getDoc(doc(db, REMOTE_COLLECTION, uid));
  return snap.exists() ? snap.data() : null;
}

// 訂閱雲端資料變化(例如在另一台裝置上改的),回傳取消訂閱函式。
// 第二個參數帶 hasPendingWrites:這台裝置自己剛寫、還沒被伺服器確認的那一版也會觸發一次,
// 呼叫端用它分辨「別台裝置改的」與「自己寫的回音」。
export function subscribeRemoteData(uid, onData, onError) {
  if (!uid) return () => {};
  return onSnapshot(
    doc(db, REMOTE_COLLECTION, uid),
    (snap) =>
      onData(snap.exists() ? snap.data() : null, {
        hasPendingWrites: Boolean(snap.metadata && snap.metadata.hasPendingWrites),
      }),
    onError
  );
}

let saveTimer = null;
// 把資料寫回雲端;預設加一點 debounce,避免連續操作(例如快速點+/-調整股數)
// 時每一下都各自觸發一次網路寫入。immediate:true 用在「合併後要立刻把本機補的資料上傳」。
// 注意:呼叫端必須先確認「已經成功讀過雲端」才能呼叫(見 portfolioSync.js 開頭的事故說明),
// 這個函式本身不做判斷。onSaved/onError 讓畫面能顯示同步狀態。
export function saveRemoteData(uid, data, { immediate = false, onSaved, onError } = {}) {
  if (!uid) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  const payload = sanitizeForFirestore(data);
  const run = () => {
    saveTimer = null;
    setDoc(doc(db, REMOTE_COLLECTION, uid), payload)
      .then(() => onSaved && onSaved(payload))
      .catch((e) => {
        console.error('雲端同步失敗(本機資料不受影響,下次有網路時會再試)', e);
        if (onError) onError(e);
      });
  };
  if (immediate) run();
  else saveTimer = setTimeout(run, 800);
}

// 還有一筆等著送出的變更(debounce 中)。這段期間收到的雲端快照不能拿來蓋本機,
// 否則剛剛的操作會被舊版本吃掉。
export function hasPendingRemoteSave() {
  return saveTimer !== null;
}

// 登出/換帳號時取消還沒送出的寫入,避免寫到錯的帳號
export function cancelPendingRemoteSave() {
  clearTimeout(saveTimer);
  saveTimer = null;
}

export const TX_TYPES = {
  BUY: 'buy',
  SELL: 'sell',
  CASH_DIVIDEND: 'cashDividend',
  STOCK_DIVIDEND: 'stockDividend',
};

export const TX_TYPE_LABELS = {
  [TX_TYPES.BUY]: '買進',
  [TX_TYPES.SELL]: '賣出',
  [TX_TYPES.CASH_DIVIDEND]: '股利',
  [TX_TYPES.STOCK_DIVIDEND]: '股票股利',
};

// 群組切換器裡固定存在的「虛擬群組」,代表不分群組、全部加總的總覽,
// 不是一筆真正存在 groups 陣列裡的紀錄,所以不能被改名/刪除。
export const ALL_GROUP_ID = '__all__';

export const DEFAULT_GROUP_COLORS = [
  '#34d399', // emerald,跟專案既有強調色一致
  '#60a5fa', // blue
  '#f472b6', // pink
  '#fbbf24', // amber
  '#a78bfa', // violet
  '#fb7185', // rose
  '#38bdf8', // sky
  '#4ade80', // green
];

const uid = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;

const defaultGroup = () => ({
  id: uid(),
  name: '我的持股',
  color: DEFAULT_GROUP_COLORS[0],
  // 手續費優惠跟低消,ETF跟一般股票很多券商會分開報價(各自的折數活動、低消
  // 門檻不一樣),所以這裡分成兩組獨立設定,新增交易時依代號自動判斷套用
  // 哪一組(也可以手動切換)。折數是百分比表示,100 = 不打折。
  etfFeeDiscountPct: 100,
  etfMinFeeNormal: 20, // ETF一般交易手續費低消(元)
  etfMinFeeOdd: 20, // ETF零股交易手續費低消(元)
  stockFeeDiscountPct: 100,
  stockMinFeeNormal: 20, // 一般股票交易手續費低消(元)
  stockMinFeeOdd: 20, // 一般股票零股交易手續費低消(元)
  createdAt: Date.now(),
  order: 0,
});

function defaultData() {
  const g = defaultGroup();
  return {
    version: 1,
    groups: [g],
    tags: [],
    transactions: [],
    activeGroupId: g.id,
  };
}

// 把舊版資料(只有一組 feeDiscountPct/minFeeNormal/minFeeOdd,不分ETF跟一般
// 股票)搬到新的欄位,ETF跟一般股票先沿用原本那組數字當起始值,之後使用者可以
// 在群組設定裡各自調整。已經是新版格式(存在 etfFeeDiscountPct 等欄位)的
// 群組就原封不動,不會覆蓋使用者已經設定好的值。
function migrateGroup(g) {
  const legacyDiscount = typeof g.feeDiscountPct === 'number' ? g.feeDiscountPct : 100;
  const legacyMinNormal = typeof g.minFeeNormal === 'number' ? g.minFeeNormal : 20;
  const legacyMinOdd = typeof g.minFeeOdd === 'number' ? g.minFeeOdd : 20;
  return {
    ...g,
    etfFeeDiscountPct: typeof g.etfFeeDiscountPct === 'number' ? g.etfFeeDiscountPct : legacyDiscount,
    etfMinFeeNormal: typeof g.etfMinFeeNormal === 'number' ? g.etfMinFeeNormal : legacyMinNormal,
    etfMinFeeOdd: typeof g.etfMinFeeOdd === 'number' ? g.etfMinFeeOdd : legacyMinOdd,
    stockFeeDiscountPct: typeof g.stockFeeDiscountPct === 'number' ? g.stockFeeDiscountPct : legacyDiscount,
    stockMinFeeNormal: typeof g.stockMinFeeNormal === 'number' ? g.stockMinFeeNormal : legacyMinNormal,
    stockMinFeeOdd: typeof g.stockMinFeeOdd === 'number' ? g.stockMinFeeOdd : legacyMinOdd,
  };
}

// 把任何來源(本機 localStorage、雲端 Firestore)的資料整理成同一個格式;
// 雲端那份原本是直接拿來用,沒有經過舊欄位搬移,這裡統一處理。
export function normalizePortfolioData(parsed) {
  if (!parsed || !Array.isArray(parsed.groups) || parsed.groups.length === 0) {
    const base = defaultData();
    // 群組被清空但還有交易時,保留交易(掛到預設群組上),不要讓交易跟著消失
    const txs = parsed && Array.isArray(parsed.transactions) ? parsed.transactions : [];
    return { ...base, transactions: txs.map((t) => ({ ...t, groupId: base.groups[0].id })) };
  }
  return {
    version: 1,
    groups: parsed.groups.map(migrateGroup),
    tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
    activeGroupId: parsed.activeGroupId || parsed.groups[0].id,
  };
}

export function loadPortfolioData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultData();
    return normalizePortfolioData(JSON.parse(raw));
  } catch (e) {
    console.error('讀取持股資料失敗,改用預設空白資料', e);
    return defaultData();
  }
}

export function savePortfolioData(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('儲存持股資料失敗(可能是瀏覽器儲存空間不足)', e);
  }
}

// ---------- 群組 CRUD ----------

export function createGroup(data, { name, color }) {
  const g = {
    ...defaultGroup(),
    name: name || '新群組',
    color: color || DEFAULT_GROUP_COLORS[data.groups.length % DEFAULT_GROUP_COLORS.length],
    order: data.groups.length,
  };
  return { ...data, groups: [...data.groups, g], activeGroupId: g.id };
}

export function updateGroup(data, groupId, patch) {
  return {
    ...data,
    groups: data.groups.map((g) => (g.id === groupId ? { ...g, ...patch } : g)),
  };
}

export function deleteGroup(data, groupId) {
  const remaining = data.groups.filter((g) => g.id !== groupId);
  const groups = remaining.length > 0 ? remaining : [defaultGroup()];
  const fallbackId = groups[0].id;
  return {
    ...data,
    groups,
    // 被刪除群組底下的交易紀錄,全部轉移到剩下的第一個群組,不會憑空消失。
    transactions: data.transactions.map((tx) =>
      tx.groupId === groupId ? { ...tx, groupId: fallbackId } : tx
    ),
    activeGroupId: data.activeGroupId === groupId ? ALL_GROUP_ID : data.activeGroupId,
  };
}

// ---------- 標籤(批次標記)CRUD ----------

export function createTag(data, { name, color }) {
  const t = { id: uid(), name: name || '未命名標籤', color: color || '#94a3b8', createdAt: Date.now() };
  return { ...data, tags: [...data.tags, t] };
}

export function deleteTag(data, tagId) {
  return {
    ...data,
    tags: data.tags.filter((t) => t.id !== tagId),
    transactions: data.transactions.map((tx) =>
      tx.tagId === tagId ? { ...tx, tagId: null } : tx
    ),
  };
}

// 建立一個新標籤,並在同一次更新裡直接套用到選取的交易紀錄上,
// 避免「先建立、再用剛拿到的 id 套用」拆成兩次 setState 時的時序問題。
export function createTagAndApply(data, { name, color }, txIds) {
  const t = { id: uid(), name: name || '未命名標籤', color: color || '#94a3b8', createdAt: Date.now() };
  const idSet = new Set(txIds);
  return {
    ...data,
    tags: [...data.tags, t],
    transactions: data.transactions.map((tx) => (idSet.has(tx.id) ? { ...tx, tagId: t.id } : tx)),
  };
}

// 移除標籤:把選到的交易的 tagId 清掉,讓它們回到一般交易列表。
// 標籤本身(名稱/顏色)保留在 data.tags,之後還可以重新套用;不自動刪除沒人用的標籤,
// 避免誤刪使用者取好的名字。
export function removeTagFromTransactions(data, txIds) {
  const idSet = new Set(txIds);
  return {
    ...data,
    transactions: data.transactions.map((tx) => (idSet.has(tx.id) && tx.tagId ? { ...tx, tagId: null } : tx)),
  };
}

export function applyTagToTransactions(data, txIds, tagId) {
  const idSet = new Set(txIds);
  return {
    ...data,
    transactions: data.transactions.map((tx) =>
      idSet.has(tx.id) ? { ...tx, tagId: tagId || null } : tx
    ),
  };
}

// ---------- 交易紀錄 CRUD ----------

export function addTransaction(data, tx) {
  const newTx = {
    id: uid(),
    symbol: tx.symbol,
    type: tx.type,
    date: tx.date,
    price: Number(tx.price) || 0,
    shares: Number(tx.shares) || 0,
    amount: Number(tx.amount) || 0,
    fee: Number(tx.fee) || 0,
    tax: Number(tx.tax) || 0,
    groupId: tx.groupId,
    tagId: tx.tagId || null,
    note: tx.note || '',
    createdAt: Date.now(),
  };
  return { ...data, transactions: [...data.transactions, newTx] };
}

export function updateTransaction(data, txId, patch) {
  return {
    ...data,
    transactions: data.transactions.map((tx) => (tx.id === txId ? { ...tx, ...patch } : tx)),
  };
}

export function deleteTransaction(data, txId) {
  return { ...data, transactions: data.transactions.filter((tx) => tx.id !== txId) };
}

export function moveTransactionToGroup(data, txId, groupId) {
  return updateTransaction(data, txId, { groupId });
}

// 把某幾檔股票「底下所有交易紀錄」一次搬到另一個群組(持股列表的「框選移動」
// 用這個,跟上面單筆交易的移動是兩個不同的操作入口)。
export function moveSymbolsToGroup(data, symbols, groupId) {
  const set = new Set(symbols);
  return {
    ...data,
    transactions: data.transactions.map((tx) => (set.has(tx.symbol) ? { ...tx, groupId } : tx)),
  };
}

// ---------- 持股列表排序 ----------

// 已出場部位的「出場時間」:最後一筆賣出的日期(同一天多筆時再比建立時間)。
// 沒有任何賣出紀錄就出場的(例如只記了股利、或股數被編輯成 0)退回用最後一筆交易。
export function lastExitKey(txs) {
  const list = Array.isArray(txs) ? txs : [];
  const sells = list.filter((t) => t.type === TX_TYPES.SELL);
  const pool = sells.length ? sells : list;
  let best = { date: '', createdAt: 0 };
  pool.forEach((t) => {
    const d = t.date || '';
    const c = t.createdAt || 0;
    if (d > best.date || (d === best.date && c > best.createdAt)) best = { date: d, createdAt: c };
  });
  return best;
}

// 持股列表的顯示順序:
//   1. 持有中的部位在前,依市值大到小(原本的排法,不變)
//   2. 打開「顯示已出場部位」時,已出場的接在後面,依最後一筆賣出日期 新 → 舊
//      ——已出場的市值都是 0,原本混在一起排等於沒有順序,找最近剛賣掉的那檔很難找。
// holdings 每筆需有 summary.shares、summary.marketValue、txs。
export function sortHoldingsForDisplay(holdings) {
  const open = [];
  const closed = [];
  (holdings || []).forEach((h) => (h.summary && h.summary.shares > 0 ? open : closed).push(h));
  open.sort((a, b) => (b.summary.marketValue || 0) - (a.summary.marketValue || 0));
  const keyed = closed.map((h) => ({ h, k: lastExitKey(h.txs) }));
  keyed.sort((a, b) => {
    if (a.k.date !== b.k.date) return a.k.date < b.k.date ? 1 : -1;
    return b.k.createdAt - a.k.createdAt;
  });
  return open.concat(keyed.map((x) => x.h));
}

// ---------- 手續費試算 ----------

// 券商交割單的算法:價金、手續費、證交稅都是「計算到元,元以下無條件捨去」,
// 不是四捨五入——原本用 Math.round,常常跟交割單差 1 元(例如價金 15,300 的手續費
// 21.8 元,交割單是 21,四捨五入會變 22)。浮點數相乘可能出現 21.999999… 這種
// 誤差,所以先加一個極小值再捨去,避免把剛好整數的金額少算 1 元。
const FLOOR_EPS = 1e-6;
export const floorYuan = (x) => Math.floor((Number(x) || 0) + FLOOR_EPS);

// 成交價金(元以下捨去;整張交易本來就是整數,零股如 15.31 × 37 = 566.47 → 566)
export function tradeGross(price, shares) {
  return floorYuan((Number(price) || 0) * (Number(shares) || 0));
}

// 依群組的手續費優惠設定,算出一筆買賣交易的手續費(元以下捨去,不低於低消)。
// 零股(不足1000股)用「零股交易手續費低消」,整張交易用「一般交易手續費低消」。
// 很多券商ETF跟一般股票的折數、低消門檻是分開報價的,所以群組底下分成兩組
// 獨立設定,由 isEtf 決定要用哪一組(預設為一般股票)。
export function estimateFee(group, price, shares, isEtf = false) {
  if (!group || !price || !shares) return 0;
  const isOddLot = shares % 1000 !== 0;
  const discountPct = isEtf ? group.etfFeeDiscountPct : group.stockFeeDiscountPct;
  const minFeeNormal = isEtf ? group.etfMinFeeNormal : group.stockMinFeeNormal;
  const minFeeOdd = isEtf ? group.etfMinFeeOdd : group.stockMinFeeOdd;
  const minFee = isOddLot ? minFeeOdd : minFeeNormal;
  const effectiveDiscountPct = typeof discountPct === 'number' ? discountPct : 100;
  const raw = tradeGross(price, shares) * 0.001425 * (effectiveDiscountPct / 100);
  return Math.max(floorYuan(raw), Math.round(minFee || 0));
}

// 粗略判斷代號是不是ETF:台灣證交所的ETF(含ETN、槓反、債券、主動式ETF)
// 編號慣例全部以「00」開頭(0050、0056、00878、00631L...),一般個股則是
// 4碼不以00開頭。證交稅就是用這個規則區分——ETF證交稅千分之1,一般股票是
// 三倍的千分之3,猜錯會讓已實現/估計出場損益差出好幾倍的稅額。這只是慣例
// 判斷不保證100%準確,所以新增交易時仍保留手動切換的選項。
export function isLikelyETF(symbol) {
  return /^00/.test(String(symbol || '').trim());
}

// 債券ETF(代號 00 開頭、最後一碼 B,例如 00679B、00945B)。
export function isBondETF(symbol) {
  return /^00\d{3,4}B$/.test(String(symbol || '').trim().toUpperCase());
}

// 證交稅相關的法定期限(證券交易稅條例):
// - 第2條之1:債券ETF 停徵證交稅,目前至民國115年(2026)12月31日。
//   行政院 2026-10-01 已通過再延長10年至125年(2036)底的修正草案,但立法院還沒三讀;
//   三讀後把這個日期改成 '2036-12-31' 即可。
// - 第2條之2:現股當沖證交稅減半(千分之3 → 千分之1.5),2024-12-31 三讀延長至 2027-12-31。
//   適用對象是「股票」的現股當沖;ETF 本身稅率就是千分之1,不再減半。
export const BOND_ETF_TAX_EXEMPT_UNTIL = '2026-12-31';
export const DAY_TRADE_TAX_HALF_UNTIL = '2027-12-31';

// 證交稅率(賣出時才課):
//   一般股票 千分之3;現股當沖 千分之1.5(期限內)
//   ETF(含 ETN、槓反、主動式)千分之1,當沖不減半
//   債券ETF 停徵期間內 0
// date 是交易日期(YYYY-MM-DD),用來判斷是否還在停徵/減半期間;沒給就當作今天。
export function securityTaxRate({ isEtf = false, isBondEtf = false, isDayTrade = false, date } = {}) {
  const d = date || new Date().toISOString().slice(0, 10);
  if (isEtf && isBondEtf && d <= BOND_ETF_TAX_EXEMPT_UNTIL) return 0;
  if (isEtf) return 0.001;
  if (isDayTrade && d <= DAY_TRADE_TAX_HALF_UNTIL) return 0.0015;
  return 0.003;
}

// 證交稅金額(元以下捨去,跟交割單一致)。taxRate 由呼叫端用 securityTaxRate 算好傳入;
// 舊的呼叫方式(isDayTrade + taxRate,當沖再減半)保留相容,但新程式請直接傳最終稅率。
export function estimateTax(price, shares, { isDayTrade = false, taxRate = 0.003 } = {}) {
  return floorYuan(tradeGross(price, shares) * taxRate * (isDayTrade ? 0.5 : 1));
}

// 判斷一筆賣出交易是否算「當沖」:同一天、同一檔股票,交易紀錄裡已經有買進
// (不分群組,因為當沖是稅務上對同一檔股票的認定,跟這個 app 自己分的群組無關)。
// 只影響賣出那一筆的證交稅(當沖減半),買進的手續費不受影響。
export function isDayTradeSell(transactions, symbol, date, excludeTxId = null) {
  return transactions.some(
    (t) => t.id !== excludeTxId && t.symbol === symbol && t.date === date && t.type === TX_TYPES.BUY
  );
}

// 當沖股數配對:同一檔、同一天同時有買有賣,就把「買」跟「賣」能互相抵銷的股數
// (= min(當天買進總股數, 當天賣出總股數))視為當沖。依登記順序(createdAt,再依原順序)
// 分配到各筆買進與賣出:先登記的先配。不分先買後賣或先賣後買,只看同一天。
// 回傳 { buyDt: {txId: 股數}, sellDt: {txId: 股數} }
// 為什麼要獨立出來:持股試算(庫存/均價/已實現)、先進先出配對、當日損益、證交稅
// 都要用同一份「哪幾股是當沖」的認定,才不會各算各的對不起來。
export function allocateDayTrades(transactions) {
  const byDate = {};
  (transactions || []).forEach((t, i) => {
    if (t.type !== TX_TYPES.BUY && t.type !== TX_TYPES.SELL) return;
    (byDate[t.date] = byDate[t.date] || []).push({ t, i });
  });
  const buyDt = {};
  const sellDt = {};
  const order = (a, b) => (a.t.createdAt || 0) - (b.t.createdAt || 0) || a.i - b.i;
  Object.values(byDate).forEach((list) => {
    const buys = list.filter((x) => x.t.type === TX_TYPES.BUY).sort(order);
    const sells = list.filter((x) => x.t.type === TX_TYPES.SELL).sort(order);
    const sum = (arr) => arr.reduce((n, x) => n + (x.t.shares || 0), 0);
    const total = Math.min(sum(buys), sum(sells));
    if (total <= 0) return;
    const assign = (arr, out) => {
      let rest = total;
      arr.forEach(({ t }) => {
        const take = Math.min(t.shares || 0, rest);
        rest -= take;
        if (take > 0) out[t.id] = take;
      });
    };
    assign(buys, buyDt);
    assign(sells, sellDt);
  });
  return { buyDt, sellDt };
}

// 新增/編輯一筆賣出時,這筆裡有幾股算當沖:同一天同一檔(不分群組,稅務上看的是
// 同一個帳戶)的買進總股數,扣掉同一天其他賣出已經配走的,剩下的才配給這筆。
export function dayTradeSharesForSell(transactions, symbol, date, sellShares, excludeTxId = null) {
  let buys = 0;
  let otherSells = 0;
  (transactions || []).forEach((t) => {
    if (t.id === excludeTxId || t.symbol !== symbol || t.date !== date) return;
    if (t.type === TX_TYPES.BUY) buys += t.shares || 0;
    else if (t.type === TX_TYPES.SELL) otherSells += t.shares || 0;
  });
  return Math.max(0, Math.min(sellShares || 0, buys - otherSells));
}

// 賣出證交稅:當沖的股數用當沖稅率(股票期限內千分之1.5),其餘用一般稅率,
// 分開計算各自元以下捨去後相加(券商交割單對部分當沖也是拆開算)。
// ETF 當沖不減半,兩個稅率相同時直接整筆算,避免拆開捨去多差 1 元。
export function estimateSellTax(price, shares, { dayTradeShares = 0, isEtf = false, isBondEtf = false, date } = {}) {
  const dt = Math.max(0, Math.min(dayTradeShares || 0, shares || 0));
  const normalRate = securityTaxRate({ isEtf, isBondEtf, isDayTrade: false, date });
  const dtRate = securityTaxRate({ isEtf, isBondEtf, isDayTrade: true, date });
  if (dt <= 0 || dtRate === normalRate) return estimateTax(price, shares, { taxRate: normalRate });
  return estimateTax(price, dt, { taxRate: dtRate }) + estimateTax(price, shares - dt, { taxRate: normalRate });
}

// 計算一組交易紀錄的「淨股數」變化:買進、股票股利增加股數,賣出減少股數,
// 現金股利不影響股數。框選套用標籤(標記成一組「已清倉」波段)時用這個檢查
// 選取的交易淨股數是否等於0——等於0才代表這組交易買了又全部賣光,沒有剩餘
// 庫存,可以自成一組獨立計算已實現損益,不會跟其他波段的庫存混在一起算錯。
export function netShareDelta(txs) {
  return txs.reduce((sum, tx) => {
    if (tx.type === TX_TYPES.BUY || tx.type === TX_TYPES.STOCK_DIVIDEND) return sum + tx.shares;
    if (tx.type === TX_TYPES.SELL) return sum - tx.shares;
    return sum;
  }, 0);
}

// 台股申報價格升降單位(最小跳動),依證交所「升降單位」表(櫃買中心相同):
//   股票(含存託憑證、封閉式基金等):
//     未滿10元 0.01 / 10~未滿50元 0.05 / 50~未滿100元 0.1 / 100~未滿500元 0.5 /
//     500~未滿1000元 1 / 1000元以上 5
//   ETF、ETN、REITs(含債券ETF、槓反、主動式ETF):未滿50元 0.01 / 50元以上 0.05
// 以前只有股票那張表,ETF 也套用,所以像 00945B 這種 10~50 元的債券ETF 按加減鈕
// 一次跳 0.05,跳不到 13.27 這種 ETF 合法的價位——現在依商品類型分開。
export function tickSize(price, isEtf = false) {
  const p = Number(price) || 0;
  if (isEtf) return p < 50 ? 0.01 : 0.05;
  if (p < 10) return 0.01;
  if (p < 50) return 0.05;
  if (p < 100) return 0.1;
  if (p < 500) return 0.5;
  if (p < 1000) return 1;
  return 5;
}

// 依目前價格所在的級距,把價格往上或往下調整一個最小跳動單位。方向 direction
// 傳 1(往上)或 -1(往下)。
// 規則:
// - 往上用「目前價格」的級距;往下用「比目前價格低一點」的級距——剛好落在級距邊界時
//   (例如股票 50.00 往下),下一個價位屬於下面那一級(49.95),不是 49.90。
// - 目前價格不在合法價位上(例如手動輸入 12.33 的股票),先對齊到該方向最近的合法價位,
//   而不是在錯誤價位上再加減一個跳動。
// - 四捨五入到兩位小數,避免浮點誤差累積出 0.3000000004。
export function stepPrice(price, direction, isEtf = false) {
  const current = Number(price) || 0;
  const round2 = (x) => Number((Math.round(x * 100) / 100).toFixed(2));
  const EPS = 1e-9;
  if (direction > 0) {
    const tick = tickSize(current, isEtf);
    const aligned = Math.floor(current / tick + EPS) * tick; // 目前價位往下對齊
    const next = round2(aligned + tick);
    // 跨級距時用新級距重新對齊(例如股票 49.95 往上 → 50.00,不會變成 50.03)
    const nt = tickSize(next, isEtf);
    return round2(Math.ceil(next / nt - EPS) * nt);
  }
  if (current <= 0) return 0;
  const tickBelow = tickSize(Math.max(0, current - 1e-6), isEtf);
  const alignedUp = Math.ceil(current / tickBelow - EPS) * tickBelow; // 目前價位往上對齊
  return Math.max(0, round2(alignedUp - tickBelow));
}

// ---------- 持股試算引擎 ----------
//
// 用「移動加權平均成本法」逐筆重播交易紀錄:
// - 買進/股票股利 增加庫存股數,買進同時把金額併入持有成本;
// - 賣出 用賣出當下的加權平均成本結算資本利得,並按比例扣減持有成本;
// - 現金股利 直接累加,不影響庫存與成本。
//
// 這套公式是比對你提供的截圖數字反推驗證過的(總損益=未實現+已實現、
// 已實現=資本利得+現金股利、交易成本=手續費+證交稅、年化報酬率/年化殖利率
// 都是用複利公式 (1+期間報酬率)^(1/投資年數)-1),未實現損益%、資本利得%
// 這兩個因為截圖沒有透露實際的成本結轉細節,採用最常見的合理算法,數字會很
// 接近但不保證跟原本那個 app 的內部數字完全一致。

function computeYears(firstDateStr, asOfDate = new Date()) {
  if (!firstDateStr) return 0;
  const first = new Date(firstDateStr);
  const ms = asOfDate.getTime() - first.getTime();
  return Math.max(ms / (365 * 24 * 60 * 60 * 1000), 0);
}

function annualize(periodReturnPct, years) {
  if (!years || years <= 0) return null;
  const r = periodReturnPct / 100;
  if (r <= -1) return -100;
  // 持有不到 30 天就套複利年化公式,會把短期的小波動放大成失真的誇張數字
  // (例如才持有 3 天賺 1%,年化算出來會變成好幾千%),這種情況下年化率沒有
  // 參考意義,直接回傳 null,畫面上會改顯示「-」。
  if (years < 30 / 365) return null;
  const result = (Math.pow(1 + r, 1 / years) - 1) * 100;
  return isFinite(result) ? result : null;
}

// 針對「單一標的」的交易紀錄(已經是過濾好的陣列),算出完整摘要。
// currentPrice / prevClose 由呼叫端傳入(來自 dataCache 抓到的即時報價)。
// todayDate 預設是「今天」的日期字串(YYYY-MM-DD),用來額外累計「本日已實現
// 損益」;外部呼叫端一般不需要自己傳,只有測試時才需要固定日期。
// 先進先出(FIFO)配對:每一筆賣出,依序拿最早買進、還沒賣完的那批來對沖。
// 為什麼獨立成函式:個股頁要在每筆「買進」旁註記「這批已在何時賣出」,
// 「今日已實現損益」也要用同一套配對算,兩邊必須共用同一份結果才不會對不起來。
//   - 同一天買先賣後(跟 computeSymbolSummary 的排序一致,避免當天先賣後買誤判庫存不足)
//   - 同一天有買有賣視為當沖:賣出先對沖同一天的買進,剩下的才拿舊庫存
//   - 同日同類型依 createdAt(沒有就維持原順序)
//   - 配股(股票股利)當成成本 0 的一批,才跟庫存股數對得上
//   - 買進成本 = 價*股數+手續費,按配對到的股數等比例分攤;賣出淨額 = 價*股數-手續費-稅
// 回傳:
//   buyMatches[buyId] = [{ sellId, date, shares, price, gain }]  這批買進被哪幾筆賣出對沖(依賣出先後),
//     price 是那筆賣出的價格,gain 是這批被對沖的股數分到的已實現損益(已扣該筆賣出分攤到的手續費、證交稅)
//   buyRemaining[buyId] = 這批還沒賣掉的股數
//   sellRealized[sellId] = { gain, shares }  這筆賣出的已實現損益(資本利得,FIFO)
export function matchFifo(transactions) {
  const list = (transactions || []).map((t, i) => ({ t, i }));
  list.sort((a, b) => {
    if (a.t.date < b.t.date) return -1;
    if (a.t.date > b.t.date) return 1;
    const rank = (x) => (x.t.type === TX_TYPES.SELL ? 1 : 0);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    const ca = a.t.createdAt || 0;
    const cb = b.t.createdAt || 0;
    return ca - cb || a.i - b.i;
  });
  const lots = []; // { id, remaining, unitCost }
  const buyMatches = {};
  const buyRemaining = {};
  const sellRealized = {};
  list.forEach(({ t }) => {
    if (t.type === TX_TYPES.BUY) {
      const total = t.price * t.shares + (t.fee || 0);
      lots.push({ id: t.id, date: t.date, remaining: t.shares, unitCost: t.shares > 0 ? total / t.shares : 0 });
      buyMatches[t.id] = [];
      buyRemaining[t.id] = t.shares;
    } else if (t.type === TX_TYPES.STOCK_DIVIDEND) {
      lots.push({ id: t.id, remaining: t.shares, unitCost: 0 });
      buyMatches[t.id] = [];
      buyRemaining[t.id] = t.shares;
    } else if (t.type === TX_TYPES.SELL) {
      const available = lots.reduce((n, l) => n + l.remaining, 0);
      const sold = Math.min(t.shares, available);
      let need = sold;
      let cost = 0;
      let dtShares = 0; // 當沖部分(對到同一天買進的批次)
      let dtCost = 0;
      let prevShares = 0; // 賣原有庫存部分(對到更早的批次)
      let prevCost = 0;
      // 手續費、證交稅依股數比例分攤:到各批買進的已實現損益(buyMatches[].gain)、
      // 到「當沖」與「賣原有庫存」兩邊(dayTradeGain/soldPrevGain),分攤後加總都會
      // 等於整筆的已實現損益(gain),不會因為拆開而兜不起來。
      const feeTaxPerShare = sold > 0 ? ((t.fee || 0) + (t.tax || 0)) / sold : 0;
      // 第一輪只拿「同一天買進」的批次(當沖先互相抵銷),第二輪才依先進先出拿最早的
      [(lot) => lot.date === t.date, () => true].forEach((ok, pass) => {
        for (let k = 0; k < lots.length && need > 0; k += 1) {
          const lot = lots[k];
          if (lot.remaining <= 0 || !ok(lot)) continue;
          const take = Math.min(lot.remaining, need);
          lot.remaining -= take;
          need -= take;
          cost += take * lot.unitCost;
          if (pass === 0) {
            dtShares += take;
            dtCost += take * lot.unitCost;
          } else {
            prevShares += take;
            prevCost += take * lot.unitCost;
          }
          buyRemaining[lot.id] = lot.remaining;
          const gain = take * (t.price - feeTaxPerShare) - take * lot.unitCost;
          buyMatches[lot.id].push({ sellId: t.id, date: t.date, shares: take, price: t.price, gain });
        }
      });
      const proceeds = t.price * sold - (t.fee || 0) - (t.tax || 0);
      const dayTradeGain = t.price * dtShares - feeTaxPerShare * dtShares - dtCost;
      const soldPrevGain = t.price * prevShares - feeTaxPerShare * prevShares - prevCost;
      sellRealized[t.id] = { gain: proceeds - cost, shares: sold, dayTradeShares: dtShares, dayTradeGain, soldPrevShares: prevShares, soldPrevGain };
    }
  });
  return { buyMatches, buyRemaining, sellRealized };
}

// 當日損益(今天這一天賺賠多少,跟成本算法無關):
//   - 昨天收盤前就持有、今天還持有的:(現價 - 昨收) × 股數
//   - 昨天就持有、今天賣出的:(賣價 - 昨收) × 股數
//   - 今天買進又今天賣出(當沖):(賣價 - 買價) × 股數
//   - 今天買進、還持有的:(現價 - 買進價) × 股數
// 同一天有買有賣視為當沖:賣出先對沖今天的買進,超過的部分才算賣掉昨天的庫存。
// 不含手續費與證交稅、也不含現金股利(股利算在「今日已實現」)。
// 為什麼要重算:舊算法只有「目前股數 × (現價 - 昨收)」,今天賣掉的股票完全不算,
// 今天買進的也用昨收當基準,跟其他 App 的「當日損益」對不上。
// 回傳 { pnl, base, parts:[{kind,shares,pnl}] }(parts 供「點今日損益看明細」使用)
export function computeDayPnl(transactions, { currentPrice = 0, prevClose = null, todayDate } = {}) {
  const hasPrev = prevClose != null && prevClose > 0;
  const hasPrice = currentPrice > 0;
  // 同一天要「買先、賣後」(跟 computeSymbolSummary / matchFifo 一致)。不然像同一天先登記
  // 賣 1000 再登記買 1000(匯入或補登時常見)會被當成「賣的時候沒庫存」而漏扣,
  // 昨天庫存就憑空多出 1000 股,今日損益明細的「昨天就持有」跟著算錯。
  const sorted = [...(transactions || [])].sort((a, b) => {
    if (a.date < b.date) return -1;
    if (a.date > b.date) return 1;
    const rank = (t) => (t.type === TX_TYPES.SELL ? 1 : 0);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return (a.createdAt || 0) - (b.createdAt || 0);
  });
  // 昨天收盤時的庫存股數
  let prevHeld = 0;
  // 同時記下「昨天庫存」是由哪幾天的買進組成(先進先出扣掉賣出),給明細顯示來源,
  // 使用者覺得「昨天不該有這麼多股」時,一看就知道是哪幾筆交易被算成昨天就持有
  const lots = [];
  const consumeLots = (n) => {
    let rest = n;
    while (rest > 0 && lots.length) {
      const take = Math.min(lots[0].shares, rest);
      lots[0].shares -= take;
      rest -= take;
      if (lots[0].shares <= 0) lots.shift();
    }
  };
  sorted.forEach((t) => {
    if (t.date >= todayDate) return;
    if (t.type === TX_TYPES.BUY || t.type === TX_TYPES.STOCK_DIVIDEND) {
      prevHeld += t.shares;
      lots.push({ date: t.date, shares: t.shares });
    } else if (t.type === TX_TYPES.SELL) {
      const n = Math.min(t.shares, prevHeld);
      prevHeld -= n;
      consumeLots(n);
    }
  });
  const today = sorted.filter((t) => t.date === todayDate);
  // 今天買進的批次(依序被今天的賣出對沖)
  const pool = today.filter((t) => t.type === TX_TYPES.BUY).map((t) => ({ price: t.price, left: t.shares }));
  const todayBuyCost = today.filter((t) => t.type === TX_TYPES.BUY).reduce((n, t) => n + t.price * t.shares, 0);
  let prevAvail = prevHeld;
  let soldPrevPnl = 0;
  let soldPrevShares = 0;
  let dayTradePnl = 0;
  let dayTradeShares = 0;
  today.forEach((t) => {
    if (t.type !== TX_TYPES.SELL) return;
    let rest = t.shares;
    for (let k = 0; k < pool.length && rest > 0; k += 1) {
      const take = Math.min(pool[k].left, rest);
      if (take <= 0) continue;
      pool[k].left -= take;
      rest -= take;
      dayTradeShares += take;
      dayTradePnl += (t.price - pool[k].price) * take;
    }
    const fromPrev = Math.min(rest, prevAvail);
    if (fromPrev > 0) {
      prevAvail -= fromPrev;
      consumeLots(fromPrev);
      soldPrevShares += fromPrev;
      if (hasPrev) soldPrevPnl += (t.price - prevClose) * fromPrev;
    }
  });
  const carryPnl = hasPrev && hasPrice ? prevAvail * (currentPrice - prevClose) : 0;
  const boughtShares = pool.reduce((n, b) => n + b.left, 0);
  const boughtPnl = hasPrice ? pool.reduce((n, b) => n + b.left * (currentPrice - b.price), 0) : 0;
  const parts = [];
  if (prevAvail > 0) parts.push({ kind: 'carry', shares: prevAvail, pnl: carryPnl, lots, currentPrice, prevClose });
  if (soldPrevShares > 0) parts.push({ kind: 'soldPrev', shares: soldPrevShares, pnl: soldPrevPnl });
  if (dayTradeShares > 0) parts.push({ kind: 'dayTrade', shares: dayTradeShares, pnl: dayTradePnl });
  if (boughtShares > 0) parts.push({ kind: 'boughtToday', shares: boughtShares, pnl: boughtPnl });
  const pnl = carryPnl + soldPrevPnl + dayTradePnl + boughtPnl;
  // 百分比的分母:昨天收盤的持股市值 + 今天買進的金額(也就是「這天投入的本金」)
  const base = (hasPrev ? prevHeld * prevClose : 0) + todayBuyCost;
  return { pnl, base, parts };
}

export function computeSymbolSummary(
  transactions,
  { currentPrice = 0, prevClose = null, groups = [], todayDate = new Date().toISOString().split('T')[0] } = {}
) {
  // 同一天如果同時有買又有賣,買要先處理、賣後處理——不然像「同一天先賣掉庫存、
  // 再買回來」這種單純依資料列原始順序(例如CSV匯入照檔案行數排)排出來的結果,
  // 遇到賣出當下庫存還不夠(因為同一天的買還沒套用)會被誤判成「庫存不足,只能
  // 賣掉庫存那麼多」,導致賣出股數被少算,庫存股數因此虛增。只排日期、沒有這個
  // 次要排序時就會踩到這個雷。
  const sorted = [...transactions].sort((a, b) => {
    if (a.date < b.date) return -1;
    if (a.date > b.date) return 1;
    const rank = (t) => (t.type === TX_TYPES.SELL ? 1 : 0);
    return rank(a) - rank(b);
  });

  let shares = 0;
  let costBasis = 0; // 目前庫存的持有成本
  let pureCostBasis = 0; // 目前庫存的持有成本(不含手續費,只算買進價*股數,供「買進成本」均價顯示用)
  let investedCapital = 0; // 投入資本(歷史買進金額累計,含已出場部位)
  let realizedCapitalGain = 0;
  let cashDividend = 0;
  let stockDividendShares = 0;
  let totalFee = 0;
  let totalTax = 0;
  let todayRealizedGain = 0; // 本日(日期等於 todayDate 的交易)已實現損益,含資本利得(先進先出)與現金股利
  let todayDtRealized = 0; // 本日已實現損益拆開:當沖部分
  let todayDtRealizedShares = 0;
  let todayPrevRealized = 0; // 本日已實現損益拆開:賣原有庫存部分
  let todayPrevRealizedShares = 0;
  let todayDividend = 0; // 本日現金股利
  let firstDate = sorted.length ? sorted[0].date : null;
  // 今日已實現(資本利得部分)改用先進先出配對;累計已實現/持有均價仍是平均成本法
  const fifo = matchFifo(transactions);
  // 同一天有買有賣視為當沖:當沖的股數(買進那一側)不進庫存、不影響持有均價,
  // 直接跟同一天的賣出配對結算(成本 = 當天買價 + 按股數分攤的買進手續費)。
  // 只有沒被當沖抵銷的買進才進庫存;賣出超過當沖的部分才用庫存均價結算。
  // 以前同一天的買會先併進庫存再賣,當天買的價格會被攤進剩下庫存的均價,
  // 導致「明明只是當沖,持有均價卻跟著變」。
  const { buyDt, sellDt } = allocateDayTrades(transactions);
  let dtDate = null;
  let dtShares = 0; // 當天買進、等著被當沖賣出配對的股數
  let dtCost = 0;

  sorted.forEach((tx) => {
    if ((tx.type === TX_TYPES.BUY || tx.type === TX_TYPES.SELL) && tx.date !== dtDate) {
      dtDate = tx.date;
      dtShares = 0;
      dtCost = 0;
    }
    if (tx.type === TX_TYPES.BUY) {
      const cost = tx.price * tx.shares + (tx.fee || 0);
      const dt = Math.min(buyDt[tx.id] || 0, tx.shares);
      const keep = tx.shares - dt;
      const ratio = tx.shares > 0 ? keep / tx.shares : 0;
      dtShares += dt;
      dtCost += cost - cost * ratio;
      shares += keep;
      costBasis += cost * ratio;
      pureCostBasis += tx.price * keep;
      investedCapital += cost;
      totalFee += tx.fee || 0;
    } else if (tx.type === TX_TYPES.SELL) {
      const dt = Math.min(sellDt[tx.id] || 0, tx.shares, dtShares);
      const dtUnit = dtShares > 0 ? dtCost / dtShares : 0;
      const costOfDt = dtUnit * dt;
      dtShares -= dt;
      dtCost -= costOfDt;
      const avgCost = shares > 0 ? costBasis / shares : 0;
      const pureAvgCost = shares > 0 ? pureCostBasis / shares : 0;
      const soldShares = Math.min(tx.shares - dt, shares);
      const costOfSold = avgCost * soldShares;
      const pureCostOfSold = pureAvgCost * soldShares;
      const proceeds = tx.price * (soldShares + dt) - (tx.fee || 0) - (tx.tax || 0);
      const gain = proceeds - costOfSold - costOfDt;
      realizedCapitalGain += gain;
      if (tx.date === todayDate) {
        const fr = fifo.sellRealized[tx.id];
        todayRealizedGain += fr ? fr.gain : gain;
        if (fr) {
          todayDtRealized += fr.dayTradeGain;
          todayDtRealizedShares += fr.dayTradeShares;
          todayPrevRealized += fr.soldPrevGain;
          todayPrevRealizedShares += fr.soldPrevShares;
        }
      }
      shares -= soldShares;
      costBasis -= costOfSold;
      pureCostBasis -= pureCostOfSold;
      totalFee += tx.fee || 0;
      totalTax += tx.tax || 0;
    } else if (tx.type === TX_TYPES.CASH_DIVIDEND) {
      const amt = tx.amount || tx.price * tx.shares || 0;
      cashDividend += amt;
      if (tx.date === todayDate) {
        todayRealizedGain += amt;
        todayDividend += amt;
      }
    } else if (tx.type === TX_TYPES.STOCK_DIVIDEND) {
      shares += tx.shares;
      stockDividendShares += tx.shares;
    }
  });

  const avgPrice = shares > 0 ? costBasis / shares : 0;
  // 不含手續費、只看「剩下持有股數」的買進均價,供首頁持股列表的「買進成本」顯示用。
  const pureAvgPrice = shares > 0 ? pureCostBasis / shares : 0;
  const marketValue = shares * (currentPrice || 0);

  // 未實現損益預先扣掉「如果現在用市價賣出」會產生的手續費跟證交稅,呈現比較
  // 接近實際可以落袋的淨損益,而不是單純的市值跟成本價差。手續費規則沿用這檔
  // 股票目前所屬群組(以最後一筆交易的群組為準)的優惠折數/低消設定。
  const lastGroupId = sorted.length ? sorted[sorted.length - 1].groupId : null;
  const exitGroup = groups.find((g) => g.id === lastGroupId) || groups[0] || null;
  const exitIsEtf = isLikelyETF(sorted.length ? sorted[sorted.length - 1].symbol : null);
  const estimatedExitFee = shares > 0 ? estimateFee(exitGroup, currentPrice, shares, exitIsEtf) : 0;
  const estimatedExitTax = shares > 0 ? estimateTax(currentPrice, shares, { taxRate: exitIsEtf ? 0.001 : 0.003 }) : 0;
  const estimatedExitCost = estimatedExitFee + estimatedExitTax;
  const unrealizedPnl = marketValue - costBasis - estimatedExitCost;
  const realizedPnl = realizedCapitalGain + cashDividend;
  const totalPnl = unrealizedPnl + realizedPnl;
  const years = computeYears(firstDate);

  const investedBase = investedCapital || 1; // 避免除以 0
  const costBase = costBasis || 1;
  // computeDayPnl 算出的是「現有庫存」價差(現價/買價 - 成本基準),純粹未實現;
  // 今天已經賣出/配息的部分改用上面 FIFO 算出的已實現損益(已扣手續費、證交稅,
  // 含股利),兩者合併才是真正「今天賺賠多少」的完整數字,不再是兩個各算各的數字。
  const day = computeDayPnl(transactions, { currentPrice, prevClose, todayDate });
  const unrealizedParts = day.parts.filter((p) => p.kind === 'carry' || p.kind === 'boughtToday');
  const unrealizedTodayPnl = unrealizedParts.reduce((n, p) => n + p.pnl, 0);
  const todayPnlParts = [...unrealizedParts];
  if (todayPrevRealizedShares > 0) todayPnlParts.push({ kind: 'soldPrev', shares: todayPrevRealizedShares, pnl: todayPrevRealized });
  if (todayDtRealizedShares > 0) todayPnlParts.push({ kind: 'dayTrade', shares: todayDtRealizedShares, pnl: todayDtRealized });
  if (todayDividend !== 0) todayPnlParts.push({ kind: 'dividend', shares: 0, pnl: todayDividend });
  const todayPnl = unrealizedTodayPnl + todayRealizedGain;
  const marketBase = marketValue || 1;

  return {
    shares,
    avgPrice,
    pureAvgPrice,
    currentPrice,
    investmentYears: years,
    marketValue,
    totalPnl,
    totalPnlPct: (totalPnl / investedBase) * 100,
    unrealizedPnl,
    unrealizedPnlPct: (unrealizedPnl / costBase) * 100,
    estimatedExitCost,
    todayPnl,
    todayPnlPct: (todayPnl / (day.base || marketBase)) * 100,
    todayBase: day.base,
    todayPnlParts,
    realizedPnl,
    realizedPnlPct: (realizedPnl / investedBase) * 100,
    todayRealizedPnl: todayRealizedGain,
    capitalGain: realizedCapitalGain,
    capitalGainPct: (realizedCapitalGain / investedBase) * 100,
    cashDividend,
    cashDividendPct: (cashDividend / investedBase) * 100,
    stockDividendShares,
    annualizedYieldPct: annualize((cashDividend / investedBase) * 100, years),
    annualizedReturnPct: annualize((totalPnl / investedBase) * 100, years),
    tradeCost: totalFee + totalTax,
    fee: totalFee,
    tax: totalTax,
    investedCapital,
    costBasis,
    firstDate,
  };
}

// 把多檔標的的摘要加總成「投資組合總覽」(對齊截圖裡整體績效頁的邏輯:
// 金額類全部直接加總,百分比類則用加總後的金額重新計算,而不是把各檔的
// 百分比平均,這樣才不會失真)。
export function aggregateSummaries(symbolSummaries) {
  const base = {
    marketValue: 0,
    totalPnl: 0,
    unrealizedPnl: 0,
    todayPnl: 0,
    todayBase: 0,
    realizedPnl: 0,
    todayRealizedPnl: 0,
    capitalGain: 0,
    cashDividend: 0,
    tradeCost: 0,
    fee: 0,
    tax: 0,
    investedCapital: 0,
    costBasis: 0,
    estimatedExitCost: 0,
  };
  let earliestDate = null;
  symbolSummaries.forEach((s) => {
    base.marketValue += s.marketValue;
    base.totalPnl += s.totalPnl;
    base.unrealizedPnl += s.unrealizedPnl;
    base.todayPnl += s.todayPnl;
    base.todayBase += s.todayBase || 0;
    base.realizedPnl += s.realizedPnl;
    base.todayRealizedPnl += s.todayRealizedPnl || 0;
    base.capitalGain += s.capitalGain;
    base.cashDividend += s.cashDividend;
    base.tradeCost += s.tradeCost;
    base.fee += s.fee;
    base.tax += s.tax;
    base.investedCapital += s.investedCapital;
    base.costBasis += s.costBasis;
    base.estimatedExitCost += s.estimatedExitCost || 0;
    if (s.firstDate && (!earliestDate || s.firstDate < earliestDate)) earliestDate = s.firstDate;
  });
  const years = computeYears(earliestDate);
  const investedBase = base.investedCapital || 1;
  const costBase = base.costBasis || 1;
  const marketBase = base.marketValue || 1;
  return {
    ...base,
    investmentYears: years,
    totalPnlPct: (base.totalPnl / investedBase) * 100,
    unrealizedPnlPct: (base.unrealizedPnl / costBase) * 100,
    todayPnlPct: (base.todayPnl / (base.todayBase || marketBase)) * 100,
    realizedPnlPct: (base.realizedPnl / investedBase) * 100,
    capitalGainPct: (base.capitalGain / investedBase) * 100,
    cashDividendPct: (base.cashDividend / investedBase) * 100,
    annualizedYieldPct: annualize((base.cashDividend / investedBase) * 100, years),
    annualizedReturnPct: annualize((base.totalPnl / investedBase) * 100, years),
  };
}

// 取出某個群組(或 ALL_GROUP_ID = 全部)底下,依代號分類的交易紀錄。
export function getTransactionsByGroup(data, groupId) {
  const list =
    groupId === ALL_GROUP_ID
      ? data.transactions
      : data.transactions.filter((tx) => tx.groupId === groupId);
  const bySymbol = {};
  list.forEach((tx) => {
    if (!bySymbol[tx.symbol]) bySymbol[tx.symbol] = [];
    bySymbol[tx.symbol].push(tx);
  });
  return bySymbol;
}

export function formatMoney(n) {
  const v = Math.round(n || 0);
  return v.toLocaleString('zh-TW');
}

export function formatSigned(n) {
  const v = Math.round(n || 0);
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toLocaleString('zh-TW')}`;
}

export function formatPct(n, digits = 2) {
  if (n === null || n === undefined || !isFinite(n)) return '-';
  const v = Number(n);
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(digits)}%`;
}

export function pnlColorClass(n, isLight) {
  if (n > 0) return isLight ? 'text-red-600' : 'text-red-400';
  if (n < 0) return isLight ? 'text-emerald-600' : 'text-emerald-400';
  return isLight ? 'text-slate-500' : 'text-slate-400';
}
