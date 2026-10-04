# 由 out/summary.json 產生 Step 0 重跑審閱報告(單一 HTML,內嵌 SVG)。格式沿用上次 Step 0 報告。
# 判定只依 13.6;本程式不做任何放寬。文字解讀放在 interp.html(看完數字後人工撰寫)。
import json, os, html

S = json.load(open('out/summary.json'))
CASES = ['0051', '0055', '006201', 'A']
CL = {'0051': '0051 中型100', '0055': '0055 MSCI金融', '006201': '006201 富櫃50', 'A': '案例 A(0050 參數)'}
COL = {'0051': 'var(--s2)', '0055': 'var(--s3)', '006201': 'var(--s4)', 'A': 'var(--s1)'}
LS = [1, 5, 10, 20, 60, 250]; GL = [5, 10, 20, 60]
G = {(e['case'], e['L']): e for e in S['gate']}
pct = lambda v, d=1: f'{v*100:.{d}f}%'


def line_chart(metric, title, data, keys, labels, cols, ymax=0.12):
    W, H, l, r, t, b = 560, 290, 48, 16, 20, 40
    x = lambda i: l + i * (W - l - r) / (len(LS) - 1)
    y = lambda v: t + (1 - min(v, ymax) / ymax) * (H - t - b)
    g = [f'<rect x="{l}" y="{t}" width="{W-l-r}" height="{y(0.06)-t:.1f}" class="danger"/>']
    for v in [i / 100 for i in range(0, int(ymax * 100) + 1, 2)]:
        g.append(f'<line x1="{l}" x2="{W-r}" y1="{y(v):.1f}" y2="{y(v):.1f}" class="grid"/><text x="{l-6}" y="{y(v)+4:.1f}" class="tick" text-anchor="end">{int(round(v*100))}%</text>')
    g.append(f'<line x1="{l}" x2="{W-r}" y1="{y(0.06):.1f}" y2="{y(0.06):.1f}" class="limit"/><text x="{W-r-4}" y="{y(0.06)-5:.1f}" class="lim-t" text-anchor="end">門檻 6%</text>')
    g.append(f'<line x1="{l}" x2="{W-r}" y1="{y(0.05):.1f}" y2="{y(0.05):.1f}" class="nominal"/>')
    for i, L in enumerate(LS):
        cls = 'tick strong' if L in GL else 'tick'
        g.append(f'<text x="{x(i):.1f}" y="{H-b+18}" class="{cls}" text-anchor="middle">L={L}</text>')
    for k in keys:
        pts = [(x(i), y(data[(k, L)][metric])) for i, L in enumerate(LS) if (k, L) in data]
        if not pts: continue
        g.append(f'<polyline fill="none" stroke="{cols[k]}" stroke-width="2.2" points="{" ".join(f"{a:.1f},{c:.1f}" for a, c in pts)}"/>')
        g += [f'<circle cx="{a:.1f}" cy="{c:.1f}" r="3" fill="{cols[k]}"/>' for a, c in pts]
    leg = ''.join(f'<span><i style="background:{cols[k]}"></i>{labels[k]}</span>' for k in keys)
    return f'<figure class="chart"><figcaption>{title}</figcaption><div class="scroll"><svg viewBox="0 0 {W} {H}" role="img" aria-label="{title}">{"".join(g)}</svg></div><div class="legend">{leg}</div></figure>'


