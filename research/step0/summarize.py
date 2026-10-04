# 彙整 Step 0 的模擬輸出(out/*.jsonl)→ out/summary.json,並在終端印出表格。
# 拒絕的定義:p ≤ 0.05(B=1000 時 p 是 0.001 的倍數;用 ≤ 比 < 稍寬鬆,對「假陽性 ≤ 6%」的判定是較嚴格的一方)。
# 信賴區間用 Wilson 95%,因為拒絕率接近 0 時常態近似會跑出負數。
import json, glob, math, collections
import numpy as np

ALPHA, LIMIT = 0.05, 0.06
Ls = [1, 5, 10, 20, 60, 250]

def wilson(k, n, z=1.96):
    if n == 0: return (None, None)
    p = k / n; den = 1 + z * z / n; c = (p + z * z / (2 * n)) / den
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return (max(0, c - h), min(1, c + h))

rows = []
for f in glob.glob('out/*.jsonl'):
    for line in open(f):
        line = line.strip()
        if line: rows.append(json.loads(line))

groups = collections.defaultdict(list)
for r in rows:
    if r['mode'] == 'garch': key = ('garch', 'GARCH', r['L'])
    elif r['mode'] == 'shift': key = ('shift', r['etf'], r['L'])
    else:
        if not r.get('targetKept', True): key = ('power_dropped', r['ann'], 0)
        else: key = ('power', r['ann'], r['L'])
    groups[key].append(r)

summary = {'null': [], 'power': [], 'power_dropped': {}, 'pc_hist': {}}
for (mode, name, L), g in sorted(groups.items(), key=lambda x: (x[0][0], str(x[0][1]), x[0][2])):
    if mode == 'power_dropped': summary['power_dropped'][str(name)] = len(g); continue
    n = len(g)
    ent = {'mode': mode, 'name': name, 'L': L, 'n': n, 'K_mean': float(np.mean([x['K'] for x in g]))}
    for key, fn in [('pl', lambda x: x['pl'] <= ALPHA), ('pc', lambda x: x['pc'] <= ALPHA),
                    ('pu', lambda x: x['pu'] <= ALPHA), ('stepm', lambda x: x['stepm'] > 0),
                    ('pc10', lambda x: x['pc'] <= 0.10)]:
        k = sum(1 for x in g if fn(x)); lo, hi = wilson(k, n)
        ent[key] = k / n; ent[key + '_ci'] = [lo, hi]
    if mode == 'power':
        # 檢定力:目標規則本身是否被 StepM 選中(比「集合非空」更嚴格,確認選對規則)
        ent['target_hit'] = None
    if mode != 'power':
        ent['pass'] = bool(ent['pc'] <= LIMIT and ent['stepm'] <= LIMIT)
        # p 值分布(10 格直方圖),用來看虛無下 p 值是否大致均勻
        summary['pc_hist'][f'{name}|{L}'] = np.histogram([x['pc'] for x in g], bins=10, range=(0, 1))[0].tolist()
        summary['null'].append(ent)
    else:
        summary['power'].append(ent)

json.dump(summary, open('out/summary.json', 'w'), indent=1, ensure_ascii=False)

def pct(v): return f'{v*100:5.1f}%'
print('── 虛無假設下的拒絕率(名目 5%,門檻 6%)──')
print(f'{"資料":8}{"L":>5}{"次數":>6}{"K":>6}  {"lower":>7}{"consist":>8}{"upper":>7}{"StepM":>7}  判定')
for e in summary['null']:
    print(f'{e["name"]:8}{e["L"]:>5}{e["n"]:>6}{e["K_mean"]:>6.0f}  {pct(e["pl"]):>7}{pct(e["pc"]):>8}{pct(e["pu"]):>7}{pct(e["stepm"]):>7}  {"通過" if e["pass"] else "未通過"}')
if summary['power']:
    print('── 檢定力(GARCH 路徑注入年化優勢)──')
    for e in summary['power']:
        print(f'δ={e["name"]:<5}L={e["L"]:>4} n={e["n"]:>4}  SPA consistent 拒絕 {pct(e["pc"])}  StepM 非空 {pct(e["stepm"])}')
    print('目標規則被剔除的次數:', summary['power_dropped'])
