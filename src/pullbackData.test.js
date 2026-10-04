// pullbackData.js 的單元測試:接縫、分割校正、含息還原價、資料來源警示、持股唯讀、設定。
// 真實資料檢查用 0050 的兩段片段(src/__fixtures__/0050_real.json,取自 research/step0 分支的
// FinMind 快照),確認「舊段 + 近期」接縫與分割校正在真實資料上和研究用快照一致。
import {
  WARN_TEXT,
  SETTINGS_KEY,
  HIST_CACHE_PREFIX,
  staleText,
  dividendsByDate,
  applySplitsPure,
  totalReturnIndex,
  toSeries,
  mergeOldSegment,
  looksTruncated,
  loadFullHistory,
  loadPortfolioReadOnly,
  holdingRows,
  loadSettings,
  saveSettings,
  stopPctFor,
  fetchFinMindRange,
} from './pullbackData';
import real0050 from './__fixtures__/0050_real.json';

const ts = (d) => new Date(d).getTime();
// 產生 dataCache 格式:rows = [[日期, 價格, 除息]]
const mk = (rows, extra = {}) => {
  const dividendsMap = {};
  const divDates = [];
  rows.forEach(([d, , div]) => {
    if (div > 0) {
      dividendsMap[ts(d)] = { amount: div };
      divDates.push(ts(d));
    }
  });
  return { data: rows.map(([d, p]) => ({ date: d, timestamp: ts(d), price: p })), divDates, dividendsMap, ...extra };
};
const memStorage = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    keys: () => [...m.keys()],
  };
};
const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

// 研究快照(research/step0_rerun/data)的 total_ret 在「分割前的除息日」把原始單位的除息金額
// 直接加到分割校正後的價格上(沒有同步除以 4),那幾天的報酬被高估。app 的算法是對的:
// 分割前的除息和價格一起縮放。所以這裡的對照分兩種:
//   一般日子 → 和快照的 total_ret 一致;
//   分割前的除息日 → 和「原始價格 (P_t + 除息) ÷ P_{t−1} − 1」一致(分割比例在分子分母約掉),
//   並且確認快照在這些天確實不同(避免測試悄悄跟著快照的錯誤走)。
const SPLIT_0050 = '2025-06-18';
function expectReturnsMatch(s, rows) {
  let flagged = 0;
  for (let k = 1; k < rows.length; k++) {
    const [d, raw, div, snap] = rows[k];
    const app = s.adj[k] / s.adj[k - 1] - 1;
    if (div > 0 && d < SPLIT_0050) {
      expect(close(app, (raw + div) / rows[k - 1][1] - 1, 1e-10)).toBe(true);
      expect(close(app, snap, 1e-3)).toBe(false);
      flagged++;
    } else {
      expect(close(app, snap, 1e-8)).toBe(true);
    }
  }
  return flagged;
}

describe('除息對照', () => {
  test('毫秒 key 與秒 key 都讀得到,同日金額相加', () => {
    const t = ts('2024-07-18');
    const r = { divDates: [t], dividendsMap: { [Math.floor(t / 1000)]: { amount: 1.5 } } };
    expect(dividendsByDate(r).get('2024-07-18')).toBe(1.5);
    const r2 = { divDates: [t, t], dividendsMap: { [t]: { amount: 1 } } };
    expect(dividendsByDate(r2).get('2024-07-18')).toBe(2);
  });
});

describe('含息還原價', () => {
  test('除息日不會被當成下跌', () => {
    // 100 → 除息 5 元、收 95 → 還原價應持平
    const adj = totalReturnIndex([100, 95, 99.75], [0, 5, 0]);
    expect(adj[1]).toBeCloseTo(100, 10);
    expect(adj[2]).toBeCloseTo(105, 10);
  });
});

