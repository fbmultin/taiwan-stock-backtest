import { squarify } from './treemap';

test('面積正比於 value、完整填滿、互不重疊', () => {
  const items = [{ key: 'a', value: 50 }, { key: 'b', value: 30 }, { key: 'c', value: 15 }, { key: 'd', value: 5 }, { key: 'z', value: 0 }];
  const out = squarify(items, 0, 0, 300, 200);
  expect(out.map((t) => t.key).sort()).toEqual(['a', 'b', 'c', 'd']); // 0 的被忽略
  const total = out.reduce((s, t) => s + t.w * t.h, 0);
  expect(total).toBeCloseTo(300 * 200, 3);
  out.forEach((t) => expect((t.w * t.h) / (300 * 200)).toBeCloseTo(t.value / 100, 5));
  out.forEach((t) => {
    expect(t.x).toBeGreaterThanOrEqual(-1e-6);
    expect(t.x + t.w).toBeLessThanOrEqual(300 + 1e-6);
    expect(t.y + t.h).toBeLessThanOrEqual(200 + 1e-6);
  });
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      const a = out[i], b = out[j];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      expect(ox > 1e-6 && oy > 1e-6).toBe(false);
    }
  }
});

test('空資料與無效尺寸回傳空陣列', () => {
  expect(squarify([], 0, 0, 100, 100)).toEqual([]);
  expect(squarify([{ key: 'a', value: 1 }], 0, 0, 0, 100)).toEqual([]);
});
