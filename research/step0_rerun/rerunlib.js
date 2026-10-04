'use strict';
// Step 0 重跑共用函式。規格唯一依據:docs/backtest-engine-design.md 13.5、13.6(commit 880cc03)。
// 訊號 / pos / d / GARCH 模擬沿用上次 Step 0 已測過的 step0lib.js,這裡只加上重跑新規格需要的部分:
//   1. n 的定義:可檢定天數 = 總日數 − 251(扣掉 252 日窗口的預熱)
//   2. 規則集合縮小:只用 252 日窗口、門檻 {5,7,10,15,20}%、持有期依 h ≤ n÷20 篩選
//   3. 種子:由基準種子、格編號、路徑編號決定,與執行順序、分批方式無關
const fs = require('fs');
const path = require('path');
const L0 = require('../step0/step0lib');

const BASE_SEED = 20261005;           // 13.6 登記的基準種子,不得因結果更換
const WARMUP = 251;                   // 252 日窗口:第 252 天才有第一個回檔值
const N_WIN = 252;
const THRESHOLDS = [5, 7, 10, 15, 20];
const HOLDS = [63, 126, 252];
const DIVISOR = 20;                   // 資料長度規則 h ≤ n ÷ 20(Step 5 才做除數變體)
const C_DAILY = 0.01 / 252;           // 現金年利率 1%
const MIN_EVENTS = 5;                 // 第九章第 3 點:去重後進場 < 5 次的規則剔除

// 依可檢定天數 n 產生規則集合。為什麼由 n 決定:13.5 規定持有期不得超過 n÷20,
// 讓短歷史的標的不去檢定「獨立事件只有個位數」的長持有期。
function rulesFor(n) {
  const rules = [];
  for (const h of HOLDS) {
    if (h > n / DIVISOR) continue;
    for (const xp of THRESHOLDS) rules.push({ x: xp / 100, h, N: N_WIN, id: `x${xp}_h${h}` });
  }
  return rules;
}

// 種子:FNV 式整數雜湊(step0lib.hashSeed),參數全部是整數
const seedOf = (...xs) => L0.hashSeed(BASE_SEED, ...xs);

// 給一條「含預熱」的報酬序列 rAll(長度 n + 250,即總日數 n+251 天的價格之間的報酬),
// 算 pos 後只保留最後 n 天當檢定區間。
// 為什麼這樣切:pos[s] 只有在 s ≥ 252 才可能為 1,前 250 個報酬日本來就不可能持有;
// 檢定區間 = 扣掉預熱後的 n 天,f_k 也只在這 n 天上算,與 13.5 的 n 定義一致。
function prepare(rAll, n, rules) {
  const P = L0.priceFromReturns(rAll);
  const { kept, posList, events } = L0.buildPosMatrix(P, rules, MIN_EVENTS);
  const off = rAll.length - n;
  for (const p of posList) for (let t = 0; t < off; t++) if (p[t]) throw new Error('預熱區出現持股,時序有誤');
  const r = rAll.subarray(off);
  const pos = posList.map(p => p.subarray(off));
  return { kept, pos, r, events, P };
}

function loadReturns(sid) {
  const rows = fs.readFileSync(path.join(__dirname, 'data', `${sid}.csv`), 'utf8').trim().split('\n').slice(1);
  // 第一列沒有報酬(=0),丟掉;總日數 D → 報酬 D−1 個 → 可檢定天數 n = D − 251
  return { r: Float64Array.from(rows.slice(1).map(l => +l.split(',')[4])), D: rows.length };
}

module.exports = { BASE_SEED, WARMUP, DIVISOR, C_DAILY, MIN_EVENTS, rulesFor, seedOf, prepare, loadReturns, L0 };
