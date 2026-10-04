'use strict';
// Step 0 程式的自我檢查:pos 的時序與「笨方法」逐字對照、d 的代數性質、GARCH 模擬的動差。
// 為什麼要做:Step 0 的結論完全建立在 pos/d 構造正確上;時序錯一天就可能變成偷看未來。
const assert = require('assert');
const L = require('./step0lib');
const { bootMeans, bootMeansNaive, cumsum } = require('./spa_stepm_prototype');

// 1) 笨方法:直接照 3.2/3.3 的文字定義逐天算
function naivePos(P, x, h, N) {
  const T = P.length, n = T - 1, pos = new Uint8Array(n), sig = [];
  const DD = s => { let H = -Infinity; for (let i = s - N + 1; i <= s; i++) H = Math.max(H, P[i]); return P[s] / H - 1; };
  for (let s = N; s < T; s++) if (DD(s) <= -x && DD(s - 1) > -x) sig.push(s);
  // 報酬日 t(1..n) 持有 ⇔ 存在 s 使 s+1 ≤ t ≤ s+h;pos 索引 = t-1
  for (let t = 1; t <= n; t++) if (sig.some(s => s + 1 <= t && t <= s + h)) pos[t - 1] = 1;
  return { pos, sig };
}
const R = L.makeRandom(42);
for (let trial = 0; trial < 30; trial++) {
  const r = Float64Array.from({ length: 900 }, () => 0.0003 + 0.015 * R.stdT(4));
  const P = L.priceFromReturns(r);
  for (const [x, h, N] of [[0.05, 20, 60], [0.1, 63, 252], [0.03, 5, 60], [0.2, 126, 252]]) {
    const H = L.rollingMax(P, N);
    const a = L.posForRule(P, H, x, h, N).pos, b = naivePos(P, x, h, N).pos;
    assert.deepStrictEqual(Array.from(a), Array.from(b), `pos 不一致 trial=${trial} x=${x}`);
  }
}
console.log('OK pos 與笨方法逐日一致(30 條隨機路徑 × 4 條規則)');

// 2) 不偷看未來:改動第 t 天以後的價格,pos[0..t-1] 不能變
{
  const r = Float64Array.from({ length: 800 }, () => 0.015 * R.norm());
  const P = L.priceFromReturns(r), cut = 500;
  const r2 = Float64Array.from(r); for (let t = cut; t < r2.length; t++) r2[t] = -0.05; // 第 cut 天起暴跌
  const P2 = L.priceFromReturns(r2);
  const a = L.posForRule(P, L.rollingMax(P, 60), 0.05, 20, 60).pos;
  const b = L.posForRule(P2, L.rollingMax(P2, 60), 0.05, 20, 60).pos;
  // r[cut] 改了 → P[cut+1] 起不同 → 訊號最早在 s=cut+1 → 最早影響 pos[cut+1]
  for (let t = 0; t <= cut; t++) assert.strictEqual(a[t], b[t], `pos[${t}] 偷看了未來`);
  console.log('OK 無前視:未來價格變動不影響已決定的 pos');
}

// 3) 手算小例子:N=3、x=10%,第 4 天收盤跌破 → 第 5 天的報酬起持有 h=2 天
{
  const P = Float64Array.from([100, 100, 100, 100, 89, 88, 95, 95]);
  const { pos, sig } = naivePos(P, 0.10, 2, 3);
  assert.deepStrictEqual(sig, [4]);
  // 報酬日 t=5,6 → pos 索引 4,5
  assert.deepStrictEqual(Array.from(L.posForRule(P, L.rollingMax(P, 3), 0.10, 2, 3).pos), [0, 0, 0, 0, 1, 1, 0]);
  console.log('OK 手算例子:第 4 天收盤跌破 → 第 5、6 天報酬持有');
}

// 4) d 的代數性質:Σ_t (pos−f) = 0,所以常數現金利率不影響 d̄(c 只影響逐日 d 的值)
{
  const r = Float64Array.from({ length: 2000 }, () => 0.0004 + 0.013 * R.stdT(4));
  const P = L.priceFromReturns(r);
  const { posList } = L.buildPosMatrix(P, L.buildRules(), 5);
  const a = L.buildD(posList, r, 0), b = L.buildD(posList, r, 0.05 / 252);
  for (let k = 0; k < a.K; k++) {
    let sa = 0, sb = 0; for (let t = 0; t < a.n; t++) { sa += a.d[t * a.K + k]; sb += b.d[t * a.K + k]; }
    assert(Math.abs(sa - sb) < 1e-12, 'd̄ 受常數現金利率影響');
  }
  // 循環位移 shift=0 應與不位移相同;cumsum 版重抽樣與逐日版一致
  const s0 = L.buildD(posList, r, 0, { shift: 0 });
  assert.deepStrictEqual(Array.from(s0.d.slice(0, 50)), Array.from(a.d.slice(0, 50)));
  const m1 = bootMeans(cumsum(a.d, a.n, a.K), a.n, a.K, 20, 10, 3), m2 = bootMeansNaive(a.d, a.n, a.K, 20, 10, 3);
  let mx = 0; for (let i = 0; i < m1.length; i++) mx = Math.max(mx, Math.abs(m1[i] - m2[i]));
  assert(mx < 1e-15, 'cumsum 版與逐日版不一致');
  console.log(`OK 常數現金利率不影響 d̄;cumsum 重抽樣 vs 逐日版最大差 ${mx.toExponential(1)};保留規則數 ${a.K}`);
}

// 5) GARCH 模擬:平均、年化波動、峰態大致合理
{
  const prm = require('./garch_params.json');
  const r = L.simGarch(prm, 200000, 1000, 5);
  let m = 0; for (const v of r) m += v; m /= r.length;
  let v2 = 0, v4 = 0; for (const v of r) { v2 += (v - m) ** 2; v4 += (v - m) ** 4; } v2 /= r.length; v4 /= r.length;
  console.log(`GARCH 模擬:日均 ${(m * 1e4).toFixed(2)} bp(參數 ${(prm.mu * 1e4).toFixed(2)})、年化波動 ${(Math.sqrt(v2 * 252) * 100).toFixed(1)}%、峰態 ${(v4 / v2 / v2).toFixed(1)}`);
}
