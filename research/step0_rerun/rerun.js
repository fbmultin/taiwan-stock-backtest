'use strict';
// Step 0 重跑執行器(規格:設計文件 13.6)。
//   node rerun.js gate  <case> <L> <from> <to> <out>   正式閘門格:case ∈ 0051|0055|006201|A
//   node rerun.js shift <etf>      <from> <to> <out>   輔助 1:真實資料循環位移(六個 L 共用同一組位移)
//   node rerun.js power <case> <δ%> <from> <to> <out>  輔助 2:注入優勢的檢定力(L=20)
//   node rerun.js bcmp  <from> <to> <out>              輔助 4:案例 A、L=20,B=5000 與閘門同一批路徑對照
// 每一行輸出一筆 JSON;同步寫檔(計算會卡住事件迴圈,非同步寫入會等到最後才落地)。
const fs = require('fs');
const path = require('path');
const R = require('./rerunlib');
const { spaStepm } = require('../step0/spa_stepm_prototype');

const CASES = ['0051', '0055', '006201', 'A'];
const LS = [1, 5, 10, 20, 60, 250];
const DELTAS = [5, 10, 15, 20, 30, 40];
const SHIFT_ETFS = ['0051', '0055', '006201', '0052', '0053', '0057', '006203', '006204'];
const GARCH = JSON.parse(fs.readFileSync(path.join(__dirname, 'garch_params.json'), 'utf8'));
const BURN = 1000;  // GARCH 預熱(丟掉),與上次相同

// 各 case 的可檢定天數 n:三檔用自己的資料長度;案例 A 用 0050 目前實際的長度(13.6:實作時記錄)
function nOf(c) { return R.loadReturns(c === 'A' ? '0050' : c).D - R.WARMUP; }

const [mode, ...args] = process.argv.slice(2);
let outFile;
const write = (o) => fs.appendFileSync(outFile, JSON.stringify(o) + '\n');

function test(d, n, K, B, L, seed) {
  const res = spaStepm(d, n, K, { B, L, seed, alpha: 0.05 });
  return { T: +res.T.toFixed(4), pl: res.pvalues.l, pc: res.pvalues.c, pu: res.pvalues.u, stepm: res.stepmRejected.length };
}

// 一條 GARCH 路徑:模擬 n+250 個報酬(含 251 天預熱的價格),再交給 prepare 切出檢定區間
function garchPath(c, n, seed) {
  return R.L0.simGarch(GARCH[c], n + R.WARMUP - 1, BURN, seed);
}

if (mode === 'gate' || mode === 'bcmp') {
  const c = mode === 'gate' ? args[0] : 'A';
  const Lb = mode === 'gate' ? +args[1] : 20;
  const [from, to] = (mode === 'gate' ? args.slice(2, 4) : args.slice(0, 2)).map(Number);
  outFile = mode === 'gate' ? args[4] : args[2];
  const ci = CASES.indexOf(c), li = LS.indexOf(Lb);
  if (ci < 0 || li < 0) throw new Error('case 或 L 不在登記清單內');
  const cellId = 100 * (ci + 1) + li;        // 格編號:同一格的路徑不會因其他格而改變
  const n = nOf(c), rules = R.rulesFor(n);
  for (let p = from; p < to; p++) {
    const { kept, pos, r } = R.prepare(garchPath(c, n, R.seedOf(cellId, p, 1)), n, rules);
    const { d, K } = R.L0.buildD(pos, r, R.C_DAILY);
    if (mode === 'gate') write({ mode, case: c, L: Lb, cell: cellId, path: p, n, K, ...test(d, n, K, 1000, Lb, R.seedOf(cellId, p, 2)) });
    else write({ mode, case: c, L: Lb, cell: cellId, path: p, n, K, B: 5000, ...test(d, n, K, 5000, Lb, R.seedOf(cellId, p, 3)) });
  }
} else if (mode === 'shift') {
  const [etf, fromS, toS, o] = args; outFile = o;
  const ei = SHIFT_ETFS.indexOf(etf);
  const { r: rAll, D } = R.loadReturns(etf);
  const n = D - R.WARMUP, rules = R.rulesFor(n);
  const { pos, r, kept } = R.prepare(rAll, n, rules);
  for (let s = +fromS; s < +toS; s++) {
    const rng = R.L0.makeRandom(R.seedOf(1000 + ei, s, 1));
    const shift = 252 + Math.floor(rng.unif() * (n - 504 + 1));   // 位移 ∈ [252, n−252]
    const { d, K } = R.L0.buildD(pos, r, R.C_DAILY, { shift });
    for (let li = 0; li < LS.length; li++)
      write({ mode, etf, L: LS[li], shift_id: s, shift, n, K, ...test(d, n, K, 1000, LS[li], R.seedOf(1000 + ei, s, 10 + li)) });
  }
} else if (mode === 'power') {
  const [c, dS, fromS, toS, o] = args; outFile = o;
  const ci = CASES.indexOf(c), di = DELTAS.indexOf(+dS);
  if (ci < 0 || di < 0) throw new Error('case 或 δ 不在登記清單內');
  const cellId = 2000 + 10 * ci + di, n = nOf(c), rules = R.rulesFor(n);
  for (let p = +fromS; p < +toS; p++) {
    const { kept, pos, r } = R.prepare(garchPath(c, n, R.seedOf(cellId, p, 1)), n, rules);
    const k = kept.findIndex(x => x.id === 'x10_h126');
    // 目標規則若因進場 < 5 次被剔除:照常檢定(不注入),記錄下來;分母仍是全部路徑(較保守)
    const inject = k >= 0 ? { k, delta: (+dS / 100) / 252 } : null;
    const { d, K } = R.L0.buildD(pos, r, R.C_DAILY, inject ? { inject } : {});
    const t = spaStepm(d, n, K, { B: 1000, L: 20, seed: R.seedOf(cellId, p, 2), alpha: 0.05 });
    write({ mode, case: c, delta: +dS, path: p, n, K, targetKept: k >= 0, stepm: t.stepmRejected.length,
      targetSelected: k >= 0 && t.stepmRejected.includes(k), pc: t.pvalues.c });
  }
} else throw new Error('未知模式 ' + mode);
