// 登入後的同步流程:讀到雲端之前絕不上傳;下載中要有提示;讀取失敗顯示可重試的提示
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
jest.mock('./portfolioStore', () => {
  const actual = jest.requireActual('./portfolioStore');
  return { ...actual, fetchRemoteDataOnce: jest.fn(), subscribeRemoteData: jest.fn(), saveRemoteData: jest.fn() };
});

/* eslint-disable import/first */
import * as dataCache from './dataCache';
import * as store from './portfolioStore';
import { PortfolioTrackerInner } from './PortfolioTracker';
/* eslint-enable import/first */

global.IS_REACT_ACT_ENVIRONMENT = true;
window.scrollTo = () => {};

const cloud = {
  version: 1,
  groups: [{ id: 'g1', name: '長期', color: '#34d399' }],
  tags: [],
  activeGroupId: 'g1',
  transactions: [{ id: 't1', groupId: 'g1', symbol: '2330', type: 'buy', date: '2026-01-02', shares: 1000, price: 1000, amount: -1001425 }],
};

let resolveRemote;
beforeEach(() => {
  localStorage.clear(); // 模擬清空瀏覽器資料後重新登入
  dataCache.fetchStockPriceData.mockImplementation(() => new Promise(() => {}));
  dataCache.fetchStockDisplayName.mockImplementation(() => new Promise(() => {}));
  dataCache.loadPriceCache.mockImplementation(() => null);
  dataCache.fetchLiveQuotes.mockImplementation(() => new Promise(() => {}));
  store.fetchRemoteDataOnce.mockImplementation(() => new Promise((r) => { resolveRemote = r; }));
  store.subscribeRemoteData.mockImplementation(() => () => {});
  store.saveRemoteData.mockImplementation(() => {});
});

async function render() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(<PortfolioTrackerInner isLight uid="u1" userEmail="a@b.c" onSignOut={() => {}} />);
  });
  return { el, unmount: () => act(() => root.unmount()) };
}
const wait = (ms) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

test('清空後登入:雲端讀很久也不會先上傳空白資料;顯示下載中提示;讀到後顯示雲端資料', async () => {
  const { el, unmount } = await render();
  await wait(1200); // 超過原本 0.8 秒的上傳 debounce
  expect(store.saveRemoteData).not.toHaveBeenCalled();
  expect(el.querySelector('[data-testid="sync-banner"]').textContent).toContain('正在從雲端下載');
  expect(el.textContent).toContain('正在從雲端載入持股');
  await act(async () => { resolveRemote(cloud); });
  await wait(10);
  expect(el.querySelector('[data-testid="sync-banner"]')).toBeNull();
  expect(el.textContent).toContain('2330');
  // 雲端資料原封不動採用,不需要上傳
  expect(store.saveRemoteData).not.toHaveBeenCalled();
  await unmount();
});

test('讀不到雲端:顯示無法連線與重試,而且不上傳', async () => {
  store.fetchRemoteDataOnce.mockImplementation(() => Promise.reject(new Error('offline')));
  const { el, unmount } = await render();
  await wait(10);
  const banner = el.querySelector('[data-testid="sync-banner"]');
  expect(banner.textContent).toContain('無法連線雲端');
  expect(banner.textContent).toContain('重試');
  expect(store.saveRemoteData).not.toHaveBeenCalled();
  store.fetchRemoteDataOnce.mockImplementation(() => Promise.resolve(cloud));
  await act(async () => { banner.querySelector('button').click(); });
  await wait(10);
  expect(el.querySelector('[data-testid="sync-banner"]')).toBeNull();
  expect(el.textContent).toContain('2330');
  await unmount();
});

test('舊裝置本機有、雲端被清空:把本機交易補回雲端並提示', async () => {
  localStorage.setItem('portfolio_tracker_v1', JSON.stringify(cloud));
  store.fetchRemoteDataOnce.mockImplementation(() =>
    Promise.resolve({ version: 1, groups: [{ id: 'gx', name: '我的持股' }], tags: [], transactions: [], activeGroupId: 'gx' })
  );
  const { el, unmount } = await render();
  await wait(10);
  expect(store.saveRemoteData).toHaveBeenCalled();
  const uploaded = store.saveRemoteData.mock.calls[0][1];
  expect(uploaded.transactions.map((t) => t.id)).toEqual(['t1']);
  expect(el.textContent).toContain('1 筆雲端沒有的交易補上傳');
  await unmount();
});