describe('接縫(舊段 + 近 20 年)', () => {
  const recent = mk([
    ['2006-10-02', 100, 0],
    ['2006-10-03', 101, 0],
    ['2006-10-04', 102, 0],
  ]);

  test('重複日期:舊段中「近期第一天以後」的列丟掉,只保留一份', () => {
    const old = mk([
      ['2006-09-28', 98, 0],
      ['2006-09-29', 99, 0],
      ['2006-10-02', 100.5, 0], // 和近期重複
      ['2006-10-03', 101.5, 0],
    ]);
    const r = mergeOldSegment('0050', old, recent);
    expect(r.status).toBe('included');
    expect(r.dupes).toBe(2);
    expect(r.merged.data.map((d) => d.date)).toEqual(['2006-09-28', '2006-09-29', '2006-10-02', '2006-10-03', '2006-10-04']);
    expect(r.merged.data[2].price).toBe(100); // 重複日期以近期資料為準
  });

  test('遺漏:兩邊相隔超過 12 個日曆天 → 不合併', () => {
    const old = mk([['2006-09-15', 99, 0]]);
    const r = mergeOldSegment('0050', old, recent);
    expect(r.status).toBe('seamRejected');
    expect(r.reason).toBe('gap');
    expect(r.merged).toBe(recent);
  });

  test('正常連假(9 天)不算遺漏', () => {
    const old = mk([['2006-09-23', 99, 0]]);
    expect(mergeOldSegment('0050', old, recent).status).toBe('included');
  });

  test('假跳空:接縫跳動超過 10.5% 又沒有除息或分割 → 不合併', () => {
    const old = mk([['2006-09-29', 80, 0]]);
    const r = mergeOldSegment('0050', old, recent);
    expect(r.status).toBe('seamRejected');
    expect(r.reason).toBe('jump');
  });

  test('接縫當天有除息可以解釋 → 合併', () => {
    const rec = mk([
      ['2006-10-02', 85, 4],
      ['2006-10-03', 86, 0],
    ]);
    const old = mk([['2006-09-29', 90, 0]]); // (85+4)/90 − 1 ≈ −1.1%
    expect(mergeOldSegment('0050', old, rec).status).toBe('included');
  });

  test('舊段的除息日只保留接縫之前的', () => {
    const old = mk([
      ['2006-09-28', 98, 1],
      ['2006-09-29', 99, 0],
      ['2006-10-03', 101, 2], // 重複區間的除息不應被帶進來
    ]);
    const r = mergeOldSegment('0050', old, recent);
    expect(r.merged.divDates).toEqual([ts('2006-09-28')]);
  });

  test('真實資料:0050 在 2006-10 切開再接回,結果和完整序列一模一樣', () => {
    const rows = real0050.seam.map(([d, p, div]) => [d, p, div]);
    const cut = rows.findIndex(([d]) => d >= '2006-10-05');
    const old = mk(rows.slice(0, cut + 3)); // 舊段故意多抓 3 天(重複)
    const rec = mk(rows.slice(cut));
    const r = mergeOldSegment('0050', old, rec);
    expect(r.status).toBe('included');
    expect(r.dupes).toBe(3);
    const full = toSeries('0050', mk(rows));
    const merged = toSeries('0050', r.merged);
    expect(merged.dates).toEqual(full.dates);
    expect(merged.adj.map((v) => v.toFixed(10))).toEqual(full.adj.map((v) => v.toFixed(10)));
    // 2006-10-26 除息 4 元在接縫之後,要被正確計入
    expect(merged.divs[merged.dates.indexOf('2006-10-26')]).toBe(4);
  });

  test('真實資料:含息還原價的日報酬和研究快照一致(分割前的除息日除外,見下)', () => {
    const rows = real0050.seam;
    const s = toSeries('0050', mk(rows.map(([d, p, div]) => [d, p, div])));
    expectReturnsMatch(s, rows);
  });
});

