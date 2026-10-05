// 回檔雷達純函式的單元測試:每個例子都小到可以手算,答案寫在註解裡。
import {
  computeDrawdown,
  detectEvents,
  clusterEvents,
  median,
  winRate,
  baselineStats,
  cellStats,
  computeTable,
  currentState,
  holdingEpisode,
  stopStatus,
  MIN_NEFF,
  EPS,
  isUp,
} from './pullbackStats';
import { totalReturnIndex } from './pullbackData';

const close = (a, b) => expect(a).toBeCloseTo(b, 10);

describe('computeDrawdown', () => {
  test('前 N−1 天沒有回檔值;之後是相對最近 N 天最高價的跌幅', () => {
    // N=3:t=2 的窗口是 [100,110,99] → H=110,DD=99/110−1
    const { dd, high } = computeDrawdown([100, 110, 99, 120, 108, 90], 3);
    expect(dd[0]).toBeNull();
    expect(dd[1]).toBeNull();
    close(high[2], 110);
    close(dd[2], 99 / 110 - 1);
    close(dd[3], 0); // 120 是新高
    close(dd[4], 108 / 120 - 1); // -10%
    close(dd[5], 90 / 120 - 1); // 窗口 [120,108,90] → -25%
  });
  test('最高價會滾出窗口', () => {
    // N=2:t=2 的窗口只有 [80,90],200 已經滾出去 → DD=0
    const { dd } = computeDrawdown([200, 80, 90], 2);
    close(dd[1], 80 / 200 - 1);
    close(dd[2], 0);
  });
});

describe('detectEvents(含去重)', () => {
  // 直接用 DD 序列測試,N=1 → 從 s=1 起都可以判斷
  test('首次跌破才算;沒回到 −x/2 以內不重新計入', () => {
    // x=10%:s=2 跌破(前一天 −5%)→ 事件;s=3 回到 −9%(仍在 −5% 之外,沒重新武裝)
    // s=4 再跌破 −10% → 不算;s=5 回到 −4%(> −5%,重新武裝);s=6 跌破 → 事件
    const dd = [0, -0.05, -0.12, -0.09, -0.11, -0.04, -0.15];
    expect(detectEvents(dd, 10, 1)).toEqual([2, 6]);
  });
  test('恰好等於 −x 算跌破;前一天恰好 −x 不算「前一天仍高於」', () => {
    const dd = [0, -0.1, -0.1, -0.2];
    // s=1:−10% ≤ −10% 且前一天 0 > −10% → 事件;s=2:前一天 −10% 不 > −10% → 不算
    expect(detectEvents(dd, 10, 1)).toEqual([1]);
  });
  test('資料開頭就已經在 −x 以下,不算事件', () => {
    const dd = [null, -0.2, -0.25, -0.03, -0.12];
    // s=2:前一天 −20% 不 > −10%;s=4:前一天 −3% → 事件
    expect(detectEvents(dd, 10, 2)).toEqual([4]);
  });
});

describe('clusterEvents', () => {
  test('以群的起始日 + h 為界(14.2.4 修訂版)', () => {
    // h=126,事件在 0、100、200:0 開第一群;100 < 126 併入;200 ≥ 0+126 開第二群
    expect(clusterEvents([0, 100, 200], 126)).toEqual([0, 200]);
    // 串連法會把三個併成一群;我們的定義不是串連
    expect(clusterEvents([0, 100, 200, 300], 126)).toEqual([0, 200]);
    expect(clusterEvents([0, 126], 126)).toEqual([0, 126]); // 剛好 = 起始日 + h → 新群
    expect(clusterEvents([], 63)).toEqual([]);
  });
});

describe('median / winRate', () => {
  test('奇數、偶數筆與空集合', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(winRate([0.1, -0.2, 0, 0.3])).toBe(0.5); // 0 不算贏
    expect(winRate([])).toBeNull();
  });
});

describe('baselineStats', () => {
  test('從第 N 個索引起、之後仍有完整 h 天的每一天', () => {
    // prices 長度 6、N=2、h=2 → t=2、3(t+h ≤ 5)
    const p = [10, 10, 10, 12, 15, 9];
    const b = baselineStats(p, 2, 2);
    expect(b.n).toBe(2);
    // t=2:15/10−1=0.5;t=3:9/12−1=−0.25 → 中位數 0.125,勝率 0.5
    close(b.median, 0.125);
    expect(b.winRate).toBe(0.5);
  });
});

