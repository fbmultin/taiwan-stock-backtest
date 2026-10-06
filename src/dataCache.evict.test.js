// localStorage 空間不足時的快取淘汰:依 cachedAt 由舊到新刪,而且不整份 JSON.parse 舊快取
// (一筆約 50 萬字元,原本每淘汰一筆就把全部快取解析一次,手機上會卡住畫面)
jest.mock('./firebase', () => ({ auth: {}, db: {}, googleProvider: {} }));
jest.mock('firebase/auth', () => ({ onAuthStateChanged: jest.fn() }));
jest.mock('firebase/firestore', () => ({ doc: jest.fn(), getDoc: jest.fn(), setDoc: jest.fn() }));
/* eslint-disable import/first */
import { savePriceCache, PRICE_CACHE_PREFIX } from './dataCache';
/* eslint-enable import/first */

const result = (n) => ({
  data: Array.from({ length: n }, (_, k) => ({ date: '2006-01-01', timestamp: k, price: 50.12 + k / 100, high: 51, low: 49 })),
  divDates: [],
  dividendsMap: {},
  usedSymbol: 'x',
});

test('空間不足時從最舊的快取開始淘汰,存檔成功,過程不解析舊快取', () => {
  localStorage.clear();
  const r = result(4800); // 約 50 萬字元,跟 20 年日資料差不多
  // 每檔隔一分鐘存,讓 cachedAt 有明確的先後;存 20 檔確保空間已滿(過程中已淘汰掉最早的幾檔)
  jest.useFakeTimers();
  for (let i = 0; i < 20; i++) {
    jest.setSystemTime(new Date(Date.UTC(2026, 9, 6, 0, i, 0)));
    savePriceCache('OLD' + i, r);
  }
  jest.setSystemTime(new Date(Date.UTC(2026, 9, 6, 1, 0, 0)));
  const before = Object.keys(localStorage).filter((k) => k.startsWith(PRICE_CACHE_PREFIX));
  expect(before.length).toBeGreaterThan(3);
  const parseSpy = jest.spyOn(JSON, 'parse');
  savePriceCache('NEW', r);
  savePriceCache('NEW2', r);
  expect(parseSpy).not.toHaveBeenCalled();
  parseSpy.mockRestore();
  jest.useRealTimers();
  expect(localStorage.getItem(`${PRICE_CACHE_PREFIX}NEW`)).not.toBeNull();
  expect(localStorage.getItem(`${PRICE_CACHE_PREFIX}NEW2`)).not.toBeNull();
  // 被淘汰的是最早存的那幾檔
  const remainingOld = before.filter((k) => localStorage.getItem(k) !== null);
  const evicted = before.filter((k) => localStorage.getItem(k) === null);
  expect(evicted.length).toBeGreaterThan(0);
  const idx = (k) => Number(k.replace(`${PRICE_CACHE_PREFIX}OLD`, ''));
  expect(Math.max(...evicted.map(idx))).toBeLessThan(Math.min(...remainingOld.map(idx)));
});