describe('分割校正(和 App.js applySplitAdjustments 同一判斷)', () => {
  test('真實資料:0050 2025-06-18 一拆四,原始價格被校正、除息同步縮放,日報酬和快照一致', () => {
    const rows = real0050.split;
    const input = mk(rows.map(([d, p, div]) => [d, p, div]));
    const before = JSON.stringify(input);
    const s = toSeries('0050', input);
    expect(JSON.stringify(input)).toBe(before); // 不改傳入資料
    expect(s.splitNotes.map((n) => n.status)).toEqual(['corrected']);
    const i = s.dates.indexOf('2025-06-10');
    expect(s.prices[i]).toBeCloseTo(188.65 / 4, 10);
    expect(s.divs[s.dates.indexOf('2025-01-17')]).toBeCloseTo(2.7 / 4, 10);
    expectReturnsMatch(s, rows);
    // 目前市價 = 最後一筆原始收盤
    expect(s.lastMarketPrice).toBe(rows[rows.length - 1][1]);
  });

  test('資料源已經調整過 → 不重複校正', () => {
    const rows = real0050.split.map(([d, p, div]) => (d < '2025-06-18' ? [d, p / 4, div / 4] : [d, p, div]));
    const s = toSeries('0050', mk(rows));
    expect(s.splitNotes.map((n) => n.status)).toEqual(['already_adjusted']);
    expect(s.prices[s.dates.indexOf('2025-06-10')]).toBeCloseTo(188.65 / 4, 10);
  });
});

describe('是否需要補抓舊段', () => {
  test('第一筆落在 20 年錨點附近 → 被截斷', () => {
    expect(looksTruncated('2006-10-05', '2026-10-02')).toBe(true);
    expect(looksTruncated('2011-04-15', '2026-10-02')).toBe(false);
  });
});

describe('loadFullHistory:警示與舊段快取', () => {
  const recentRows = (source, extra = {}) =>
    mk(
      [
        ['2006-10-05', 50, 0],
        ['2006-10-06', 51, 0],
      ],
      { source, ...extra }
    );
  const oldSeg = { ...mk([['2006-10-04', 49.5, 0]]), source: 'FinMind' };
  const base = (recent, fetchFinMind, storage = memStorage()) => ({
    fetchStockPriceData: async () => recent,
    fetchFinMind,
    storage,
    lastCompletedTradingDay: '2026-10-02',
  });

  test('FinMind 來源、舊段成功 → 沒有警示,舊段寫進 pullback_hist_ 快取,第二次不再抓', async () => {
    const storage = memStorage();
    const ff = jest.fn(async () => oldSeg);
    const r = await loadFullHistory('0050', base(recentRows('FinMind'), ff, storage));
    expect(r.warnings).toEqual([]);
    expect(r.histStatus).toBe('included');
    expect(r.series.dates[0]).toBe('2006-10-04');
    expect(storage.keys()).toEqual([`${HIST_CACHE_PREFIX}0050`]);
    await loadFullHistory('0050', base(recentRows('FinMind'), ff, storage));
    expect(ff).toHaveBeenCalledTimes(1);
  });

  test('Yahoo 來源 → 顯示備援來源警示(文字照指令)', async () => {
    const r = await loadFullHistory('0050', base(recentRows('Yahoo'), async () => oldSeg));
    expect(r.warnings.map((w) => w.text)).toEqual([WARN_TEXT.yahoo]);
    expect(WARN_TEXT.yahoo).toBe('資料來自備援來源，可能有誤差（Yahoo 在部分期間缺配息或價格錯位）');
  });

  test('來源未記錄、配息不完整、資料過期 → 各自顯示', async () => {
    const r = await loadFullHistory('0050', base(recentRows('', { dividendDataIncomplete: true, stale: true }), async () => oldSeg));
    expect(r.warnings.map((w) => w.text)).toEqual([WARN_TEXT.unknownSource, WARN_TEXT.dividendIncomplete, staleText('2006-10-06')]);
    expect(r.stale).toBe(true);
  });

  test('舊段抓取失敗 → 只用近 20 年並標示', async () => {
    const r = await loadFullHistory('0050', base(recentRows('FinMind'), async () => { throw new Error('net'); }));
    expect(r.histStatus).toBe('failed');
    expect(r.series.dates[0]).toBe('2006-10-05');
    expect(r.warnings.map((w) => w.text)).toEqual([WARN_TEXT.histFailed]);
  });

  test('接縫異常 → 不合併並警示', async () => {
    const bad = { ...mk([['2006-10-04', 30, 0]]), source: 'FinMind' };
    const r = await loadFullHistory('0050', base(recentRows('FinMind'), async () => bad));
    expect(r.histStatus).toBe('seamRejected');
    expect(r.warnings.map((w) => w.text)).toEqual([WARN_TEXT.seamRejected]);
  });

  test('持股提醒模式(withOldSegment=false)→ 不補抓、也不顯示「僅含近 20 年」', async () => {
    const ff = jest.fn();
    const r = await loadFullHistory('0050', { ...base(recentRows('FinMind'), ff), withOldSegment: false });
    expect(ff).not.toHaveBeenCalled();
    expect(r.histStatus).toBe('skipped');
    expect(r.warnings).toEqual([]);
  });

  test('上市未滿 20 年 → 不補抓', async () => {
    const ff = jest.fn();
    const rec = { ...mk([['2015-01-05', 20, 0]]), source: 'FinMind' };
    const r = await loadFullHistory('00878', base(rec, ff));
    expect(ff).not.toHaveBeenCalled();
    expect(r.histStatus).toBe('notNeeded');
  });
});