def gate_table():
    rows = []
    for c in CASES:
        for L in LS:
            e = G.get((c, L))
            if not e: continue
            def cell(k):
                v = e[k]; lo, hi = e[k + '_ci']; bad = ' bad' if (e['gate'] and v > 0.06) else ''
                return f'<td class="num{bad}">{pct(v,2)}<small>{pct(lo,2)}–{pct(hi,2)}</small></td>'
            if e['gate']: mark = '<span class="pill ok">通過</span>' if e['cell_pass'] else '<span class="pill no">超標</span>'
            else: mark = '<span class="pill ref">參考</span>'
            rows.append(f'<tr class="{"hl" if L == 20 else ""}{" ref" if not e["gate"] else ""}"><td>{CL[c]}</td><td class="num">{L}</td><td class="num">{e["n"]:,}</td><td class="num">{e["K_mean"]:.1f}</td><td class="num">{e["paths"]:,}</td>{cell("pc")}{cell("stepm")}<td class="num muted">{pct(e["pl"])}</td><td class="num muted">{pct(e["pu"])}</td><td>{mark}</td></tr>')
    return ('<div class="scroll"><table><thead><tr><th>虛無</th><th>L</th><th>n</th><th>平均 K</th><th>路徑</th><th>SPA consistent<br><small>95% CI</small></th><th>StepM 非空<br><small>95% CI</small></th><th>lower</th><th>upper</th><th>判定</th></tr></thead><tbody>'
            + ''.join(rows) + '</tbody></table></div>')


def shift_section():
    SH = {(e['etf'], e['L']): e for e in S['shift']}
    etfs = list(dict.fromkeys(e['etf'] for e in S['shift']))
    pal = ['var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)', 'var(--s9)']
    cols = {e: pal[i % len(pal)] for i, e in enumerate(etfs)}
    chart = line_chart('pc', 'SPA consistent p ≤ 0.05 的比例(循環位移,各 2000 次)', SH, etfs, {e: e for e in etfs}, cols, ymax=0.2)
    rows = ''.join(f'<tr><td>{e}</td><td class="num">{SH[(e,5)]["n"]:,}</td><td class="num">{SH[(e,5)]["K"]}</td><td class="num">≈{SH[(e,5)]["indep_approx"]:.0f}</td>'
                   + ''.join(f'<td class="num{" bad" if (L in GL and max(SH[(e,L)]["pc"],SH[(e,L)]["stepm"])>0.06) else ""}">{pct(SH[(e,L)]["pc"])}</td>' for L in LS) + '</tr>' for e in etfs)
    tbl = ('<div class="scroll"><table><thead><tr><th>ETF</th><th>n</th><th>K</th><th>獨立位移約</th>' + ''.join(f'<th>L={L}</th>' for L in LS)
           + '</tr></thead><tbody>' + rows + '</tbody></table></div><p class="note">表中為 SPA consistent;StepM 與它相差很小,超標判斷取兩者較大值。紅字 = 事先登記的預測(L=5–60 皆 ≤ 6%)不成立的格。</p>')
    verdict = ('<p><b>事先登記的預測成立。</b></p>' if S['shift_prediction_holds'] else
               '<p><b>事先登記的預測不成立</b>:' + '、'.join(html.escape(x) for x in S['shift_prediction_fail']) + '。依 13.6,這部分只是輔助報告,不影響閘門判定,但一律公開。</p>')
    return chart + verdict + tbl


