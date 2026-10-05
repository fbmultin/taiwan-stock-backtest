"""Step C:回檔雷達(第一層)的獨立對照。

做法(依「給股魚棚_第一層實作指令.md」第 7 節與「資料錯誤更正與StepC.md」第三階段):
  1. 從研究快照建立還原價:P̃ = Π(1 + 日報酬),第一天為 1。
       0050 用 total_ret_fixed(修正版);0051、0055、006201 用 total_ret(沒有分割,不受影響);
       另把有誤的 0050 total_ret 也跑一次(0050_bad),只為記錄差異。
  2. 同一條序列交給 app 的純函式(run_app.js,直接載入 main 分支的 src/pullbackStats.js)。
  3. 這支程式依設計文件 3.2、14.2.2、14.2.4、14.5 的文字定義「從頭重寫」一次(門檻比較含 1e-9 容許誤差:
     報酬 > 1e-9 才算上漲、回檔 ≤ −x + 1e-9 算跌到、回檔 ≥ −x/2 − 1e-9 算回到 −x/2 以內),不參考 app 的程式寫法
     (例如滾動最大值這裡用最直接的逐窗掃描,app 用單調佇列),再逐項比對:
       回檔序列、窗口最高價、事件(含去重)、事件群、基準、各格統計、今日狀態。
     容許誤差 1e-9(浮點)。
  4. app 的資料管線(原始收盤價 + 原始除息 → toSeries)產生的 0050 日報酬,
     應與 total_ret_fixed 一致、與有誤的 total_ret 在 29 天不同。

用法(在 research/stepC 目錄):APP_DIR=<main 分支 checkout> python3 stepc.py
輸出:out/summary.json、out/report.md
"""
import csv, json, math, os, statistics, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, '..', 'step0_rerun', 'data')
OUT = os.path.join(HERE, 'out')
TOL = 1e-9
# 門檻比較的浮點容許誤差(設計文件 14.5「上漲」的判定;與 app 的 pullbackStats.EPS 同值、同規則)
EPS = 1e-9

WINDOWS = [60, 252]
THRESHOLDS = [5, 7, 10, 15, 20]
HOLDS = [63, 126, 252]
MIN_NEFF = 5
MIN_EXTRA = 63

SERIES = [  # (名稱, 檔案, 報酬欄)
    ('0050', '0050', 'total_ret_fixed'),
    ('0051', '0051', 'total_ret'),
    ('0055', '0055', 'total_ret'),
    ('006201', '006201', 'total_ret'),
    ('0050_bad', '0050', 'total_ret'),
]


def load(sym):
    return list(csv.DictReader(open(os.path.join(DATA, f'{sym}.csv'), encoding='utf-8')))


def index_from(rows, col):
    p, out = 1.0, []
    for i, r in enumerate(rows):
        if i > 0:
            p = p * (1 + float(r[col]))
        out.append(p)
    return out


# ── 獨立實作(依文件文字) ──
def drawdown(P, N):
    """DD_t = P_t / max(P_{t-N+1..t}) − 1;前 N−1 天沒有完整窗口 → None。逐窗直接取最大值。"""
    dd, hi = [None] * len(P), [None] * len(P)
    for t in range(N - 1, len(P)):
        h = max(P[t - N + 1:t + 1])
        hi[t], dd[t] = h, P[t] / h - 1
    return dd, hi


def events(dd, xpct, N):
    """首次跌破 −x(前一天仍高於 −x),事件日 s ≥ N;計入後要先回到 −x/2 以內才可再計入。"""
    x = xpct / 100
    out, can_count = [], True
    for s in range(N, len(dd)):
        if dd[s] is None or dd[s - 1] is None:
            continue
        if not can_count and dd[s] >= -x / 2 - EPS:  # 回到 −x/2 以內(含邊界)
            can_count = True
        if can_count and dd[s] <= -x + EPS and dd[s - 1] > -x + EPS:  # 剛好 −x 算跌到
            out.append(s)
            can_count = False
    return out


def clusters(ev, h):
    """第一個事件開第一群;進場日 ≥ 該群起始日 + h 的事件才開下一群。回傳各群第一個事件。"""
    firsts = []
    for s in ev:
        if not firsts or s >= firsts[-1] + h:
            firsts.append(s)
    return firsts


