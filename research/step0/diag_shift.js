'use strict';
// 診斷:循環位移虛無的拒絕率為什麼在不同 ETF 差這麼多?
// 做法:對每一個可能的位移量 m(每 3 天取一個),算代表性規則的 t 值(重抽樣變異數,L=20)。
// 若檢定校準正確,t 在各位移之間的標準差應約為 1;明顯大於 1 代表「這段歷史」下變異數被低估。
// 另外記錄 T(108 條的最大值)隨 m 的變化,看拒絕是否集中在少數幾段位移(→ 有效獨立樣本很少)。
const fs = require('fs'), L = require('./step0lib'), { spaStepm } = require('./spa_stepm_prototype');
const rules = L.buildRules(), C = 0.01 / 252, res = {};
const pick = ['x5_h63_N60', 'x10_h126_N252', 'x15_h252_N252', 'x8_h126_N60'];
for (const e of ['0050', '0056', '006208', '00692']) {
  const rows = fs.readFileSync(`data/${e}_ret.csv`, 'utf8').trim().split('\n').slice(2);
  const r = Float64Array.from(rows.map(l => +l.split(',')[2])), n = r.length;
  const P = L.priceFromReturns(r), { kept, posList } = L.buildPosMatrix(P, rules, 5);
  const idx = pick.map(id => kept.findIndex(k => k.id === id)).filter(i => i >= 0);
  const sub = idx.map(i => posList[i]);
  const ms = [], ts = [], Ts = [];
  for (let m = 252; m <= n - 252; m += 3) {
    const { d, K } = L.buildD(sub, r, C, { shift: m });
    const o = spaStepm(d, n, K, { B: 300, L: 20, seed: m });
    ms.push(m); ts.push(o.tk);
    if (m % 15 === 0) { const full = L.buildD(posList, r, C, { shift: m }); Ts.push([m, spaStepm(full.d, n, full.K, { B: 300, L: 20, seed: m }).pvalues.c]); }
  }
  const sd = idx.map((_, j) => { const v = ts.map(t => t[j]); const mu = v.reduce((a, b) => a + b) / v.length; return Math.sqrt(v.reduce((a, b) => a + (b - mu) ** 2, 0) / v.length); });
  const mean = idx.map((_, j) => ts.reduce((a, t) => a + t[j], 0) / ts.length);
  res[e] = { n, rules: idx.map(i => kept[i].id), sd_t: sd, mean_t: mean, pc_by_shift: Ts };
  console.log(e, 'n', n, kept.length, idx.map((i, j) => `${kept[i].id}: t 平均 ${mean[j].toFixed(2)} 標準差 ${sd[j].toFixed(2)}`).join(' | '));
}
fs.writeFileSync('out/diag_shift.json', JSON.stringify(res));
