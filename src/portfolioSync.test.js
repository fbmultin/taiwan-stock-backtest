// 跨裝置同步合併規則(2026-10 事故:手機清空後登入,空白資料搶先上傳蓋掉雲端)
import { mergeForSync, saveSyncMeta, loadSyncMeta, SYNC_META_KEY } from './portfolioSync';

const g = (id) => ({ id, name: id });
const tx = (id, groupId = 'g1', extra = {}) => ({ id, groupId, symbol: '0050', type: 'buy', date: '2026-01-02', shares: 1000, price: 100, ...extra });
const data = (transactions, groups = [g('g1')], extra = {}) => ({ version: 1, groups, tags: [], transactions, activeGroupId: groups[0].id, ...extra });

test('雲端沒有資料:本機有交易才上傳;空白的新裝置不上傳', () => {
  expect(mergeForSync({ local: data([tx('a')]), remote: null, meta: null, uid: 'u' }).needsUpload).toBe(true);
  expect(mergeForSync({ local: data([]), remote: null, meta: null, uid: 'u' }).needsUpload).toBe(false);
});

test('清空手機後登入:本機空白,雲端資料原封不動採用,不上傳、不多塞一個空白預設群組', () => {
  const remote = data([tx('a'), tx('b')]);
  const local = data([], [g('fresh-default')]);
  const r = mergeForSync({ local, remote, meta: null, uid: 'u' });
  expect(r.data.transactions.map((t) => t.id)).toEqual(['a', 'b']);
  expect(r.data.groups.map((x) => x.id)).toEqual(['g1']);
  expect(r.data.activeGroupId).toBe('g1');
  expect(r.needsUpload).toBe(false);
});

test('救回被蓋掉的雲端:舊版裝置(沒有同步紀錄)本機的交易全部補回雲端', () => {
  const wiped = data([], [g('phone-default')]);
  const computer = data([tx('a'), tx('b', 'g2')], [g('g1'), g('g2')]);
  const r = mergeForSync({ local: computer, remote: wiped, meta: null, uid: 'u' });
  expect(r.data.transactions.map((t) => t.id).sort()).toEqual(['a', 'b']);
  expect(r.data.groups.map((x) => x.id).sort()).toEqual(['g1', 'g2', 'phone-default']);
  expect(r.needsUpload).toBe(true);
  expect(r.addedTxCount).toBe(2);
});

test('別台裝置刪掉的交易跟著刪;這台離線新增的補上傳', () => {
  const remote = data([tx('a')]);
  const local = data([tx('a'), tx('deletedElsewhere'), tx('newOffline')]);
  const meta = { uid: 'u', txIds: ['a', 'deletedElsewhere'] };
  const r = mergeForSync({ local, remote, meta, uid: 'u' });
  expect(r.data.transactions.map((t) => t.id)).toEqual(['a', 'newOffline']);
  expect(r.needsUpload).toBe(true);
});

test('同一台裝置換帳號登入:不把前一個帳號的資料併進來', () => {
  const r = mergeForSync({ local: data([tx('x')]), remote: data([tx('a')]), meta: { uid: 'other', txIds: ['x'] }, uid: 'u' });
  expect(r.data.transactions.map((t) => t.id)).toEqual(['a']);
  expect(r.needsUpload).toBe(false);
});

test('同步紀錄存取', () => {
  localStorage.clear();
  saveSyncMeta(localStorage, 'u', data([tx('a')]));
  expect(loadSyncMeta(localStorage)).toMatchObject({ uid: 'u', txIds: ['a'], groupIds: ['g1'] });
  localStorage.setItem(SYNC_META_KEY, '{bad');
  expect(loadSyncMeta(localStorage)).toBeNull();
});

describe('備份與還原', () => {
  const { makeBackupFile, parseBackupFile, summarizeBackup, maybeSaveAutoBackup, loadAutoBackup } = require('./portfolioSync');
  test('備份檔來回轉換;也接受直接是持股資料的 JSON', () => {
    const d = data([tx('a'), tx('b', 'g1', { date: '2026-10-06', symbol: '3026' })]);
    expect(parseBackupFile(makeBackupFile(d))).toEqual(d);
    expect(parseBackupFile(JSON.stringify(d))).toEqual(d);
    expect(summarizeBackup(d)).toEqual({ txCount: 2, groupCount: 1, symbolCount: 2, lastDate: '2026-10-06' });
    expect(() => parseBackupFile('{oops')).toThrow('不是有效的 JSON');
    expect(() => parseBackupFile('{"a":1}')).toThrow('找不到持股資料');
  });
  test('自動備份:每天一份,空白資料不會蓋掉前一份好的備份', () => {
    localStorage.clear();
    expect(maybeSaveAutoBackup(localStorage, data([tx('a')]), '2026-10-05')).toBe(true);
    expect(maybeSaveAutoBackup(localStorage, data([tx('a'), tx('b')]), '2026-10-05')).toBe(false);
    expect(maybeSaveAutoBackup(localStorage, data([]), '2026-10-06')).toBe(false);
    expect(loadAutoBackup(localStorage).data.transactions.map((t) => t.id)).toEqual(['a']);
  });
});
