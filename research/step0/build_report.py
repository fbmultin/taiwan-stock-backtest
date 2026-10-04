# 由 out/summary.json 與 out/acf_lb.json 產生 Step 0 審閱報告(單一 HTML,圖用內嵌 SVG)。
# 判定邏輯完全照設計文件 10.1 / 10.1.1 的事前登記,這裡只負責「照規則算 + 畫出來」。
import json, html

S = json.load(open('out/summary.json'))
A = json.load(open('out/acf_lb.json'))
Ls = [1, 5, 10, 20, 60, 250]
DS = ['GARCH', '0050', '0056', '006208', '00692']
DS_LABEL = {'GARCH': 'GARCH 虛無', '0050': '0050 位移', '0056': '0056 位移', '006208': '006208 位移', '00692': '00692 位移'}
COL = {'GARCH': 'var(--s1)', '0050': 'var(--s2)', '0056': 'var(--s3)', '006208': 'var(--s4)', '00692': 'var(--s5)'}
null = {(e['name'], e['L']): e for e in S['null']}
power = {(e['name'], e['L']): e for e in S['power']}

# ── 依事前登記判定 ──
def passes(L):
    return all((ds, L) in null and null[(ds, L)]['pass'] for ds in DS)
pass_by_L = {L: passes(L) for L in Ls}
if pass_by_L[20]: chosen, verdict = 20, 'pass'
else:
    longer = [L for L in Ls if L > 20 and pass_by_L[L]]
    chosen, verdict = (longer[0], 'pass_longer') if longer else (None, 'fail')

def pct(v, d=1): return f'{v*100:.{d}f}%'

# ── SVG:拒絕率對 L(對數刻度的類別軸,等距放 6 個 L)──
def line_chart(metric, title):
    W, H, l, r, t, b = 560, 300, 48, 16, 20, 40
    ymax = 0.28
    x = lambda i: l + i * (W - l - r) / (len(Ls) - 1)
    y = lambda v: t + (1 - min(v, ymax) / ymax) * (H - t - b)
    g = []
    for v in [0, 0.04, 0.08, 0.12, 0.16, 0.20, 0.24, 0.28]:
        g.append(f'<line x1="{l}" x2="{W-r}" y1="{y(v):.1f}" y2="{y(v):.1f}" class="grid"/>'
                 f'<text x="{l-6}" y="{y(v)+4:.1f}" class="tick" text-anchor="end">{int(v*100)}%</text>')
    g.append(f'<rect x="{l}" y="{t}" width="{W-l-r}" height="{y(0.06)-t:.1f}" class="danger"/>')
    g.append(f'<line x1="{l}" x2="{W-r}" y1="{y(0.06):.1f}" y2="{y(0.06):.1f}" class="limit"/>'
             f'<text x="{W-r-4}" y="{y(0.06)-5:.1f}" class="lim-t" text-anchor="end">通過門檻 6%</text>')
    g.append(f'<line x1="{l}" x2="{W-r}" y1="{y(0.05):.1f}" y2="{y(0.05):.1f}" class="nominal"/>'
             f'<text x="{l+4}" y="{y(0.05)+13:.1f}" class="nom-t">名目 5%</text>')
    for i, L in enumerate(Ls):
        g.append(f'<text x="{x(i):.1f}" y="{H-b+18}" class="tick" text-anchor="middle">L={L}</text>')
    for ds in DS:
        pts = [(x(i), y(null[(ds, L)][metric])) for i, L in enumerate(Ls) if (ds, L) in null]
        if not pts: continue
        w = 3 if ds == 'GARCH' else 1.8
        g.append(f'<polyline fill="none" stroke="{COL[ds]}" stroke-width="{w}" points="{" ".join(f"{a:.1f},{c:.1f}" for a, c in pts)}"/>')
        for a, c in pts: g.append(f'<circle cx="{a:.1f}" cy="{c:.1f}" r="{3.5 if ds=="GARCH" else 2.8}" fill="{COL[ds]}"/>')
    return f'<figure class="chart"><figcaption>{title}</figcaption><div class="scroll"><svg viewBox="0 0 {W} {H}" role="img" aria-label="{title}">{"".join(g)}</svg></div></figure>'

