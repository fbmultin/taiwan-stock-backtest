// 「我的持股」功能的資料層與試算引擎。
//
// 目前先用 localStorage 做本機儲存(瀏覽器/手機各自獨立一份資料)。
// 之後如果要做跨裝置同步,只需要把 loadPortfolioData / savePortfolioData
// 換成打後端 API 的版本,其他呼叫端(PortfolioTracker.js)完全不用改,
// 因為這兩個函式就是整個模組對外唯一的讀寫入口。

const STORAGE_KEY = 'portfolio_tracker_v1';

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
  feeDiscountPct: 100, // 手續費優惠(折數的百分比表示,100 = 不打折)
  minFeeNormal: 20, // 一般交易手續費低消(元)
  minFeeOdd: 20, // 零股交易手續費低消(元)
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

export function loadPortfolioData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultData();
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.groups) || parsed.groups.length === 0) {
      return defaultData();
    }
    return {
      version: 1,
      groups: parsed.groups,
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
      activeGroupId: parsed.activeGroupId || parsed.groups[0].id,
    };
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

// ---------- 手續費試算 ----------

// 依群組的手續費優惠設定,算出一筆買賣交易的手續費(四捨五入到整數元)。
// 零股(不足1000股)用「零股交易手續費低消」,整張交易用「一般交易手續費低消」。
export function estimateFee(group, price, shares) {
  if (!group || !price || !shares) return 0;
  const isOddLot = shares % 1000 !== 0;
  const minFee = isOddLot ? group.minFeeOdd : group.minFeeNormal;
  const discountPct = typeof group.feeDiscountPct === 'number' ? group.feeDiscountPct : 100;
  const raw = price * shares * 0.001425 * (discountPct / 100);
  return Math.max(Math.round(raw), Math.round(minFee || 0));
}

// 粗略判斷代號是不是ETF:台灣證交所的ETF(含ETN、槓反、債券、主動式ETF)
// 編號慣例全部以「00」開頭(0050、0056、00878、00631L...),一般個股則是
// 4碼不以00開頭。證交稅就是用這個規則區分——ETF證交稅千分之1,一般股票是
// 三倍的千分之3,猜錯會讓已實現/估計出場損益差出好幾倍的稅額。這只是慣例
// 判斷不保證100%準確,所以新增交易時仍保留手動切換的選項。
export function isLikelyETF(symbol) {
  return /^00/.test(String(symbol || '').trim());
}

// 證交稅:一般股票千分之3,ETF(含ETN、槓反、債券ETF等)千分之1,當沖(同一天
// 同股票先買後賣)不分ETF或個股都再減半。taxRate 由呼叫端依 isLikelyETF 或
// 使用者手動切換的結果傳入;沒有傳的話預設用一般股票的千分之3(比較保守,
// 高估稅額好過低估)。
export function estimateTax(price, shares, { isDayTrade = false, taxRate = 0.003 } = {}) {
  return Math.round(price * shares * taxRate * (isDayTrade ? 0.5 : 1));
}

