// 「我的持股」現價:開啟時先顯示上一次數據;更新鈕不分盤中盤後都更新所有持股
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

jest.mock('./firebase', () => ({ auth: {}, db: {}, googleProvider: {} }));
jest.mock('firebase/auth', () => ({
  onAuthStateChanged: jest.fn(),
  getRedirectResult: jest.fn(() => Promise.resolve()),
  signInWithPopup: jest.fn(),
  signInWithRedirect: jest.fn(),
  signInWithCredential: jest.fn(),
  signOut: jest.fn(),
  GoogleAuthProvider: { credential: jest.fn() },
}));
jest.mock('firebase/firestore', () => ({ doc: jest.fn(), getDoc: jest.fn(), setDoc: jest.fn(), onSnapshot: jest.fn() }));
jest.mock('./dataCache', () => ({
  fetchStockPriceData: jest.fn(),
  fetchStockDisplayName: jest.fn(() => Promise.resolve('')),
  loadPriceCache: jest.fn(() => null),
  fetchLiveQuotes: jest.fn(() => Promise.resolve({})),
}));

/* eslint-disable import/first */
import * as dataCache from './dataCache';
import { PortfolioTrackerInner } from './PortfolioTracker';
import { LAST_QUOTES_KEY } from './portfolioQuotes';
/* eslint-enable import/first */

global.IS_REACT_ACT_ENVIRONMENT = true;
window.scrollTo = () => {};

const portfolio = {
  version: 1,
  groups: [{ id: 'g1', name: '長期', color: '#34d399' }],
  tags: [],
  activeGroupId: 'g1',
  transactions: [
    { id: 't1', groupId: 'g1', symbol: '8358', type: 'buy', date: '2026-01-02', shares: 1000, price: 300 },
    { id: 't2', groupId: 'g1', symbol: '2330', type: 'buy', date: '2026-01-02', shares: 100, price: 1000 },
  ],
};

async function render() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(<PortfolioTrackerInner isLight uid={null} userEmail={null} onSignOut={() => {}} />);
  });
  return { el, unmount: () => act(() => root.unmount()) };
}
const flush = async () => {
  for (let i = 0; i < 5; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('portfolio_tracker_v1', JSON.stringify(portfolio));
  // CRA 的 jest 預設 resetMocks:true,每個測試前會清掉 mock 的實作,所以在這裡重設
  dataCache.fetchStockDisplayName.mockImplementation(() => Promise.resolve(''));
  dataCache.loadPriceCache.mockImplementation(() => null);
  dataCache.fetchLiveQuotes.mockImplementation(() => Promise.resolve({}));
  dataCache.fetchStockPriceData.mockImplementation(() => new Promise(() => {}));
});

test('開啟時:股價快取被淘汰了也先顯示上一次數據,不會空白等網路', async () => {
  localStorage.setItem(
    LAST_QUOTES_KEY,
    JSON.stringify({
      8358: { price: 551, prevClose: 570, asOf: '2026-10-06T13:30:00' },
      2330: { price: 2585, prevClose: 2575, asOf: '2026-10-06T13:30:00' },
    })
  );
  dataCache.fetchStockPriceData.mockImplementation(() => new Promise(() => {})); // 網路永遠不回來
  const { el, unmount } = await render();
  expect(el.textContent).toContain('551.00');
  expect(el.textContent).toContain('2585.00');
  unmount();
});

test('開啟時:晚到的昨收不會蓋掉比較新的上一次數據(例如今天盤中的價格)', async () => {
  localStorage.setItem(LAST_QUOTES_KEY, JSON.stringify({ 8358: { price: 553, prevClose: 570, asOf: '2026-10-06T10:15:00' } }));
  dataCache.fetchStockPriceData.mockImplementation((sym) =>
    Promise.resolve({ data: sym === '8358' ? [{ date: '2026-10-02', price: 519 }, { date: '2026-10-05', price: 570 }] : [{ date: '2026-10-05', price: 2575 }] })
  );
  const { el, unmount } = await render();
  await flush();
  expect(el.textContent).toContain('553.00');
  expect(el.textContent).not.toContain('570.00');
  unmount();
});

test('更新鈕:不分盤中盤後,所有持股都拿即時報價更新(上櫃的金居也一樣),並存成下次開啟的上一次數據', async () => {
  // 日資料只有到昨天(盤中按更新時的真實情況)
  dataCache.fetchStockPriceData.mockImplementation((sym) =>
    Promise.resolve({ data: sym === '8358' ? [{ date: '2026-10-02', price: 519 }, { date: '2026-10-05', price: 570 }] : [{ date: '2026-10-02', price: 2570 }, { date: '2026-10-05', price: 2575 }] })
  );
  const { el, unmount } = await render();
  await flush();
  expect(el.textContent).toContain('570.00');
  dataCache.fetchLiveQuotes.mockImplementation(() =>
    Promise.resolve({
      8358: { price: 553, prevClose: 570, date: '2026-10-06', time: '10:15:03' },
      2330: { price: 2590, prevClose: 2575, date: '2026-10-06', time: '10:15:03' },
    })
  );
  const btn = el.querySelector('button[title="重新抓取最新股價/市值"]');
  await act(async () => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
  expect(dataCache.fetchLiveQuotes).toHaveBeenLastCalledWith(expect.arrayContaining(['8358', '2330']));
  expect(dataCache.fetchStockPriceData).toHaveBeenCalledWith('8358', { force: true });
  expect(el.textContent).toContain('553.00');
  expect(el.textContent).toContain('2590.00');
  const saved = JSON.parse(localStorage.getItem(LAST_QUOTES_KEY));
  expect(saved['8358']).toEqual({ price: 553, prevClose: 570, asOf: '2026-10-06T10:15:03' });
  unmount();
});
