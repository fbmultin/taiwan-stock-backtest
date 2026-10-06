// 持股熱力圖:模型(各群組市值/比重/漲跌)與兩層互動(群組 → 個股 → 細節框)
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

jest.mock('./firebase', () => ({ auth: {}, db: {}, googleProvider: {} }));
jest.mock('firebase/auth', () => ({ onAuthStateChanged: jest.fn(), GoogleAuthProvider: { credential: jest.fn() } }));
jest.mock('firebase/firestore', () => ({ doc: jest.fn(), getDoc: jest.fn(), setDoc: jest.fn(), onSnapshot: jest.fn() }));
jest.mock('./dataCache', () => ({
  fetchStockPriceData: jest.fn(),
  fetchStockDisplayName: jest.fn(),
  loadPriceCache: jest.fn(),
  fetchLiveQuotes: jest.fn(),
  fetchDividendData: jest.fn(),
}));

/* eslint-disable import/first */
import { HeatmapView } from './PortfolioTracker';
import { buildHeatmapModel } from './portfolioHeatmap';
/* eslint-enable import/first */

global.IS_REACT_ACT_ENVIRONMENT = true;

const buy = (id, groupId, symbol, shares) => ({
  id, groupId, symbol, type: 'buy', date: '2026-09-01', price: 10, shares, fee: 0, tax: 0, amount: -(shares * 10),
});
const data = {
  version: 1,
  activeGroupId: 'g1',
  groups: [{ id: 'g1', name: '長期', color: '#f00' }, { id: 'g2', name: '波段', color: '#0f0' }],
  tags: [],
  transactions: [buy('1', 'g1', '00865B', 1000), buy('2', 'g1', '2330', 100), buy('3', 'g2', '2330', 200), buy('4', 'g2', '3406', 50)],
};
const prices = {
  '00865B': { price: 50, prevClose: 50 },
  '2330': { price: 1000, prevClose: 990 },
  '3406': { price: 200, prevClose: 200 },
};
const names = { '00865B': '國泰US短期公債', '2330': '台積電', '3406': '玉晶光' };

test('模型:各群組市值、全部合併、已出場不入圖', () => {
  const m = buildHeatmapModel({ ...data, transactions: data.transactions.concat({ ...buy('5', 'g1', '1101', 10), type: 'sell', amount: 100 }) }, prices, names);
  expect(m.total.marketValue).toBe(50000 + 100000 + 200000 + 10000);
  const g1 = m.groups.find((g) => g.id === 'g1');
  expect(g1.marketValue).toBe(150000);
  expect(g1.items.map((i) => i.symbol)).toEqual(['2330', '00865B']);
  expect(m.total.items.find((i) => i.symbol === '2330').shares).toBe(300);
  expect(m.total.changePct).toBeGreaterThan(0);
});

test('熱力圖:群組格列出個股(ETF 代號/股名)→ 點群組看個股 → 點個股跳細節框', async () => {
  const model = buildHeatmapModel(data, prices, names);
  const onBack = jest.fn();
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => { root.render(<HeatmapView isLight model={model} onBack={onBack} />); });
  const g1 = el.querySelector('[data-testid="hm-group-g1"]');
  expect(g1.textContent).toContain('長期');
  expect(g1.textContent).toMatch(/\d+\.\d\d%/);
  expect(g1.textContent).toContain('台積電');
  expect(g1.textContent).toContain('00865B');
  expect(g1.textContent).not.toContain('國泰US短期公債');
  await act(async () => { g1.click(); });
  const st = el.querySelector('[data-testid="hm-stock-00865B"]');
  expect(st.textContent).toContain('00865B'); // ETF 顯示代號
  expect(el.querySelector('[data-testid="hm-stock-2330"]').textContent).toContain('台積電'); // 個股顯示股名
  await act(async () => { el.querySelector('[data-testid="hm-stock-2330"]').click(); });
  const pop = el.querySelector('[data-testid="heatmap-popup"]');
  expect(pop.textContent).toContain('持股比重');
  expect(pop.textContent).toContain('66.67%');
  expect(pop.textContent).toContain('100股');
  expect(pop.textContent).toContain('100,000');
  expect(pop.textContent).toContain('1000.00(+1.01%)');
  // 浮動回上一層鈕:每層都有;點細節框外關閉後,個股層回群組層、群組層回首頁
  await act(async () => { el.querySelector('[data-testid="heatmap-popup"]').parentElement.click(); });
  const fb = () => el.querySelector('[data-testid="heatmap-float-back"]');
  expect(fb()).not.toBeNull();
  await act(async () => { fb().click(); });
  expect(el.querySelector('[data-testid="hm-group-g1"]')).not.toBeNull();
  expect(fb()).not.toBeNull();
  await act(async () => { fb().click(); });
  expect(onBack).toHaveBeenCalledTimes(1);
  await act(() => root.unmount());
});
