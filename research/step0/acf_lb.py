# 10.1 第 4 點:d_k 的自相關函數與 Ljung–Box 檢定
# 為什麼也算 GARCH 虛無路徑:Ljung–Box 假設資料同質變異,在有波動叢聚的資料上本來就容易拒絕;
# 拿「已知沒有擇時資訊、但有波動叢聚」的 GARCH 路徑當對照,才知道真實資料的拒絕比例算不算異常。
import json, numpy as np
from statsmodels.stats.diagnostic import acorr_ljungbox
meta = json.load(open('out/d/meta.json'))
res = {}
for name, m in meta.items():
    d = np.fromfile(f'out/d/{name}.bin', dtype=np.float64).reshape(m['n'], m['K'])
    acf = np.zeros((m['K'], 30)); lb10 = []; lb20 = []; rq10 = []; rq20 = []
    for k in range(m['K']):
        x = d[:, k] - d[:, k].mean(); v = (x * x).mean()
        acf[k] = [(x[:-j] * x[j:]).mean() / v for j in range(1, 31)]
        lb = acorr_ljungbox(d[:, k], lags=[10, 20])
        lb10.append(float(lb.lb_pvalue.iloc[0])); lb20.append(float(lb.lb_pvalue.iloc[1]))
        # 異質變異穩健版 Q(Diebold 1986;Lobato、Nankervis、Savin 2001 的形式):
        # 每個落後期的樣本自共變異數,用 (1/n)Σ x_t² x_{t-j}² 當變異數,而不是假設同質變異的 γ0²。
        # 為什麼需要:原始 Ljung–Box 在波動叢聚下會大量誤報,無法區分「真的有序列相關」與「只是變異數會變」。
        n_ = len(x); q = 0.0
        for j in range(1, 21):
            g = (x[:-j] * x[j:]).sum() / n_; tau = (x[:-j]**2 * x[j:]**2).sum() / n_
            q += n_ * g * g / tau
            if j == 10: q10 = q
        from scipy.stats import chi2
        rq10.append(chi2.sf(q10, 10)); rq20.append(chi2.sf(q, 20))
    res[name] = {'K': m['K'], 'n': m['n'], 'ids': m['ids'],
                 'acf_median': np.median(acf, 0).tolist(), 'acf_p05': np.percentile(acf, 5, 0).tolist(),
                 'acf_p95': np.percentile(acf, 95, 0).tolist(), 'acf_maxabs_lag1_20': float(np.abs(acf[:, :20]).max()),
                 'lb10_rej': float(np.mean(np.array(lb10) < 0.05)), 'lb20_rej': float(np.mean(np.array(lb20) < 0.05)),
                 'rq10_rej': float(np.mean(np.array(rq10) < 0.05)), 'rq20_rej': float(np.mean(np.array(rq20) < 0.05)),
                 'acf_by_rule': acf[:, :20].round(4).tolist()}
g = [res[f'garch{s}'] for s in range(20)]
res['garch_summary'] = {'lb10_rej_mean': float(np.mean([x['lb10_rej'] for x in g])),
                        'lb20_rej_mean': float(np.mean([x['lb20_rej'] for x in g])),
                        'rq10_rej_mean': float(np.mean([x['rq10_rej'] for x in g])), 'rq20_rej_mean': float(np.mean([x['rq20_rej'] for x in g])),
                        'acf_median_avg': np.mean([x['acf_median'] for x in g], 0).tolist(),
                        'acf_maxabs_avg': float(np.mean([x['acf_maxabs_lag1_20'] for x in g]))}
json.dump(res, open('out/acf_lb.json', 'w'))
for k in ['0050', '0056', '006208', '00692']:
    r = res[k]; print(k, 'LB10 拒絕比例', round(r['lb10_rej'], 3), 'LB20', round(r['lb20_rej'], 3), '|ACF| 最大(lag1-20)', round(r['acf_maxabs_lag1_20'], 3), 'lag1 中位', round(r['acf_median'][0], 4), '穩健Q10', round(r['rq10_rej'],3), '穩健Q20', round(r['rq20_rej'],3))
s = res['garch_summary']; print('GARCH 虛無平均:LB10', round(s['lb10_rej_mean'], 3), 'LB20', round(s['lb20_rej_mean'], 3), '|ACF|max', round(s['acf_maxabs_avg'], 3), '穩健Q10', round(s['rq10_rej_mean'],3), '穩健Q20', round(s['rq20_rej_mean'],3))