describe('cellStats', () => {
  // 造一條價格:窗口 N=1 時 DD 永遠是 0(只看當天),所以改用 N=2 以手算
  test('事件、後續報酬不足者剔除、N_eff<5 時不給中位數', () => {
    // N=2:DD_t = P_t / max(P_{t−1},P_t) − 1
    const p = [100, 100, 85, 100, 100, 88, 100, 100];
    // t=2:85/100−1=−15% → 跌破 10%(t=1 DD=0)→ 事件 2;t=3 DD=0 重新武裝
    // t=5:88/100−1=−12% → 事件 5
    const { dd } = computeDrawdown(p, 2);
    const base = baselineStats(p, 2, 2);
    const c = cellStats(p, dd, 2, 10, 2, base);
    expect(c.eventIndices).toEqual([2, 5]); // 5+2=7 < 8 → 完整
    expect(c.nEff).toBe(2); // 5 ≥ 2+2 → 第二群
    expect(c.tooFew).toBe(true);
    expect(c.median).toBeNull();
    expect(c.winRate).toBeNull();
    expect(c.medianDiffPp).toBeNull();
    // h=3:事件 5 需要 t=8,不存在 → 剔除
    const c3 = cellStats(p, dd, 2, 10, 3, baselineStats(p, 2, 3));
    expect(c3.eventIndices).toEqual([2]);
    expect(c3.nEventsAll).toBe(2);
  });

  test('N_eff ≥ 5 時給中位數、勝率與差(百分點)', () => {
    // 重複 6 次「120,120,107,120,120」,窗口 N=2:
    // 每段第 3 天 107/120−1 = −10.8% 跌破 −10%;段與段之間 120→120 沒有回檔
    const seg = [120, 120, 107, 120, 120];
    const p = [].concat(...Array(6).fill(seg), [120, 120]);
    const { dd } = computeDrawdown(p, 2);
    const h = 2;
    const base = baselineStats(p, 2, h);
    const c = cellStats(p, dd, 2, 10, h, base);
    // 事件在每段的第 3 天:索引 2,7,12,17,22,27;彼此相距 5 ≥ h → 6 群
    expect(c.clusterFirstIndices).toEqual([2, 7, 12, 17, 22, 27]);
    expect(c.nEff).toBe(6);
    expect(c.nEff >= MIN_NEFF).toBe(true);
    // 每個事件 107 → 兩天後 120:報酬 120/107−1
    close(c.median, 120 / 107 - 1);
    expect(c.winRate).toBe(1);
    close(c.medianDiffPp, (120 / 107 - 1 - base.median) * 100);
    close(c.winRateDiffPp, (1 - base.winRate) * 100);
  });
});

describe('computeTable', () => {
  test('總日數 < 窗口 + 63 → 資料不足', () => {
    expect(computeTable(Array(60 + 62).fill(100), 60).insufficient).toBe(true);
    const t = computeTable(Array(60 + 63).fill(100), 60);
    expect(t.insufficient).toBe(false);
    expect(t.cells).toHaveLength(15); // 5 檔位 × 3 持有期
  });
});

describe('currentState', () => {
  test('已到檔位與距下一檔位', () => {
    // N=3,最後窗口 [100, 95, 88]:H=100、DD=−12% → 已到 10%,下一檔 15%
    const s = currentState([90, 100, 95, 88], 3);
    close(s.drawdown, -0.12);
    expect(s.deepestReached).toBe(10);
    expect(s.nextThreshold).toBe(15);
    close(s.distanceToNext, (0.85 * 100) / 88 - 1); // 還要再跌約 3.4%
  });
  test('還沒到任何檔位;已超過最深檔位', () => {
    const a = currentState([100, 98], 2);
    expect(a.deepestReached).toBeNull();
    expect(a.nextThreshold).toBe(5);
    close(a.distanceToNext, 95 / 98 - 1);
    const b = currentState([100, 70], 2);
    expect(b.deepestReached).toBe(20);
    expect(b.nextThreshold).toBeNull();
    expect(b.distanceToNext).toBeNull();
  });
  test('資料不足一個窗口時回傳 null', () => {
    expect(currentState([100, 90], 3)).toBeNull();
  });
});

