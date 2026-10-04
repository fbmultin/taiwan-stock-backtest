// 回檔雷達畫面的整合測試:用注入的假資料實際渲染,檢查
//   Yahoo 警示、資料不足、樣本太少三種畫面;用詞限制;持股只讀(不寫回、不訂閱);
//   同一檔在兩個群組 → 兩列,各自顯示群組名稱與起點。
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// firebase 與持股模組換成假的:測試不連網,也能檢查「沒有呼叫任何寫入或訂閱」
jest.mock('./firebase', () => ({ auth: {} }));
jest.mock('firebase/auth', () => ({ onAuthStateChanged: jest.fn() }));
jest.mock('./dataCache', () => ({ fetchStockPriceData: jest.fn() }));
jest.mock('./portfolioStore', () => ({
  loadPortfolioData: jest.fn(),
  fetchRemoteDataOnce: jest.fn(),
  savePortfolioData: jest.fn(),
  saveRemoteData: jest.fn(),
  subscribeRemoteData: jest.fn(),
}));

/* eslint-disable import/first */
import * as portfolioStore from './portfolioStore';
import PullbackRadar, { FOOTER_TEXT, LAYER2_TEXT, TOO_FEW_TEXT } from './PullbackRadar';
import { WARN_TEXT, SETTINGS_KEY } from './pullbackData';
/* eslint-enable import/first */

global.IS_REACT_ACT_ENVIRONMENT = true;

// 從 2015-01-05 起的交易日(只跳週末;測試不需要真的假日表)
function tradingDates(n) {
  const out = [];
  const d = new Date(Date.UTC(2015, 0, 5));
  while (out.length < n) {
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) out.push(d.toISOString().split('T')[0]);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
function series(prices, source = 'FinMind', extra = {}) {
  const dates = tradingDates(prices.length);
  return {
    data: prices.map((p, i) => ({ date: dates[i], timestamp: new Date(dates[i]).getTime(), price: p })),
    divDates: [],
    dividendsMap: {},
    source,
    ...extra,
  };
}
// 週期 150 天、振幅 ±8% 的波動(峰到谷約 −14.8%),讓 −5%/−7%/−10% 檔位都有很多事件,−15%/−20% 一次都沒有
const wave = (n) => Array.from({ length: n }, (_, i) => 100 * (1 + 0.08 * Math.sin((2 * Math.PI * i) / 150)) * (1 + i / 5000));

const memStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), keys: () => [...m.keys()] };
};

async function render(deps) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(<PullbackRadar isLight deps={deps} />);
  });
  for (let i = 0; i < 5; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
  return { el, unmount: () => act(() => root.unmount()) };
}

function makeDeps({ priceBySymbol, portfolio = { groups: [], transactions: [] }, user = null }) {
  portfolioStore.loadPortfolioData.mockReturnValue(portfolio);
  portfolioStore.fetchRemoteDataOnce.mockResolvedValue(portfolio);
  return {
    fetchStockPriceData: jest.fn(async (s) => priceBySymbol[s] || null),
    fetchFinMind: jest.fn(async () => null),
    storage: memStorage(),
    lastCompletedTradingDay: '2026-10-02',
    onAuth: (cb) => {
      cb(user);
      return () => {};
    },
    loadPortfolioData: portfolioStore.loadPortfolioData,
    fetchRemoteDataOnce: portfolioStore.fetchRemoteDataOnce,
  };
}

const FORBIDDEN = ['有效', '已驗證', '加碼區', '建議買進', '停利區', '獨立事件群'];

beforeEach(() => jest.clearAllMocks());

test('Yahoo 來源:顯示來源與警示;說明列文字正確;沒有暗示結論的用詞', async () => {
  const deps = makeDeps({ priceBySymbol: { '0050': series(wave(1500), 'Yahoo') } });
  const { el, unmount } = await render(deps);
  const text = el.textContent;
  expect(text).toContain('最近一次更新來源：Yahoo');
  expect(text).toContain(WARN_TEXT.yahoo);
  expect(text).toMatch(/資料截至 \d{4}-\d{2}-\d{2}/);
  expect(text).toContain('含息回檔');
  expect(text).toContain(FOOTER_TEXT);
  expect(text).toContain(LAYER2_TEXT);
  // 第二層說明那一句是唯一允許出現「有效」的地方
  const rest = text.replace(LAYER2_TEXT, '');
  FORBIDDEN.forEach((w) => expect(rest).not.toContain(w));
  unmount();
});