def power_section():
    PW = {(e['case'], e['delta']): e for e in S['power']}
    D = [5, 10, 15, 20, 30, 40]
    W, H, l, r, t, b = 560, 260, 48, 16, 20, 40
    x = lambda i: l + i * (W - l - r) / (len(D) - 1); y = lambda v: t + (1 - v) * (H - t - b)
    g = [f'<line x1="{l}" x2="{W-r}" y1="{y(.8):.1f}" y2="{y(.8):.1f}" class="limit"/><text x="{W-r-4}" y="{y(.8)-5:.1f}" class="lim-t" text-anchor="end">80%</text>']
    for v in [0, .25, .5, .75, 1]: g.append(f'<line x1="{l}" x2="{W-r}" y1="{y(v):.1f}" y2="{y(v):.1f}" class="grid"/><text x="{l-6}" y="{y(v)+4:.1f}" class="tick" text-anchor="end">{int(v*100)}%</text>')
    for i, d in enumerate(D): g.append(f'<text x="{x(i):.1f}" y="{H-b+18}" class="tick" text-anchor="middle">+{d}%</text>')
    for c in CASES:
        pts = [(x(i), y(PW[(c, d)]['stepm'])) for i, d in enumerate(D) if (c, d) in PW]
        if pts:
            g.append(f'<polyline fill="none" stroke="{COL[c]}" stroke-width="2.2" points="{" ".join(f"{a:.1f},{b_:.1f}" for a, b_ in pts)}"/>')
            g += [f'<circle cx="{a:.1f}" cy="{b_:.1f}" r="3" fill="{COL[c]}"/>' for a, b_ in pts]
    leg = ''.join(f'<span><i style="background:{COL[c]}"></i>{CL[c]}</span>' for c in CASES)
    chart = f'<figure class="chart"><figcaption>StepM 判「有效」的比例 vs 注入的年化優勢(L=20,各 500 次)</figcaption><div class="scroll"><svg viewBox="0 0 {W} {H}" role="img">{"".join(g)}</svg></div><div class="legend">{leg}</div></figure>'
    rows = ''.join(f'<tr><td>{CL[c]}</td>' + ''.join(f'<td class="num">{pct(PW[(c,d)]["stepm"],0)}<small>選中目標 {pct(PW[(c,d)]["target_selected"],0)}</small></td>' for d in D)
                   + f'<td class="num"><b>{S["mde"][c]}</b></td></tr>' for c in CASES if (c, 5) in PW)
    drops = sum(e['target_dropped'] for e in S['power'])
    return chart + ('<div class="scroll"><table><thead><tr><th>case</th>' + ''.join(f'<th>+{d}%</th>' for d in D) + '<th>最小可偵測優勢</th></tr></thead><tbody>' + rows
                    + f'</tbody></table></div><p class="note">最小可偵測優勢 = StepM 判「有效」機率 ≥ 80% 的最小 δ(13.6 定義)。目標規則因進場不足 5 次被剔除的路徑共 {drops} 條,仍計入分母、照常檢定但未注入。</p>')


def cov_section():
    rows = ''.join(f'<tr><td>{CL[c]}</td><td class="num">{v["truth"]*100:.2f}%</td><td class="num">{v["withCI"]:,} / {v["paths"]:,}</td><td class="num"><b>{pct(v["coverage"])}</b></td><td class="num">{v["neffMedian"]:.0f}</td><td class="num">{v["widthMedian"]*100:.1f} 個百分點</td></tr>'
                   for c, v in S['coverage'].items())
    return ('<div class="scroll"><table><thead><tr><th>case</th><th>真值(母體中位數)</th><th>有給區間的路徑</th><th>名目 90% 區間實際涵蓋率</th><th>N_eff 中位數</th><th>區間寬度中位數</th></tr></thead><tbody>'
            + rows + '</tbody></table></div>')


def garch_table():
    rows = ''
    for c in CASES:
        p = S['garch'][c]
        meth = 'VT-MLE' if c != 'A' else '沿用上次(MLE 後替換 ω)'
        rows += f'<tr><td>{CL[c]}</td><td>{meth}</td><td class="num">{p["mu"]*252*100:.1f}%</td><td class="num">{p["alpha"]:.4f}</td><td class="num">{p["gamma"]:.4f}</td><td class="num">{p["beta"]:.4f}</td><td class="num"><b>{p["persistence"]:.4f}</b></td><td class="num"><b>{p["nu"]:.2f}</b></td><td class="num">{(p["sample_daily_var"]*252)**.5*100:.1f}%</td></tr>'
    return ('<div class="scroll"><table><thead><tr><th>case</th><th>估計方法</th><th>年化平均</th><th>α</th><th>γ</th><th>β</th><th>持續度</th><th>t 自由度</th><th>年化波動(目標)</th></tr></thead><tbody>'
            + rows + '</tbody></table></div><p class="note">案例 A 依 13.6 沿用上次 Step 0 的參數、不重估,估計方法和三檔不同(上次:先 MLE,再把 ω 換成 樣本變異數×(1−持續度))。</p>')