describe('持股唯讀', () => {
  const portfolioStore = () => ({
    loadPortfolioData: jest.fn(() => ({ groups: [], transactions: [{ id: 'local' }] })),
    fetchRemoteDataOnce: jest.fn(async () => ({ groups: [], transactions: [{ id: 'cloud' }] })),
    savePortfolioData: jest.fn(),
    saveRemoteData: jest.fn(),
    subscribeRemoteData: jest.fn(),
  });

  test('已登入:讀一次雲端;不呼叫任何寫入或訂閱', async () => {
    const ps = portfolioStore();
    const r = await loadPortfolioReadOnly({ uid: 'u1', ...ps });
    expect(r.from).toBe('cloud');
    expect(ps.fetchRemoteDataOnce).toHaveBeenCalledTimes(1);
    expect(ps.savePortfolioData).not.toHaveBeenCalled();
    expect(ps.saveRemoteData).not.toHaveBeenCalled();
    expect(ps.subscribeRemoteData).not.toHaveBeenCalled();
  });

  test('未登入或雲端失敗 → 用本機資料', async () => {
    const ps = portfolioStore();
    expect((await loadPortfolioReadOnly({ uid: null, ...ps })).from).toBe('local');
    expect(ps.fetchRemoteDataOnce).not.toHaveBeenCalled();
    ps.fetchRemoteDataOnce.mockRejectedValueOnce(new Error('offline'));
    expect((await loadPortfolioReadOnly({ uid: 'u1', ...ps })).from).toBe('local');
  });

  test('原始碼層級:pullbackData.js 沒有引用任何寫入或訂閱函式', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('./pullbackData.js'), 'utf8').replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/savePortfolioData|saveRemoteData|subscribeRemoteData|portfolio_tracker_v1/);
  });
});

