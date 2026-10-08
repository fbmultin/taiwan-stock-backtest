import { matchFifo, computeSymbolSummary, removeTagFromTransactions, computeDayPnl, aggregateSummaries } from './portfolioStore';

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

test('移除標籤:只清掉選到的交易的 tagId,標籤本身保留', () => {
  const data = {
    tags: [{ id: 'g1', name: '已清倉1' }],
    transactions: [{ id: 'a', tagId: 'g1' }, { id: 'b', tagId: 'g1' }, { id: 'c' }],
  };
  const next = removeTagFromTransactions(data, ['a', 'c']);
  expect(next.transactions.map((x) => x.tagId || null)).toEqual([null, 'g1', null]);
  expect(next.tags).toEqual(data.tags);
});

const TODAY = '2026-10-08';

test('當日損益:原有庫存、賣出、今日買進各自用對的基準', () => {
  const txs = [
    tx('b0', 'buy', '2026-09-01', 20, 1000), // 昨天已持有 1000 股
    tx('s1', 'sell', TODAY, 31, 400), // 賣原有庫存 400 股:(31-28)*400
    tx('b1', 'buy', TODAY, 27, 200), // 今天買 200 股:(30-27)*200
  ];
  const r = computeDayPnl(txs, { currentPrice: 30, prevClose: 28, todayDate: TODAY });
  expect(r.parts).toEqual([
    { kind: 'carry', shares: 600, pnl: 1200, lots: [{ date: '2026-09-01', shares: 600 }] }, // (30-28)*600
    { kind: 'soldPrev', shares: 400, pnl: 1200 },
    { kind: 'boughtToday', shares: 200, pnl: 600 },
  ]);
  expect(r.pnl).toBe(3000);
  expect(r.base).toBe(1000 * 28 + 200 * 27);
});

test('當日損益:當沖用賣價減買價;沒有昨收時只算有基準的部分', () => {
  const day = computeDayPnl([tx('b1', 'buy', TODAY, 27, 100), tx('s1', 'sell', TODAY, 28, 100)], { currentPrice: 30, prevClose: 28, todayDate: TODAY });
  expect(day.pnl).toBe(100);
  expect(day.parts).toEqual([{ kind: 'dayTrade', shares: 100, pnl: 100 }]);
  const noPrev = computeDayPnl([tx('b0', 'buy', '2026-09-01', 20, 1000)], { currentPrice: 30, prevClose: null, todayDate: TODAY });
  expect(noPrev.pnl).toBe(0);
});

test('當日損益:沒有今天的交易時等於舊算法 股數×(現價-昨收);並納入彙總', () => {
  const txs = [tx('b0', 'buy', '2026-09-01', 20, 1000)];
  const s = computeSymbolSummary(txs, { currentPrice: 30, prevClose: 28, todayDate: TODAY });
  expect(s.todayPnl).toBe(2000);
  expect(s.todayPnlPct).toBeCloseTo((2000 / 28000) * 100, 6);
  const agg = aggregateSummaries([s, computeSymbolSummary(txs, { currentPrice: 10, prevClose: 11, todayDate: TODAY })]);
  expect(agg.todayPnl).toBe(1000);
});

test('當日損益:昨天庫存來源依先進先出扣掉賣出,供明細顯示', () => {
  const txs = [
    tx('b1', 'buy', '2026-10-01', 100, 1000),
    tx('b2', 'buy', '2026-10-05', 110, 600),
    tx('s0', 'sell', '2026-10-06', 120, 300), // 昨天前已賣 300,先扣最早那批
    tx('s1', 'sell', TODAY, 121, 200), // 今天賣 200 也先扣昨天庫存
  ];
  const r = computeDayPnl(txs, { currentPrice: 125, prevClose: 120, todayDate: TODAY });
  const carry = r.parts.find((p) => p.kind === 'carry');
  expect(carry.shares).toBe(1100);
  expect(carry.lots).toEqual([{ date: '2026-10-01', shares: 500 }, { date: '2026-10-05', shares: 600 }]);
});

test('當日損益:同一天先登記賣、後登記買時,昨天庫存不會被虛增(買先賣後)', () => {
  const txs = [
    tx('s0', 'sell', '2026-08-21', 641, 1000, { createdAt: 1 }), // 先登記賣
    tx('b0', 'buy', '2026-08-21', 675, 1000, { createdAt: 2 }), // 後登記買
    tx('b1', 'buy', '2026-09-29', 800, 600),
    tx('s1', 'sell', TODAY, 875, 300),
  ];
  const r = computeDayPnl(txs, { currentPrice: 870, prevClose: 860, todayDate: TODAY });
  const carry = r.parts.find((p) => p.kind === 'carry');
  expect(carry.shares).toBe(300); // 8/21 買賣對沖為 0,昨天庫存 600,今天賣 300 後剩 300(修正前會多出 1000)
});
