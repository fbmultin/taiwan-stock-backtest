"""修正研究用資料快照的含息報酬(設計文件 13.12)。

錯誤:快照的 total_ret 在「分割之前的除息日」把原始單位的配息直接加到分割校正後的價格上,
沒有一起除以分割倍數,那幾天的報酬被高估(0050、0052)。
修正規則:日期早於分割日時,除息金額先除以分割倍數,再算
    (close_split_adj + 修正後除息) / 前一日 close_split_adj − 1;
其餘日期與原本的 total_ret 完全相同(字串照抄)。

為什麼是「新增欄位/檔案」而不是改原檔:已記錄的 Step 0 結果與原始輸出雜湊要能重現(13.12 決定 1)。
既有欄位一個字都不改,只在最後面加一欄 total_ret_fixed(Step 0 的程式是用欄位位置讀第 5 欄,
加在最後面不影響重跑)。

用法(在 repo 根目錄):python3 research/fix_snapshots.py
會改寫 research/step0_rerun/data/*.csv(加欄)並產生 research/step0/data/0050_ret_fixed.csv,
最後印出驗證數字。重複執行結果相同(已有 total_ret_fixed 欄時先去掉再重算)。
"""
import csv, io, math, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RERUN = os.path.join(ROOT, 'research', 'step0_rerun', 'data')
STEP0 = os.path.join(ROOT, 'research', 'step0', 'data')
SYMBOLS = ['0050', '0051', '0052', '0053', '0055', '0057', '006201', '006203', '006204']


def load_splits():
    """從 app 的分割表讀分割日與倍數(只取 type='split';快照涉及的只有 0050、0052)。"""
    src = open(os.path.join(ROOT, 'src', 'data', 'twStockSplits.js'), encoding='utf-8').read()
    out = {}
    for m in re.finditer(r"symbol:\s*'([^']+)',\s*date:\s*'([^']+)',\s*type:\s*'(\w+)',\s*ratio:\s*([\d.]+)", src):
        sym, date, typ, ratio = m.group(1), m.group(2), m.group(3), float(m.group(4))
        if sym in SYMBOLS:
            out.setdefault(sym, []).append((date, typ, ratio))
    return out


def fix_rerun(sym, splits):
    path = os.path.join(RERUN, f'{sym}.csv')
    lines = open(path, encoding='utf-8').read().rstrip('\n').split('\n')
    header = lines[0].split(',')
    if header[-1] == 'total_ret_fixed':  # 重複執行:先還原成原始欄位
        lines = [','.join(l.split(',')[:-1]) for l in lines]
        header = header[:-1]
    assert header == ['date', 'close_raw', 'close_split_adj', 'div', 'total_ret'], header
    rows = [l.split(',') for l in lines[1:]]
    ev = [(d, r) for d, t, r in splits.get(sym, []) if t == 'split']
    assert len(ev) <= 1, f'{sym} 有多次分割,本程式未處理'
    out = [lines[0] + ',total_ret_fixed']
    stats = {'affected': 0, 'max_over_pp': 0.0, 'cum_old': 1.0, 'cum_new': 1.0, 'min_new': math.inf, 'max_new': -math.inf}
    fixed_by_date = {}
    for i, r in enumerate(rows):
        date, _, adj, div, tr = r
        new = tr
        if i > 0 and ev and date < ev[0][0] and float(div) > 0:
            prev = float(rows[i - 1][2])
            val = (float(adj) + float(div) / ev[0][1]) / prev - 1
            new = repr(val)
            stats['affected'] += 1
            stats['max_over_pp'] = max(stats['max_over_pp'], (float(tr) - val) * 100)
        out.append(','.join(r) + ',' + new)
        fixed_by_date[date] = (adj, new, tr != new)
        if i > 0:
            stats['cum_old'] *= 1 + float(tr)
            stats['cum_new'] *= 1 + float(new)
            stats['min_new'] = min(stats['min_new'], float(new))
            stats['max_new'] = max(stats['max_new'], float(new))
    open(path, 'w', encoding='utf-8').write('\n'.join(out) + '\n')
    stats['identical'] = all(not c for _, _, c in fixed_by_date.values())
    # 年化用日曆年數(首日到末日),和 13.12「年化約 14.9%」同一算法
    from datetime import date as _d
    y0, y1 = (_d.fromisoformat(rows[0][0]), _d.fromisoformat(rows[-1][0]))
    stats['years'] = (y1 - y0).days / 365.25
    return stats, fixed_by_date


def fix_step0_0050(fixed_by_date):
    """第一次 Step 0 的 0050_ret.csv(total_ret 與重跑快照逐日相同,同樣有誤)→ 新增 0050_ret_fixed.csv。
    受影響的日子用修正值;其餘日子照抄 0050_ret.csv 原本(較高精度)的 total_ret。"""
    src = list(csv.reader(open(os.path.join(STEP0, '0050_ret.csv'), encoding='utf-8')))
    assert src[0] == ['date', 'close_split_adj', 'total_ret']
    lines = ['date,close_split_adj,total_ret_fixed']
    changed = 0
    for date, adj, tr in src[1:]:
        _, new, is_changed = fixed_by_date[date]
        if is_changed:
            changed += 1
            assert abs(float(adj) - float(fixed_by_date[date][0])) < 1e-9
            lines.append(f'{date},{adj},{new}')
        else:
            assert abs(float(tr) - float(new)) < 1e-9, date
            lines.append(f'{date},{adj},{tr}')
    open(os.path.join(STEP0, '0050_ret_fixed.csv'), 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
    return changed, len(src) - 1


if __name__ == '__main__':
    splits = load_splits()
    print('分割表中涉及快照的標的:', {k: v for k, v in splits.items()})
    fixed0050 = None
    for sym in SYMBOLS:
        s, fixed = fix_rerun(sym, splits)
        if sym == '0050':
            fixed0050 = fixed
        if s['affected']:
            ann = s['cum_new'] ** (1 / s['years']) - 1
            print(f"{sym}: 受影響 {s['affected']} 天,單日最多高估 {s['max_over_pp']:.1f} 個百分點;"
                  f"全期累積 {s['cum_old']:.1f} 倍 → {s['cum_new']:.1f} 倍(年化約 {ann*100:.1f}%,以日曆年數計);"
                  f"修正後單日報酬介於 {s['min_new']*100:.2f}% 與 {s['max_new']*100:.2f}%")
        else:
            print(f"{sym}: 沒有分割,total_ret_fixed 與 total_ret 完全相同 = {s['identical']}")
    changed, n = fix_step0_0050(fixed0050)
    print(f'research/step0/data/0050_ret_fixed.csv:{n} 列,其中 {changed} 列為修正值,其餘照抄 0050_ret.csv')