def hists():
    out = ''
    for c in CASES:
        h = S['pc_hist'].get(f'{c}|20')
        if not h: continue
        W, H, l, r, t, b = 270, 160, 30, 8, 14, 28
        n = sum(h); exp = n / 10; m = max(max(h), exp) * 1.15; bw = (W - l - r) / 10
        g = [f'<rect x="{l+i*bw+1:.1f}" y="{H-b-v/m*(H-t-b):.1f}" width="{bw-2:.1f}" height="{v/m*(H-t-b):.1f}" class="bar"/>' for i, v in enumerate(h)]
        ye = H - b - exp / m * (H - t - b)
        g.append(f'<line x1="{l}" x2="{W-r}" y1="{ye:.1f}" y2="{ye:.1f}" class="limit"/>')
        g += [f'<text x="{l+v*(W-l-r):.1f}" y="{H-b+15}" class="tick" text-anchor="middle">{v:g}</text>' for v in (0, .5, 1)]
        out += f'<figure class="chart small"><figcaption>{CL[c]},L=20</figcaption><svg viewBox="0 0 {W} {H}" role="img">{"".join(g)}</svg></figure>'
    return out


bc = S['bcmp']
bcmp = (f'<p>案例 A、L=20、同一批 {bc["paths"]} 條路徑:SPA consistent 拒絕率 B=1000 為 {pct(bc["B1000_pc"])}、B=5000 為 {pct(bc["B5000_pc"])};'
        f'StepM 為 {pct(bc["B1000_stepm"])} 與 {pct(bc["B5000_stepm"])}。差異 {"<b>超過</b>" if bc["flag"] else "未超過"} 1 個百分點(13.6 標準)。'
        f'判定不一致的路徑 {bc["disagree"]} 條。</p>') if bc else ''

if S['gate_pass']:
    verdict = '<div class="verdict ok"><b>依 13.6:通過</b><p>32 格(三檔正式閘門與案例 A × L=5、10、20、60 × 兩個統計量)全部 ≤ 6%。</p></div>'
elif not S['gate_complete']:
    verdict = '<div class="verdict no"><b>閘門資料不完整</b><p>部分格未跑滿 4000 條,不能判定。</p></div>'
else:
    verdict = ('<div class="verdict no"><b>依 13.6:未通過</b><p>超過 6% 的格:' + '、'.join(html.escape(x) for x in S['gate_fail_cells'])
               + '。依「失敗時」:第二層不上線,頁面退回只有第一層的描述性版本,不再調整規則。</p></div>')
strip = ''.join(f'<div class="lcell {"ok" if all(G[(c,L)]["cell_pass"] for c in CASES if (c,L) in G) else "no"}"><span>L={L}</span><b>{"8/8 格通過" if all(G[(c,L)]["cell_pass"] for c in CASES if (c,L) in G) else str(sum(G[(c,L)]["pc"]<=.06 for c in CASES)+sum(G[(c,L)]["stepm"]<=.06 for c in CASES))+"/8 格"}</b></div>' for L in GL)

T = open('report_template.html', encoding='utf-8').read()
interp = open('interp.html', encoding='utf-8').read() if os.path.exists('interp.html') else ''
dq = open('dq_summary.html', encoding='utf-8').read() if os.path.exists('dq_summary.html') else ''
out = (T.replace('{{VERDICT}}', verdict).replace('{{STRIP}}', strip).replace('{{INTERP}}', interp)
       .replace('{{CHART_PC}}', line_chart('pc', 'SPA consistent p ≤ 0.05 的比例', G, CASES, CL, COL))
       .replace('{{CHART_STEPM}}', line_chart('stepm', 'StepM 選出至少一條規則的比例', G, CASES, CL, COL))
       .replace('{{GATE_TABLE}}', gate_table()).replace('{{HISTS}}', hists()).replace('{{SHIFT}}', shift_section())
       .replace('{{POWER}}', power_section()).replace('{{COVERAGE}}', cov_section()).replace('{{BCMP}}', bcmp)
       .replace('{{GARCH}}', garch_table()).replace('{{DQ}}', dq).replace('{{N_A}}', f'{G[("A",20)]["n"]:,}' if ('A', 20) in G else '—'))
open('out/step0_rerun_report.html', 'w', encoding='utf-8').write(out)
print('report written; gate_pass =', S['gate_pass'])
