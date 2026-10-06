// 新增交易表單:±按鈕依 ETF/股票級距跳動,填價格與股數時即時列出費用明細
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
import * as dataCache from './dataCache';
import { TransactionFormModal } from './PortfolioTracker';
/* eslint-enable import/first */

global.IS_REACT_ACT_ENVIRONMENT = true;

const data = {
  version: 1,
  groups: [{ id: 'g1', name: '長期', color: '#34d399' }],
  tags: [],
  activeGroupId: 'g1',
  transactions: [],
};

beforeEach(() => {
  // CRA 預設 resetMocks:true,實作要在每個測試前重設;網路永遠不回來,避免自動帶價蓋掉測試輸入
  dataCache.fetchStockPriceData.mockImplementation(() => new Promise(() => {}));
  dataCache.fetchStockDisplayName.mockImplementation(() => new Promise(() => {}));
  dataCache.loadPriceCache.mockImplementation(() => null);
  dataCache.fetchLiveQuotes.mockImplementation(() => new Promise(() => {}));
  if (dataCache.fetchDividendData) dataCache.fetchDividendData.mockImplementation(() => new Promise(() => {}));
});

async function render(initial) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(
      <TransactionFormModal isLight data={data} initial={initial} onClose={() => {}} onSubmit={() => {}} onDelete={() => {}} />
    );
  });
  return { el, unmount: () => act(() => root.unmount()) };
}

const clickButton = async (el, label) => {
  const btn = el.querySelector(`button[aria-label="${label}"]`);
  if (!btn) throw new Error(`找不到按鈕 ${label}`);
  await act(async () => {
    btn.click();
  });
};

test('00945B 價格 + 按鈕跳 0.01(ETF級距),費用明細列出價金、手續費、應付金額', async () => {
  const { el, unmount } = await render({ symbol: '00945B', type: 'buy', price: 15.3, shares: 1000 });
  const box = el.querySelector('[data-testid="cost-breakdown"]');
  expect(box).not.toBeNull();
  expect(box.textContent).toContain('價金');
  expect(box.textContent).toContain('15,300');
  expect(box.textContent).toContain('手續費');
  expect(box.textContent).toContain('應付金額');
  expect(box.textContent).toContain('升降單位 0.01');
  expect(box.textContent).not.toContain('證交稅');
  await unmount();
});

test('賣出股票:明細含證交稅 0.3%,應收 = 價金 − 手續費 − 稅', async () => {
  const { el, unmount } = await render({ symbol: '2330', type: 'sell', price: 1000, shares: 1000, date: '2026-10-06' });
  const box = el.querySelector('[data-testid="cost-breakdown"]');
  expect(box.textContent).toContain('證交稅(0.3%)');
  expect(box.textContent).toContain('3,000'); // 1,000,000 × 0.3%
  expect(box.textContent).toContain('1,425'); // 手續費 0.1425%
  expect(box.textContent).toContain('995,575');
  expect(box.textContent).toContain('升降單位 5');
  await unmount();
});

test('賣出債券ETF:證交稅顯示停徵', async () => {
  const { el, unmount } = await render({ symbol: '00945B', type: 'sell', price: 15.3, shares: 1000, date: '2026-10-06' });
  const box = el.querySelector('[data-testid="cost-breakdown"]');
  expect(box.textContent).toContain('債券ETF停徵');
  await unmount();
});

test('± 按鈕:00945B 一次跳 0.01,股票 15 元一次跳 0.05', async () => {
  const etf = await render({ symbol: '00945B', type: 'buy', price: 15.3, shares: 1000 });
  await clickButton(etf.el, '價格加一檔');
  expect(etf.el.querySelector('[data-testid="cost-breakdown"]').textContent).toContain('15,310');
  await clickButton(etf.el, '價格減一檔');
  await clickButton(etf.el, '價格減一檔');
  expect(etf.el.querySelector('[data-testid="cost-breakdown"]').textContent).toContain('15,290');
  await etf.unmount();

  const stock = await render({ symbol: '2884', type: 'buy', price: 15.3, shares: 1000 });
  await clickButton(stock.el, '價格加一檔');
  expect(stock.el.querySelector('[data-testid="cost-breakdown"]').textContent).toContain('15,350');
  await stock.unmount();
});