def power_chart():
    W, H, l, r, t, b = 560, 260, 48, 16, 20, 40
    x = lambda i: l + i * (W - l - r) / (len(Ls) - 1)
    y = lambda v: t + (1 - v) * (H - t - b)
    g = []
    for v in [0, .25, .5, .75, 1]:
        g.append(f'<line x1="{l}" x2="{W-r}" y1="{y(v):.1f}" y2="{y(v):.1f}" class="grid"/><text x="{l-6}" y="{y(v)+4:.1f}" class="tick" text-anchor="end">{int(v*100)}%</text>')
    for i, L in enumerate(Ls): g.append(f'<text x="{x(i):.1f}" y="{H-b+18}" class="tick" text-anchor="middle">L={L}</text>')
    cols = {0.05: 'var(--p1)', 0.1: 'var(--p2)', 0.2: 'var(--p3)'}
    for ann in [0.05, 0.1, 0.2]:
        pts = [(x(i), y(power[(ann, L)]['stepm'])) for i, L in enumerate(Ls) if (ann, L) in power]
        if not pts: continue
        g.append(f'<polyline fill="none" stroke="{cols[ann]}" stroke-width="2.4" points="{" ".join(f"{a:.1f},{c:.1f}" for a, c in pts)}"/>')
        for a, c in pts: g.append(f'<circle cx="{a:.1f}" cy="{c:.1f}" r="3" fill="{cols[ann]}"/>')
    leg = ''.join(f'<span><i style="background:{cols[a]}"></i>年化 +{int(a*100)}%</span>' for a in [0.05, 0.1, 0.2])
    return f'<figure class="chart"><figcaption>檢定力:StepM 判定「有效」的比例</figcaption><div class="scroll"><svg viewBox="0 0 {W} {H}" role="img">{"".join(g)}</svg></div><div class="legend">{leg}</div></figure>'

def hist_chart(key, title):
    h = S['pc_hist'].get(key)
    if not h: return ''
    W, H, l, r, t, b = 270, 170, 30, 8, 14, 30
    n = sum(h); exp = n / 10; m = max(max(h), exp) * 1.15
    bw = (W - l - r) / 10; g = []
    for i, c in enumerate(h):
        hh = c / m * (H - t - b)
        g.append(f'<rect x="{l+i*bw+1:.1f}" y="{H-b-hh:.1f}" width="{bw-2:.1f}" height="{hh:.1f}" class="bar"/>')
    ye = H - b - exp / m * (H - t - b)
    g.append(f'<line x1="{l}" x2="{W-r}" y1="{ye:.1f}" y2="{ye:.1f}" class="limit"/>')
    for v in [0, .5, 1]: g.append(f'<text x="{l+v*(W-l-r):.1f}" y="{H-b+15}" class="tick" text-anchor="middle">{v:g}</text>')
    return f'<figure class="chart small"><figcaption>{title}</figcaption><svg viewBox="0 0 {W} {H}" role="img">{"".join(g)}</svg></figure>'

