# Step 0 重跑(設計文件 13.6):三檔正式閘門各自估 GJR-GARCH(1,1)-t,
# 用「變異數目標化的最大概似估計」(VT-MLE)。
#
# 為什麼不再沿用上次「先 MLE、再把 ω 換成 樣本變異數×(1−持續度)」:
#   0055 的 MLE 持續度落在 1 的邊界,替換後 ω ≤ 0,模型無法使用(2026-10-04 模擬前決定,已登記 13.6)。
# VT-MLE:估計時就令 ω = s² ×(1 − α − γ/2 − β),s² 為樣本變異數,只對 μ、α、γ、β、ν 求最大概似。
#   這樣無條件變異數一定等於樣本變異數,和上次的精神一致,而且估計本身就保證 ω > 0。
#
# 失敗判定(13.6:失敗就停止回報,不再換方法):
#   無法收斂、持續度 ≥ 0.999(貼近平穩邊界)、α/γ/β 貼近 0 的邊界、ν 貼近下限 2.1 或上限 200。
# 案例 A 依規格沿用上次 Step 0 的參數(估計方法不同,報告須註明)。
import json, sys
import numpy as np, pandas as pd
from scipy.optimize import minimize
from scipy.special import gammaln

PERSIST_MAX = 0.9999  # 最佳化時的硬限制;結果若 ≥ 0.999 視為貼邊界 → 失敗


def nll(th, r, s2v):
    mu, a, g, b, nu = th
    if a < 0 or g < 0 or b < 0 or not (2.1 < nu < 200) or a + g / 2 + b >= PERSIST_MAX:
        return 1e12
    e = r - mu
    om = s2v * (1 - a - g / 2 - b)
    s2 = np.empty_like(e)
    s2[0] = s2v
    # GJR:負的衝擊多一個 γ,保留「跌的時候波動放大」
    for t in range(1, len(e)):
        e1 = e[t - 1]
        s2[t] = om + (a + (g if e1 < 0 else 0.0)) * e1 * e1 + b * s2[t - 1]
    z2 = e * e / s2 / (nu - 2)
    ll = gammaln((nu + 1) / 2) - gammaln(nu / 2) - 0.5 * np.log(np.pi * (nu - 2)) - 0.5 * np.log(s2) - (nu + 1) / 2 * np.log1p(z2)
    return -ll.sum()


def fit(r_pct):
    s2v = float(np.var(r_pct))
    starts = [[np.mean(r_pct), 0.05, 0.08, 0.88, 5.0], [np.mean(r_pct), 0.03, 0.05, 0.90, 4.5],
              [np.mean(r_pct), 0.08, 0.10, 0.80, 6.0]]
    best = None
    for x0 in starts:  # 多組起點,避免停在局部解
        o = minimize(nll, x0, args=(r_pct, s2v), method='Nelder-Mead',
                     options={'maxiter': 8000, 'maxfev': 12000, 'xatol': 1e-7, 'fatol': 1e-7})
        if best is None or o.fun < best.fun:
            best = o
    return best, s2v


out, fail = {}, []
for sid in ['0051', '0055', '006201']:
    r = pd.read_csv(f'data/{sid}.csv').total_ret.values[1:]
    o, s2v = fit(r * 100)
    mu, a, g, b, nu = o.x
    persist = a + g / 2 + b
    prm = {'method': 'VT-MLE(變異數目標化的最大概似估計)', 'mu': mu / 100, 'alpha': a, 'gamma': g, 'beta': b, 'nu': nu,
           'persistence': persist, 'omega': (s2v / 1e4) * (1 - persist), 'sample_daily_var': s2v / 1e4,
           'loglik': -o.fun, 'converged': bool(o.success), 'optimizer_msg': o.message,
           'source': f'{sid} 含息日報酬,{len(r)} 個報酬(資料快照 research/step0_rerun/data)'}
    problems = []
    if not o.success: problems.append('最佳化未收斂:' + o.message)
    if persist >= 0.999: problems.append(f'持續度 {persist:.5f} 貼近 1')
    for k in ('alpha', 'gamma', 'beta'):
        if prm[k] < 1e-4: problems.append(f'{k} 貼近 0 的邊界')
    if nu < 2.2 or nu > 190: problems.append(f'ν={nu:.2f} 貼近邊界')
    prm['problems'] = problems
    if problems: fail.append((sid, problems))
    out[sid] = prm
    print(sid, {k: (round(v, 6) if isinstance(v, float) else v) for k, v in prm.items() if k not in ('source', 'method')})

prev = json.load(open('../step0/garch_params.json'))
prev['method'] = '沿用上次 Step 0:MLE 後以 樣本變異數×(1−持續度) 替換 ω(與三檔的 VT-MLE 不同)'
out['A'] = prev
json.dump(out, open('garch_params.json', 'w'), indent=2, ensure_ascii=False)
if fail:
    print('目標化估計失敗,依 13.6 停止:', fail)
    sys.exit(2)
print('三檔 VT-MLE 皆正常')