// 判斷一筆賣出交易是否算「當沖」:同一天、同一檔股票,交易紀錄裡已經有買進
// (不分群組,因為當沖是稅務上對同一檔股票的認定,跟這個 app 自己分的群組無關)。
// 只影響賣出那一筆的證交稅(當沖減半),買進的手續費不受影響。
export function isDayTradeSell(transactions, symbol, date, excludeTxId = null) {
  return transactions.some(
    (t) => t.id !== excludeTxId && t.symbol === symbol && t.date === date && t.type === TX_TYPES.BUY
  );
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

// 台股股價升降單位(最小跳動)級距,依證交所公告的價格級距表:
// <10 元:0.01 / 10~50 元:0.05 / 50~100 元:0.1 / 100~500 元:0.5 / 500~1000 元:1 / >=1000 元:5
export function tickSize(price) {
  const p = Number(price) || 0;
  if (p < 10) return 0.01;
  if (p < 50) return 0.05;
  if (p < 100) return 0.1;
  if (p < 500) return 0.5;
  if (p < 1000) return 1;
  return 5;
}

// 依目前價格所在的級距,把價格往上或往下調整一個最小跳動單位。方向 direction
// 傳 1(往上)或 -1(往下);四捨五入到該級距對應的小數位數,避免浮點數誤差
// 累積出 0.3000000004 這種顯示瑕疵。
export function stepPrice(price, direction) {
  const current = Number(price) || 0;
  const tick = tickSize(current);
  const next = Math.max(0, current + tick * direction);
  // 跨級距時用「調整後價格」的級距重新算一次跳動單位對齊到整數倍,避免卡在
  // 級距邊界(例如從 49.98 往上跳,照 10~50 元級距應落在 50.00 而不是 50.03)。
  const nextTick = tickSize(next);
  const rounded = Math.round(next / nextTick) * nextTick;
  const decimals = nextTick < 1 ? 2 : 0;
  return Number(rounded.toFixed(decimals));
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
export function computeSymbolSummary(
  transactions,
  { currentPrice = 0, prevClose = null, groups = [], todayDate = new Date().toISOString().split('T')[0] } = {}
) {
  const sorted = [...transactions].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  let shares = 0;
  let costBasis = 0; // 目前庫存的持有成本
  let pureCostBasis = 0; // 目前庫存的持有成本(不含手續費,只算買進價*股數,供「買進成本」均價顯示用)
  let investedCapital = 0; // 投入資本(歷史買進金額累計,含已出場部位)
  let realizedCapitalGain = 0;
  let cashDividend = 0;
  let stockDividendShares = 0;
  let totalFee = 0;
  let totalTax = 0;
  let todayRealizedGain = 0; // 本日(日期等於 todayDate 的交易)已實現損益,含資本利得與現金股利
  let firstDate = sorted.length ? sorted[0].date : null;

  sorted.forEach((tx) => {
    if (tx.type === TX_TYPES.BUY) {
      const cost = tx.price * tx.shares + (tx.fee || 0);
      const pureCost = tx.price * tx.shares;
      shares += tx.shares;
      costBasis += cost;
      pureCostBasis += pureCost;
      investedCapital += cost;
      totalFee += tx.fee || 0;
    } else if (tx.type === TX_TYPES.SELL) {
      const avgCost = shares > 0 ? costBasis / shares : 0;
      const pureAvgCost = shares > 0 ? pureCostBasis / shares : 0;
      const soldShares = Math.min(tx.shares, shares);
      const costOfSold = avgCost * soldShares;
      const pureCostOfSold = pureAvgCost * soldShares;
      const proceeds = tx.price * soldShares - (tx.fee || 0) - (tx.tax || 0);
      const gain = proceeds - costOfSold;
      realizedCapitalGain += gain;
      if (tx.date === todayDate) todayRealizedGain += gain;
      shares -= soldShares;
      costBasis -= costOfSold;
      pureCostBasis -= pureCostOfSold;
      totalFee += tx.fee || 0;
      totalTax += tx.tax || 0;
    } else if (tx.type === TX_TYPES.CASH_DIVIDEND) {
      const amt = tx.amount || tx.price * tx.shares || 0;
      cashDividend += amt;
      if (tx.date === todayDate) todayRealizedGain += amt;
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
  const estimatedExitFee = shares > 0 ? estimateFee(exitGroup, currentPrice, shares) : 0;
  const exitTaxRate = isLikelyETF(sorted.length ? sorted[sorted.length - 1].symbol : null) ? 0.001 : 0.003;
  const estimatedExitTax = shares > 0 ? estimateTax(currentPrice, shares, { taxRate: exitTaxRate }) : 0;
  const estimatedExitCost = estimatedExitFee + estimatedExitTax;
  const unrealizedPnl = marketValue - costBasis - estimatedExitCost;
  const realizedPnl = realizedCapitalGain + cashDividend;
  const totalPnl = unrealizedPnl + realizedPnl;
  const years = computeYears(firstDate);

  const investedBase = investedCapital || 1; // 避免除以 0
  const costBase = costBasis || 1;
  const todayPnl = prevClose != null ? shares * (currentPrice - prevClose) : 0;
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
    todayPnlPct: (todayPnl / marketBase) * 100,
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
    todayPnlPct: (base.todayPnl / marketBase) * 100,
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