def acf_chart():
    W, H, l, r, t, b = 560, 220, 44, 16, 16, 34
    lags = list(range(1, 21)); ymax = 0.08
    x = lambda j: l + (j - 1) * (W - l - r) / 19
    y = lambda v: t + (ymax - max(-ymax, min(ymax, v))) / (2 * ymax) * (H - t - b)
    g = [f'<line x1="{l}" x2="{W-r}" y1="{y(0):.1f}" y2="{y(0):.1f}" class="axis"/>']
    for v in [-0.08, -0.04, 0, 0.04, 0.08]: g.append(f'<text x="{l-6}" y="{y(v)+4:.1f}" class="tick" text-anchor="end">{v:+.2f}</text>')
    for j in [1, 5, 10, 15, 20]: g.append(f'<text x="{x(j):.1f}" y="{H-b+18}" class="tick" text-anchor="middle">落後 {j}</text>')
    a = A['0050']
    band = [(x(j), y(a['acf_p95'][j-1])) for j in lags] + [(x(j), y(a['acf_p05'][j-1])) for j in reversed(lags)]
    g.append(f'<polygon points="{" ".join(f"{p:.1f},{q:.1f}" for p, q in band)}" class="band"/>')
    g.append(f'<polyline fill="none" stroke="var(--s2)" stroke-width="2.2" points="{" ".join(f"{x(j):.1f},{y(a["acf_median"][j-1]):.1f}" for j in lags)}"/>')
    gm = A['garch_summary']['acf_median_avg']
    g.append(f'<polyline fill="none" stroke="var(--s1)" stroke-width="2" stroke-dasharray="5 4" points="{" ".join(f"{x(j):.1f},{y(gm[j-1]):.1f}" for j in lags)}"/>')
    leg = '<span><i style="background:var(--s2)"></i>0050 真實 d:各規則中位數(陰影 = 5%–95% 規則)</span><span><i class="dash"></i>GARCH 虛無 20 條路徑的中位數</span>'
    return f'<figure class="chart"><figcaption>d 的自相關函數(0050,未位移)</figcaption><div class="scroll"><svg viewBox="0 0 {W} {H}" role="img">{"".join(g)}</svg></div><div class="legend">{leg}</div></figure>'

# ── 表格 ──
def null_table():
    rows = []
    for ds in DS:
        for L in Ls:
            e = null.get((ds, L))
            if not e: continue
            def cell(k):
                v = e[k]; lo, hi = e[k + '_ci']; cls = 'bad' if v > 0.06 else ''
                return f'<td class="num {cls}">{pct(v)}<small>{pct(lo,1)}–{pct(hi,1)}</small></td>'
            mark = '<span class="pill ok">通過</span>' if e['pass'] else '<span class="pill no">未通過</span>'
            hl = ' class="hl"' if L == 20 else ''
            rows.append(f'<tr{hl}><td>{DS_LABEL[ds]}</td><td class="num">{L}</td><td class="num">{e["n"]}</td><td class="num">{e["K_mean"]:.0f}</td>'
                        f'<td class="num muted">{pct(e["pl"])}</td>{cell("pc")}<td class="num muted">{pct(e["pu"])}</td>{cell("stepm")}<td>{mark}</td></tr>')
    return ('<div class="scroll"><table><thead><tr><th>虛無</th><th>L</th><th>次數</th><th>平均K</th><th>SPA lower</th><th>SPA consistent<br><small>95% CI</small></th><th>SPA upper</th><th>StepM 非空<br><small>95% CI</small></th><th>判定</th></tr></thead><tbody>'
            + ''.join(rows) + '</tbody></table></div>')

def power_table():
    rows = []
    for ann in [0.05, 0.1, 0.2]:
        cells = ''.join(f'<td class="num">{pct(power[(ann, L)]["stepm"])}<small>SPA {pct(power[(ann, L)]["pc"])}</small></td>' if (ann, L) in power else '<td>—</td>' for L in Ls)
        n = power.get((ann, 20), {}).get('n', 0)
        rows.append(f'<tr><td>年化 +{int(ann*100)}%</td><td class="num">{n}</td>{cells}</tr>')
    drop = S['power_dropped']
    return ('<div class="scroll"><table><thead><tr><th>注入優勢</th><th>次數</th>' + ''.join(f'<th>L={L}</th>' for L in Ls) + '</tr></thead><tbody>'
            + ''.join(rows) + '</tbody></table></div>'
            + (f'<p class="note">另有 {sum(drop.values())} 筆因目標規則的進場次數不足 5 次被剔除,未計入上表。</p>' if drop else ''))

