// 回檔雷達(第一層)的純計算函式。
//
// 規格依據:docs/backtest-engine-design.md
//   - 3.2、3.3:回檔與事件的定義,時序上「收盤後確認、只用當時已知的資訊」
//   - 14.2.2:去重(跌破後要先回到 −x/2 以內才可再次計入)
//   - 14.2.4(2026-10-05 修訂):事件群以「群的起始日 + h」為界、統計只取各群第一個事件
//   - 13.11、14.5:第一層的決策與新增參數
// 這裡只放「給定價格序列 → 算出數字」的純函式,不碰網路、不碰 localStorage,
// 好處是可以用手算得出答案的小例子做單元測試,也方便用 Python 獨立重算對照(Step C)。
//
// 重要:這一層只有「歷史描述」,沒有任何顯著性檢定(第二層暫不上線,見 13.10)。

export const WINDOWS = [60, 252]; // 回看窗口(交易日),預設 252
export const DEFAULT_WINDOW = 252;
export const THRESHOLDS = [5, 7, 10, 15, 20]; // 檔位(%),沿用 13.5
export const HOLDS = [63, 126, 252]; // 持有期(交易日),約 3/6/12 個月
export const MIN_NEFF = 5; // N_eff < 5 不顯示中位數與勝率(14.2.4、14.5)
export const MIN_EXTRA_DAYS = 63; // 總日數 < 窗口 + 63 → 整個表「資料不足」(14.5)
export const DEFAULT_STOP_PCT = 10; // 停利回落% 預設值(股魚公開範例,14.2.1)

// ── 回檔序列 ──
// H_t = 最近 N 天(含當天)的最高價,DD_t = P_t / H_t − 1。
// 前 N−1 天沒有完整窗口,回傳 null——不能用「目前為止的最高價」代替,
// 否則短窗口在資料開頭會被當成有完整歷史,和 3.2 的定義不一致。
// 用單調佇列做滾動最大值:N=252、5,000 筆時不需要每天往回掃 252 天。
export function computeDrawdown(prices, N) {
  const T = prices.length;
  const dd = new Array(T).fill(null);
  const high = new Array(T).fill(null);
  const q = []; // 存索引,對應的價格由大到小
  for (let t = 0; t < T; t++) {
    while (q.length && prices[q[q.length - 1]] <= prices[t]) q.pop();
    q.push(t);
    if (q[0] <= t - N) q.shift();
    if (t >= N - 1) {
      high[t] = prices[q[0]];
      dd[t] = prices[t] / high[t] - 1;
    }
  }
  return { dd, high };
}

// ── 事件(首次跌破 −x,含去重)──
// 事件日 s:DD_s ≤ −x 且前一天 DD_{s−1} > −x(兩天都要有完整窗口,所以 s ≥ N)。
// 去重(14.2.2 基準):計入一次事件之後進入「未重新武裝」狀態,
// 要等到某天 DD > −x/2(回到 −x/2 以內)才會重新武裝、下一次跌破才再計入。
// 為什麼要去重:同一波下跌常在門檻附近上下震盪,不去重會把同一段行情算成好幾次。
export function detectEvents(dd, xPct, N) {
  const x = xPct / 100;
  const events = [];
  let armed = true;
  for (let s = N; s < dd.length; s++) {
    if (dd[s] === null || dd[s - 1] === null) continue;
    if (!armed && dd[s] > -x / 2) armed = true;
    if (armed && dd[s] <= -x && dd[s - 1] > -x) {
      events.push(s);
      armed = false;
    }
  }
  return events;
}

// ── 事件群(14.2.4 修訂版)──
// 依時間排序,第一個事件開啟第一群;之後第一個進場日 ≥ 該群起始日 + h 的事件才開啟下一群。
// 這保證各群第一個事件的後續報酬期間互不重疊(但不保證是獨立的市場事件)。
// 傳入的 events 必須已經只留「後續有完整 h 天資料」的事件(見 cellStats)。
export function clusterEvents(events, h) {
  const firsts = [];
  let groupStart = null;
  for (const s of events) {
    if (groupStart === null || s >= groupStart + h) {
      firsts.push(s);
      groupStart = s;
    }
  }
  return firsts;
}

export function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function winRate(values) {
  if (!values.length) return null;
  return values.filter((v) => v > 0).length / values.length;
}

// 進場 = 事件日收盤;後續報酬 = P_{s+h} / P_s − 1。後續不足 h 天的不計(回傳 null)。
export function forwardReturn(prices, s, h) {
  return s + h < prices.length ? prices[s + h] / prices[s] - 1 : null;
}

// ── 基準:平常任一天買 ──
// 對照範圍(14.2.4 修訂、H5):從第 N 天起(索引 N,也就是事件最早可能出現的那天),
// 之後仍有完整 h 天報酬的每一天。和事件用同一個可出現範圍,比較才公平。
export function baselineStats(prices, N, h) {
  const rets = [];
  for (let t = N; t + h < prices.length; t++) rets.push(prices[t + h] / prices[t] - 1);
  return { n: rets.length, median: median(rets), winRate: winRate(rets) };
}