test('資料不足:總日數 < 窗口 + 63', async () => {
  const deps = makeDeps({ priceBySymbol: { '0050': series(wave(300)) } });
  const { el, unmount } = await render(deps);
  const box = el.querySelector('[data-testid="insufficient"]');
  expect(box).not.toBeNull();
  expect(box.textContent).toContain('資料不足');
  expect(box.textContent).toContain('至少需要 315 個交易日');
  unmount();
});

test('樣本太少與正常格並存:深檔位顯示「樣本太少」、淺檔位顯示中位數與勝率', async () => {
  const deps = makeDeps({ priceBySymbol: { '0050': series(wave(1500)) } });
  const { el, unmount } = await render(deps);
  const deep = el.querySelector('[data-testid="cell-20-63"]').textContent;
  expect(deep).toContain(TOO_FEW_TEXT);
  expect(deep).not.toContain('中位數');
  const shallow = el.querySelector('[data-testid="cell-5-63"]').textContent;
  expect(shallow).toMatch(/事件 \d+／群 \d+/);
  expect(shallow).toContain('中位數');
  expect(shallow).toContain('個百分點');
  unmount();
});

test('持股:已登入讀雲端一次;同一檔在兩群組 → 兩列;沒有寫回、沒有訂閱、沒有寫入持股 localStorage', async () => {
  const portfolio = {
    groups: [
      { id: 'g1', name: '長期存股', color: '#34d399' },
      { id: 'g2', name: '波段操作', color: '#60a5fa' },
    ],
    transactions: [
      { id: 't1', groupId: 'g1', symbol: '0050', type: 'buy', date: '2016-03-01', shares: 1000, price: 60 },
      { id: 't2', groupId: 'g2', symbol: '0050', type: 'buy', date: '2018-01-02', shares: 500, price: 80 },
      { id: 't3', groupId: 'g2', symbol: '0050', type: 'sell', date: '2018-06-01', shares: 500, price: 80 },
      { id: 't4', groupId: 'g2', symbol: '0050', type: 'buy', date: '2019-02-01', shares: 300, price: 80 },
    ],
  };
  const deps = makeDeps({ priceBySymbol: { '0050': series(wave(1500)) }, portfolio, user: { uid: 'u1' } });
  const { el, unmount } = await render(deps);
  expect(portfolioStore.fetchRemoteDataOnce).toHaveBeenCalledTimes(1);
  expect(portfolioStore.saveRemoteData).not.toHaveBeenCalled();
  expect(portfolioStore.savePortfolioData).not.toHaveBeenCalled();
  expect(portfolioStore.subscribeRemoteData).not.toHaveBeenCalled();
  const r1 = el.querySelector('[data-testid="holding-g1|0050"]');
  const r2 = el.querySelector('[data-testid="holding-g2|0050"]');
  expect(r1.textContent).toContain('長期存股');
  expect(r1.textContent).toContain('起點 2016-03-01');
  expect(r2.textContent).toContain('波段操作');
  expect(r2.textContent).toContain('起點 2019-02-01'); // 賣光後重新買進,起點重算
  [r1, r2].forEach((r) => {
    expect(r.textContent).toContain('含息回檔');
    expect(r.textContent).toMatch(/距停利點|已低於停利設定/);
    expect(r.textContent).toMatch(/資料截至 \d{4}-\d{2}-\d{2}/);
  });
  expect(el.textContent).toContain('持股來源：雲端（唯讀）');
  // 本機只會出現 pullback_ 開頭的 key(這次沒改設定,所以甚至一個都沒有)
  expect(deps.storage.keys().every((k) => k.startsWith('pullback_'))).toBe(true);
  unmount();
});

test('切換窗口會存到 pullback_settings', async () => {
  const deps = makeDeps({ priceBySymbol: { '0050': series(wave(1500)) } });
  const { el, unmount } = await render(deps);
  const btn = [...el.querySelectorAll('button')].find((b) => b.textContent === '60 日');
  await act(async () => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  expect(JSON.parse(deps.storage.getItem(SETTINGS_KEY)).window).toBe(60);
  expect(el.querySelector('[data-testid="state-card"]').textContent).toContain('60 日窗口');
  unmount();
});
