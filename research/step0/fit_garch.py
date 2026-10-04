# 用真實 0050 含息日報酬估計 GJR-GARCH(1,1)-t 參數,給 Step 0 的「GARCH 虛無」模擬用。
# 為什麼用 GJR(非對稱)而不是純 GARCH(1,1):台股有「跌的時候波動放大」的槓桿效果,
# 這正是設計文件 8.1 擔心的「回檔期間波動較大」,模擬要把它保留下來才算嚴格。
# 為什麼用 t 分配:真實報酬厚尾(8.1 的因素 c)。
import json, numpy as np, pandas as pd
from arch import arch_model
df = pd.read_csv('data/0050_ret.csv')
r = df.total_ret.values[1:] * 100  # arch 慣例用百分比,數值較穩定
res = arch_model(r, mean='Constant', vol='GARCH', p=1, o=1, q=1, dist='t').fit(disp='off')
print(res.summary())
p = res.params
out = {'mu': p['mu']/100, 'omega': p['omega']/1e4, 'alpha': p['alpha[1]'], 'gamma': p['gamma[1]'],
       'beta': p['beta[1]'], 'nu': p['nu'], 'source': '0050 含息日報酬 2003-07-01~2026-10-02, n=%d' % len(r)}
json.dump(out, open('garch_params.json', 'w'), indent=2)
print(out)

# ── 變異數目標化(variance targeting)──
# 為什麼:估出來的持續度 α+γ/2+β ≈ 0.995 非常接近 1,隱含的「無條件變異數」ω/(1−持續度)
# 會被 ω 的小誤差放大(實測模擬年化波動約 29%,真實 0050 約 20%)。波動水準直接影響
# 「多常跌到門檻」,所以把 ω 改成讓無條件變異數等於樣本變異數,其他參數維持 MLE 估計值。
persist = out['alpha'] + out['gamma'] / 2 + out['beta']
var_s = float(np.var(r / 100))
out['omega_mle'] = out['omega']
out['omega'] = var_s * (1 - persist)
out['persistence'] = persist
out['sample_daily_var'] = var_s
out['note'] = 'omega 已做變異數目標化:omega = 樣本變異數 × (1 − (alpha + gamma/2 + beta));omega_mle 為原始 MLE 值'
json.dump(out, open('garch_params.json', 'w'), indent=2)
print('variance targeting:', out)