describe('holdingEpisode(各群組分開時,傳入的是單一群組、單一代號的交易)', () => {
  const tx = (date, type, shares) => ({ date, type, shares });
  test('從未歸零:起點是第一筆買進', () => {
    const r = holdingEpisode([tx('2024-01-05', 'buy', 1000), tx('2024-03-01', 'buy', 500), tx('2024-04-01', 'sell', 800)]);
    expect(r).toEqual({ shares: 700, holding: true, startDate: '2024-01-05' });
  });
  test('全部賣出後又重新買進:起點重算', () => {
    const r = holdingEpisode([
      tx('2023-01-01', 'buy', 1000),
      tx('2023-06-01', 'sell', 1000),
      tx('2024-02-01', 'buy', 200),
      tx('2024-03-01', 'buy', 300),
    ]);
    expect(r).toEqual({ shares: 500, holding: true, startDate: '2024-02-01' });
  });
  test('已全部賣出:不在持有中', () => {
    const r = holdingEpisode([tx('2023-01-01', 'buy', 1000), tx('2023-06-01', 'sell', 1000)]);
    expect(r).toEqual({ shares: 0, holding: false, startDate: null });
  });
  test('同一天先買後賣(和 computeSymbolSummary 一致);賣超過庫存只賣到 0', () => {
    // 原始順序是賣在前,但同一天要先處理買 → 不會被誤判成歸零
    const r = holdingEpisode([tx('2024-01-01', 'buy', 100), tx('2024-05-01', 'sell', 100), tx('2024-05-01', 'buy', 100)]);
    expect(r).toEqual({ shares: 100, holding: true, startDate: '2024-01-01' });
    const r2 = holdingEpisode([tx('2024-01-01', 'sell', 50), tx('2024-02-01', 'buy', 10)]);
    expect(r2).toEqual({ shares: 10, holding: true, startDate: '2024-02-01' });
  });
  test('兩個群組持有同一檔、起點不同 → 各算各的(呼叫端依 groupId 分開傳入)', () => {
    const all = [
      { ...tx('2022-01-03', 'buy', 1000), groupId: 'A' },
      { ...tx('2024-07-01', 'buy', 1000), groupId: 'B' },
      { ...tx('2023-01-03', 'sell', 1000), groupId: 'A' },
      { ...tx('2023-05-02', 'buy', 500), groupId: 'A' },
    ];
    const a = holdingEpisode(all.filter((t) => t.groupId === 'A'));
    const b = holdingEpisode(all.filter((t) => t.groupId === 'B'));
    expect(a.startDate).toBe('2023-05-02'); // A 歸零後重新買進
    expect(b.startDate).toBe('2024-07-01');
  });
  test('一個群組持有、另一個群組已全部賣出', () => {
    const a = holdingEpisode([tx('2022-01-03', 'buy', 1000)]);
    const b = holdingEpisode([tx('2022-01-03', 'buy', 1000), tx('2022-09-01', 'sell', 1000)]);
    expect(a.holding).toBe(true);
    expect(b.holding).toBe(false);
  });
  test('股票股利增加股數,現金股利不影響', () => {
    const r = holdingEpisode([tx('2024-01-01', 'buy', 100), tx('2024-02-01', 'stockDividend', 10), tx('2024-03-01', 'cashDividend', 0), tx('2024-04-01', 'sell', 100)]);
    expect(r.shares).toBe(10);
    expect(r.startDate).toBe('2024-01-01');
  });
});

describe('stopStatus', () => {
  const dates = ['2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05', '2024-01-08'];
  const adj = [130, 100, 120, 110, 105];
  test('最高價只從起點起算;距停利點 = (1−stop)·H ÷ P − 1', () => {
    // 起點 01-03 → 最高價 120(不含 01-02 的 130)
    const s = stopStatus(dates, adj, '2024-01-03', 10);
    close(s.fallFromHigh, 105 / 120 - 1); // −12.5%
    expect(s.belowStop).toBe(true);
    expect(s.highDate).toBe('2024-01-04');
    const s2 = stopStatus(dates, adj, '2024-01-03', 15);
    expect(s2.belowStop).toBe(false);
    close(s2.distanceToStop, (0.85 * 120) / 105 - 1); // 還要再跌約 2.9%
  });
  test('起點不是交易日:從之後第一個交易日起算;起點晚於資料 → null', () => {
    const s = stopStatus(dates, adj, '2024-01-06', 10);
    close(s.fallFromHigh, 0); // 只剩 01-08 一天
    expect(stopStatus(dates, adj, '2024-02-01', 10)).toBeNull();
  });
  test('兩個群組起點不同 → 最高價不同', () => {
    const a = stopStatus(dates, adj, '2024-01-02', 10);
    const b = stopStatus(dates, adj, '2024-01-05', 10);
    close(a.fallFromHigh, 105 / 130 - 1);
    close(b.fallFromHigh, 105 / 110 - 1);
  });
});