def win(v):
    return sum(1 for a in v if a > EPS) / len(v) if v else None  # 報酬 > 1e-9 才算上漲


def med(v):
    return statistics.median(v) if v else None


def baseline(P, N, h):
    r = [P[t + h] / P[t] - 1 for t in range(N, len(P) - h)]
    return {'n': len(r), 'median': med(r), 'winRate': win(r)}


def table(P, N):
    if len(P) < N + MIN_EXTRA:
        return {'insufficient': True, 'totalDays': len(P), 'needed': N + MIN_EXTRA, 'cells': [], 'baselines': {}}
    dd, _ = drawdown(P, N)
    base = {h: baseline(P, N, h) for h in HOLDS}
    cells = []
    for x in THRESHOLDS:
        ev_all = events(dd, x, N)
        for h in HOLDS:
            comp = [s for s in ev_all if s + h < len(P)]
            f = clusters(comp, h)
            rets = [P[s + h] / P[s] - 1 for s in f]
            ok = len(f) >= MIN_NEFF
            m, w = (med(rets), win(rets)) if ok else (None, None)
            cells.append({
                'xPct': x, 'h': h, 'nEvents': len(comp), 'nEventsAll': len(ev_all), 'nEff': len(f), 'tooFew': not ok,
                'median': m, 'winRate': w,
                'medianDiffPp': (m - base[h]['median']) * 100 if ok else None,
                'winRateDiffPp': (w - base[h]['winRate']) * 100 if ok else None,
                'eventIndices': comp, 'clusterFirstIndices': f,
            })
    return {'insufficient': False, 'totalDays': len(P), 'cells': cells, 'baselines': base}


def state(P, N):
    dd, hi = drawdown(P, N)
    t = len(P) - 1
    if dd[t] is None:
        return None
    d = dd[t]
    reached = [x for x in THRESHOLDS if d <= -x / 100 + EPS]
    nxt = next((x for x in THRESHOLDS if d > -x / 100 + EPS), None)
    return {'drawdown': d, 'high': hi[t], 'price': P[t], 'deepestReached': reached[-1] if reached else None,
            'nextThreshold': nxt, 'distanceToNext': None if nxt is None else (1 - nxt / 100) * hi[t] / P[t] - 1}


# ── 比對工具 ──
def close(a, b):
    if a is None or b is None:
        return a is None and b is None
    if isinstance(a, bool) or isinstance(b, bool) or isinstance(a, int) and isinstance(b, int):
        return a == b
    return abs(a - b) <= TOL * max(1.0, abs(b))


def cmp_value(a, b, where, diffs, worst):
    if isinstance(a, dict):
        for k in a:
            cmp_value(a[k], b.get(k) if isinstance(b, dict) else None, f'{where}.{k}', diffs, worst)
        for k in (b or {}):
            if k not in a:
                diffs.append(f'{where}.{k}: 只有 app 有')
    elif isinstance(a, list):
        if not isinstance(b, list) or len(a) != len(b):
            diffs.append(f'{where}: 長度不同 {len(a)} vs {len(b) if isinstance(b, list) else b}')
            return
        for i, (x, y) in enumerate(zip(a, b)):
            cmp_value(x, y, f'{where}[{i}]', diffs, worst)
    else:
        if not close(a, b):
            diffs.append(f'{where}: python={a} app={b}')
        elif isinstance(a, float) and isinstance(b, (int, float)):
            worst[0] = max(worst[0], abs(a - b))


