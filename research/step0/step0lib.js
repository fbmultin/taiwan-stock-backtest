'use strict';
// Step 0 共用函式:訊號 → pos → d 的構造、GARCH 模擬、規則集合。
// 依據:docs/backtest-engine-design.md 第 3 章(定義)與 10.1 / 10.1.1(Step 0 設計)。
// 這裡的 pos / d 構造日後會成為 app 裡 signalEngine.js 的雛形,所以時序細節照文件寫死。

const { mulberry32 } = require('./spa_stepm_prototype');

// ── 規則集合(3.5 暫定):18 檔門檻 × 3 持有期 × 2 回看窗口 = 108 條 ──
function buildRules() {
  const rules = [];
  for (const N of [60, 252])
    for (const h of [63, 126, 252])
      for (let xp = 3; xp <= 20; xp++) rules.push({ x: xp / 100, h, N, id: `x${xp}_h${h}_N${N}` });
  return rules;
}

// ── 滾動高點(含當日):單調佇列,O(n) ──
// 為什麼不用每天往回掃 N 天:N=252、n=5200、每次模擬都要算,O(nN) 會拖慢 2000 次模擬。
function rollingMax(P, N) {
  const T = P.length, H = new Float64Array(T), q = new Int32Array(T);
  let head = 0, tail = 0;
  for (let t = 0; t < T; t++) {
    while (tail > head && P[q[tail - 1]] <= P[t]) tail--;
    q[tail++] = t;
    if (q[head] <= t - N) head++;
    H[t] = P[q[head]];
  }
  return H;
}

// ── 一條規則的 pos 序列與去重後的事件數 ──
// P:價格(含息報酬指數),長度 T;回傳的 pos 對應「報酬日」t=1..T-1(共 n=T-1 天),
//   pos[t-1] 表示第 t 天的報酬是否持有。
// 時序(3.3):第 s 天收盤後確認訊號 → 曝險從第 s+1 天的報酬開始,持有 h 天。
//   這保證 pos_t 只用到 t-1 以前的資訊(不偷看未來),Step 0 的 GARCH 虛無之所以成立就靠這點。
// 訊號(3.2):DD_s ≤ −x 且 DD_{s-1} > −x(首次跌破);兩天都要有完整的 N 日窗口,所以 s ≥ N。
// 事件數(只用於第九章「進場次數 < 5 剔除」):3.3 暫定的去重——觸發後要回到 −x/2 以內才重新計算。
//   注意 pos 本身不去重(多個訊號的持有區間取聯集),去重只影響「算幾次」。
function posForRule(P, H, x, h, N) {
  const T = P.length, n = T - 1, pos = new Uint8Array(n);
  let events = 0, armed = true, holdUntil = -1; // holdUntil:報酬日索引(含)
  for (let s = N; s < T; s++) {
    const dd = P[s] / H[s] - 1, ddPrev = P[s - 1] / H[s - 1] - 1;
    if (dd <= -x && ddPrev > -x) {
      // 曝險:報酬日 s+1 .. s+h,轉成 pos 索引 s .. s+h-1
      const end = Math.min(n - 1, s + h - 1);
      if (end > holdUntil) holdUntil = end;
      if (armed) { events++; armed = false; }
    }
    if (!armed && dd > -x / 2) armed = true;
    // 第 s 天訊號影響的是 pos[s..],所以在處理完第 s 天後,把 pos[s] 依目前的 holdUntil 填上
    if (s < n && s <= holdUntil) pos[s] = 1;
  }
  return { pos, events };
}
// 上面的寫法:pos[s] 在第 s 天迴圈結束時決定,而 pos[s] 代表第 s+1 天的報酬,
// 只依賴第 s 天(含)以前的訊號——正好是「收盤後確認、隔天起算」。
// holdUntil 單調遞增、跨天沿用,所以持有區間會自然延續到 s+h-1。

// ── 對整個規則集合算 pos,並依「事件數 ≥ minEvents」篩選 ──
function buildPosMatrix(P, rules, minEvents = 5) {
  const Hs = {};
  for (const N of new Set(rules.map(r => r.N))) Hs[N] = rollingMax(P, N);
  const kept = [], posList = [], events = [];
  for (const r of rules) {
    const { pos, events: ev } = posForRule(P, Hs[r.N], r.x, r.h, r.N);
    events.push(ev);
    if (ev >= minEvents) { kept.push(r); posList.push(pos); }
  }
  return { kept, posList, events };
}

