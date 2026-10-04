# 彙整 Step 0 重跑的所有輸出 → out/summary.json 與 out/summary.txt
# 判定只依設計文件 13.6:正式閘門 = (0051、0055、006201、案例 A)× L∈{5,10,20,60} × 2 統計量 = 32 格,
# 全部 ≤ 6% 才通過。拒絕 = p ≤ 0.05(B=1000 時 p 為 0.001 的倍數,用 ≤ 對通過判定較嚴)。
import json, glob, math, collections
import numpy as np

# K=0(所有規則都因進場 < 5 次被剔除)時,依第九章屬「資料不足以判斷」,不做檢定。
# 原型 spaStepm 在 K=0 時會回傳 T=0、p=0(空集合取最大值的邊界情況),若直接比 p ≤ 0.05 會被誤算成「拒絕」。
# 所以拒絕一律要求 K > 0;K=0 的路徑仍留在分母(它代表「檢定沒說有效」),另外計數報告。
def rej_pc(x, key='pc'): return x['K'] > 0 and x[key] <= ALPHA

LIMIT, ALPHA = 0.06, 0.05
CASES = ['0051', '0055', '006201', 'A']
GATE_L = [5, 10, 20, 60]
ALL_L = [1, 5, 10, 20, 60, 250]
SHIFT_ETFS = ['0051', '0055', '006201', '0052', '0053', '0057', '006203', '006204']
DELTAS = [5, 10, 15, 20, 30, 40]


def wilson(k, n, z=1.96):
    p = k / n; den = 1 + z * z / n; c = (p + z * z / (2 * n)) / den
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return [max(0.0, c - h), min(1.0, c + h)]


def load(pat):
    rows = []
    for f in sorted(glob.glob(pat)):
        rows += [json.loads(l) for l in open(f) if l.strip()]
    return rows


S = {'gate': [], 'shift': [], 'power': [], 'bcmp': {}, 'coverage': {}, 'pc_hist': {}, 'garch': json.load(open('garch_params.json'))}

# ── 正式閘門 ──
for c in CASES:
    for L in ALL_L:
        g = load(f'out/gate_{c}_L{L}.jsonl')
        if not g: continue
        n = len(g); kc = sum(rej_pc(x) for x in g); ks = sum(x['stepm'] > 0 for x in g)
        e = {'case': c, 'K0': sum(x['K'] == 0 for x in g), 'L': L, 'paths': n, 'n': g[0]['n'], 'K_mean': float(np.mean([x['K'] for x in g])),
             'K_min': int(min(x['K'] for x in g)), 'pc': kc / n, 'pc_ci': wilson(kc, n), 'stepm': ks / n, 'stepm_ci': wilson(ks, n),
             'pl': float(np.mean([rej_pc(x, 'pl') for x in g])), 'pu': float(np.mean([rej_pc(x, 'pu') for x in g])),
             'gate': L in GATE_L}
        e['cell_pass'] = e['pc'] <= LIMIT and e['stepm'] <= LIMIT
        S['gate'].append(e)
        S['pc_hist'][f'{c}|{L}'] = np.histogram([x['pc'] for x in g if x['K'] > 0], bins=10, range=(0, 1))[0].tolist()
gate_cells = [(e['case'], e['L'], stat, e[stat]) for e in S['gate'] if e['gate'] for stat in ('pc', 'stepm')]
complete = len(gate_cells) == 32 and all(e['paths'] == 4000 for e in S['gate'] if e['gate'])
S['gate_complete'] = complete
S['gate_pass'] = complete and all(v <= LIMIT for *_, v in gate_cells)
S['gate_fail_cells'] = [f'{c} L={L} {st} {v*100:.2f}%' for c, L, st, v in gate_cells if v > LIMIT]

# ── 輔助 1:循環位移 ──
for etf in SHIFT_ETFS:
    rows = load(f'out/shift_{etf}.jsonl')
    by = collections.defaultdict(list)
    for x in rows: by[x['L']].append(x)
    for L in ALL_L:
        g = by.get(L, [])
        if not g: continue
        n = len(g); kc = sum(rej_pc(x) for x in g); ks = sum(x['stepm'] > 0 for x in g)
        S['shift'].append({'etf': etf, 'L': L, 'shifts': n, 'n': g[0]['n'], 'K': g[0]['K'], 'pc': kc / n, 'stepm': ks / n,
                           'indep_approx': g[0]['n'] / 126})  # 三檔與輔助各檔最長持有期都是 126(n÷20 < 252)
pred = [e for e in S['shift'] if e['L'] in GATE_L]
S['shift_prediction_holds'] = bool(pred) and all(e['pc'] <= LIMIT and e['stepm'] <= LIMIT for e in pred)
S['shift_prediction_fail'] = [f"{e['etf']} L={e['L']} consistent {e['pc']*100:.1f}% / StepM {e['stepm']*100:.1f}%" for e in pred if e['pc'] > LIMIT or e['stepm'] > LIMIT]