def lb_table():
    rows = []
    for ds in ['0050', '0056', '006208', '00692']:
        a = A[ds]
        rows.append(f'<tr><td>{ds}</td><td class="num">{a["K"]}</td><td class="num">{pct(a["lb10_rej"],0)}</td><td class="num">{pct(a["lb20_rej"],0)}</td><td class="num">{pct(a["rq10_rej"],0)}</td><td class="num">{pct(a["rq20_rej"],0)}</td><td class="num">{a["acf_maxabs_lag1_20"]:.3f}</td></tr>')
    g = A['garch_summary']
    rows.append(f'<tr class="hl"><td>GARCH 虛無(20 條平均)</td><td class="num">—</td><td class="num">{pct(g["lb10_rej_mean"],0)}</td><td class="num">{pct(g["lb20_rej_mean"],0)}</td><td class="num">{pct(g["rq10_rej_mean"],0)}</td><td class="num">{pct(g["rq20_rej_mean"],0)}</td><td class="num">{g["acf_maxabs_avg"]:.3f}</td></tr>')
    return ('<div class="scroll"><table><thead><tr><th>資料</th><th>規則數</th><th>Ljung–Box<br>10 期</th><th>Ljung–Box<br>20 期</th><th>穩健 Q<br>10 期</th><th>穩健 Q<br>20 期</th><th>|ACF| 最大<br>(落後 1–20)</th></tr></thead><tbody>'
            + ''.join(rows) + '</tbody></table></div><p class="note">表中是「p &lt; 0.05 的規則比例」。規則之間高度相關,108 條不是 108 次獨立檢定。</p>')

g20 = null.get(('GARCH', 20), {})
verdict_html = {
    'pass': f'<div class="verdict ok"><b>依事前登記的標準:通過</b><p>預設 L=20 在五組虛無(GARCH 與四檔 ETF 循環位移)下,SPA consistent 與 StepM 的拒絕率都 ≤ 6%。維持 L=20。</p></div>',
    'pass_longer': f'<div class="verdict warn"><b>依事前登記的標準:L=20 未通過,改採 L={chosen}</b><p>L=20 至少在一組虛無下超過 6%,大於 20 且五組都通過的最小 L 是 {chosen}。</p></div>',
    'fail': '<div class="verdict no"><b>依事前登記的標準:未通過閘門</b><p>沒有任何 L 在五組虛無下都 ≤ 6%。B′ 檢定框架需要回頭討論。</p></div>',
}[verdict]
pass_strip = ''.join(f'<div class="lcell {"ok" if pass_by_L[L] else "no"}"><span>L={L}</span><b>{"通過" if pass_by_L[L] else "未通過"}</b></div>' for L in Ls)

TEMPLATE = open('report_template.html', encoding='utf-8').read()
out = (TEMPLATE.replace('{{VERDICT}}', verdict_html).replace('{{PASS_STRIP}}', pass_strip)
       .replace('{{CHART_PC}}', line_chart('pc', 'SPA consistent p ≤ 0.05 的比例'))
       .replace('{{CHART_STEPM}}', line_chart('stepm', 'StepM 選出至少一條規則的比例'))
       .replace('{{LEGEND}}', ''.join(f'<span><i style="background:{COL[d]}"></i>{DS_LABEL[d]}</span>' for d in DS))
       .replace('{{NULL_TABLE}}', null_table())
       .replace('{{HISTS}}', hist_chart('GARCH|20', 'GARCH 虛無,L=20') + hist_chart('0050|20', '0050 位移,L=20') + hist_chart('GARCH|1', 'GARCH 虛無,L=1') + hist_chart('GARCH|250', 'GARCH 虛無,L=250'))
       .replace('{{POWER_CHART}}', power_chart()).replace('{{POWER_TABLE}}', power_table())
       .replace('{{ACF_CHART}}', acf_chart()).replace('{{LB_TABLE}}', lb_table())
       .replace('{{N_GARCH}}', str(g20.get('n', 0))))
# 文字解讀是人寫的(看完數字才寫),放在獨立檔案,避免和自動計算的判定混在一起
import os
for k, f in [('{{INTERP}}', 'interp.html'), ('{{ACF_INTERP}}', 'acf_interp.html')]:
    out = out.replace(k, open(f, encoding='utf-8').read() if os.path.exists(f) else '')
open('out/step0_report.html', 'w', encoding='utf-8').write(out)
print('verdict', verdict, chosen, pass_by_L)