def main():
    app_dir = os.environ.get('APP_DIR')
    if not app_dir:
        sys.exit('請設定 APP_DIR(main 分支的 checkout 路徑)')
    os.makedirs(OUT, exist_ok=True)
    raw = {s: load(s) for s in {'0050', '0051', '0055', '006201', '0052'}}
    series = {name: {'dates': [r['date'] for r in raw[f]], 'adj': index_from(raw[f], col)} for name, f, col in SERIES}
    pipeline = {s: {'symbol': s, 'dates': [r['date'] for r in raw[s]], 'close_raw': [float(r['close_raw']) for r in raw[s]],
                    'div': [float(r['div']) for r in raw[s]]} for s in ['0050', '0052']}
    inp = os.path.join(OUT, 'series.json')
    json.dump({'series': series, 'pipeline': pipeline}, open(inp, 'w'))
    app_out = os.path.join(OUT, 'app_results.json')
    subprocess.run(['node', os.path.join(HERE, 'run_app.js'), inp, app_out], check=True, env={**os.environ, 'APP_DIR': app_dir})
    app = json.load(open(app_out))

    summary = {'appBlobs': app['appBlobs'], 'tolerance': TOL, 'series': {}, 'pipeline': {}, 'fixed_vs_bad': {}}
    py_all = {}
    for name in series:
        P = series[name]['adj']
        summary['series'][name] = {'days': len(P), 'first': series[name]['dates'][0], 'last': series[name]['dates'][-1]}
        py_all[name] = {}
        for N in WINDOWS:
            dd, hi = drawdown(P, N)
            py = {'dd': dd, 'high': hi, 'events': {str(x): events(dd, x, N) for x in THRESHOLDS},
                  'table': table(P, N), 'state': state(P, N)}
            py['table']['baselines'] = {str(h): v for h, v in py['table']['baselines'].items()}
            py_all[name][N] = py
            diffs, worst = [], [0.0]
            cmp_value(py, app['series'][name][str(N)], f'{name}/N={N}', diffs, worst)
            t = py['table']
            summary['series'][name][f'N={N}'] = {
                'differences': len(diffs), 'first_differences': diffs[:10], 'max_abs_float_gap': worst[0],
                'compared': {
                    'dd_points': sum(1 for v in dd if v is not None),
                    'events': {x: len(v) for x, v in py['events'].items()},
                    'cells': len(t['cells']), 'insufficient': t['insufficient'],
                },
            }

    # app 資料管線 vs 修正版/有誤版
    for s in ['0050', '0052']:
        a = app['appPipeline'][s]
        rows = raw[s]
        assert a['dates'] == [r['date'] for r in rows]
        r_app = [a['adj'][i] / a['adj'][i - 1] - 1 for i in range(1, len(rows))]
        fx = [float(r['total_ret_fixed']) for r in rows[1:]]
        bad = [float(r['total_ret']) for r in rows[1:]]
        # 快照的 total_ret 只存 10 位有效數字,所以這裡的容許誤差用 1e-8(相對於報酬本身)
        diff_fixed = [rows[i + 1]['date'] for i, (x, y) in enumerate(zip(r_app, fx)) if abs(x - y) > 1e-8]
        diff_bad = [rows[i + 1]['date'] for i, (x, y) in enumerate(zip(r_app, bad)) if abs(x - y) > 1e-8]
        summary['pipeline'][s] = {'splitNotes': a['splitNotes'], 'days_differ_from_fixed': diff_fixed,
                                  'days_differ_from_bad': len(diff_bad), 'bad_days': diff_bad}

    # 修正版 vs 有誤版(只記錄)
    for N in WINDOWS:
        g, b = py_all['0050'][N], py_all['0050_bad'][N]
        ddg = [x for x in g['dd'] if x is not None]; ddb = [x for x in b['dd'] if x is not None]
        gaps = [abs(x - y) for x, y in zip(ddg, ddb)]
        cells = []
        for cg, cb in zip(g['table']['cells'], b['table']['cells']):
            cells.append({'x': cg['xPct'], 'h': cg['h'],
                          'fixed': [cg['nEvents'], cg['nEff'], cg['median'], cg['winRate']],
                          'bad': [cb['nEvents'], cb['nEff'], cb['median'], cb['winRate']]})
        ev = {x: {'fixed': len(g['events'][x]), 'bad': len(b['events'][x]),
                  'only_fixed': len(set(g['events'][x]) - set(b['events'][x])),
                  'only_bad': len(set(b['events'][x]) - set(g['events'][x]))} for x in g['events']}
        base = {h: {'fixed': g['table']['baselines'][h], 'bad': b['table']['baselines'][h]} for h in g['table']['baselines']}
        summary['fixed_vs_bad'][f'N={N}'] = {
            'dd_days_differ': sum(1 for x in gaps if x > 1e-12), 'dd_max_gap_pp': max(gaps) * 100,
            'events': ev, 'baselines': base, 'cells': cells,
            'state': {'fixed': g['state'], 'bad': b['state']},
        }
    # 管線序列(原始價 + 除息)vs 快照序列(累乘 total_ret_fixed):日報酬一致到 1e-8,
    # 但快照只存 10 位有效數字;真實報酬剛好為 0 的期間(前後收盤價相同、沒有除息),
    # 兩邊的浮點雜訊正負號可能不同。改成「報酬 > 1e-9 才算上漲」之後,這些期間兩邊都算持平;
    # 這裡列出 |報酬| ≤ 1e-9 的期間(near_zero),並確認上漲判定已不再不同(sign_flips 應為空)。
    Pp = app['appPipeline']['0050']['adj']; Ps = series['0050']['adj']; d0050 = series['0050']['dates']
    flips, cell_gaps, near_zero = [], [], []
    for N in WINDOWS:
        tp, ts_ = table(Pp, N), table(Ps, N)
        for h in HOLDS:
            for t in range(N, len(Pp) - h):
                a, b = Pp[t + h] / Pp[t] - 1, Ps[t + h] / Ps[t] - 1
                if abs(a) <= EPS or abs(b) <= EPS:
                    near_zero.append({'N': N, 'h': h, 'from': d0050[t], 'to': d0050[t + h], 'pipeline': a, 'snapshot': b})
                if (a > EPS) != (b > EPS):
                    flips.append({'N': N, 'h': h, 'from': d0050[t], 'to': d0050[t + h], 'pipeline': a, 'snapshot': b})
            bp, bs = tp['baselines'][h], ts_['baselines'][h]
            if bp['winRate'] != bs['winRate']:
                cell_gaps.append({'N': N, 'h': h, 'what': '基準勝率', 'pipeline': bp['winRate'], 'snapshot': bs['winRate']})
        for cp, cs in zip(tp['cells'], ts_['cells']):
            for k in ['nEvents', 'nEff', 'winRate']:
                if cp[k] != cs[k]:
                    cell_gaps.append({'N': N, 'h': cp['h'], 'x': cp['xPct'], 'what': k, 'pipeline': cp[k], 'snapshot': cs[k]})
            if cp['median'] is not None and abs(cp['median'] - cs['median']) > 1e-8:
                cell_gaps.append({'N': N, 'h': cp['h'], 'x': cp['xPct'], 'what': 'median', 'pipeline': cp['median'], 'snapshot': cs['median']})
    summary['pipeline_vs_snapshot_0050'] = {'near_zero': near_zero, 'sign_flips': flips, 'stat_gaps': cell_gaps}
    json.dump(summary, open(os.path.join(OUT, 'summary.json'), 'w'), ensure_ascii=False, indent=1)
    write_report(summary)
    total = sum(v[k]['differences'] for v in summary['series'].values() for k in v if k.startswith('N='))
    print('app 與 Python 的差異總數:', total)
    print('0050 管線與修正版不同的天數:', len(summary['pipeline']['0050']['days_differ_from_fixed']),
          ';與有誤版不同的天數:', summary['pipeline']['0050']['days_differ_from_bad'])


