// 「回檔雷達」分頁(第一層:描述性數字 + 持股提醒)。
// 規格:docs/backtest-engine-design.md 第九章「其他畫面規則」、13.11、14.2.1、14.2.4、14.4、14.5。
//
// 畫面原則(為什麼這樣寫):
//   - 這一層只有歷史描述,沒有顯著性檢定(13.10)。所有文字只用「回檔」「檔位」「歷史描述」
//     「未經驗證」「樣本太少」這類中性詞,不用任何暗示結論的詞;唯一例外是說明列裡
//     「不提供『門檻是否有效』的判定」那一句(13.10 第 2 點的原文)。
//   - 回檔與停利都用含息還原價(13.11 第 2 項),畫面標示「含息回檔」;現價顯示市價。
//   - 持股只讀不寫(13.11 補充要求 3):只透過 pullbackData.loadPortfolioReadOnly 讀一次,
//     不呼叫任何寫入、不訂閱雲端;停利設定存在本機 pullback_settings,不寫進持股資料。
//   - 持股提醒各群組分開(13.11 第 3 項):回檔幅度與已到檔位只看代號,兩個群組相同;
//     起點、持有期間最高價與距停利點各群組各算。
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './firebase';
import { fetchStockPriceData } from './dataCache';
import { loadPortfolioData, fetchRemoteDataOnce } from './portfolioStore';
import { getLastCompletedTradingDay } from './tradingCalendar';
import { THRESHOLDS, HOLDS, computeTable, currentState, stopStatus } from './pullbackStats';
import {
  loadFullHistory,
  loadPortfolioReadOnly,
  holdingRows,
  loadSettings,
  saveSettings,
  stopPctFor,
} from './pullbackData';

export const FOOTER_TEXT = '歷史描述，未經顯著性檢定。不重疊事件群數見各格。';
export const LAYER2_TEXT = '以現有資料量，本工具只可能偵測到極大的優勢（年化約 40% 以上），因此不提供『門檻是否有效』的判定。';
export const STOP_LABEL = '自訂設定，未經檢定；預設值來自股魚公開範例。';
export const TOO_FEW_TEXT = '樣本太少，不顯示統計。';

const SOURCE_NAMES = { FinMind: 'FinMind', TWSE: '證交所', TPEx: '櫃買中心', Yahoo: 'Yahoo' };
const HOLD_LABELS = { 63: '63 日', 126: '126 日', 252: '252 日' }; // 約 3、6、12 個月(交易日)

