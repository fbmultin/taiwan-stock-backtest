'use strict';
// 匯出 d 矩陣(Float64 二進位)給 acf_lb.py 算自相關與 Ljung–Box(10.1 第 4 點)
// 真實 4 檔 ETF 用「未位移」的 d(就是 app 實際會檢定的那一份),另加 20 條 GARCH 虛無路徑當對照
const fs = require('fs'), path = require('path'), L = require('./step0lib');
const rules = L.buildRules(), C = 0.01 / 252, meta = {};
fs.mkdirSync('out/d', { recursive: true });
function dump(name, r) {
  const P = L.priceFromReturns(r), { kept, posList } = L.buildPosMatrix(P, rules, 5);
  const { d, n, K, f } = L.buildD(posList, r, C);
  fs.writeFileSync(`out/d/${name}.bin`, Buffer.from(d.buffer));
  meta[name] = { n, K, ids: kept.map(k => k.id), f: Array.from(f) };
}
for (const e of ['0050', '0056', '006208', '00692']) {
  const rows = fs.readFileSync(`data/${e}_ret.csv`, 'utf8').trim().split('\n').slice(2);
  dump(e, Float64Array.from(rows.map(l => +l.split(',')[2])));
}
const prm = require('./garch_params.json');
for (let s = 0; s < 20; s++) dump(`garch${s}`, L.simGarch(prm, 5200, 1000, L.hashSeed(777, s)));
fs.writeFileSync('out/d/meta.json', JSON.stringify(meta));
console.log(Object.entries(meta).slice(0, 5).map(([k, v]) => `${k}: n=${v.n} K=${v.K}`).join('\n'));