def pct(v):
    return '—' if v is None else f'{v * 100:+.1f}%'


def wr(v):
    return '—' if v is None else f'{v * 100:.1f}%'


def write_report(S):
    L = ['# Step C 獨立對照結果', '',
         f"app 檔案(main 分支 blob):" + '、'.join(f'`{k}` {v[:7]}' for k, v in S['appBlobs'].items()), '',
         f"容許誤差:{S['tolerance']}(相對)。", '', '## 1. app 純函式 vs Python 獨立重算', '',
         '| 序列 | 日數 | 窗口 | 比對的回檔點數 | 各檔位事件數(5/7/10/15/20) | 差異數 | 最大浮點差 |', '|---|---|---|---|---|---|---|']
    for name, v in S['series'].items():
        for N in WINDOWS:
            c = v[f'N={N}']
            ev = '/'.join(str(c['compared']['events'][str(x)]) for x in THRESHOLDS)
            L.append(f"| {name} | {v['days']} | {N} | {c['compared']['dd_points']} | {ev} | {c['differences']} | {c['max_abs_float_gap']:.1e} |")
    L += ['', '比對項目:回檔序列、窗口最高價、事件(含去重)、各格的事件與事件群索引、事件數、群數、中位數、勝率、與基準的差、基準、今日狀態。', '',
          '## 2. app 資料管線(原始收盤價 + 原始除息 → 分割校正 → 含息還原價)', '']
    for s, p in S['pipeline'].items():
        L.append(f"- {s}:分割校正狀態 {p['splitNotes']};日報酬與 `total_ret_fixed` 不同的天數 **{len(p['days_differ_from_fixed'])}**;"
                 f"與有誤的 `total_ret` 不同的天數 **{p['days_differ_from_bad']}**。")
    L += ['', '## 3. 0050:修正版 vs 有誤版(只記錄)', '']
    for N in WINDOWS:
        f = S['fixed_vs_bad'][f'N={N}']
        L += [f'### 窗口 {N} 日', '', f"- 回檔序列不同的天數:{f['dd_days_differ']};最大差 {f['dd_max_gap_pp']:.1f} 個百分點。",
              f"- 今日回檔:修正版 {pct(f['state']['fixed']['drawdown'])},有誤版 {pct(f['state']['bad']['drawdown'])}。", '',
              '| 檔位 | 事件數(修正/有誤) | 只在修正版 | 只在有誤版 |', '|---|---|---|---|']
        for x, e in f['events'].items():
            L.append(f"| −{x}% | {e['fixed']} / {e['bad']} | {e['only_fixed']} | {e['only_bad']} |")
        L += ['', '| 持有期 | 基準中位數(修正/有誤) | 基準勝率(修正/有誤) |', '|---|---|---|']
        for h, b in f['baselines'].items():
            L.append(f"| {h} | {pct(b['fixed']['median'])} / {pct(b['bad']['median'])} | {wr(b['fixed']['winRate'])} / {wr(b['bad']['winRate'])} |")
        L += ['', '| 檔位 × 持有期 | 事件／群(修正) | 中位數、勝率(修正) | 事件／群(有誤) | 中位數、勝率(有誤) |', '|---|---|---|---|---|']
        for c in f['cells']:
            a, b = c['fixed'], c['bad']
            L.append(f"| −{c['x']}% × {c['h']} | {a[0]}／{a[1]} | {pct(a[2])}、{wr(a[3])} | {b[0]}／{b[1]} | {pct(b[2])}、{wr(b[3])} |")
        L.append('')
    V = S['pipeline_vs_snapshot_0050']
    L += ['## 4. 0050:app 資料管線的序列 vs 快照累乘的序列', '',
          '兩者日報酬一致到 1e-8;但快照的 `total_ret` 只存 10 位有效數字。真實報酬剛好為 0 的期間(前後收盤價相同、期間沒有配息),'
          '兩邊只剩浮點雜訊(約 1e-16 或 1e-11),正負號可能相反。依 14.5「報酬 > 1e-9 才算上漲」,這些期間兩邊都算持平。', '',
          '| 窗口 | 持有期 | 起 | 迄 | 管線報酬 | 快照報酬 |', '|---|---|---|---|---|---|']
    for f in V['near_zero']:
        L.append(f"| {f['N']} | {f['h']} | {f['from']} | {f['to']} | {f['pipeline']:.1e} | {f['snapshot']:.1e} |")
    L += ['', f"上漲判定不同的期間:{len(V['sign_flips'])} 個;因此不同的統計量:", '']
    for g in V['stat_gaps']:
        L.append(f"- 窗口 {g['N']}、持有 {g['h']}" + (f"、−{g['x']}%" if 'x' in g else '') + f":{g['what']} 管線 {g['pipeline']} vs 快照 {g['snapshot']}")
    if not V['stat_gaps']:
        L.append('- 無')
    open(os.path.join(OUT, 'report.md'), 'w', encoding='utf-8').write('\n'.join(L) + '\n')


if __name__ == '__main__':
    main()
