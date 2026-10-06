// 持股列表排序:持有中依市值;已出場依最後一筆賣出日期 新 → 舊
import { sortHoldingsForDisplay, lastExitKey } from './portfolioStore';

const h = (symbol, shares, marketValue, txs = []) => ({ symbol, summary: { shares, marketValue }, txs });

test('持有中在前依市值,已出場在後依最後賣出日期新到舊', () => {
  const list = [
    h('A', 0, 0, [{ type: 'buy', date: '2026-01-02' }, { type: 'sell', date: '2026-03-01' }]),
    h('B', 1000, 50000),
    h('C', 0, 0, [{ type: 'sell', date: '2026-09-30' }, { type: 'sell', date: '2026-02-01' }]),
    h('D', 500, 90000),
    h('E', 0, 0, [{ type: 'sell', date: '2026-05-05' }]),
  ];
  expect(sortHoldingsForDisplay(list).map((x) => x.symbol)).toEqual(['D', 'B', 'C', 'E', 'A']);
});

test('同一天賣出的,比建立時間;沒有賣出紀錄的退回最後一筆交易日期', () => {
  const list = [
    h('X', 0, 0, [{ type: 'sell', date: '2026-10-01', createdAt: 100 }]),
    h('Y', 0, 0, [{ type: 'sell', date: '2026-10-01', createdAt: 200 }]),
    h('Z', 0, 0, [{ type: 'cashDividend', date: '2026-10-03' }]),
  ];
  expect(sortHoldingsForDisplay(list).map((x) => x.symbol)).toEqual(['Z', 'Y', 'X']);
  expect(lastExitKey([]).date).toBe('');
});