// ── d 矩陣(3.4):d(k,t) = (pos(k,t) − f_k) · (r_t − c_t),列優先 Float64Array ──
// shift:循環位移量(pos 相對報酬整體平移,所有規則一起移,保留規則間相關)
// inject:{k, delta} 檢定力測試用——在規則 k 持有的日子把報酬加上 delta
//   (注意:注入是用「位移前/原始」的 pos_k,與 d 用的 pos 同一份)
function buildD(posList, r, c, { shift = 0, inject = null } = {}) {
  const K = posList.length, n = r.length, d = new Float64Array(n * K);
  const f = new Float64Array(K);
  for (let k = 0; k < K; k++) { let s = 0; const p = posList[k]; for (let t = 0; t < n; t++) s += p[t]; f[k] = s / n; }
  const x = new Float64Array(n);
  for (let t = 0; t < n; t++) x[t] = r[t] - c;
  if (inject) { const p = posList[inject.k]; for (let t = 0; t < n; t++) if (p[t]) x[t] += inject.delta; }
  for (let t = 0; t < n; t++) {
    const ts = shift ? (t + shift) % n : t, row = t * K;
    for (let k = 0; k < K; k++) d[row + k] = (posList[k][ts] - f[k]) * x[t];
  }
  return { d, f, n, K };
}

// ── 亂數:標準常態(Box–Muller)、Gamma(Marsaglia–Tsang)、標準化 t ──
function makeRandom(seed) {
  const u = mulberry32(seed);
  let spare = null;
  const unif = () => { let v; do { v = u(); } while (v === 0); return v; };
  const norm = () => {
    if (spare !== null) { const s = spare; spare = null; return s; }
    const a = unif(), b = unif(), R = Math.sqrt(-2 * Math.log(a));
    spare = R * Math.sin(2 * Math.PI * b); return R * Math.cos(2 * Math.PI * b);
  };
  const gamma = (k) => { // k ≥ 1
    const d = k - 1 / 3, cc = 1 / Math.sqrt(9 * d);
    for (;;) { let z, v; do { z = norm(); v = 1 + cc * z; } while (v <= 0); v = v * v * v;
      const U = unif(); if (Math.log(U) < 0.5 * z * z + d - d * v + d * Math.log(v)) return d * v; }
  };
  // 標準化 t:變異數為 1(nu > 2),才符合 GARCH 的 σ² 定義
  const stdT = (nu) => norm() / Math.sqrt(2 * gamma(nu / 2) / nu) * Math.sqrt((nu - 2) / nu);
  return { unif, norm, stdT };
}

// ── GJR-GARCH(1,1)-t 模擬(10.1.1):r_t = μ + ε_t,σ²_t = ω + (α + γ·1[ε<0]) ε²_{t-1} + β σ²_{t-1} ──
// 平均數為常數 μ → 報酬對過去資訊「不可預測」,所以任何依過去價格決定的 pos 都沒有擇時資訊,
// 這就是虛無假設成立的世界;但波動叢聚、槓桿效果、厚尾都保留,正好是 8.1 擔心的三個因素中的 (a)(c),
// 而 (b) 由「pos 依模擬出的價格路徑產生」來涵蓋。
function simGarch(prm, n, burn, seed) {
  const R = makeRandom(seed), { mu, omega, alpha, gamma, beta, nu } = prm;
  const persist = alpha + gamma / 2 + beta;
  let s2 = omega / (1 - persist), eps = 0;
  const r = new Float64Array(n);
  for (let t = -burn; t < n; t++) {
    s2 = omega + (alpha + (eps < 0 ? gamma : 0)) * eps * eps + beta * s2;
    eps = Math.sqrt(s2) * R.stdT(nu);
    if (t >= 0) r[t] = mu + eps;
  }
  return r;
}

// 報酬 → 含息價格指數(長度 n+1,P[0]=1)
function priceFromReturns(r) {
  const P = new Float64Array(r.length + 1); P[0] = 1;
  for (let t = 0; t < r.length; t++) P[t + 1] = P[t] * (1 + r[t]);
  return P;
}

// 簡單、可重現的整數雜湊,用來把 (模擬編號, L) 變成獨立的種子
function hashSeed(...xs) {
  let h = 2166136261 >>> 0;
  for (const x of xs) { h ^= x >>> 0; h = Math.imul(h, 16777619) >>> 0; h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) >>> 0; h ^= h >>> 15; }
  return h >>> 0;
}

module.exports = { buildRules, rollingMax, posForRule, buildPosMatrix, buildD, simGarch, priceFromReturns, makeRandom, hashSeed };