# ── 輔助 2:檢定力與最小可偵測優勢 ──
for c in CASES:
    mde = None
    for d in DELTAS:
        g = load(f'out/power_{c}_d{d}.jsonl')
        if not g: continue
        n = len(g); p = sum(x['stepm'] > 0 for x in g) / n
        S['power'].append({'case': c, 'delta': d, 'paths': n, 'stepm': p, 'target_selected': sum(x['targetSelected'] for x in g) / n,
                           'target_dropped': sum(not x['targetKept'] for x in g), 'pc': sum(rej_pc(x) for x in g) / n})
        if mde is None and p >= 0.8: mde = d
    S.setdefault('mde', {})[c] = f'{mde}%' if mde is not None else '> 40%'

# ── 輔助 3:涵蓋率 ──
for c in CASES:
    try: S['coverage'][c] = json.load(open(f'out/coverage_{c}.json'))
    except FileNotFoundError: pass

# ── 輔助 4:B=5000 vs B=1000(同一批 500 條路徑)──
b5 = load('out/bcmp_A_L20.jsonl')
if b5:
    g1 = {x['path']: x for x in load('out/gate_A_L20.jsonl')}
    pairs = [(g1[x['path']], x) for x in b5 if x['path'] in g1]
    n = len(pairs)
    r1c = sum(rej_pc(a) for a, _ in pairs) / n; r5c = sum(rej_pc(b) for _, b in pairs) / n
    r1s = sum(a['stepm'] > 0 for a, _ in pairs) / n; r5s = sum(b['stepm'] > 0 for _, b in pairs) / n
    S['bcmp'] = {'paths': n, 'B1000_pc': r1c, 'B5000_pc': r5c, 'B1000_stepm': r1s, 'B5000_stepm': r5s,
                 'flag': abs(r1c - r5c) > 0.01 or abs(r1s - r5s) > 0.01,
                 'disagree': sum(rej_pc(a) != rej_pc(b) for a, b in pairs)}

json.dump(S, open('out/summary.json', 'w'), ensure_ascii=False, indent=1)

pct = lambda v: f'{v*100:5.2f}%'
L_ = ['── 正式閘門(GARCH 虛無,每格 4000 條;門檻 6%)──',
      f'{"case":7}{"L":>5}{"n":>6}{"K":>5}  {"consist":>8}{"95%CI":>16}  {"StepM":>7}{"95%CI":>16}  判定']
for e in S['gate']:
    tag = ('過' if e['cell_pass'] else '✗') if e['gate'] else '(參考)'
    L_.append(f'{e["case"]:7}{e["L"]:>5}{e["n"]:>6}{e["K_mean"]:>5.1f}  {pct(e["pc"]):>8} {pct(e["pc_ci"][0])}–{pct(e["pc_ci"][1])}  {pct(e["stepm"]):>7} {pct(e["stepm_ci"][0])}–{pct(e["stepm_ci"][1])}  {tag}')
L_.append('K=0(資料不足、不檢定)的路徑數:' + ', '.join(f"{e['case']} L={e['L']}:{e['K0']}" for e in S['gate'] if e['K0']))
L_.append(f'閘門完整:{complete};通過:{S["gate_pass"]};超標格:{S["gate_fail_cells"]}')
L_.append('── 輔助 1:循環位移(各 2000 次)──')
for e in S['shift']:
    L_.append(f'{e["etf"]:7}L={e["L"]:>4} n={e["n"]} K={e["K"]}  consistent {pct(e["pc"])}  StepM {pct(e["stepm"])}')
L_.append(f'事先登記的預測(L∈5–60 皆 ≤6%)成立:{S["shift_prediction_holds"]};不成立:{S["shift_prediction_fail"]}')
L_.append('── 輔助 2:檢定力(L=20,各 500 次)──')
for e in S['power']:
    L_.append(f'{e["case"]:7}δ={e["delta"]:>3}%  StepM 有效 {pct(e["stepm"])}  選中目標 {pct(e["target_selected"])}  目標被剔除 {e["target_dropped"]}')
L_.append(f'最小可偵測優勢(StepM 有效 ≥ 80%):{S.get("mde")}')
L_.append('── 輔助 3:涵蓋率 ──')
for c, v in S['coverage'].items():
    L_.append(f'{c}: 真值 {v["truth"]*100:.2f}%  涵蓋 {v["covered"]}/{v["withCI"]} = {pct(v["coverage"])}  N_eff<5 的路徑 {v["tooFew"]}  N_eff 中位數 {v["neffMedian"]}')
L_.append(f'── 輔助 4:B 對照 ── {S["bcmp"]}')
open('out/summary.txt', 'w').write('\n'.join(L_) + '\n')
print('\n'.join(L_))
