// ETF 以代號為主、個股以股名為主;個股交易紀錄依日期分段
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
}));

/* eslint-disable import/first */
import * as dataCache from './dataCache';
import { PortfolioTrackerInner, symbolLabel, formatDayHeader } from './PortfolioTracker';
/* eslint-enable import/first */

global.IS_REACT_ACT_ENVIRONMENT = true;
window.scrollTo = () => {};

test('symbolLabel:ETF 代號為主,個股股名為主,查不到名稱只顯示代號', () => {
  expect(symbolLabel('00878', '國泰永續高股息')).toEqual({ primary: '00878', secondary: '國泰永續高股息', codeFirst: true });
  expect(symbolLabel('3026', '禾伸堂')).toEqual({ primary: '禾伸堂', secondary: '3026', codeFirst: false });
  expect(symbolLabel('9999', '9999')).toEqual({ primary: '9999', secondary: '', codeFirst: true });
});

test('formatDayHeader', () => {
  expect(formatDayHeader('2026-10-06')).toBe('10/06(二)');
});

test('持股列表 ETF 代號放大在前;個股頁交易紀錄依日期分段', async () => {
  localStorage.clear();
  const tx = (id, symbol, date, type = 'buy') => ({ id, groupId: 'g1', symbol, type, date, shares: 1000, price: 50, amount: -50071, createdAt: 1 });
  localStorage.setItem(
    'portfolio_tracker_v1',
    JSON.stringify({
      version: 1,
      groups: [{ id: 'g1', name: '長期', color: '#34d399' }],
      tags: [],
      activeGroupId: 'g1',
      transactions: [
        tx('a', '00878', '2026-10-06'),
        tx('b', '00878', '2026-10-06'),
        tx('c', '00878', '2026-10-01'),
        tx('d', '3026', '2026-10-06'),
      ],
    })
  );
  dataCache.fetchStockPriceData.mockImplementation(() => new Promise(() => {}));
  dataCache.fetchStockDisplayName.mockImplementation(() => new Promise(() => {}));
  dataCache.loadPriceCache.mockImplementation(() => null);
  dataCache.fetchLiveQuotes.mockImplementation(() => new Promise(() => {}));
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(<PortfolioTrackerInner isLight uid={null} userEmail={null} onSignOut={() => {}} />);
  });
  const etfCode = Array.from(el.querySelectorAll('.font-mono.text-lg')).find((n) => n.textContent === '00878');
  expect(etfCode).toBeTruthy();
  // 點進 00878 個股頁
  await act(async () => {
    etfCode.closest('[class*="cursor-pointer"]').click();
  });
  const groups = el.querySelectorAll('[data-testid="tx-day-group"]');
  expect(groups).toHaveLength(2);
  expect(groups[0].textContent).toContain('10/06(二)');
  expect(groups[0].textContent).toContain('2筆');
  expect(groups[1].textContent).toContain('10/01(四)');
  await act(() => root.unmount());
});