describe('holdingRows:各群組分開', () => {
  const groups = [
    { id: 'g1', name: '長期', color: 'blue' },
    { id: 'g2', name: '波段', color: 'red' },
  ];
  const tx = (groupId, symbol, type, date, shares) => ({ groupId, symbol, type, date, shares, price: 100 });

  test('同一檔在兩個群組 → 兩列,起點各自計算', () => {
    const rows = holdingRows({
      groups,
      transactions: [
        tx('g1', '0050', 'buy', '2020-01-02', 1000),
        tx('g2', '0050', 'buy', '2023-05-02', 500),
        tx('g2', '0050', 'buy', '2023-06-02', 500),
      ],
    });
    expect(rows.map((r) => [r.groupName, r.symbol, r.startDate, r.shares])).toEqual([
      ['波段', '0050', '2023-05-02', 1000],
      ['長期', '0050', '2020-01-02', 1000],
    ]);
  });

  test('一群仍持有、另一群已賣光 → 只剩持有中的那群', () => {
    const rows = holdingRows({
      groups,
      transactions: [
        tx('g1', '0050', 'buy', '2020-01-02', 1000),
        tx('g2', '0050', 'buy', '2021-01-04', 500),
        tx('g2', '0050', 'sell', '2022-01-04', 500),
      ],
    });
    expect(rows.map((r) => r.groupId)).toEqual(['g1']);
  });

  test('賣光後再買 → 起點是再買那天', () => {
    const rows = holdingRows({
      groups,
      transactions: [
        tx('g1', '0056', 'buy', '2019-01-02', 1000),
        tx('g1', '0056', 'sell', '2020-03-02', 1000),
        tx('g1', '0056', 'buy', '2021-08-02', 200),
      ],
    });
    expect(rows[0].startDate).toBe('2021-08-02');
  });

  test('群組已不存在 → 顯示未知群組,不會出錯', () => {
    const rows = holdingRows({ groups: [], transactions: [tx('gx', '0050', 'buy', '2020-01-02', 1)] });
    expect(rows[0].groupName).toBe('(未知群組)');
  });
});

describe('本機設定 pullback_settings', () => {
  test('預設 10%、252;個別 (群組, 代號) 可覆寫;key 用 pullback_ 前綴', () => {
    const st = memStorage();
    const s0 = loadSettings(st);
    expect(s0).toEqual({ defaultStopPct: 10, overrides: {}, window: 252 });
    saveSettings(st, { ...s0, overrides: { 'g1|0050': 15 }, window: 60 });
    const s1 = loadSettings(st);
    expect(stopPctFor(s1, 'g1', '0050')).toBe(15);
    expect(stopPctFor(s1, 'g2', '0050')).toBe(10);
    expect(s1.window).toBe(60);
    expect(st.keys()).toEqual([SETTINGS_KEY]);
    expect(SETTINGS_KEY.startsWith('pullback_')).toBe(true);
  });

  test('壞掉的 JSON → 回到預設', () => {
    const st = memStorage();
    st.setItem(SETTINGS_KEY, '{oops');
    expect(loadSettings(st).defaultStopPct).toBe(10);
  });
});

describe('FinMind 舊段補抓', () => {
  test('代號去掉 .TW 後綴;除息轉成 dataCache 格式;排除非正價格', async () => {
    const urls = [];
    const fetchFn = async (u) => {
      urls.push(u);
      const price = { msg: 'success', data: [{ date: '2003-06-30', close: 37.08 }, { date: '2003-07-01', close: 0 }] };
      const div = { msg: 'success', data: [{ date: '2005-05-19', cash_dividend: 1.85 }] };
      return { json: async () => (u.includes('TaiwanStockPrice') ? price : div) };
    };
    const r = await fetchFinMindRange('0050.TW', '1990-01-01', '2006-10-04', fetchFn);
    expect(urls.every((u) => u.includes('data_id=0050&'))).toBe(true);
    expect(r.data).toEqual([{ date: '2003-06-30', timestamp: ts('2003-06-30'), price: 37.08 }]);
    expect(dividendsByDate(r).get('2005-05-19')).toBe(1.85);
  });

  test('價格查詢失敗 → null', async () => {
    const fetchFn = async () => ({ json: async () => ({ msg: 'error' }) });
    expect(await fetchFinMindRange('0050', 'a', 'b', fetchFn)).toBeNull();
  });
});
