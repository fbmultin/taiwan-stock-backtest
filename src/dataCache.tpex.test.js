// dataCache:上櫃股票在 FinMind 失敗時改用櫃買中心(/api/twPrice);即時報價的解析
jest.mock('./firebase', () => ({ auth: {}, db: {} }));
jest.mock('firebase/auth', () => ({ onAuthStateChanged: jest.fn() }));
jest.mock('firebase/firestore', () => ({ doc: jest.fn(), getDoc: jest.fn(), setDoc: jest.fn() }));

/* eslint-disable import/first */
import { fetchStockPriceData, fetchLiveQuotes } from './dataCache';
/* eslint-enable import/first */

const json = (body, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) });

beforeEach(() => {
  localStorage.clear();
  global.fetch = jest.fn();
  // 固定「今天」為 2026-10-06(台灣時間下午),讓抓取的月份範圍固定
  jest.useFakeTimers('modern');
  jest.setSystemTime(new Date('2026-10-06T09:00:00Z'));
});
afterEach(() => jest.useRealTimers());

test('上櫃股票:FinMind 額度用完、證交所查不到 → 改用櫃買中心,不再落到打不通的 Yahoo 代理', async () => {
  // 有舊快取(到 9/30),走輕量增量抓取:只需要最近一兩個月
  const old = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10);
    return { date: d, timestamp: new Date(d).getTime(), price: 480 + i, high: 490, low: 470 };
  });
  localStorage.setItem('stock_price_8358', JSON.stringify({ schemaVersion: 2, data: old, divDates: [], dividendsMap: {} }));
  global.fetch.mockImplementation((url) => {
    if (url.includes('finmindtrade')) return json({ msg: 'Requests reach the upper limit.', status: 402 });
    if (url.includes('twse.com.tw')) return json({ stat: '很抱歉，沒有符合條件的資料!' });
    if (url.startsWith('/api/twPrice?type=tpexMonth')) {
      const rows = url.includes('month=2026-10')
        ? [
            { date: '2026-10-05', open: 534, high: 570, low: 526, close: 570 },
            { date: '2026-10-06', open: 577, high: 578, low: 548, close: 551 },
          ]
        : [];
      return json({ rows });
    }
    return Promise.reject(new Error('unexpected ' + url));
  });
  const r = await fetchStockPriceData('8358', { force: true });
  expect(r.source).toBe('TPEx');
  expect(r.data[r.data.length - 1]).toMatchObject({ date: '2026-10-06', price: 551, high: 578, low: 548 });
  expect(global.fetch.mock.calls.some(([u]) => String(u).includes('yahoo') || String(u).includes('allorigins'))).toBe(false);
  // 寫回快取,下次開啟就有
  expect(JSON.parse(localStorage.getItem('stock_price_8358')).data.slice(-1)[0].price).toBe(551);
});

test('即時報價:一次查完所有代號;失敗回傳空物件', async () => {
  global.fetch.mockImplementation((url) => {
    expect(url).toBe('/api/twPrice?type=quote&symbols=8358%2C2330');
    return json({
      quotes: {
        8358: { price: 551, prevClose: 570, date: '2026-10-06', time: '13:30:00' },
        2330: { price: 2585, prevClose: 2575, date: '2026-10-06', time: '13:30:00' },
      },
    });
  });
  const q = await fetchLiveQuotes(['8358', '2330', '8358', 'bad code']);
  expect(q['8358']).toEqual({ price: 551, prevClose: 570, date: '2026-10-06', time: '13:30:00' });
  expect(Object.keys(q).sort()).toEqual(['2330', '8358']);
  global.fetch.mockImplementation(() => Promise.reject(new Error('offline')));
  expect(await fetchLiveQuotes(['8358'])).toEqual({});
});
