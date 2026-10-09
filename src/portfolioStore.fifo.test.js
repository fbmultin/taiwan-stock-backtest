import { matchFifo, computeSymbolSummary, removeTagFromTransactions, computeDayPnl, aggregateSummaries, allocateDayTrades, dayTradeSharesForSell, estimateSellTax } from './portfolioStore';

const tx = (id, type, date, price, shares, extra = {}) => ({ id, type, date, price, shares, fee: 0, tax: 0, createdAt: 0, ...extra });

test('先進先出:賣出先對沖最早買進,記錄賣出日期與剩餘股數', () => {
  const r = matchFifo([
    tx('b1', 'buy', '2026-01-02', 10, 1000),
    tx('b2', 'buy', '2026-02-02', 20, 1000),
    tx('s1', 'sell', '2026-03-02', 30, 1500),
  ]);
  expect(r.buyMatches.b1).toEqual([{ sellId: 's1', date: '2026-03-02', shares: 1000, price: 30, gain: 20000 }]);
  expect(r.buyMatches.b2).toEqual([{ sellId: 's1', date: '2026-03-02', shares: 500, price: 30, gain: 5000 }]);
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
  // 同一天買 200、賣 400:其中 200 股是當沖(賣價-買價),另外 200 股才是賣掉昨天的庫存
  expect(r.parts).toEqual([
    { kind: 'carry', shares: 800, pnl: 1600, lots: [{ date: '2026-09-01', shares: 800 }] }, // (30-28)*800
    { kind: 'soldPrev', shares: 200, pnl: 600 }, // (31-28)*200
    { kind: 'dayTrade', shares: 200, pnl: 800 }, // (31-27)*200
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

test('當沖配對:同一天買賣取較小的股數,依登記順序分配', () => {
  const r = allocateDayTrades([
    tx('b1', 'buy', TODAY, 10, 300, { createdAt: 1 }),
    tx('s1', 'sell', TODAY, 11, 200, { createdAt: 2 }),
    tx('b2', 'buy', TODAY, 10, 500, { createdAt: 3 }),
    tx('s2', 'sell', TODAY, 11, 400, { createdAt: 4 }),
    tx('b0', 'buy', '2026-10-01', 10, 1000),
  ]);
  expect(r.buyDt).toEqual({ b1: 300, b2: 300 }); // 當沖共 min(800, 600) = 600
  expect(r.sellDt).toEqual({ s1: 200, s2: 400 });
});

test('持股試算:當沖的股數不進庫存,持有均價不受當天買價影響', () => {
  const txs = [
    tx('b0', 'buy', '2026-10-01', 100, 1000),
    tx('b1', 'buy', TODAY, 120, 500, { fee: 50 }),
    tx('s1', 'sell', TODAY, 121, 500, { fee: 60, tax: 90 }),
  ];
  const s = computeSymbolSummary(txs, { currentPrice: 121, todayDate: TODAY });
  expect(s.shares).toBe(1000);
  expect(s.avgPrice).toBe(100); // 以前會被當天買價攤成 106.67
  expect(s.capitalGain).toBeCloseTo(121 * 500 - 150 - (120 * 500 + 50)); // 當沖損益 = 賣淨額 - 當天買成本
});

test('持股試算:部分當沖,超過的賣出才用庫存均價結算', () => {
  const txs = [
    tx('b0', 'buy', '2026-10-01', 100, 1000),
    tx('b1', 'buy', TODAY, 120, 200),
    tx('s1', 'sell', TODAY, 130, 500),
  ];
  const s = computeSymbolSummary(txs, { currentPrice: 130, todayDate: TODAY });
  expect(s.shares).toBe(700);
  expect(s.avgPrice).toBe(100);
  expect(s.capitalGain).toBeCloseTo((130 - 120) * 200 + (130 - 100) * 300);
});

test('先進先出:同一天的賣出先對沖同一天的買進(當沖),不動舊庫存', () => {
  const r = matchFifo([
    tx('b0', 'buy', '2026-10-01', 100, 1000),
    tx('b1', 'buy', TODAY, 120, 500),
    tx('s1', 'sell', TODAY, 121, 500),
  ]);
  expect(r.buyMatches.b1).toEqual([{ sellId: 's1', date: TODAY, shares: 500, price: 121, gain: 500 }]);
  expect(r.buyRemaining.b0).toBe(1000);
  expect(r.sellRealized.s1.gain).toBeCloseTo(500);
});

test('證交稅:只有當沖的股數減半,ETF 不減半', () => {
  const all = [tx('b1', 'buy', TODAY, 100, 300, { symbol: '2330' }), tx('s0', 'sell', TODAY, 100, 100, { symbol: '2330' })];
  expect(dayTradeSharesForSell(all, '2330', TODAY, 1000, null)).toBe(200); // 買 300 已被另一筆賣配走 100
  expect(estimateSellTax(100, 1000, { dayTradeShares: 200, date: TODAY })).toBe(30 + 240); // 200股×0.15% + 800股×0.3%
  expect(estimateSellTax(100, 1000, { dayTradeShares: 0, date: TODAY })).toBe(300);
  expect(estimateSellTax(100, 1000, { dayTradeShares: 1000, isEtf: true, date: TODAY })).toBe(100);
});

test('今日損益:合併未實現(現有庫存)與今日已實現(含手續費、證交稅、股利)', () => {
  const txs = [
    tx('b0', 'buy', '2026-10-01', 100, 1000, { fee: 0 }), // 昨天就持有 1000 股
    tx('s1', 'sell', TODAY, 110, 300, { fee: 50, tax: 45 }), // 賣掉昨天庫存 300 股:已實現 = 110*300-50-45-100*300=2905
    tx('d1', 'cashDividend', TODAY, 0, 0, { amount: 1000 }), // 今日股利 1000
  ];
  const s = computeSymbolSummary(txs, { currentPrice: 115, prevClose: 108, todayDate: TODAY });
  const unrealized = (115 - 108) * 700; // 現有庫存 700 股(1000 減今天賣掉的 300)的價差
  const realized = 110 * 300 - 50 - 45 - 100 * 300 + 1000; // 賣出已實現 + 股利
  expect(s.todayRealizedPnl).toBeCloseTo(realized);
  expect(s.todayPnl).toBeCloseTo(unrealized + realized); // 兩者合併,不再是各算各的兩個數字
  const soldPart = s.todayPnlParts.find((p) => p.kind === 'soldPrev');
  const divPart = s.todayPnlParts.find((p) => p.kind === 'dividend');
  expect(soldPart.shares).toBe(300);
  expect(soldPart.pnl).toBeCloseTo(110 * 300 - 50 - 45 - 100 * 300); // 已實現,非價差
  expect(divPart.pnl).toBe(1000);
  expect(s.todayPnlParts.reduce((n, p) => n + p.pnl, 0)).toBeCloseTo(s.todayPnl); // 明細加總要等於合計
});

test('先進先出:賣出含手續費/證交稅時,分攤到每一批買進的已實現損益相加等於整筆', () => {
  const r = matchFifo([
    tx('b1', 'buy', '2026-01-02', 10, 1000),
    tx('b2', 'buy', '2026-02-02', 20, 500),
    tx('s1', 'sell', '2026-03-02', 30, 1500, { fee: 50, tax: 45 }),
  ]);
  // feeTaxPerShare = 95/1500;b1 分到 1000*(30-95/1500)-1000*10,b2 分到 500*(30-95/1500)-500*20
  const b1gain = 1000 * (30 - 95 / 1500) - 1000 * 10;
  const b2gain = 500 * (30 - 95 / 1500) - 500 * 20;
  expect(r.buyMatches.b1[0].gain).toBeCloseTo(b1gain);
  expect(r.buyMatches.b2[0].gain).toBeCloseTo(b2gain);
  expect(r.buyMatches.b1[0].gain + r.buyMatches.b2[0].gain).toBeCloseTo(r.sellRealized.s1.gain);
});
