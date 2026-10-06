// portfolioQuotes:上一次數據的保存/墊檔、日收盤與即時報價的取捨
import {
  LAST_QUOTES_KEY,
  quoteFromDaily,
  quoteFromLive,
  pickNewer,
  loadLastQuotes,
  saveLastQuotes,
  seedQuote,
  applyQuote,
} from './portfolioQuotes';

const mem = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
};
const daily = (rows) => rows.map(([date, price]) => ({ date, price }));

test('日資料 → 現價(收盤視為 13:30)', () => {
  expect(quoteFromDaily(daily([['2026-10-05', 570], ['2026-10-06', 551]]))).toEqual({
    price: 551,
    prevClose: 570,
    asOf: '2026-10-06T13:30:00',
  });
  expect(quoteFromDaily([])).toBeNull();
});

test('即時報價 → 現價', () => {
  expect(quoteFromLive({ price: 553, prevClose: 570, date: '2026-10-06', time: '10:15:03' })).toEqual({
    price: 553,
    prevClose: 570,
    asOf: '2026-10-06T10:15:03',
  });
  expect(quoteFromLive({ price: 0, date: '2026-10-06' })).toBeNull();
});

test('取比較新的:盤中報價不會被晚到的昨收蓋掉;收盤後同時間用新來的', () => {
  const intraday = { price: 553, prevClose: 570, asOf: '2026-10-06T10:15:03' };
  const yesterday = { price: 570, prevClose: 519, asOf: '2026-10-05T13:30:00' };
  const closeDaily = { price: 551, prevClose: 570, asOf: '2026-10-06T13:30:00' };
  expect(pickNewer(intraday, yesterday)).toBe(intraday);
  expect(pickNewer(intraday, closeDaily)).toBe(closeDaily);
  expect(pickNewer(closeDaily, { ...closeDaily, price: 551.5 }).price).toBe(551.5);
  expect(pickNewer(null, yesterday)).toBe(yesterday);
  expect(pickNewer({ price: 1 }, yesterday)).toBe(yesterday); // 沒有 asOf 的舊資料視為最舊
});

test('上一次數據:存了下次開啟讀得回來;只存有現價的代號;壞掉的 JSON 當成沒有', () => {
  const st = mem();
  saveLastQuotes(st, {
    8358: { price: 551, prevClose: 570, asOf: '2026-10-06T13:30:00', loading: false },
    2330: { loading: true }, // 沒有現價 → 不存
  });
  expect(loadLastQuotes(st)).toEqual({ 8358: { price: 551, prevClose: 570, asOf: '2026-10-06T13:30:00' } });
  st.setItem(LAST_QUOTES_KEY, '{oops');
  expect(loadLastQuotes(st)).toEqual({});
});

test('開啟時墊檔:股價歷史快取被淘汰(沒有了)時,仍用上一次數據,不會空白', () => {
  const lastQuotes = { 8358: { price: 551, prevClose: 570, asOf: '2026-10-06T13:30:00' } };
  expect(seedQuote('8358', { lastQuotes, loadPriceCache: () => null })).toEqual(lastQuotes['8358']);
  // 兩者都有時取比較新的
  const cache = { data: daily([['2026-10-06', 551], ['2026-10-07', 560]]) };
  expect(seedQuote('8358', { lastQuotes, loadPriceCache: () => cache }).price).toBe(560);
  expect(seedQuote('9999', { lastQuotes, loadPriceCache: () => null })).toBeNull();
});

test('applyQuote:比畫面上舊的不覆蓋,但會清掉讀取中;新的覆蓋並清掉錯誤', () => {
  const p0 = { 8358: { price: 553, prevClose: 570, asOf: '2026-10-06T10:15:03', loading: true, error: true } };
  const p1 = applyQuote(p0, '8358', { price: 570, prevClose: 519, asOf: '2026-10-05T13:30:00' });
  expect(p1['8358']).toMatchObject({ price: 553, loading: false, error: false });
  const p2 = applyQuote(p1, '8358', { price: 551, prevClose: 570, asOf: '2026-10-06T13:30:00' });
  expect(p2['8358']).toMatchObject({ price: 551, prevClose: 570 });
  const p3 = applyQuote(p2, '2330', null);
  expect(p3['2330']).toEqual({ loading: false });
});