// ── 單一格(檔位 × 持有期)──
export function cellStats(prices, dd, N, xPct, h, baseline) {
  const all = detectEvents(dd, xPct, N);
  // 只留後續有完整 h 天資料的事件;不足的是最近才發生的事件,本來就算不出報酬
  const complete = all.filter((s) => s + h < prices.length);
  const firsts = clusterEvents(complete, h);
  const rets = firsts.map((s) => forwardReturn(prices, s, h));
  const nEff = firsts.length;
  const enough = nEff >= MIN_NEFF;
  const med = enough ? median(rets) : null;
  const wr = enough ? winRate(rets) : null;
  return {
    xPct,
    h,
    nEvents: complete.length, // 事件數(去重後、後續資料完整者)
    nEventsAll: all.length, // 含後續資料還不足 h 天的事件
    nEff,
    tooFew: !enough,
    median: med,
    winRate: wr,
    // 與基準的差,單位為百分點(14.5)
    medianDiffPp: enough && baseline.median !== null ? (med - baseline.median) * 100 : null,
    winRateDiffPp: enough && baseline.winRate !== null ? (wr - baseline.winRate) * 100 : null,
    eventIndices: complete,
    clusterFirstIndices: firsts,
  };
}

// ── 整張表 ──
export function computeTable(prices, N) {
  if (prices.length < N + MIN_EXTRA_DAYS) {
    return { insufficient: true, totalDays: prices.length, needed: N + MIN_EXTRA_DAYS, cells: [], baselines: {} };
  }
  const { dd } = computeDrawdown(prices, N);
  const baselines = {};
  HOLDS.forEach((h) => {
    baselines[h] = baselineStats(prices, N, h);
  });
  const cells = [];
  THRESHOLDS.forEach((x) => HOLDS.forEach((h) => cells.push(cellStats(prices, dd, N, x, h, baselines[h]))));
  return { insufficient: false, totalDays: prices.length, cells, baselines };
}

// ── 今日狀態 ──
// 已到檔位:目前 DD ≤ −x 的最深檔位。距下一檔位(14.5):(1 − x)·H ÷ P − 1,
// 也就是「股價還要再變動多少 % 才會碰到下一個更深的檔位」(負數 = 還要再跌)。
export function currentState(prices, N) {
  const { dd, high } = computeDrawdown(prices, N);
  const t = prices.length - 1;
  if (t < 0 || dd[t] === null) return null;
  const d = dd[t];
  const reached = THRESHOLDS.filter((x) => d <= -x / 100);
  const deepestReached = reached.length ? reached[reached.length - 1] : null;
  const next = THRESHOLDS.find((x) => d > -x / 100) ?? null;
  const distanceToNext = next === null ? null : ((1 - next / 100) * high[t]) / prices[t] - 1;
  return { drawdown: d, high: high[t], price: prices[t], deepestReached, nextThreshold: next, distanceToNext };
}

// ── 持股:某群組、某代號的「本輪持有起點」──
// 定義(13.11、14.5):該群組內最後一次股數歸零之後的第一筆買進日;從未歸零則為第一筆買進日。
// 排序與股數規則刻意和 portfolioStore.computeSymbolSummary 一致:
//   同一天先處理買、後處理賣;賣出股數不超過當下庫存;股票股利增加股數;現金股利不影響股數。
// 這樣「持有中」的判斷才會和「我的持股」頁看到的庫存一致。
export function holdingEpisode(transactions) {
  const sorted = [...transactions].sort((a, b) => {
    if (a.date < b.date) return -1;
    if (a.date > b.date) return 1;
    const rank = (t) => (t.type === 'sell' ? 1 : 0);
    return rank(a) - rank(b);
  });
  let shares = 0;
  let start = null;
  for (const tx of sorted) {
    if (tx.type === 'buy') {
      if (shares <= 0 && start === null) start = tx.date;
      shares += Number(tx.shares) || 0;
    } else if (tx.type === 'sell') {
      shares -= Math.min(Number(tx.shares) || 0, shares);
      if (shares <= 0) {
        shares = 0;
        start = null; // 歸零:下一筆買進才是新的一輪
      }
    } else if (tx.type === 'stockDividend') {
      shares += Number(tx.shares) || 0;
    }
  }
  return { shares, holding: shares > 0, startDate: shares > 0 ? start : null };
}

// ── 停利距離 ──
// 回落 = 目前價 ÷ 持有期間最高收盤價 − 1(用含息還原價,避免除息被誤算成回落,13.11 第 2 項)。
// 持有期間 = 起點當天(或之後第一個交易日)到最新一天。
// 距停利點 = (1 − stop)·最高價 ÷ 目前價 − 1(和「距下一檔位」同一種表示法)。
export function stopStatus(dates, adjPrices, startDate, stopPct) {
  const i0 = dates.findIndex((d) => d >= startDate);
  if (i0 < 0 || !adjPrices.length) return null;
  let maxP = -Infinity;
  for (let i = i0; i < adjPrices.length; i++) if (adjPrices[i] > maxP) maxP = adjPrices[i];
  const p = adjPrices[adjPrices.length - 1];
  const fall = p / maxP - 1;
  const stop = stopPct / 100;
  return {
    fallFromHigh: fall,
    belowStop: fall <= -stop,
    distanceToStop: ((1 - stop) * maxP) / p - 1,
    highDate: dates[adjPrices.indexOf(maxP, i0)],
  };
}