// 百分比格式:帶正負號、一位小數。負號用 −(U+2212)和設計文件一致。
const pct = (v, digits = 1) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const s = (v * 100).toFixed(digits);
  return v > 0 ? `+${s}%` : s.replace('-', '−') + '%';
};
const pp = (v) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const s = v.toFixed(1);
  return (v > 0 ? `+${s}` : s.replace('-', '−')) + ' 個百分點';
};
const plainPct = (v) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`);
const price = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('zh-TW', { maximumFractionDigits: 2 }));
const isoDay = (d) => new Date(d).toISOString().split('T')[0];

// 預設依賴:正式環境用真的 dataCache / localStorage;測試時由 props.deps 注入假的。
const defaultDeps = () => ({
  fetchStockPriceData,
  storage: typeof window !== 'undefined' ? window.localStorage : null,
  lastCompletedTradingDay: isoDay(getLastCompletedTradingDay()),
  onAuth: (cb) => onAuthStateChanged(auth, cb),
  loadPortfolioData,
  fetchRemoteDataOnce,
});

function useTheme(isLight) {
  return useMemo(
    () => ({
      card: isLight ? 'bg-white border-slate-200' : 'bg-slate-800/60 border-slate-700',
      sub: isLight ? 'text-slate-500' : 'text-slate-400',
      strong: isLight ? 'text-slate-900' : 'text-slate-100',
      input: isLight ? 'bg-white border-slate-300 text-slate-900' : 'bg-slate-800 border-slate-600 text-slate-100',
      warn: isLight ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-amber-900/30 border-amber-700 text-amber-200',
      info: isLight ? 'bg-sky-50 border-sky-200 text-sky-900' : 'bg-sky-900/30 border-sky-800 text-sky-200',
      stateCard: isLight ? 'bg-emerald-50 border-emerald-200' : 'bg-emerald-900/20 border-emerald-800',
      holdCard: isLight ? 'bg-violet-50 border-violet-200' : 'bg-violet-900/20 border-violet-800',
      chipOn: 'bg-emerald-500 text-white border-emerald-500',
      chipOff: isLight ? 'bg-white text-slate-600 border-slate-300' : 'bg-slate-800 text-slate-300 border-slate-600',
      row: isLight ? 'border-slate-200' : 'border-slate-700',
    }),
    [isLight]
  );
}

// ── 資料來源與警示條 ──
export function SourceBar({ hist, t }) {
  if (!hist) return null;
  const name = SOURCE_NAMES[hist.source] || hist.source || '未記錄';
  return (
    <div className="space-y-2" data-testid="source-bar">
      <div className={`text-sm ${t.sub}`}>
        最近一次更新來源：<span className={`font-semibold ${t.strong}`}>{name}</span>
        <span className="mx-2">·</span>
        <span className="whitespace-nowrap">
          資料截至 <span className={`font-semibold ${t.strong}`}>{hist.series.lastDate}</span>
        </span>
      </div>
      {hist.warnings.map((w) => (
        <div key={w.text} role="alert" className={`border rounded-lg px-3 py-2 text-sm ${w.level === 'warn' ? t.warn : t.info}`}>
          {w.level === 'warn' ? '⚠ ' : ''}
          {w.text}
        </div>
      ))}
    </div>
  );
}

// ── 今日狀態卡 ──
function StateCard({ hist, N, t }) {
  const st = currentState(hist.series.adj, N);
  if (!st) {
    return (
      <div className={`border rounded-xl p-4 ${t.stateCard}`}>
        <div className={t.sub}>資料不足：少於 {N} 個交易日，還算不出回檔。</div>
      </div>
    );
  }
  const reachedText =
    st.deepestReached === null
      ? `尚未到 −${THRESHOLDS[0]}% 檔位`
      : `已到 −${st.deepestReached}% 檔位（歷史描述，未經驗證）`;
  return (
    <div className={`border rounded-xl p-4 space-y-2 ${t.stateCard}`} data-testid="state-card">
      <div className={`text-sm ${t.sub}`}>今日狀態（{N} 日窗口）</div>
      <div className={t.strong}>
        目前含息回檔 <span className="text-2xl font-bold">{pct(st.drawdown)}</span>
      </div>
      <div className={`font-semibold ${t.strong}`}>{reachedText}</div>
      <div className={t.strong}>
        {st.nextThreshold === null ? (
          <span className="font-semibold">已超過最深檔位</span>
        ) : (
          <>
            距 −{st.nextThreshold}% 檔位還差 <span className="font-bold">{pct(st.distanceToNext)}</span>
          </>
        )}
      </div>
      <div className={`text-sm ${t.sub}`}>
        市價 {price(hist.series.lastMarketPrice)} · 資料截至 {hist.series.lastDate}
      </div>
    </div>
  );
}

// ── 檔位 × 持有期的表 ──
// 手機優先:一次只看一個持有期(5 列 × 3 欄),用切換鈕換持有期,避免 15 格擠在窄螢幕上。
function StatsTable({ hist, N, t }) {
  const [h, setH] = useState(HOLDS[0]);
  const table = useMemo(() => computeTable(hist.series.adj, N), [hist, N]);
  if (table.insufficient) {
    return (
      <div className={`border rounded-xl p-4 ${t.card}`} data-testid="insufficient">
        <div className={`font-semibold ${t.strong}`}>資料不足</div>
        <div className={`text-sm ${t.sub}`}>
          目前共 {table.totalDays} 個交易日，至少需要 {table.needed} 個交易日（窗口 {N} ＋ 63）才算得出完整事件。
        </div>
      </div>
    );
  }
  const base = table.baselines[h];
  const cells = table.cells.filter((c) => c.h === h);
  return (
    <div className={`border rounded-xl p-4 space-y-3 ${t.card}`} data-testid="stats-table">
      <div className={`font-semibold ${t.strong}`}>跌到各檔位之後（歷史描述）</div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`text-sm ${t.sub}`}>持有</span>
        {HOLDS.map((x) => (
          <button key={x} onClick={() => setH(x)} className={`px-3 py-1 rounded-full border text-sm ${x === h ? t.chipOn : t.chipOff}`}>
            {HOLD_LABELS[x]}
          </button>
        ))}
        <span className={`text-xs ${t.sub}`}>（交易日，約 3、6、12 個月）</span>
      </div>
      <div className={`text-sm ${t.sub}`}>
        對照（平常任一天買，{base.n} 天）：中位數 <span className={`font-semibold ${t.strong}`}>{pct(base.median)}</span>，勝率{' '}
        <span className={`font-semibold ${t.strong}`}>{plainPct(base.winRate)}</span>
      </div>
      <div className="divide-y" style={{ borderColor: 'inherit' }}>
        {cells.map((c) => (
          <div key={c.xPct} className={`py-2 border-t first:border-t-0 ${t.row}`} data-testid={`cell-${c.xPct}-${c.h}`}>
            <div className="flex items-baseline justify-between gap-2">
              <span className={`font-bold ${t.strong}`}>−{c.xPct}% 檔位</span>
              <span className={`text-sm ${t.sub}`}>
                事件 {c.nEvents}／群 {c.nEff}
              </span>
            </div>
            {c.tooFew ? (
              <div className={`text-sm ${t.sub}`}>{TOO_FEW_TEXT}</div>
            ) : (
              <div className={`text-sm ${t.strong} grid grid-cols-1 sm:grid-cols-2 gap-x-4`}>
                <div>
                  中位數 <span className="font-bold">{pct(c.median)}</span>
                  <span className={`${t.sub} whitespace-nowrap`}>（差 {pp(c.medianDiffPp)}）</span>
                </div>
                <div>
                  勝率 <span className="font-bold">{plainPct(c.winRate)}</span>
                  <span className={`${t.sub} whitespace-nowrap`}>（差 {pp(c.winRateDiffPp)}）</span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className={`text-xs ${t.sub}`}>
        「事件」是第一次跌破該檔位的次數（去重後、之後有完整 {h} 天資料者）；「群」是不重疊事件群數，統計只用各群第一個事件。「差」是與對照的差，單位為百分點。
      </div>
    </div>
  );
}

// ── 持股提醒 ──
export function HoldingsSection({ rows, histBySymbol, settings, N, t, status }) {
  return (
    <div className={`border rounded-xl p-4 space-y-3 ${t.holdCard}`} data-testid="holdings">
      <div className={`font-semibold ${t.strong}`}>我的持股提醒（各群組分開）</div>
      {status && <div className={`text-sm ${t.sub}`}>{status}</div>}
      {rows.map((r) => {
        const hist = histBySymbol[r.symbol];
        if (!hist) {
          return (
            <div key={r.key} className={`text-sm ${t.sub}`}>
              {r.symbol}（{r.groupName}）：讀取中…
            </div>
          );
        }
        if (hist.error) {
          return (
            <div key={r.key} className={`text-sm ${t.sub}`}>
              {r.symbol}（{r.groupName}）：{hist.error}
            </div>
          );
        }
        const st = currentState(hist.series.adj, N);
        const stopPct = stopPctFor(settings, r.groupId, r.symbol);
        const ss = stopStatus(hist.series.dates, hist.series.adj, r.startDate, stopPct);
        const startBeforeData = hist.series.dates.length && r.startDate < hist.series.dates[0];
        return (
          <div key={r.key} className={`border-t pt-3 first:border-t-0 first:pt-0 space-y-1 ${t.row}`} data-testid={`holding-${r.key}`}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: r.groupColor || '#94a3b8' }} />
              <span className={`font-bold ${t.strong}`}>{r.symbol}</span>
              <span className={`text-sm ${t.sub}`} data-testid="group-name">
                {r.groupName}
              </span>
              <span className={`text-sm ${t.sub}`}>· 起點 {r.startDate}</span>
            </div>
            <div className={`text-sm ${t.strong}`}>
              市價 <span className="font-semibold">{price(hist.series.lastMarketPrice)}</span>
              {st && (
                <>
                  <span className="mx-1">·</span>含息回檔（{N} 日）<span className="font-bold">{pct(st.drawdown)}</span>
                  <span className="mx-1">·</span>
                  {st.deepestReached === null ? `尚未到 −${THRESHOLDS[0]}% 檔位` : `已到 −${st.deepestReached}% 檔位`}
                </>
              )}
            </div>
            {ss && (
              <div className={`text-sm ${t.strong}`}>
                自持有期間含息最高（{ss.highDate}）回落 <span className="font-semibold">{pct(ss.fallFromHigh)}</span>
                <span className="mx-1">·</span>
                {ss.belowStop ? (
                  <span className="font-bold">已低於停利設定（{stopPct}%）</span>
                ) : (
                  <>
                    距停利點 <span className="font-bold">{pct(ss.distanceToStop)}</span>（停利設定 {stopPct}%）
                  </>
                )}
              </div>
            )}
            {startBeforeData && (
              <div className={`text-xs ${t.sub}`}>起點早於可取得的資料（{hist.series.dates[0]}），持有期間最高價從資料第一天起算。</div>
            )}
            <div className={`text-xs ${t.sub}`}>
              資料截至 {hist.series.lastDate} · 最近一次更新來源：{SOURCE_NAMES[hist.source] || hist.source || '未記錄'}
              {hist.warnings.length > 0 && ` · ⚠ ${hist.warnings.map((w) => w.text).join('；')}`}
            </div>
          </div>
        );
      })}
      {rows.length > 0 && <div className={`text-xs ${t.sub}`}>歷史描述，未經驗證。停利：{STOP_LABEL}</div>}
    </div>
  );
}

// ── 進階設定(預設收合)──
function SettingsPanel({ settings, onChange, rows, t }) {
  const [open, setOpen] = useState(false);
  const num = (v) => {
    const x = parseFloat(v);
    return Number.isFinite(x) && x > 0 && x < 100 ? x : null;
  };
  return (
    <div className={`border rounded-xl ${t.card}`}>
      <button onClick={() => setOpen((o) => !o)} className={`w-full text-left px-4 py-3 font-semibold ${t.strong}`}>
        {open ? '▾' : '▸'} 進階設定：停利回落%
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3">
          <div className={`text-sm ${t.sub}`}>{STOP_LABEL}</div>
          <label className={`flex items-center gap-2 text-sm ${t.strong}`}>
            預設停利回落
            <input
              type="number"
              min="1"
              max="99"
              value={settings.defaultStopPct}
              onChange={(e) => {
                const v = num(e.target.value);
                if (v !== null) onChange({ ...settings, defaultStopPct: v });
              }}
              className={`w-20 border rounded px-2 py-1 ${t.input}`}
            />
            %
          </label>
          {rows.map((r) => {
            const k = `${r.groupId}|${r.symbol}`;
            const v = settings.overrides[k];
            return (
              <label key={k} className={`flex items-center gap-2 text-sm flex-wrap ${t.strong}`}>
                {r.symbol}（{r.groupName}）
                <input
                  type="number"
                  min="1"
                  max="99"
                  placeholder={String(settings.defaultStopPct)}
                  value={typeof v === 'number' ? v : ''}
                  onChange={(e) => {
                    const overrides = { ...settings.overrides };
                    const x = num(e.target.value);
                    if (x === null) delete overrides[k];
                    else overrides[k] = x;
                    onChange({ ...settings, overrides });
                  }}
                  className={`w-20 border rounded px-2 py-1 ${t.input}`}
                />
                %<span className={t.sub}>{typeof v === 'number' ? '' : '（用預設）'}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function PullbackRadar({ isLight, deps: injected }) {
  const deps = useMemo(() => injected || defaultDeps(), [injected]);
  const t = useTheme(isLight);
  const [settings, setSettings] = useState(() => loadSettings(deps.storage));
  const N = settings.window;
  const [symbolInput, setSymbolInput] = useState('0050');
  const [hist, setHist] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);
  const [holdStatus, setHoldStatus] = useState('讀取持股中…');
  const [histBySymbol, setHistBySymbol] = useState({});

  const updateSettings = (s) => {
    setSettings(s);
    saveSettings(deps.storage, s);
  };

  const query = useCallback(
    async (sym) => {
      const s = String(sym || '').trim().toUpperCase();
      if (!s) return;
      setLoading(true);
      setError(null);
      try {
        const r = await loadFullHistory(s, deps);
        if (!r) setError(`查不到 ${s} 的價格資料`);
        setHist(r);
      } catch (e) {
        setError(`讀取 ${s} 失敗：${(e && e.message) || '未知錯誤'}`);
        setHist(null);
      } finally {
        setLoading(false);
      }
    },
    [deps]
  );

  useEffect(() => {
    query('0050');
  }, [query]);

  // 持股:等登入狀態確定後讀一次(雲端或本機),之後不訂閱。
  // onAuth 只是登入狀態的監聽(Firebase Auth),不是持股資料的訂閱。
  useEffect(() => {
    let cancelled = false;
    let done = false;
    const unsub = deps.onAuth(async (user) => {
      if (done) return; // 只讀一次;登入狀態之後再變也不重讀,避免和「我的持股」頁搶寫入時機
      done = true;
      const { data, from } = await loadPortfolioReadOnly({
        uid: user ? user.uid : null,
        loadPortfolioData: deps.loadPortfolioData,
        fetchRemoteDataOnce: deps.fetchRemoteDataOnce,
      });
      if (cancelled) return;
      const list = holdingRows(data);
      setRows(list);
      setHoldStatus(list.length ? `持股來源：${from === 'cloud' ? '雲端（唯讀）' : '本機'}` : '目前沒有持有中的持股。');
      const symbols = [...new Set(list.map((r) => r.symbol))];
      for (const s of symbols) {
        let r;
        try {
          r = (await loadFullHistory(s, { ...deps, withOldSegment: false })) || { error: '查不到價格資料' };
        } catch (e) {
          r = { error: '價格讀取失敗' };
        }
        if (cancelled) return;
        setHistBySymbol((m) => ({ ...m, [s]: r }));
      }
    });
    return () => {
      cancelled = true;
      if (typeof unsub === 'function') unsub();
    };
  }, [deps]);

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className={`text-2xl font-bold ${t.strong}`}>回檔雷達</div>

      {/* 1. 查詢列 */}
      <div className={`border rounded-xl p-4 space-y-3 ${t.card}`}>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            query(symbolInput);
          }}
        >
          <input
            value={symbolInput}
            onChange={(e) => setSymbolInput(e.target.value)}
            placeholder="ETF 代號，例如 0050"
            className={`flex-1 min-w-0 border rounded-lg px-3 py-2 ${t.input}`}
          />
          <button type="submit" disabled={loading} className="px-4 py-2 rounded-lg bg-emerald-500 text-white font-semibold disabled:opacity-50">
            {loading ? '讀取中…' : '查詢'}
          </button>
        </form>
        <div className="flex items-center gap-2 text-sm">
          <span className={t.sub}>回看窗口</span>
          {[60, 252].map((w) => (
            <button key={w} onClick={() => updateSettings({ ...settings, window: w })} className={`px-3 py-1 rounded-full border ${w === N ? t.chipOn : t.chipOff}`}>
              {w} 日
            </button>
          ))}
        </div>
      </div>

      {error && <div className={`border rounded-lg px-3 py-2 text-sm ${t.warn}`}>{error}</div>}

      {hist && (
        <>
          <div className={`font-semibold ${t.strong}`}>{hist.symbol}</div>
          {/* 2. 資料來源與警示 */}
          <SourceBar hist={hist} t={t} />
          {/* 3. 今日狀態 */}
          <StateCard hist={hist} N={N} t={t} />
          {/* 4. 檔位 × 持有期 */}
          <StatsTable hist={hist} N={N} t={t} />
        </>
      )}

      {/* 5. 持股提醒 */}
      <HoldingsSection rows={rows} histBySymbol={histBySymbol} settings={settings} N={N} t={t} status={holdStatus} />

      {/* 6. 進階設定 */}
      <SettingsPanel settings={settings} onChange={updateSettings} rows={rows} t={t} />

      {/* 7. 固定說明列 */}
      <div className={`border rounded-xl p-4 text-sm space-y-1 ${t.info}`} data-testid="footer">
        <div>{FOOTER_TEXT}</div>
        <div>{LAYER2_TEXT}</div>
      </div>
    </div>
  );
}
