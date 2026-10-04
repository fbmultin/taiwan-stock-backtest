// Step C:把 app 的純函式(main 分支的 src/pullbackStats.js、src/pullbackData.js)原封不動拿來算。
// app 原始碼是 ES module(import/export,且 import 路徑沒寫副檔名),Node 不能直接 require,
// 所以用 app 自己 node_modules 裡的 Babel 只做「ESM → CommonJS」的語法轉換,不改任何計算邏輯。
// 用法:APP_DIR=<main 分支 checkout> node run_app.js <series.json> <out.json>
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const APP = process.env.APP_DIR;
if (!APP) throw new Error('請設定 APP_DIR(main 分支的 checkout 路徑)');
const babel = require(path.join(APP, 'node_modules', '@babel', 'core'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stepc-'));
const used = {};
for (const rel of ['src/pullbackStats.js', 'src/pullbackData.js', 'src/data/twStockSplits.js']) {
  const src = fs.readFileSync(path.join(APP, rel));
  used[rel] = crypto.createHash('sha1').update(`blob ${src.length}\0`).update(src).digest('hex'); // git blob sha
  const out = babel.transformSync(src.toString('utf8'), {
    babelrc: false, configFile: false,
    plugins: [require.resolve(path.join(APP, 'node_modules', '@babel', 'plugin-transform-modules-commonjs'))],
  }).code;
  const dst = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, out);
}
const S = require(path.join(tmp, 'src/pullbackStats.js'));
const D = require(path.join(tmp, 'src/pullbackData.js'));

const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const result = { appBlobs: used, series: {}, appPipeline: {} };

// 1) 純函式:同一條還原價序列 → 回檔、事件、事件群、各格統計、今日狀態
for (const [name, s] of Object.entries(input.series)) {
  result.series[name] = {};
  for (const N of S.WINDOWS) {
    const { dd, high } = S.computeDrawdown(s.adj, N);
    const events = {};
    for (const x of S.THRESHOLDS) events[x] = S.detectEvents(dd, x, N);
    const table = S.computeTable(s.adj, N);
    result.series[name][N] = { dd, high, events, table, state: S.currentState(s.adj, N) };
  }
}

// 2) app 的資料管線:原始收盤價 + 原始除息 → toSeries(分割校正 + 含息還原價)
for (const [name, p] of Object.entries(input.pipeline)) {
  const res = {
    data: p.dates.map((d, i) => ({ date: d, timestamp: new Date(d).getTime(), price: p.close_raw[i] })),
    divDates: [], dividendsMap: {},
  };
  p.dates.forEach((d, i) => {
    if (p.div[i] > 0) { const t = new Date(d).getTime(); res.divDates.push(t); res.dividendsMap[t] = { amount: p.div[i] }; }
  });
  const ser = D.toSeries(p.symbol, res);
  result.appPipeline[name] = { dates: ser.dates, adj: ser.adj, splitNotes: ser.splitNotes.map((n) => n.status) };
}
fs.writeFileSync(process.argv[3], JSON.stringify(result));
console.log('app 計算完成,使用的 app 檔案 blob:', used);
