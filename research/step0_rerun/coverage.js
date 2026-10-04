'use strict';
// 輔助報告 3(設計文件 13.6、14.2.4):第一層描述性數字的區間涵蓋率。
//   node coverage.js <case> <out.json>
// 步驟(順序固定,真值先算好寫檔,之後才算涵蓋率,不看結果調整):
//   1. 真值:該 case 的 GARCH 模型下,規則「回檔 10%、持有 126 天、252 日窗口」的
//      「事件群第一次進場日」之後 126 日報酬,把 20000 條獨立路徑的所有事件群合在一起取中位數。
//   2. 涵蓋率:另外 2000 條路徑(條數在執行前寫死於此),每條算 N_eff(事件群數)與中位數的 90% 區間
//      (以事件群為單位做自助法,1000 次,取第 5 與第 95 百分位);N_eff < 5 不給區間(14.2.4),另計數。
//      涵蓋率 = 區間包含真值的路徑比例(只算有給區間的路徑)。
// 事件群(14.2.4):持有期窗口 [s+1, s+126] 互相重疊的進場日併為一群,取群內第一次進場日。
const fs = require('fs');
const R = require('./rerunlib');
const GARCH = JSON.parse(fs.readFileSync(__dirname + '/garch_params.json', 'utf8'));
const CASES = ['0051', '0055', '006201', 'A'];
const X = 0.10, H = 126, N_TRUTH = 20000, N_COV = 2000, B_CI = 1000;

const [c, outFile] = process.argv.slice(2);
const ci = CASES.indexOf(c);
const n = R.loadReturns(c === 'A' ? '0050' : c).D - R.WARMUP;

// 回傳一條路徑上「事件群第一次進場日」的後續 126 日報酬
function clusterReturns(seed) {
  const r = R.L0.simGarch(GARCH[c], n + R.WARMUP - 1, 1000, seed);
  const P = R.L0.priceFromReturns(r), Hm = R.L0.rollingMax(P, 252), T = P.length;
  const out = [];
  let lastEntry = -Infinity;
  for (let s = 252; s + H < T; s++) {  // 需要完整窗口(s ≥ 252)且之後還有 126 天可算報酬
    const dd = P[s] / Hm[s] - 1, ddPrev = P[s - 1] / Hm[s - 1] - 1;
    if (dd <= -X && ddPrev > -X) {
      // 與上一個進場日的持有窗口重疊(s < 上一個 + 126)→ 同一群,不另計
      if (s >= lastEntry + H) out.push(P[s + H] / P[s] - 1);
      lastEntry = s;
    }
  }
  return out;
}
const median = (a) => { const s = Float64Array.from(a).sort(); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// 1. 真值
const pool = [];
for (let p = 0; p < N_TRUTH; p++) for (const v of clusterReturns(R.seedOf(3000 + ci, p, 1))) pool.push(v);
const truth = median(pool);
fs.writeFileSync(outFile.replace('.json', '_truth.json'), JSON.stringify({ case: c, n, truth, pooledClusters: pool.length, paths: N_TRUTH }));

// 2. 涵蓋率
let covered = 0, withCI = 0, tooFew = 0; const neff = [], widths = [];
for (let p = 0; p < N_COV; p++) {
  const v = clusterReturns(R.seedOf(4000 + ci, p, 1));
  neff.push(v.length);
  if (v.length < 5) { tooFew++; continue; }
  const rng = R.L0.makeRandom(R.seedOf(4000 + ci, p, 2)), meds = new Float64Array(B_CI), tmp = new Array(v.length);
  for (let b = 0; b < B_CI; b++) { for (let i = 0; i < v.length; i++) tmp[i] = v[Math.floor(rng.unif() * v.length)]; meds[b] = median(tmp); }
  meds.sort();
  const lo = meds[Math.floor(0.05 * B_CI)], hi = meds[Math.ceil(0.95 * B_CI) - 1];
  withCI++; widths.push(hi - lo);
  if (truth >= lo && truth <= hi) covered++;
}
fs.writeFileSync(outFile, JSON.stringify({ case: c, n, truth, paths: N_COV, withCI, tooFew, covered,
  coverage: covered / withCI, neffMedian: median(neff), widthMedian: median(widths) }));
