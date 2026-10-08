import { matchFifo, computeSymbolSummary } from './portfolioStore';

const tx = (id, type, date, price, shares, extra = {}) => ({ id, type, date, price, shares, fee: 0, tax: 0, createdAt: 0, ...extra });

test('先進先出:賣出先對沖最早買進,記錄賣出日期與剩餘股數', () => {
  const r = matchFifo([
    tx('b1', 'buy', '2026-01-02', 10, 1000),
    tx('b2', 'buy', '2026-02-02', 20, 1000),
    tx('s1', 'sell', '2026-03-02', 30, 1500),
  ]);
  expect(r.buyMatches.b1).toEqual([{ sellId: 's1', date: '2026-03-02', shares: 1000 }]);
  expect(r.buyMatches.b2).toEqual([{ sellId: 's1', date: '2026-03-02', shares: 500 }]);
  expect(r.buyRemaining).toEqual({ b1: 0, b2: 500 });
  // 成本 = 1000*10 + 500*20 = 20,000;收入 = 45,000
  expect(r.sellRealized.s1.gain).toBe(25000);
});

test('同一天先賣後買的排序不影響:買先處理', () => {
  const r = matchFifo([tx('s1', 'sell', '2026-03-02', 12, 1000), tx('b1', 'buy', '2026-03-02', 10, 1000)]);
  expect(r.buyRemaining.b1).toBe(0);
  expect(r.sellRealized.s1.gain).toBe(2000);
});

test('今日已實現損益用先進先出,不是平均成本', () => {
  const txs = [
    tx('b1', 'buy', '2026-01-02', 10, 1000),
    tx('b2', 'buy', '2026-02-02', 20, 1000),
    tx('s1', 'sell', '2026-10-08', 30, 1000),
  ];
  const s = computeSymbolSummary(txs, { currentPrice: 30, todayDate: '2026-10-08' });
  // FIFO:賣掉的是 10 元那批 → 賺 20,000(平均成本法只會算 15,000)
  expect(s.todayRealizedPnl).toBe(20000);
});

test('配股當成本 0 的一批參與配對', () => {
  const r = matchFifo([tx('b1', 'buy', '2026-01-02', 10, 1000), tx('d1', 'stockDividend', '2026-02-02', 0, 100), tx('s1', 'sell', '2026-03-02', 10, 1050)]);
  expect(r.buyRemaining).toEqual({ b1: 0, d1: 50 });
});
