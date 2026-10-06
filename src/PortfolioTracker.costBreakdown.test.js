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
import { TransactionFormModal, TodayTransactionsView } from './PortfolioTracker';
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

const line = (el) => el.querySelector('[data-testid="cost-breakdown"]').textContent;

test('買進 00945B:跟「1張 = 1000股」同一行列出價金、手續費、稅、應付;手續費元以下捨去', async () => {
  const { el, unmount } = await render({ symbol: '00945B', type: 'buy', price: 15.3, shares: 1000 });
  // 15,300 × 0.1425% = 21.8 → 交割單是 21(捨去),不是四捨五入的 22
  expect(line(el)).toContain('1張 = 1000股');
  expect(line(el)).toContain('價金 15,300・手續費 21・稅 0・應付 15,321');
  await unmount();
});

test('賣出股票:稅 0.3%,應收 = 價金 − 手續費 − 稅', async () => {
  const { el, unmount } = await render({ symbol: '2330', type: 'sell', price: 1000, shares: 1000, date: '2026-10-06' });
  expect(line(el)).toContain('價金 1,000,000・手續費 1,425・稅 3,000・應收 995,575');
  await unmount();
});

test('賣出零股:價金、手續費、稅都元以下捨去', async () => {
  // 價金 56.7 × 37 = 2097.9 → 2,097;稅 2097 × 0.3% = 6.29 → 6;手續費低於低消時用低消(預設 0 → 2097×0.1425%=2.98 → 2)
  const { el, unmount } = await render({ symbol: '2884', type: 'sell', price: 56.7, shares: 37, date: '2026-10-06' });
  expect(line(el)).toContain('價金 2,097・手續費 2・稅 6・應收 2,089');
  await unmount();
});

test('賣出債券ETF:停徵期間稅 0', async () => {
  const { el, unmount } = await render({ symbol: '00945B', type: 'sell', price: 15.3, shares: 1000, date: '2026-10-06' });
  expect(line(el)).toContain('稅 0・應收 15,279');
  await unmount();
});

test('今日交易:先一行列出 進/出/總計,再列各筆;點明細直接開操作選單', async () => {
  const onOpenAction = jest.fn();
  const items = [
    { id: 'a', symbol: '00945B', type: 'buy', price: 15.3, shares: 1000, amount: -15321 },
    { id: 'b', symbol: '2330', type: 'sell', price: 1000, shares: 1000, amount: 995575 },
    { id: 'c', symbol: '0056', type: 'cashDividend', price: 0, shares: 0, amount: 500 },
  ];
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(
      <TodayTransactionsView isLight items={items} stockNames={{}} todayStr="2026-10-06" onBack={() => {}} onOpenAction={onOpenAction} />
    );
  });
  const sum = el.querySelector('[data-testid="today-summary"]');
  expect(sum.textContent).toContain('進 15,321');
  expect(sum.textContent).toContain('出 995,575');
  expect(sum.textContent).toContain('總計 +980,254');
  // 摘要在各筆交易之前
  expect(el.innerHTML.indexOf('today-summary')).toBeLessThan(el.innerHTML.indexOf('00945B'));
  // 點一筆交易直接開操作選單(編輯/複製/移動/刪除),不再先跳到個股頁
  const row = Array.from(el.querySelectorAll('div.cursor-pointer')).find((d) => d.textContent.includes('2330'));
  await act(async () => { row.click(); });
  expect(onOpenAction).toHaveBeenCalledWith(items[1]);
  await act(() => root.unmount());
});

test('± 按鈕:00945B 一次跳 0.01,股票 15 元一次跳 0.05', async () => {
  const etf = await render({ symbol: '00945B', type: 'buy', price: 15.3, shares: 1000 });
  await clickButton(etf.el, '價格加一檔');
  expect(line(etf.el)).toContain('價金 15,310');
  await clickButton(etf.el, '價格減一檔');
  await clickButton(etf.el, '價格減一檔');
  expect(line(etf.el)).toContain('價金 15,290');
  await etf.unmount();

  const stock = await render({ symbol: '2884', type: 'buy', price: 15.3, shares: 1000 });
  await clickButton(stock.el, '價格加一檔');
  expect(line(stock.el)).toContain('價金 15,350');
  await stock.unmount();
});

test('複製交易:帶入原交易欄位,改股數就能照交割單拆成多筆(00878 10,000 股 + 4,000 股)', async () => {
  const onSubmit = jest.fn();
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  const original = { symbol: '00878', type: 'sell', price: 35.11, shares: 14000, date: '2026-10-06', groupId: 'g1', copiedFrom: 'orig' };
  await act(async () => {
    root.render(<TransactionFormModal isLight data={data} initial={original} onClose={() => {}} onSubmit={onSubmit} onDelete={() => {}} />);
  });
  expect(el.textContent).toContain('複製交易');
  const sharesInput = Array.from(el.querySelectorAll('input')).find((i) => i.value === '14000');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    setter.call(sharesInput, '4000');
    sharesInput.dispatchEvent(new Event('input', { bubbles: true }));
  });
  // 跟交割單第二筆一模一樣:價金 140,440、手續費 200、稅 140、應收 140,100
  expect(line(el)).toContain('價金 140,440・手續費 200・稅 140・應收 140,100');
  const save = Array.from(el.querySelectorAll('button')).find((b) => /儲存|新增|確認/.test(b.textContent) && !b.disabled && b.textContent.length < 10);
  await act(async () => { save.click(); });
  const payload = onSubmit.mock.calls[0][0];
  expect(payload).toMatchObject({ symbol: '00878', type: 'sell', shares: 4000, price: 35.11, date: '2026-10-06', fee: 200, tax: 140, amount: 140100 });
  expect(payload.id).toBeUndefined();
  await act(() => root.unmount());
});