describe('浮點容許誤差(EPS = 1e-9)', () => {
  test('上漲的判定:報酬 > 1e-9 才算;|報酬| ≤ 1e-9 視為持平;剛好貼近門檻', () => {
    expect(EPS).toBe(1e-9);
    // 0、±浮點雜訊、剛好 ±1e-9 → 都不算上漲;1.5e-9、2e-9 → 上漲
    const v = [0, 2.2e-16, -2.2e-16, 1e-9, -1e-9, 1.5e-9, 2e-9];
    expect(v.map(isUp)).toEqual([false, false, false, false, false, true, true]);
    close(winRate(v), 2 / 7);
  });

  test('價格完全不變的期間:還原價的浮點雜訊不會被算成上漲(勝率與基準勝率)', () => {
    // 27.6875 → … → 27.6875,期間沒有配息;真實報酬是 0,但累乘後剩 +2.2e-16 的雜訊
    const adj = totalReturnIndex([27.6875, 28.1, 27.3, 27.6875], [0, 0, 0, 0]);
    const r = adj[3] / adj[0] - 1;
    expect(r).not.toBe(0); // 前提:確實有雜訊
    expect(Math.abs(r)).toBeLessThan(1e-12);
    expect(winRate([r])).toBe(0);
    // 基準勝率:N=0、h=3,只有 t=0 一天可算
    expect(baselineStats(adj, 0, 3)).toMatchObject({ n: 1, winRate: 0 });
  });

  test('前後同價但期間有配息:含息報酬為正 → 算上漲', () => {
    // 10 → 10.2 → 除息 0.5 元後收 9.8 → 10;含息報酬 = (10.2/10)·((9.8+0.5)/10.2)·(10/9.8) − 1 ≈ +5.1%
    const adj = totalReturnIndex([10, 10.2, 9.8, 10], [0, 0, 0.5, 0]);
    const r = adj[3] / adj[0] - 1;
    close(r, 10.3 / 9.8 - 1);
    expect(isUp(r)).toBe(true);
    expect(baselineStats(adj, 0, 3).winRate).toBe(1);
  });

  test('回檔剛好等於 −x(價格落在跳動單位上):一律算跌到,不受浮點誤差左右', () => {
    // 53.96 / 56.8 − 1 在電腦裡是 −0.04999999999999993(比 −5% 淺一點點)
    // 44.84 / 47.2 − 1 同樣;95 / 100 − 1 則是 −0.050000000000000044(比 −5% 深一點點)
    for (const [H, P] of [[56.8, 53.96], [47.2, 44.84], [100, 95]]) {
      const { dd } = computeDrawdown([H, H, P], 2);
      expect(detectEvents(dd, 5, 2)).toEqual([2]);
      expect(currentState([H, H, P], 2).deepestReached).toBe(5);
    }
  });

  test('回檔剛好回到 −x/2:算「回到 −x/2 以內」,可再次計入', () => {
    // −5% 檔位:跌到 −5% → 回到剛好 −2.5%(55.38/56.8−1 = −0.02499999999999991;
    // 32.37/33.2−1 = −0.025000000000000133,兩種方向的雜訊都要判成回到)→ 再跌到 −5% → 第二個事件
    for (const [H, half, low] of [[56.8, 55.38, 53.96], [33.2, 32.37, 31.54]]) {
      const p = [H, H, H, H, H, low, half, low]; // 窗口 5 日,最高價一直是 H
      const { dd } = computeDrawdown(p, 5);
      expect(detectEvents(dd, 5, 5)).toEqual([5, 7]);
    }
  });

  test('停利:剛好回落到停利設定也算「已低於停利設定」', () => {
    // 最高 56.8,現價 51.12 = 56.8 × 0.9;51.12/56.8 − 1 在電腦裡比 −10% 淺一點點
    const s = stopStatus(['2024-01-02', '2024-01-03'], [56.8, 51.12], '2024-01-02', 10);
    expect(s.belowStop).toBe(true);
  });
});
