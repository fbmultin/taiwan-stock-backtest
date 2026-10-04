'use strict';
// Step 0 執行器:node step0run.js <mode> <from> <to> <out.jsonl> [etf]
//   mode = garch  :GARCH 虛無,模擬編號 from..to-1
//   mode = shift  :真實資料循環位移虛無(etf 指定代號),位移編號 from..to-1
//   mode = power  :GARCH 路徑 + 注入已知優勢,編號 from..to-1(每個編號跑三種 δ)
// 每一行輸出一筆 JSON:一次模擬 × 一個 L 的 SPA 三個 p 值與 StepM 是否非空。
// 為什麼分段跑、寫 jsonl:2000 次 × 6 個 L 要跑幾十分鐘,分段可以平行(2 核)且中斷可續跑。

const fs = require('fs');
const path = require('path');
const { spaStepm } = require('./spa_stepm_prototype');
const L = require('./step0lib');

const [mode, fromS, toS, outFile, etf] = process.argv.slice(2);
const from = +fromS, to = +toS;
const Ls = [1, 5, 10, 20, 60, 250];
const B = 1000, ALPHA = 0.05;
const C_DAILY = 0.01 / 252;            // 10.1.1:現金固定年化 1%
const N_SIM = 5200, BURN = 1000;
const prm = JSON.parse(fs.readFileSync(path.join(__dirname, 'garch_params.json'), 'utf8'));
const rules = L.buildRules();
// 用同步寫入:計算是同步阻塞的,createWriteStream 要等事件迴圈空下來才會真的寫檔,
// 會導致跑完前完全看不到進度、中途中斷就全部遺失。
const out = { write: (s) => fs.appendFileSync(outFile, s), end: () => {} };

function runTests(d, n, K, simId, extra) {
  for (const Lb of Ls) {
    // 種子依 (模式, 模擬編號, L) 雜湊而來:各 L 的重抽樣互相獨立,且與分段方式無關
    const seed = L.hashSeed(mode.length, simId, Lb, extra && extra.di != null ? extra.di : 0);
    const res = spaStepm(d, n, K, { B, L: Lb, seed, alpha: ALPHA });
    out.write(JSON.stringify({ mode, etf: etf || null, sim: simId, L: Lb, K, n,
      T: +res.T.toFixed(4), pl: res.pvalues.l, pc: res.pvalues.c, pu: res.pvalues.u,
      stepm: res.stepmRejected.length, ...(extra || {}) }) + '\n');
  }
}

if (mode === 'garch' || mode === 'power') {
  const target = rules.findIndex(r => r.x === 0.10 && r.h === 126 && r.N === 252);
  for (let s = from; s < to; s++) {
    const r = L.simGarch(prm, N_SIM, BURN, L.hashSeed(777, s));   // 路徑種子與重抽樣種子分開
    const P = L.priceFromReturns(r);
    const { kept, posList } = L.buildPosMatrix(P, rules, 5);
    if (mode === 'garch') {
      const { d, n, K } = L.buildD(posList, r, C_DAILY);
      runTests(d, n, K, s, {});
    } else {
      const kIdx = kept.indexOf(rules[target]);
      for (const [di, ann] of [[1, 0.05], [2, 0.10], [3, 0.20]]) {
        // 目標規則若因事件數不足被剔除,仍記錄下來(此時檢定力就是 0 的來源之一)
        if (kIdx < 0) { out.write(JSON.stringify({ mode, sim: s, di, ann, targetKept: false }) + '\n'); continue; }
        const { d, n, K } = L.buildD(posList, r, C_DAILY, { inject: { k: kIdx, delta: ann / 252 } });
        runTests(d, n, K, s, { di, ann, targetKept: true });
      }
    }
  }
} else if (mode === 'shift') {
  const rows = fs.readFileSync(path.join(__dirname, 'data', `${etf}_ret.csv`), 'utf8').trim().split('\n').slice(1);
  const r = Float64Array.from(rows.slice(1).map(l => +l.split(',')[2])); // 第一天沒有報酬
  const P = L.priceFromReturns(r);
  const { posList } = L.buildPosMatrix(P, rules, 5);
  const n = r.length;
  for (let s = from; s < to; s++) {
    const rng = L.makeRandom(L.hashSeed(999, s));
    const shift = 252 + Math.floor(rng.unif() * (n - 504 + 1)); // 10.1.1:位移量 ∈ [252, n−252]
    const { d, K } = L.buildD(posList, r, C_DAILY, { shift });
    runTests(d, n, K, s, { shift });
  }
}
out.end();
