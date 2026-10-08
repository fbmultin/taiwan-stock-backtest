import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Settings,
  ChevronDown,
  Plus,
  Minus,
  X,
  ArrowRightLeft,
  Trash2,
  Pencil,
  Calendar,
  Palette,
  Check,
  Tag,
  ArrowLeft,
  Folder,
  Upload,
  LogOut,
  RefreshCw,
  Cloud,
  CloudOff,
  Archive,
  Copy,
} from 'lucide-react';
import {
  mergeForSync,
  loadSyncMeta,
  saveSyncMeta,
  makeBackupFile,
  parseBackupFile,
  summarizeBackup,
  loadAutoBackup,
  maybeSaveAutoBackup,
  isTrustedRemote,
  stampForUpload,
  isSuspiciousShrink,
  getDeviceId,
} from './portfolioSync';
import {
  onAuthStateChanged,
  signInWithCredential,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  signOut,
} from 'firebase/auth';
import { auth, googleProvider } from './firebase';
import TW_STOCK_NAMES from './data/twStockNames';
import { squarify } from './treemap';
import { buildHeatmapModel } from './portfolioHeatmap';
import { fetchStockPriceData, fetchStockDisplayName, loadPriceCache, fetchLiveQuotes } from './dataCache';
import {
  quoteFromDaily,
  quoteFromLive,
  loadLastQuotes,
  saveLastQuotes,
  seedQuote,
  applyQuote,
} from './portfolioQuotes';
import { isNonTradingDay, getTaipeiDateTimeParts } from './tradingCalendar';
import {
  TX_TYPES,
  TX_TYPE_LABELS,
  ALL_GROUP_ID,
  DEFAULT_GROUP_COLORS,
  loadPortfolioData,
  savePortfolioData,
  fetchRemoteDataOnce,
  subscribeRemoteData,
  saveRemoteData,
  hasPendingRemoteSave,
  cancelPendingRemoteSave,
  normalizePortfolioData,
  createGroup,
  updateGroup,
  deleteGroup,
  createTagAndApply,
  applyTagToTransactions,
  removeTagFromTransactions,
  addTransaction,
  updateTransaction,
  deleteTransaction,
  moveTransactionToGroup,
  moveSymbolsToGroup,
  estimateFee,
  estimateTax,
  isDayTradeSell,
  isLikelyETF,
  stepPrice,
  tradeGross,
  sortHoldingsForDisplay,
  securityTaxRate,
  isBondETF,
  netShareDelta,
  computeSymbolSummary,
  matchFifo,
  aggregateSummaries,
  getTransactionsByGroup,
  formatMoney,
  formatSigned,
  formatPct,
  pnlColorClass,
} from './portfolioStore';

// ============== 共用小工具 ==============

const todayStr = () => new Date().toISOString().split('T')[0];

// 台灣投資人的習慣:ETF 記代號(0050、00878、00945B),個股記股名(台積電、禾伸堂)。
// 所以畫面上 ETF 把代號當主角(放大、加粗、放前面),股名退成小字;個股維持股名為主、代號小字。
// 查不到名稱(name 等於代號)時只顯示代號。
export function symbolLabel(symbol, name) {
  const hasName = Boolean(name) && name !== symbol;
  if (!hasName) return { primary: symbol, secondary: '', codeFirst: true };
  return isLikelyETF(symbol)
    ? { primary: symbol, secondary: name, codeFirst: true }
    : { primary: name, secondary: symbol, codeFirst: false };
}

// 依 item.date 把已排好序的列表切成 [[日期, items], ...],保持原本順序
function groupByDay(items) {
  const out = [];
  items.forEach((it) => {
    const last = out[out.length - 1];
    if (last && last[0] === it.date) last[1].push(it);
    else out.push([it.date, [it]]);
  });
  return out;
}

// 交易明細依日期分段用的「10/06(二)」
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
export function formatDayHeader(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const w = new Date(y, m - 1, d).getDay();
  return `${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}(${WEEKDAYS[w]})`;
}

// 手機鍵盤彈出時,大部分瀏覽器的 position:fixed 仍然是用「整個頁面」的高度在定位,
// 不會跟著可視區域縮小,導致原本貼在畫面最下面的浮動按鈕被鍵盤整個擋住、變成看
// 不到也點不到。用 visualViewport 量出鍵盤佔用的高度,讓浮動按鈕往上跟著讓開。
function useKeyboardInset() {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return undefined;
    const update = () => {
      const diff = window.innerHeight - vv.height - vv.offsetTop;
      setInset(diff > 0 ? diff : 0);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
  return inset;
}

// 買進(紅) / 賣出(綠) / 股利(橘) 三段式切換鈕,樣式對齊截圖:
// 選中項為實色填滿,未選中的兩項中間用一條細線分隔。
function TypeSegmented({ value, onChange, isLight }) {
  const items = [
    { key: TX_TYPES.BUY, label: '買進', activeClass: 'bg-red-500 text-white' },
    { key: TX_TYPES.SELL, label: '賣出', activeClass: 'bg-emerald-500 text-white' },
    { key: TX_TYPES.CASH_DIVIDEND, label: '股利', activeClass: 'bg-amber-500 text-white' },
  ];
  const inactiveBg = isLight ? 'bg-slate-200 text-slate-600' : 'bg-slate-700 text-slate-200';
  return (
    <div className="flex rounded-xl overflow-hidden">
      {items.map((item, i) => (
        <React.Fragment key={item.key}>
          {i > 0 && (
            <div className={`w-px ${isLight ? 'bg-slate-300' : 'bg-slate-600'} ${value === item.key || value === items[i - 1].key ? 'opacity-0' : ''}`} />
          )}
          <button
            type="button"
            onClick={() => onChange(item.key)}
            className={`flex-1 py-3 text-sm font-bold transition-colors ${
              value === item.key ? item.activeClass : inactiveBg
            }`}
          >
            {item.label}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}

function FieldBox({ label, icon, children, isLight, className = '' }) {
  return (
    <div
      className={`relative border rounded-xl px-3 pt-4 pb-3 ${
        isLight ? 'border-slate-300 bg-white' : 'border-slate-600 bg-slate-800/40'
      } ${className}`}
    >
      <span
        className={`absolute -top-2.5 left-3 px-1 text-[11px] ${
          isLight ? 'bg-white text-slate-500' : 'bg-slate-900 text-slate-400'
        }`}
      >
        {label}
      </span>
      <div className="flex items-center gap-2 min-w-0">
        {icon}
        {children}
      </div>
    </div>
  );
}

// ============== 新增/編輯交易 Modal ==============

// export 只是為了讓單元測試能直接渲染這個表單(檢查升降單位與費用明細),畫面上仍只由本檔使用
export function TransactionFormModal({ isLight, data, initial, onClose, onSubmit, onDelete }) {
  const keyboardInset = useKeyboardInset();
  const isEdit = Boolean(initial && initial.id);
  // 「複製交易」:帶入原本那筆的所有欄位,但存成新的一筆(沒有 id)。用途例如券商把一張委託
  // 拆成好幾筆成交(交割單上 10,000 股 + 4,000 股分開列),複製後只改股數就能照交割單一筆一筆記。
  const isCopy = Boolean(initial && initial.copiedFrom);
  const presetSymbol = initial && initial.symbol ? initial.symbol : '';
  const [symbol, setSymbol] = useState(presetSymbol);
  const [type, setType] = useState((initial && initial.type) || TX_TYPES.BUY);
  const [date, setDate] = useState((initial && initial.date) || todayStr());
  const [price, setPrice] = useState(initial && initial.price ? String(initial.price) : '');
  const [shares, setShares] = useState(initial && initial.shares ? String(initial.shares) : '');
  const [amountOverride, setAmountOverride] = useState(
    initial && initial.type === TX_TYPES.CASH_DIVIDEND && initial.amount ? String(initial.amount) : ''
  );
  const [note, setNote] = useState((initial && initial.note) || '');
  const [groupId, setGroupId] = useState(() => {
    if (initial && initial.groupId) return initial.groupId;
    if (data.activeGroupId !== ALL_GROUP_ID) return data.activeGroupId;
    return data.groups[0]?.id;
  });
  const [fixedFee, setFixedFee] = useState(false);
  const [manualFee, setManualFee] = useState(initial && initial.fee ? String(initial.fee) : '');
  // ETF跟一般股票的手續費優惠分開存,新增交易時依代號自動套用對應那組(也可
  // 以用下面的「商品類型」切換手動覆蓋),跟證交稅的判斷邏輯共用同一個開關。
  const [etfFeeDiscountPct, setEtfFeeDiscountPct] = useState(() => {
    const g = data.groups.find((x) => x.id === groupId);
    return g && typeof g.etfFeeDiscountPct === 'number' ? g.etfFeeDiscountPct : 100;
  });
  const [stockFeeDiscountPct, setStockFeeDiscountPct] = useState(() => {
    const g = data.groups.find((x) => x.id === groupId);
    return g && typeof g.stockFeeDiscountPct === 'number' ? g.stockFeeDiscountPct : 100;
  });
  const [showGroupPicker, setShowGroupPicker] = useState(false);
  const [priceLoading, setPriceLoading] = useState(false);
  const priceTouchedRef = useRef(isEdit || isCopy); // 編輯既有交易時視為「已手動設定」,不要被自動帶入蓋掉
  const [isEtf, setIsEtf] = useState(() => isLikelyETF(symbol));
  const etfTouchedRef = useRef(isEdit);
  const nameGuess = TW_STOCK_NAMES[symbol.toUpperCase()] || '';

  // 代號改變時,如果使用者還沒手動切換過「商品類型」,就依代號猜測是ETF還是
  // 一般股票——這個判斷同時決定手續費優惠套用哪一組、證交稅稅率千分之1還是3,
  // 猜錯會讓估計的手續費、已實現/出場損益差到好幾倍。
  useEffect(() => {
    if (etfTouchedRef.current) return;
    setIsEtf(isLikelyETF(symbol));
  }, [symbol]);

  // 新增買進/賣出交易時,價格欄位預設帶入最近一個已知收盤價(這裡沿用整個
  // 專案統一的「資料抓取基準日」規則——台灣時間下午3:30後用當天,之前用
  // 前一個交易日——避免帶入 TWSE 尚未正式收錄、可能跟隔天資料對不上的尾盤價)。
  // 只要使用者自己改過價格(或用±按鈕調整過),就不再自動覆寫。
  useEffect(() => {
    if (isEdit) return;
    if (type !== TX_TYPES.BUY && type !== TX_TYPES.SELL) return;
    const sym = symbol.trim().toUpperCase();
    if (sym.length < 4) return;
    let cancelled = false;
    setPriceLoading(true);
    const timer = setTimeout(async () => {
      try {
        const result = await fetchStockPriceData(sym);
        if (cancelled) return;
        const d = (result && result.data) || [];
        const last = d[d.length - 1];
        if (last && !priceTouchedRef.current) {
          setPrice(String(last.price));
        }
      } catch (e) {
        // 抓不到收盤價就讓使用者自己輸入,不特別提示。
      } finally {
        if (!cancelled) setPriceLoading(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setPriceLoading(false);
    };
  }, [symbol, type, isEdit]);

  // 以下「股利參考資訊」只在新增股利交易時才會用到,買/賣/股票股利、以及
  // 編輯既有交易都完全不受影響——這是 Adam 明確要求的範圍限制。
  // amountTouchedRef/noteTouchedRef:使用者一旦自己手動改過金額或備註,之後
  // 不管怎麼切換群組、重新查到配息資料,都不要再用自動算出來的值蓋掉。
  const [divRefLoading, setDivRefLoading] = useState(false);
  const [divRef, setDivRef] = useState(null); // { date, amount } | null,amount 是「每股」配息金額
  // 複製來的股利金額/備註是使用者要的值,不要被自動估算蓋掉
  const amountTouchedRef = useRef(isEdit || isCopy);
  const noteTouchedRef = useRef(isEdit || isCopy);

  // 新增股利交易時,額外查一次這檔股票的配息紀錄(跟ETF回測比較共用同一份
  // dataCache,通常已經有快取、幾乎不用等)。只是要「最近一次配息日期/金額」
  // 當參考,不是要畫面上顯示完整股價,所以不影響前面那個買/賣用的報價 effect。
  // 這裡故意用 force:true:使用者會打開這個表單,通常就是剛好配到息、想記錄
  // 這筆交易,正是最需要「這一刻」資料夠新的時候。非force模式下,只要股價快取
  // 本身還沒跟不上最新交易日(cacheIsFresh),就會直接吃快取、完全不會去檢查
  // 快取裡的配息紀錄是不是也跟上了最新一次配息——配息公告不像股價每天變動,
  // 股價快取可能已經是「新的」,但裡面存的配息資訊卻是好幾天前抓的舊資料,
  // 導致這裡顯示的「最近一次配息」參考資訊其實沒有真正重新確認過。force:true
  // 會跳過那個檢查、一定重新查一次——搭配 dataCache.js 裡的輕量增量抓取,
  // 已經有快取時只會抓最近幾天,不會整個重抓20年,成本很低。
  useEffect(() => {
    if (isEdit) return;
    if (type !== TX_TYPES.CASH_DIVIDEND) return;
    const sym = symbol.trim().toUpperCase();
    if (sym.length < 4) {
      setDivRef(null);
      return;
    }
    let cancelled = false;
    setDivRefLoading(true);
    const timer = setTimeout(async () => {
      try {
        const result = await fetchStockPriceData(sym, { force: true });
        if (cancelled) return;
        const divDates = (result && result.divDates) || [];
        const dividendsMap = (result && result.dividendsMap) || {};
        const latestTs = divDates.length > 0 ? divDates[divDates.length - 1] : null;
        const info = latestTs != null ? dividendsMap[latestTs] : null;
        if (info && info.amount) {
          setDivRef({ date: new Date(latestTs).toISOString().split('T')[0], amount: info.amount });
        } else {
          setDivRef(null);
        }
      } catch (e) {
        setDivRef(null);
      } finally {
        if (!cancelled) setDivRefLoading(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setDivRefLoading(false);
    };
  }, [symbol, type, isEdit]);

  const group = data.groups.find((g) => g.id === groupId) || data.groups[0];
  const priceNum = parseFloat(price) || 0;
  const sharesNum = parseFloat(shares) || 0;
  const symbolUpper = symbol.trim().toUpperCase();
  // 賣出這檔股票時,「剩下持有股數」用來顯示清倉按鈕、一鍵帶入全部庫存張數。
  // 編輯既有交易時要排除自己這一筆,避免把自己算進庫存裡造成誤差。
  const remainingShares = useMemo(() => {
    if (!symbolUpper) return 0;
    const txs = data.transactions.filter(
      (t) => t.symbol === symbolUpper && !(isEdit && initial && t.id === initial.id)
    );
    return computeSymbolSummary(txs).shares;
  }, [symbolUpper, data.transactions, isEdit, initial]);

  // 新增股利交易用:跟上面 remainingShares 不同,這裡要的是「這個群組裡」的
  // 庫存股數(同一檔股票可能分散在不同群組各自持有),切換股利表單上的群組
  // 選擇器時,這個數字要跟著變,才能依照 Adam 的要求重新估算這個群組該拿到
  // 的股利金額,而不是整個帳戶(所有群組加總)的庫存。
  const groupShares = useMemo(() => {
    if (!symbolUpper || !groupId) return 0;
    const txs = data.transactions.filter(
      (t) => t.symbol === symbolUpper && t.groupId === groupId && !(isEdit && initial && t.id === initial.id)
    );
    return computeSymbolSummary(txs).shares;
  }, [symbolUpper, groupId, data.transactions, isEdit, initial]);

  // 股利金額/備註自動帶入:等「這個群組的庫存股數」跟「查到的配息參考資訊」
  // 都到位,且使用者還沒手動改過金額/備註,才會用兩者相乘算出估計金額跟
  // 明細文字。切換群組(groupShares變)或重新查到配息資訊(divRef變)都會
  // 重新算一次,直到使用者自己動手改過金額或備註為止。
  useEffect(() => {
    if (isEdit) return;
    if (type !== TX_TYPES.CASH_DIVIDEND) return;
    if (!divRef || groupShares <= 0) return;
    const estimate = Math.round(groupShares * divRef.amount);
    if (!amountTouchedRef.current) setAmountOverride(String(estimate));
    if (!noteTouchedRef.current) setNote(`${formatMoney(groupShares)}股 × ${divRef.amount}元/股`);
  }, [divRef, groupShares, type, isEdit]);

  const isBuySell = type === TX_TYPES.BUY || type === TX_TYPES.SELL;
  const activeFeeDiscountPct = isEtf ? etfFeeDiscountPct : stockFeeDiscountPct;
  const autoFee = isBuySell
    ? estimateFee({ ...group, etfFeeDiscountPct, stockFeeDiscountPct }, priceNum, sharesNum, isEtf)
    : 0;
  const fee = fixedFee ? parseFloat(manualFee) || 0 : autoFee;
  // 當沖判斷:同一天、同一檔股票的交易紀錄裡已經有買進,賣出的證交稅就減半。
  const isDayTrade =
    type === TX_TYPES.SELL &&
    symbol.trim() &&
    date &&
    isDayTradeSell(data.transactions, symbol.trim().toUpperCase(), date, isEdit ? initial.id : null);
  // 證交稅率依商品類型與交易日期(債券ETF停徵、股票當沖減半都有法定期限),見 portfolioStore.securityTaxRate
  const isBondEtf = isEtf && isBondETF(symbol);
  const taxRate = securityTaxRate({ isEtf, isBondEtf, isDayTrade: Boolean(isDayTrade), date });
  const tax = type === TX_TYPES.SELL ? estimateTax(priceNum, sharesNum, { taxRate }) : 0;
  const grossAmount = tradeGross(priceNum, sharesNum); // 價金(元以下捨去,跟交割單一致)
  const taxLabel = isBondEtf && taxRate === 0
    ? '債券ETF停徵'
    : `${(taxRate * 100).toFixed(taxRate === 0.0015 ? 2 : 1)}%${isDayTrade && !isEtf && taxRate === 0.0015 ? ' 當沖減半' : ''}`;
  // 交割金額:買進 = 價金 + 手續費;賣出 = 價金 − 手續費 − 證交稅
  const computedAmount =
    type === TX_TYPES.BUY
      ? -(grossAmount + fee)
      : type === TX_TYPES.SELL
      ? grossAmount - fee - tax
      : parseFloat(amountOverride) || 0;

  const canSubmit =
    symbol.trim() &&
    date &&
    groupId &&
    (type === TX_TYPES.CASH_DIVIDEND
      ? (parseFloat(amountOverride) || 0) !== 0
      : sharesNum > 0 && (type === TX_TYPES.STOCK_DIVIDEND || priceNum > 0));

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({
      symbol: symbol.trim().toUpperCase(),
      type,
      date,
      price: type === TX_TYPES.STOCK_DIVIDEND || type === TX_TYPES.CASH_DIVIDEND ? 0 : priceNum,
      shares: type === TX_TYPES.CASH_DIVIDEND ? 0 : sharesNum,
      amount: type === TX_TYPES.CASH_DIVIDEND ? parseFloat(amountOverride) || 0 : computedAmount,
      fee: isBuySell ? fee : 0,
      tax,
      groupId,
      note,
    });
  };

  const inputBase = `flex-1 min-w-0 bg-transparent outline-none text-lg font-mono font-bold ${
    isLight ? 'text-slate-900 placeholder-slate-400' : 'text-white placeholder-slate-500'
  }`;

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className={`relative w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[92vh] overflow-y-auto ${
          isLight ? 'bg-white text-slate-900' : 'bg-slate-900 text-white'
        }`}
      >
        <div className="flex items-center gap-3 px-4 pt-4 pb-2">
          <button onClick={onClose} className="w-10 h-10 -ml-2 -my-2 flex items-center justify-center shrink-0">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="text-sm font-bold">{isEdit ? '編輯交易' : isCopy ? '複製交易(存成新的一筆)' : '新增交易'}</div>
          </div>
        </div>

        <div className="px-4 pb-4 space-y-4">
          {!presetSymbol ? (
            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="輸入股票代號,例如 0050"
              className={`w-full border rounded-xl px-3 py-3 text-lg font-mono font-bold outline-none ${
                isLight ? 'border-slate-300 bg-white' : 'border-slate-600 bg-slate-800/40'
              }`}
            />
          ) : (
            <div className="text-xl font-bold">
              {symbol} {nameGuess && <span className="text-base font-normal opacity-70">{nameGuess}</span>}
            </div>
          )}
          {!presetSymbol && nameGuess && <div className="text-xs opacity-60 -mt-3">{nameGuess}</div>}

          <TypeSegmented value={type} onChange={setType} isLight={isLight} />

          <FieldBox label="日期" icon={<Calendar className="w-4 h-4 opacity-60" />} isLight={isLight}>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={`flex-1 bg-transparent outline-none text-lg font-mono font-bold ${
                isLight ? 'text-slate-900' : 'text-white'
              }`}
            />
          </FieldBox>

          {type === TX_TYPES.CASH_DIVIDEND ? (
            <>
              {symbolUpper.length >= 4 && (
                <div
                  className={`text-xs rounded-xl px-3 py-2 leading-relaxed ${
                    isLight ? 'bg-slate-100 text-slate-600' : 'bg-slate-800/60 text-slate-300'
                  }`}
                >
                  {divRefLoading ? (
                    '查詢最近一次配息中…'
                  ) : divRef ? (
                    <>最近一次配息:{divRef.date}，每股 {divRef.amount} 元(僅供參考,實際請以實收為準)</>
                  ) : (
                    '查無這檔過去的配息紀錄,金額請自行輸入'
                  )}
                  <br />
                  {group?.name || '這個群組'}目前庫存 {formatMoney(groupShares)} 股
                </div>
              )}
              <FieldBox label="金額" icon={<span className="opacity-60 font-mono">$</span>} isLight={isLight}>
                <input
                  type="number"
                  value={amountOverride}
                  onChange={(e) => {
                    setAmountOverride(e.target.value);
                    amountTouchedRef.current = true;
                  }}
                  placeholder="0"
                  className={inputBase}
                />
                <span className="text-xs opacity-60">NTD</span>
              </FieldBox>
              <FieldBox label="備註" icon={<span className="opacity-60">✎</span>} isLight={isLight}>
                <input
                  value={note}
                  onChange={(e) => {
                    setNote(e.target.value);
                    noteTouchedRef.current = true;
                  }}
                  placeholder="備註(選填)"
                  className={`flex-1 min-w-0 bg-transparent outline-none text-sm ${
                    isLight ? 'text-slate-900 placeholder-slate-400' : 'text-white placeholder-slate-500'
                  }`}
                />
              </FieldBox>
            </>
          ) : (
            <div className="flex items-start gap-2">
              {type !== TX_TYPES.STOCK_DIVIDEND && (
                <FieldBox
                  label="價格"
                  icon={<span className="opacity-60 font-mono">$</span>}
                  isLight={isLight}
                  className="flex-1 min-w-0"
                >
                  <input
                    type="number"
                    value={price}
                    onChange={(e) => {
                      setPrice(e.target.value);
                      priceTouchedRef.current = true;
                    }}
                    placeholder={priceLoading ? '抓取收盤價中…' : '0.00'}
                    className={inputBase}
                  />
                </FieldBox>
              )}
              {type !== TX_TYPES.STOCK_DIVIDEND && (
                <div className="flex gap-1 shrink-0 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      priceTouchedRef.current = true;
                      // 用函式型 setState(讀前一個「待更新」的值而不是這次渲染當下的
                      // closure 變數),避免快速連點時因為尚未重新渲染、好幾次點擊都
                      // 讀到同一個舊的 price 值,導致點擊被「吃掉」、感覺卡住不動。
                      // 升降單位依商品類型:ETF(含債券ETF)與股票的級距表不同
                      setPrice((prev) => String(stepPrice(parseFloat(prev) || 0, -1, isEtf)));
                    }}
                    aria-label="價格減一檔"
                    className="w-11 h-11 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      priceTouchedRef.current = true;
                      setPrice((prev) => String(stepPrice(parseFloat(prev) || 0, 1, isEtf)));
                    }}
                    aria-label="價格加一檔"
                    className="w-11 h-11 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="flex items-start gap-2">
            <FieldBox
              label="數量(股)"
              icon={<span className="opacity-60">#</span>}
              isLight={isLight}
              className="flex-1 min-w-0"
            >
              <input
                type="number"
                value={shares}
                onChange={(e) => setShares(e.target.value)}
                placeholder="數量"
                className={inputBase}
              />
            </FieldBox>
            {type === TX_TYPES.SELL && remainingShares > 0 && (
              <button
                type="button"
                onClick={() => setShares(String(remainingShares))}
                className="h-11 mt-1 px-3 rounded-xl bg-rose-500 text-white text-sm font-bold shrink-0"
              >
                清倉
              </button>
            )}
          </div>
          {/* 費用摘要跟「1張 = 1000股」放同一行、同樣小字,省空間;
              應付/應收就是交割金額(價金、手續費、證交稅都以元以下捨去計算)。 */}
          <div className="text-xs opacity-60 -mt-2 flex flex-wrap gap-x-2" data-testid="cost-breakdown">
            <span>1張 = 1000股</span>
            {isBuySell && priceNum > 0 && sharesNum > 0 && (
              <span className="font-mono">
                價金 {formatMoney(grossAmount)}・手續費 {formatMoney(fee)}・稅 {formatMoney(tax)}・
                {type === TX_TYPES.BUY ? '應付' : '應收'} {formatMoney(Math.abs(computedAmount))}
              </span>
            )}
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowGroupPicker((v) => !v)}
              className={`w-full flex items-center gap-2 border rounded-xl px-3 py-3 ${
                isLight ? 'border-slate-300 bg-white' : 'border-slate-600 bg-slate-800/40'
              }`}
            >
              <Folder className="w-4 h-4 opacity-60" />
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ background: group?.color || '#94a3b8' }}
              />
              <span className="flex-1 text-left font-bold">{group?.name || '選擇群組'}</span>
              <ChevronDown className="w-4 h-4 opacity-60" />
            </button>
            {showGroupPicker && (
              <div
                className={`absolute z-10 mt-1 w-full rounded-xl border shadow-lg overflow-hidden ${
                  isLight ? 'bg-white border-slate-200' : 'bg-slate-800 border-slate-600'
                }`}
              >
                {data.groups.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => {
                      setGroupId(g.id);
                      setEtfFeeDiscountPct(typeof g.etfFeeDiscountPct === 'number' ? g.etfFeeDiscountPct : 100);
                      setStockFeeDiscountPct(typeof g.stockFeeDiscountPct === 'number' ? g.stockFeeDiscountPct : 100);
                      setShowGroupPicker(false);
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm ${
                      isLight ? 'hover:bg-slate-100' : 'hover:bg-slate-700'
                    }`}
                  >
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: g.color }} />
                    <span className="flex-1 text-left">{g.name}</span>
                    {g.id === groupId && <Check className="w-4 h-4 text-emerald-500" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-2">
            {isEdit && (
              <button
                type="button"
                onClick={() => onDelete(initial.id)}
                className="px-4 py-3 rounded-xl bg-red-500/10 text-red-500 font-bold text-sm"
              >
                刪除
              </button>
            )}
            <button
              type="button"
              disabled={!canSubmit}
              onClick={handleSubmit}
              className={`flex-1 py-3 rounded-full font-bold text-sm ${
                canSubmit
                  ? 'bg-amber-500 text-white'
                  : isLight
                  ? 'bg-slate-200 text-slate-400'
                  : 'bg-slate-700 text-slate-500'
              }`}
            >
              + {isEdit ? '儲存' : '新增'}
            </button>
          </div>

          {/* 手續費相關設定不常用,移到「新增」鈕下方,這樣主要操作(送出)
              不用滑到最下面才按得到;要調整手續費的人再往下滑開啟即可。 */}
          {isBuySell && (
            <div className={`pt-3 mt-1 border-t ${isLight ? 'border-slate-100' : 'border-slate-800'} space-y-3`}>
              <div className="flex items-center justify-between">
                <span className="text-sm">商品類型</span>
                <div className={`flex rounded-full p-0.5 ${isLight ? 'bg-slate-100' : 'bg-slate-800'}`}>
                  <button
                    type="button"
                    onClick={() => {
                      etfTouchedRef.current = true;
                      setIsEtf(true);
                    }}
                    className={`px-3 py-1 rounded-full text-xs font-bold ${
                      isEtf ? 'bg-amber-500 text-white' : 'opacity-60'
                    }`}
                  >
                    ETF
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      etfTouchedRef.current = true;
                      setIsEtf(false);
                    }}
                    className={`px-3 py-1 rounded-full text-xs font-bold ${
                      !isEtf ? 'bg-amber-500 text-white' : 'opacity-60'
                    }`}
                  >
                    一般股票
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm">固定手續費</span>
                <button
                  type="button"
                  onClick={() => setFixedFee((v) => !v)}
                  className={`w-11 h-6 rounded-full transition-colors relative ${
                    fixedFee ? 'bg-amber-500' : isLight ? 'bg-slate-300' : 'bg-slate-600'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${
                      fixedFee ? 'left-5' : 'left-0.5'
                    }`}
                  />
                </button>
              </div>

              {fixedFee ? (
                <FieldBox label="手續費(元)" icon={<span className="opacity-60 font-mono">$</span>} isLight={isLight}>
                  <input
                    type="number"
                    value={manualFee}
                    onChange={(e) => setManualFee(e.target.value)}
                    placeholder="0"
                    className={inputBase}
                  />
                </FieldBox>
              ) : (
                <div
                  className={`border rounded-xl px-4 py-3 ${
                    isLight ? 'border-slate-300' : 'border-slate-600'
                  }`}
                >
                  <div className="flex items-center justify-between text-sm mb-2">
                    <span>手續費優惠({isEtf ? 'ETF' : '一般股票'})</span>
                    <span className="font-mono font-bold">{activeFeeDiscountPct}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={activeFeeDiscountPct}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (isEtf) setEtfFeeDiscountPct(v);
                      else setStockFeeDiscountPct(v);
                    }}
                    className="w-full accent-amber-500"
                  />
                  <div className="flex justify-between text-[10px] opacity-50 font-mono mt-1">
                    <span>0%</span>
                    <span>20%</span>
                    <span>40%</span>
                    <span>60%</span>
                    <span>80%</span>
                    <span>100%</span>
                  </div>
                </div>
              )}
              <div className="text-xs opacity-60 flex justify-between">
                <span>試算手續費:{formatMoney(fee)} 元</span>
                {type === TX_TYPES.SELL && (
                  <span>
                    證交稅({taxLabel}):{formatMoney(tax)} 元
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          // 14rem跟其他頁面浮動返回鈕的 bottom-56 對齊(同樣的「往上3+1顆鈕距離」),
          // 鍵盤彈出時再疊加 keyboardInset 往上讓開,兩者不衝突。
          style={{ bottom: `calc(14rem + ${keyboardInset}px)` }}
          className={`fixed right-4 z-[80] w-12 h-12 rounded-full shadow-xl flex items-center justify-center ${
            isLight ? 'bg-slate-700 text-white' : 'bg-slate-200 text-slate-900'
          }`}
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

// ============== CSV 匯入(試用版)==============
//
// 先支援最單純的情境:CSV 表頭含日期/代號/類型(買/賣)/股數/價格,常見欄位
// 別名可以自動辨識。手續費/證交稅沒有欄位可用時,依匯入目標群組的設定跟代號
// (00開頭視為ETF)自動估算,跟手動新增交易用的是同一套邏輯跟稅率/當沖判斷。

// 簡易 CSV 解析:支援雙引號包住的欄位(內含逗號、換行、用 "" 轉義雙引號),
// 一般試算表(Excel/Numbers/Google試算表)另存CSV的格式都在支援範圍內。
function parseCsvText(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < normalized.length; i += 1) {
    const c = normalized[i];
    if (inQuotes) {
      if (c === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      pushField();
    } else if (c === '\n') {
      pushRow();
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) pushRow();
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

const CSV_HEADER_ALIASES = {
  date: ['日期', '交易日期', '成交日期', 'date'],
  symbol: ['代號', '股票代號', '證券代號', 'symbol', 'code'],
  name: ['名稱', '股票名稱', 'name'],
  type: ['類型', '買賣', '買賣別', 'type'],
  shares: ['股數', '股數(股)', '數量', 'shares', 'quantity'],
  price: ['價格', '成交價', '價格(元)', 'price'],
  // 股利(現金股利)需要的「拿到的金額」欄位,買賣不需要(金額由股數×價格自動算,
  // 有這欄也不會拿來用,避免跟手續費/證交稅估算的結果對不上)。
  amount: ['金額', '金額(元)', '總金額', '股利金額', 'amount'],
};

const CSV_TYPE_MAP = {
  買: TX_TYPES.BUY,
  買進: TX_TYPES.BUY,
  buy: TX_TYPES.BUY,
  b: TX_TYPES.BUY,
  賣: TX_TYPES.SELL,
  賣出: TX_TYPES.SELL,
  sell: TX_TYPES.SELL,
  s: TX_TYPES.SELL,
  股利: TX_TYPES.CASH_DIVIDEND,
  現金股利: TX_TYPES.CASH_DIVIDEND,
  cashdividend: TX_TYPES.CASH_DIVIDEND,
  dividend: TX_TYPES.CASH_DIVIDEND,
  股票股利: TX_TYPES.STOCK_DIVIDEND,
  stockdividend: TX_TYPES.STOCK_DIVIDEND,
};

const CSV_REQUIRED_COLUMNS = ['date', 'symbol', 'type', 'shares', 'price'];

function detectCsvColumns(headerRow) {
  const normalized = headerRow.map((h) => h.trim().toLowerCase());
  const map = {};
  Object.entries(CSV_HEADER_ALIASES).forEach(([key, aliases]) => {
    const idx = normalized.findIndex((h) => aliases.some((a) => a.toLowerCase() === h));
    if (idx >= 0) map[key] = idx;
  });
  return map;
}

function parseImportRows(csvText) {
  const table = parseCsvText(csvText);
  if (table.length === 0) return { rows: [], columns: {}, missingColumns: CSV_REQUIRED_COLUMNS };
  const columns = detectCsvColumns(table[0]);
  const missingColumns = CSV_REQUIRED_COLUMNS.filter((key) => columns[key] === undefined);
  const dataRows = table.slice(1);
  const rows = dataRows.map((cols, idx) => {
    const get = (key) => (columns[key] !== undefined ? (cols[columns[key]] || '').trim() : '');
    const dateRaw = get('date');
    const symbolRaw = get('symbol').toUpperCase();
    const typeRaw = get('type');
    const sharesRaw = get('shares').replace(/,/g, '');
    const priceRaw = get('price').replace(/,/g, '');
    const amountRaw = get('amount').replace(/,/g, '');
    const name = get('name');

    const errors = [];
    const date = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : null;
    if (!date) errors.push('日期格式需為YYYY-MM-DD');
    if (!symbolRaw) errors.push('缺少代號');
    const type = CSV_TYPE_MAP[typeRaw.trim().toLowerCase()];
    if (!type) errors.push(`不支援的類型「${typeRaw}」(目前支援買/賣/股利/股票股利)`);

    let shares = parseFloat(sharesRaw) || 0;
    let price = parseFloat(priceRaw) || 0;
    let amount = parseFloat(amountRaw) || 0;

    // 現金股利:不看股數/價格,改看「金額」欄位(拿到的現金股利總額)。
    // 股票股利:只看股數(配發的股數),價格/金額不需要,固定當0。
    // 買/賣:維持原本的股數+價格都要是正數。
    if (type === TX_TYPES.CASH_DIVIDEND) {
      shares = 0;
      price = 0;
      if (!amount) errors.push('股利需要「金額」欄位(需為正數)');
    } else if (type === TX_TYPES.STOCK_DIVIDEND) {
      price = 0;
      amount = 0;
      if (!shares || shares <= 0) errors.push('股票股利的股數需為正數');
    } else {
      if (!shares || shares <= 0) errors.push('股數需為正數');
      if (!price || price <= 0) errors.push('價格需為正數');
    }

    return {
      rowIndex: idx,
      date,
      symbol: symbolRaw,
      name,
      type,
      shares,
      price,
      amount,
      errors,
      valid: errors.length === 0 && missingColumns.length === 0,
    };
  });
  return { rows, columns, missingColumns };
}

function ImportCsvModal({ isLight, data, onClose, onImport }) {
  const [csvText, setCsvText] = useState('');
  const [groupId, setGroupId] = useState(
    data.activeGroupId !== ALL_GROUP_ID ? data.activeGroupId : data.groups[0]?.id
  );
  const [parsed, setParsed] = useState(null); // { rows, columns, missingColumns } | null
  const [checkedRows, setCheckedRows] = useState({}); // rowIndex -> boolean
  const fileInputRef = useRef(null);

  const group = data.groups.find((g) => g.id === groupId) || data.groups[0];

  const handleFile = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => setCsvText(String(e.target.result || ''));
    reader.readAsText(file, 'utf-8');
  };

  const handleParse = () => {
    const result = parseImportRows(csvText);
    // 重複偵測:日期+代號+類型+股數+價格都相同就視為跟現有紀錄重複,預設不勾選
    // (避免同一份CSV不小心匯入兩次),使用者可以自己勾選覆蓋。
    const keyOf = (t) => `${t.date}|${t.symbol}|${t.type}|${t.shares}|${t.price}`;
    const existingSet = new Set(data.transactions.map(keyOf));
    const withDup = result.rows.map((r) => ({
      ...r,
      isDuplicate: r.valid && existingSet.has(keyOf(r)),
    }));
    setParsed({ ...result, rows: withDup });
    const initialChecked = {};
    withDup.forEach((r) => {
      initialChecked[r.rowIndex] = r.valid && !r.isDuplicate;
    });
    setCheckedRows(initialChecked);
  };

  // 計算每一筆被勾選交易的估計手續費/證交稅(含當沖判斷——批次匯入裡同一天
  // 同一檔股票如果有買又有賣,賣出那筆也要比照手動輸入減半課稅),組成最終
  // 準備寫入的交易物件。
  const computedRows = useMemo(() => {
    if (!parsed || !group) return [];
    const selected = parsed.rows.filter((r) => r.valid && checkedRows[r.rowIndex]);
    const dayTradeLookup = [
      ...data.transactions,
      ...selected.map((r) => ({ symbol: r.symbol, date: r.date, type: r.type })),
    ];
    return selected.map((r) => {
      const isEtf = isLikelyETF(r.symbol);
      // 股利(現金/股票)沒有手續費、證交稅,也不用算當沖——現金股利金額直接用
      // CSV 裡解析出來的 r.amount,股票股利沒有現金流動,amount固定是0。
      if (r.type === TX_TYPES.CASH_DIVIDEND) {
        return { ...r, fee: 0, tax: 0, isDayTrade: false, isEtf, amount: r.amount };
      }
      if (r.type === TX_TYPES.STOCK_DIVIDEND) {
        return { ...r, fee: 0, tax: 0, isDayTrade: false, isEtf, amount: 0 };
      }
      const fee = estimateFee(group, r.price, r.shares, isEtf);
      const isDayTrade = r.type === TX_TYPES.SELL && isDayTradeSell(dayTradeLookup, r.symbol, r.date, null);
      // 稅率跟手動新增交易同一套規則(股票/ETF/債券ETF停徵/股票當沖減半),依該筆交易日期判斷
      const taxRate = securityTaxRate({ isEtf, isBondEtf: isEtf && isBondETF(r.symbol), isDayTrade, date: r.date });
      const tax = r.type === TX_TYPES.SELL ? estimateTax(r.price, r.shares, { taxRate }) : 0;
      const gross = tradeGross(r.price, r.shares);
      const amount = r.type === TX_TYPES.BUY ? -(gross + fee) : gross - fee - tax;
      return { ...r, fee, tax, isDayTrade, isEtf, amount };
    });
  }, [parsed, checkedRows, group, data.transactions]);

  const computedByIndex = useMemo(() => {
    const m = {};
    computedRows.forEach((r) => {
      m[r.rowIndex] = r;
    });
    return m;
  }, [computedRows]);

  const selectedCount = computedRows.length;
  const totalFee = computedRows.reduce((s, r) => s + r.fee, 0);
  const totalTax = computedRows.reduce((s, r) => s + r.tax, 0);

  const toggleRow = (rowIndex) => setCheckedRows((prev) => ({ ...prev, [rowIndex]: !prev[rowIndex] }));

  const handleConfirmImport = () => {
    if (!group || computedRows.length === 0) return;
    const payloads = computedRows.map((r) => ({
      symbol: r.symbol,
      type: r.type,
      date: r.date,
      price: r.price,
      shares: r.shares,
      amount: r.amount,
      fee: r.fee,
      tax: r.tax,
      groupId: group.id,
    }));
    onImport(payloads);
  };

  return (
    <div className="fixed inset-0 z-[85] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className={`relative w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[92vh] overflow-y-auto ${
          isLight ? 'bg-white text-slate-900' : 'bg-slate-900 text-white'
        }`}
      >
        <div className="flex items-center gap-3 px-4 pt-4 pb-2">
          <button onClick={onClose} className="w-10 h-10 -ml-2 -my-2 flex items-center justify-center shrink-0">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="font-bold">CSV 匯入交易(試用版)</div>
        </div>

        <div className="px-4 pb-6 space-y-4">
          {!parsed && (
            <>
              <div className={`text-xs rounded-lg px-3 py-2 ${isLight ? 'bg-slate-100' : 'bg-slate-800/60'}`}>
                支援「買/賣/股利/股票股利」四種類型,表頭需包含日期、代號、類型、股數、價格(常見欄位別名可自動辨識),日期格式需為YYYY-MM-DD。股利(現金股利)那一列股數/價格可以留空,但要有「金額」欄位填實際拿到的現金;股票股利只需要股數。手續費/證交稅沒有欄位的話,會依下面選的群組設定跟代號(00開頭視為ETF)自動估算,邏輯跟手動新增交易一致。
              </div>

              <div>
                <div className="text-sm font-bold mb-1.5">匯入到群組</div>
                <div className="flex gap-2 flex-wrap">
                  {data.groups.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setGroupId(g.id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm ${
                        g.id === groupId ? 'border-amber-500 bg-amber-500/10' : isLight ? 'border-slate-300' : 'border-slate-600'
                      }`}
                    >
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: g.color }} />
                      {g.name}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current && fileInputRef.current.click()}
                  className={`w-full flex items-center justify-center gap-2 border border-dashed rounded-xl px-3 py-4 text-sm font-bold ${
                    isLight ? 'border-slate-300 text-slate-600' : 'border-slate-600 text-slate-300'
                  }`}
                >
                  <Upload className="w-4 h-4" />
                  選擇CSV檔案
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files && e.target.files[0];
                    if (file) handleFile(file);
                    e.target.value = '';
                  }}
                />
              </div>

              <div>
                <div className="text-sm font-bold mb-1.5">或直接貼上CSV內容</div>
                <textarea
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  rows={8}
                  placeholder={
                    '日期,代號,名稱,類型,股數,價格,金額\n2026-09-29,6182,合晶,買,2000,117.5,\n2026-07-15,009805,新光電力,股利,0,,7000'
                  }
                  className={`w-full rounded-xl border px-3 py-2 text-xs font-mono outline-none ${
                    isLight ? 'border-slate-300 bg-white' : 'border-slate-600 bg-slate-800/40'
                  }`}
                />
              </div>

              <button
                type="button"
                disabled={!csvText.trim() || !groupId}
                onClick={handleParse}
                className={`w-full py-3 rounded-full font-bold text-sm ${
                  csvText.trim() && groupId
                    ? 'bg-amber-500 text-white'
                    : isLight
                    ? 'bg-slate-200 text-slate-400'
                    : 'bg-slate-700 text-slate-500'
                }`}
              >
                解析預覽
              </button>
            </>
          )}

          {parsed && (
            <>
              {parsed.missingColumns.length > 0 && (
                <div className={`text-xs rounded-lg px-3 py-2 ${isLight ? 'bg-red-50 text-red-600' : 'bg-red-900/30 text-red-300'}`}>
                  找不到欄位:{parsed.missingColumns.join('、')}。請確認CSV表頭名稱,或改用常見的日期/代號/類型/股數/價格命名。
                </div>
              )}

              <div className="flex items-center justify-between">
                <div className="text-sm font-bold">
                  預覽({parsed.rows.length}筆,已選{selectedCount}筆)
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setParsed(null);
                    setCheckedRows({});
                  }}
                  className={`text-xs font-bold ${isLight ? 'text-amber-600' : 'text-amber-400'}`}
                >
                  重新選擇
                </button>
              </div>

              <div className="space-y-1.5 max-h-80 overflow-y-auto">
                {parsed.rows.map((r) => {
                  const c = computedByIndex[r.rowIndex];
                  return (
                    <div
                      key={r.rowIndex}
                      className={`rounded-xl px-3 py-2 text-xs ${
                        !r.valid
                          ? isLight
                            ? 'bg-red-50'
                            : 'bg-red-900/20'
                          : r.isDuplicate
                          ? isLight
                            ? 'bg-amber-50'
                            : 'bg-amber-900/20'
                          : isLight
                          ? 'bg-slate-100'
                          : 'bg-slate-800/60'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {r.valid ? (
                          <button
                            type="button"
                            onClick={() => toggleRow(r.rowIndex)}
                            className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                              checkedRows[r.rowIndex]
                                ? 'bg-amber-500 border-amber-500'
                                : isLight
                                ? 'border-slate-400'
                                : 'border-slate-500'
                            }`}
                          >
                            {checkedRows[r.rowIndex] && <Check className="w-3 h-3 text-white" />}
                          </button>
                        ) : (
                          <X className="w-4 h-4 text-red-500 shrink-0" />
                        )}
                        <div className="flex-1 font-mono">
                          {r.date || '－'}　{r.symbol || '－'}
                          {r.name ? ` ${r.name}` : ''}　{r.type ? TX_TYPE_LABELS[r.type] : '－'}
                          {r.type === TX_TYPES.CASH_DIVIDEND
                            ? `金額${r.amount ? formatMoney(r.amount) : '－'}`
                            : `${r.shares ? formatMoney(r.shares) : '－'}股　${r.price || '－'}`}
                        </div>
                        {r.isDuplicate && <span className="text-amber-600 font-bold shrink-0">疑似重複</span>}
                      </div>
                      {!r.valid && <div className="mt-1 text-red-500 pl-6">{r.errors.join('、')}</div>}
                      {r.valid &&
                        checkedRows[r.rowIndex] &&
                        c &&
                        r.type !== TX_TYPES.CASH_DIVIDEND &&
                        r.type !== TX_TYPES.STOCK_DIVIDEND && (
                          <div className="mt-1 pl-6 opacity-60">
                            估計手續費{formatMoney(c.fee)}元・估計證交稅{formatMoney(c.tax)}元
                            {c.isDayTrade ? '(當沖減半)' : ''}
                          </div>
                        )}
                    </div>
                  );
                })}
              </div>

              {selectedCount > 0 && (
                <div className="text-xs opacity-60 flex justify-between">
                  <span>預估手續費合計:{formatMoney(totalFee)} 元</span>
                  <span>預估證交稅合計:{formatMoney(totalTax)} 元</span>
                </div>
              )}

              <button
                type="button"
                disabled={selectedCount === 0}
                onClick={handleConfirmImport}
                className={`w-full py-3 rounded-full font-bold text-sm ${
                  selectedCount > 0
                    ? 'bg-amber-500 text-white'
                    : isLight
                    ? 'bg-slate-200 text-slate-400'
                    : 'bg-slate-700 text-slate-500'
                }`}
              >
                確認匯入{selectedCount}筆
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ============== 備份與還原 ==============
// 為什麼要有:2026-10 同步出錯把雲端與各裝置的資料都清空過一次,最後是從瀏覽器的資料庫
// 檔案裡把舊資料挖回來的。有了「下載備份檔」與「從備份還原」,之後就不用靠運氣。
export function BackupSheet({ isLight, data, onClose, onRestore }) {
  const [pending, setPending] = useState(null); // { data, summary, source }
  const [error, setError] = useState('');
  const auto = useMemo(() => loadAutoBackup(window.localStorage), []);
  const current = summarizeBackup(data);

  const download = () => {
    const blob = new Blob([makeBackupFile(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `持股備份-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const pickFile = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = parseBackupFile(String(reader.result || ''));
        setPending({ data: d, summary: summarizeBackup(d), source: file.name });
        setError('');
      } catch (err) {
        setPending(null);
        setError(err.message);
      }
    };
    reader.readAsText(file, 'utf-8');
  };
  const row = `w-full flex items-center gap-3 px-5 py-3.5 text-left ${isLight ? 'hover:bg-slate-100' : 'hover:bg-slate-700'}`;
  return (
    <div className="fixed inset-0 z-[75] flex items-end justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        data-testid="backup-sheet"
        className={`relative w-full sm:max-w-md rounded-t-2xl pb-6 pt-2 ${isLight ? 'bg-white text-slate-900' : 'bg-slate-800 text-white'}`}
      >
        <div className="w-10 h-1 rounded-full bg-slate-500/40 mx-auto my-2" />
        <div className="px-5 pb-2 font-bold">備份與還原</div>
        <div className="px-5 pb-2 text-xs opacity-60">
          目前:{current.txCount} 筆交易、{current.groupCount} 個群組
        </div>
        <button onClick={download} className={row}>
          <Archive className="w-4 h-4" />
          <span>下載備份檔(JSON)</span>
        </button>
        <label className={`${row} cursor-pointer`}>
          <Upload className="w-4 h-4" />
          <span>從備份檔還原…</span>
          <input type="file" accept=".json,application/json" className="hidden" onChange={pickFile} data-testid="backup-file" />
        </label>
        {auto && (
          <button
            onClick={() => setPending({ data: auto.data, summary: summarizeBackup(auto.data), source: `這台裝置 ${auto.date} 的自動備份` })}
            className={row}
          >
            <RefreshCw className="w-4 h-4" />
            <span>還原這台裝置的自動備份({auto.date},{summarizeBackup(auto.data).txCount} 筆)</span>
          </button>
        )}
        {error && <div className="px-5 py-2 text-sm text-red-500">{error}</div>}
        {pending && (
          <div className={`mx-4 mt-2 rounded-xl px-3 py-3 text-sm ${isLight ? 'bg-amber-50' : 'bg-amber-900/40'}`}>
            <div className="font-bold mb-1">{pending.source}</div>
            <div>
              {pending.summary.txCount} 筆交易、{pending.summary.symbolCount} 檔、{pending.summary.groupCount} 個群組
              {pending.summary.lastDate ? `,最後交易日 ${pending.summary.lastDate}` : ''}
            </div>
            <div className="text-xs opacity-70 mt-1">還原會取代目前的資料,並同步到雲端與其他裝置。</div>
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => {
                  onRestore(pending.data);
                  onClose();
                }}
                className="flex-1 py-2 rounded-lg bg-amber-500 text-white font-bold"
              >
                確定還原
              </button>
              <button onClick={() => setPending(null)} className="flex-1 py-2 rounded-lg border border-slate-400/50">
                取消
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============== 交易操作選單(編輯/移動/刪除) ==============

function TxActionSheet({ isLight, tx, onClose, onEdit, onCopy = () => {}, onMove, onDelete }) {
  return (
    <div className="fixed inset-0 z-[75] flex items-end justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className={`relative w-full sm:max-w-md rounded-t-2xl pb-6 pt-2 ${
          isLight ? 'bg-white text-slate-900' : 'bg-slate-800 text-white'
        }`}
      >
        <div className="w-10 h-1 rounded-full bg-slate-500/40 mx-auto my-2" />
        <button
          onClick={() => {
            onEdit(tx);
            onClose();
          }}
          className={`w-full flex items-center gap-3 px-5 py-3.5 text-left ${
            isLight ? 'hover:bg-slate-100' : 'hover:bg-slate-700'
          }`}
        >
          <Pencil className="w-4 h-4" />
          <span>編輯交易</span>
        </button>
        <button
          onClick={() => {
            onCopy(tx);
            onClose();
          }}
          className={`w-full flex items-center gap-3 px-5 py-3.5 text-left ${
            isLight ? 'hover:bg-slate-100' : 'hover:bg-slate-700'
          }`}
        >
          <Copy className="w-4 h-4" />
          <span>複製交易</span>
        </button>
        <button
          onClick={() => {
            onMove(tx);
            onClose();
          }}
          className={`w-full flex items-center gap-3 px-5 py-3.5 text-left ${
            isLight ? 'hover:bg-slate-100' : 'hover:bg-slate-700'
          }`}
        >
          <ArrowRightLeft className="w-4 h-4" />
          <span>移動交易紀錄</span>
        </button>
        <button
          onClick={() => {
            onDelete(tx.id);
            onClose();
          }}
          className={`w-full flex items-center gap-3 px-5 py-3.5 text-left text-red-500`}
        >
          <Trash2 className="w-4 h-4" />
          <span>刪除交易</span>
        </button>
        <button
          onClick={onClose}
          className={`w-full flex items-center gap-3 px-5 py-3.5 text-left ${
            isLight ? 'hover:bg-slate-100' : 'hover:bg-slate-700'
          }`}
        >
          <X className="w-4 h-4" />
          <span>取消</span>
        </button>
      </div>
    </div>
  );
}

// ============== 移動交易到別的群組 ==============

function MoveGroupSheet({ isLight, data, title = '移動到群組', currentGroupId = null, onClose, onConfirm }) {
  return (
    <div className="fixed inset-0 z-[75] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className={`relative w-full sm:max-w-sm sm:rounded-2xl rounded-t-2xl pb-6 pt-2 ${
          isLight ? 'bg-white text-slate-900' : 'bg-slate-800 text-white'
        }`}
      >
        <div className="text-center font-bold py-2">{title}</div>
        {data.groups.map((g) => (
          <button
            key={g.id}
            onClick={() => {
              onConfirm(g.id);
              onClose();
            }}
            className={`w-full flex items-center gap-3 px-5 py-3 text-left ${
              isLight ? 'hover:bg-slate-100' : 'hover:bg-slate-700'
            }`}
          >
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: g.color }} />
            <span className="flex-1">{g.name}</span>
            {g.id === currentGroupId && <Check className="w-4 h-4 text-emerald-500" />}
          </button>
        ))}
      </div>
    </div>
  );
}

// ============== 批次標籤選擇 ==============

function TagPickerModal({ isLight, tags, netShares = 0, selectedCount = 0, onClose, onApply, onCreate }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(DEFAULT_GROUP_COLORS[2]);
  // 只是提醒「淨股數不是0,可能不是一個完整的清倉波段」,不擋使用者實際套用——
  // 有些情況使用者就是清楚自己在做什麼(例如分批、跨群組),不應該被卡死。
  const netSharesWarning = netShares !== 0;
  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className={`relative w-full sm:max-w-sm sm:rounded-2xl rounded-t-2xl pb-6 pt-3 px-4 ${
          isLight ? 'bg-white text-slate-900' : 'bg-slate-800 text-white'
        }`}
      >
        <div className="font-bold mb-2">套用批次標籤</div>
        <div className="text-xs opacity-60 mb-3">
          標記這幾筆交易屬於同一個已清倉波段,方便你自己日後辨識、各自獨立檢視損益(只有你看得到標籤文字)。
        </div>

        {netSharesWarning && (
          <div
            className={`text-xs rounded-lg px-3 py-2 mb-3 ${
              isLight ? 'bg-amber-50 text-amber-700' : 'bg-amber-900/30 text-amber-300'
            }`}
          >
            ⚠已選{selectedCount}筆,淨股數{formatSigned(netShares)}股——不是0代表這批交易可能不是一個完整的買賣平倉,仍可套用,但損益計算僅供參考。
          </div>
        )}

        <div className="space-y-1 max-h-48 overflow-y-auto">
          {tags.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                onApply(t.id);
                onClose();
              }}
              className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-left ${
                isLight ? 'hover:bg-slate-100' : 'hover:bg-slate-700'
              }`}
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: t.color }} />
              <span className="flex-1 text-sm">{t.name}</span>
            </button>
          ))}
        </div>

        {creating ? (
          <div className="mt-3 space-y-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="標籤名稱(留空會自動命名,例如:已清倉1)"
              className={`w-full border rounded-lg px-3 py-2 text-sm outline-none ${
                isLight ? 'border-slate-300' : 'border-slate-600 bg-slate-900/40'
              }`}
            />
            <div className="flex gap-1.5">
              {DEFAULT_GROUP_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className="w-6 h-6 rounded-full flex items-center justify-center"
                  style={{ background: c }}
                >
                  {color === c && <Check className="w-3.5 h-3.5 text-white" />}
                </button>
              ))}
            </div>
            <button
              onClick={() => {
                onCreate(name.trim(), color);
                setCreating(false);
                setName('');
              }}
              className="w-full py-2 rounded-full bg-amber-500 text-white font-bold text-sm"
            >
              建立並套用
            </button>
          </div>
        ) : (
          <button
            onClick={() => setCreating(true)}
            className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg mt-1 text-sm font-bold ${
              isLight ? 'text-amber-600 hover:bg-amber-50' : 'text-amber-400 hover:bg-slate-700'
            }`}
          >
            <Tag className="w-4 h-4" />＋ 新增標籤
          </button>
        )}
      </div>
    </div>
  );
}

// ============== 群組設定 ==============

function GroupEditorModal({ isLight, group, isNew, onClose, onSave, onDelete }) {
  const [name, setName] = useState(group?.name || '新群組');
  const [color, setColor] = useState(group?.color || DEFAULT_GROUP_COLORS[0]);
  // ETF跟一般股票的手續費優惠、低消各自獨立設定(很多券商兩邊報價不一樣),
  // 新增交易時依代號自動套用對應那組,這裡用一個分頁切換來編輯,避免表單
  // 一次塞兩組設定、要一直往下滑。
  const [feeTab, setFeeTab] = useState('etf');
  const [etfFeeDiscountPct, setEtfFeeDiscountPct] = useState(group?.etfFeeDiscountPct ?? 100);
  const [etfMinFeeNormal, setEtfMinFeeNormal] = useState(group?.etfMinFeeNormal ?? 20);
  const [etfMinFeeOdd, setEtfMinFeeOdd] = useState(group?.etfMinFeeOdd ?? 20);
  const [stockFeeDiscountPct, setStockFeeDiscountPct] = useState(group?.stockFeeDiscountPct ?? 100);
  const [stockMinFeeNormal, setStockMinFeeNormal] = useState(group?.stockMinFeeNormal ?? 20);
  const [stockMinFeeOdd, setStockMinFeeOdd] = useState(group?.stockMinFeeOdd ?? 20);

  const isEtfTab = feeTab === 'etf';
  const feeDiscountPct = isEtfTab ? etfFeeDiscountPct : stockFeeDiscountPct;
  const setFeeDiscountPct = isEtfTab ? setEtfFeeDiscountPct : setStockFeeDiscountPct;
  const minFeeNormal = isEtfTab ? etfMinFeeNormal : stockMinFeeNormal;
  const setMinFeeNormal = isEtfTab ? setEtfMinFeeNormal : setStockMinFeeNormal;
  const minFeeOdd = isEtfTab ? etfMinFeeOdd : stockMinFeeOdd;
  const setMinFeeOdd = isEtfTab ? setEtfMinFeeOdd : setStockMinFeeOdd;

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className={`relative w-full sm:max-w-sm sm:rounded-2xl rounded-t-2xl max-h-[90vh] overflow-y-auto ${
          isLight ? 'bg-white text-slate-900' : 'bg-slate-900 text-white'
        }`}
      >
        <div className="flex items-center gap-3 px-4 pt-4 pb-2">
          <button onClick={onClose} className="w-10 h-10 -ml-2 -my-2 flex items-center justify-center shrink-0">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="font-bold">{isNew ? '新增群組' : '群組設定'}</div>
        </div>
        <div className="px-4 pb-6 space-y-4">
          <FieldBox label="群組名稱" icon={<span className="text-[10px] opacity-60 font-bold">ABC</span>} isLight={isLight}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={`flex-1 bg-transparent outline-none text-lg font-bold ${
                isLight ? 'text-slate-900' : 'text-white'
              }`}
            />
          </FieldBox>

          <div
            className={`border rounded-xl px-3 py-3 ${isLight ? 'border-slate-300' : 'border-slate-600'}`}
          >
            <div className="flex items-center gap-2 text-sm mb-2 opacity-70">
              <Palette className="w-4 h-4" />
              群組顏色
            </div>
            <div className="flex gap-2 flex-wrap">
              {DEFAULT_GROUP_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className="w-8 h-8 rounded-full flex items-center justify-center"
                  style={{ background: c }}
                >
                  {color === c && <Check className="w-4 h-4 text-white" />}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between text-sm mb-2 opacity-70">
              <span>手續費設定</span>
              <span className="text-xs opacity-60">新增交易依代號(00開頭)自動套用</span>
            </div>
            <div className={`flex rounded-full p-0.5 mb-3 ${isLight ? 'bg-slate-100' : 'bg-slate-800'}`}>
              <button
                type="button"
                onClick={() => setFeeTab('etf')}
                className={`flex-1 px-3 py-1.5 rounded-full text-xs font-bold ${
                  isEtfTab ? 'bg-amber-500 text-white' : 'opacity-60'
                }`}
              >
                ETF
              </button>
              <button
                type="button"
                onClick={() => setFeeTab('stock')}
                className={`flex-1 px-3 py-1.5 rounded-full text-xs font-bold ${
                  !isEtfTab ? 'bg-amber-500 text-white' : 'opacity-60'
                }`}
              >
                一般股票
              </button>
            </div>

            <div
              className={`border rounded-xl px-4 py-3 mb-3 ${isLight ? 'border-slate-300' : 'border-slate-600'}`}
            >
              <div className="flex items-center justify-between text-sm mb-2">
                <span>{isEtfTab ? 'ETF' : '一般股票'}手續費優惠</span>
                <span className="font-mono font-bold">{feeDiscountPct}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={feeDiscountPct}
                onChange={(e) => setFeeDiscountPct(parseInt(e.target.value, 10))}
                className="w-full accent-amber-500"
              />
            </div>

            <div className="space-y-4">
              <FieldBox
                label={`${isEtfTab ? 'ETF' : '一般股票'}一般交易手續費低消`}
                icon={<span className="opacity-60 font-mono">$</span>}
                isLight={isLight}
              >
                <input
                  type="number"
                  value={minFeeNormal}
                  onChange={(e) => setMinFeeNormal(parseFloat(e.target.value) || 0)}
                  className={`flex-1 bg-transparent outline-none text-lg font-mono font-bold ${
                    isLight ? 'text-slate-900' : 'text-white'
                  }`}
                />
              </FieldBox>
              <FieldBox
                label={`${isEtfTab ? 'ETF' : '一般股票'}零股交易手續費低消`}
                icon={<span className="opacity-60 font-mono">$</span>}
                isLight={isLight}
              >
                <input
                  type="number"
                  value={minFeeOdd}
                  onChange={(e) => setMinFeeOdd(parseFloat(e.target.value) || 0)}
                  className={`flex-1 bg-transparent outline-none text-lg font-mono font-bold ${
                    isLight ? 'text-slate-900' : 'text-white'
                  }`}
                />
              </FieldBox>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            {!isNew && (
              <button
                onClick={() => onDelete(group.id)}
                className="px-4 py-3 rounded-xl bg-red-500/10 text-red-500 font-bold text-sm flex items-center gap-1.5"
              >
                <Trash2 className="w-4 h-4" />
                刪除群組
              </button>
            )}
            <button
              onClick={() =>
                onSave({
                  name: name.trim() || '未命名群組',
                  color,
                  etfFeeDiscountPct,
                  etfMinFeeNormal,
                  etfMinFeeOdd,
                  stockFeeDiscountPct,
                  stockMinFeeNormal,
                  stockMinFeeOdd,
                })
              }
              className="flex-1 py-3 rounded-full bg-amber-500 text-white font-bold text-sm"
            >
              儲存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============== 群組切換器 ==============

function GroupSwitcherSheet({ isLight, data, onClose, onSelect, onNewGroup, onOpenSettings }) {
  return (
    <div className="fixed inset-0 z-[65] flex items-start justify-center pt-20">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className={`relative w-[90%] max-w-xs rounded-2xl overflow-hidden shadow-xl ${
          isLight ? 'bg-white text-slate-900' : 'bg-slate-800 text-white'
        }`}
      >
        <div
          className={`text-center font-bold py-3 border-b ${
            isLight ? 'border-slate-200' : 'border-slate-700'
          }`}
        >
          群組
        </div>
        <button
          onClick={() => {
            onSelect(ALL_GROUP_ID);
            onClose();
          }}
          className={`w-full flex items-center gap-2.5 px-4 py-3 text-left ${
            isLight ? 'hover:bg-slate-100' : 'hover:bg-slate-700'
          }`}
        >
          <span className="w-3 h-3 rounded-sm shrink-0 bg-gradient-to-br from-slate-400 to-slate-600" />
          <span className="flex-1 font-bold">全部(群組總覽)</span>
          {data.activeGroupId === ALL_GROUP_ID && <Check className="w-4 h-4 text-emerald-500" />}
        </button>
        {data.activeGroupId !== ALL_GROUP_ID && (
          <button
            onClick={() => {
              onOpenSettings(data.activeGroupId);
              onClose();
            }}
            className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-sm opacity-80 ${
              isLight ? 'hover:bg-slate-100' : 'hover:bg-slate-700'
            }`}
          >
            <Settings className="w-4 h-4" />
            群組設定
          </button>
        )}
        <div className={`border-t pt-1 ${isLight ? 'border-slate-200' : 'border-slate-700'}`}>
          <div className="px-4 pt-1.5 pb-1 text-xs opacity-50">切換群組</div>
          {data.groups.map((g) => (
            <button
              key={g.id}
              onClick={() => {
                onSelect(g.id);
                onClose();
              }}
              className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left ${
                isLight ? 'hover:bg-slate-100' : 'hover:bg-slate-700'
              }`}
            >
              <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: g.color }} />
              <span className="flex-1">{g.name}</span>
              {g.id === data.activeGroupId && <Check className="w-4 h-4 text-emerald-500" />}
            </button>
          ))}
        </div>
        <button
          onClick={() => {
            onNewGroup();
            onClose();
          }}
          className={`w-full flex items-center gap-2.5 px-4 py-3 text-left font-bold border-t ${
            isLight ? 'border-slate-200 text-amber-600 hover:bg-amber-50' : 'border-slate-700 text-amber-400 hover:bg-slate-700'
          }`}
        >
          <Plus className="w-4 h-4" />＋ 新增群組
        </button>
      </div>
    </div>
  );
}

// ============== 小統計卡片 ==============

function StatCard({
  isLight,
  label,
  value,
  valueClass = '',
  subValue,
  subValueClass = '',
  // 預設維持原本「(subValue)」的括號樣式;個股頁今日損益卡要不加括號才用 false
  subValueParens = true,
  sizeClass = 'shrink-0 min-w-[110px]',
  // 有傳 onClick 才變成可點(例如今日損益點開明細);其他卡片維持原樣
  onClick,
  testId,
}) {
  return (
    <div
      onClick={onClick}
      data-testid={testId}
      className={`rounded-xl px-3 py-2.5 ${sizeClass} ${onClick ? 'cursor-pointer' : ''} ${
        isLight ? 'bg-slate-100' : 'bg-slate-800/60'
      }`}
    >
      <div className={`text-[11px] mb-1 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>{label}</div>
      <div className={`text-base font-mono font-bold ${valueClass}`}>{value}</div>
      {subValue && (
        <div className={`text-[11px] font-mono mt-0.5 ${subValueClass || (isLight ? 'text-slate-500' : 'text-slate-400')}`}>
          {subValueParens ? `(${subValue})` : subValue}
        </div>
      )}
    </div>
  );
}

// ============== 今日損益明細(浮動視窗,樣式比照熱力圖細節框) ==============
// rows: [{ symbol, name, pnl, parts:[{kind,shares,pnl}] }];每檔列出各部分怎麼來的
// 明細分兩區:「現有庫存」(目前還抱著的股數,對應首頁持股列表的股數)與「今日已交易」
// (今天賣掉的)。現有庫存再拆成兩種基準:昨天收盤就持有的(現價−昨收)、今天才買的(現價−買價),
// 兩者股數相加=首頁看到的持有股數,使用者才對得上帳。
const DAY_PART_LABELS = {
  carry: (n) => `昨天就持有 ${formatMoney(n)}股:現價−昨收`,
  boughtToday: (n) => `今日買進 ${formatMoney(n)}股:現價−買價`,
  soldPrev: (n) => `賣出(昨天就持有)${formatMoney(n)}股:賣價−昨收`,
  dayTrade: (n) => `當沖 ${formatMoney(n)}股:賣價−買價`,
};
const HOLD_KINDS = ['carry', 'boughtToday'];
const TRADED_KINDS = ['soldPrev', 'dayTrade'];

export function TodayPnlPopup({ isLight, title = '今日損益明細', rows, onClose }) {
  const list = rows.filter((r) => r.parts && r.parts.length > 0).sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));
  const total = list.reduce((n, r) => n + r.pnl, 0);
  const muted = isLight ? 'text-slate-500' : 'text-slate-400';
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        data-testid="today-pnl-popup"
        onClick={(e) => e.stopPropagation()}
        className={`relative w-full max-w-sm max-h-[75vh] overflow-y-auto rounded-xl px-5 py-4 shadow-2xl ${
          isLight ? 'bg-white text-slate-900' : 'bg-slate-800 text-white'
        }`}
      >
        <div className="text-center mb-3">
          <div className="font-bold">{title}</div>
          <div className={`font-mono font-bold text-xl ${pnlColorClass(total, isLight)}`}>{formatSigned(total)}</div>
          <div className={`text-[11px] ${muted}`}>價差損益,不含手續費、證交稅與股利(股利算在今日已實現)</div>
        </div>
        {list.length === 0 && <div className={`text-center text-sm py-4 ${muted}`}>今天沒有可計算的持股或交易</div>}
        {list.map((r) => {
          const lb = symbolLabel(r.symbol, r.name);
          return (
            <div key={r.symbol} data-testid="today-pnl-row" className={`py-2 border-t ${isLight ? 'border-slate-200' : 'border-slate-700'}`}>
              <div className="flex items-baseline justify-between gap-2">
                <div className={`font-bold truncate ${lb.codeFirst ? 'font-mono' : ''}`}>{lb.primary}</div>
                <div className={`font-mono font-bold shrink-0 ${pnlColorClass(r.pnl, isLight)}`}>{formatSigned(r.pnl)}</div>
              </div>
              {[
                { key: 'hold', kinds: HOLD_KINDS, title: (n) => `現有庫存 ${formatMoney(n)}股` },
                { key: 'traded', kinds: TRADED_KINDS, title: () => '今日已交易' },
              ].map((sec) => {
                const ps = r.parts.filter((pt) => sec.kinds.includes(pt.kind));
                if (ps.length === 0) return null;
                const sh = ps.reduce((n, pt) => n + pt.shares, 0);
                const sub = ps.reduce((n, pt) => n + pt.pnl, 0);
                return (
                  <div key={sec.key} className="mt-1">
                    <div className="flex justify-between gap-2 text-xs font-semibold">
                      <span>{sec.title(sh)}</span>
                      <span className={`font-mono shrink-0 ${pnlColorClass(sub, isLight)}`}>{formatSigned(sub)}</span>
                    </div>
                    {ps.map((pt) => (
                      <div key={pt.kind} className={`flex justify-between gap-2 text-[11px] pl-3 ${muted}`}>
                        <span>{DAY_PART_LABELS[pt.kind](pt.shares)}</span>
                        <span className={`font-mono shrink-0 ${pnlColorClass(pt.pnl, isLight)}`}>{formatSigned(pt.pnl)}</span>
                      </div>
                    ))}
                    {sec.key === 'hold' && (ps.find((pt) => pt.kind === 'carry') || {}).lots && (
                      <div data-testid="carry-lots" className={`pl-3 text-[11px] ${muted}`}>
                        昨天庫存來源:{ps.find((pt) => pt.kind === 'carry').lots.map((l) => `${l.date.slice(5)} 買${formatMoney(l.shares)}股`).join('、')}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============== 持股總覽(主畫面) ==============

function HoldingsListView({
  isLight,
  data,
  holdings,
  hiddenCount,
  showHidden,
  onToggleHidden,
  totalSummary,
  onOpenDetail,
  onOpenSwitcher,
  onSelectGroup,
  onNewGroup,
  onOpenSettings,
  onOpenSummary,
  onOpenTodayTx,
  onOpenTodayPnl = () => {},
  onOpenHeatmap = () => {},
  onAddTx,
  onOpenImport,
  activeGroup,
  selectMode,
  selectedSymbols,
  onToggleSelectMode,
  onToggleSelectSymbol,
  onOpenMoveSymbols,
  userEmail,
  onSignOut,
  onRefreshPrices,
  refreshingPrices,
  sync = { status: 'off' },
  onRetrySync = () => {},
  onDismissRestored = () => {},
  onOpenBackup = () => {},
  onDismissBlocked = () => {},
  onAcceptRemote = () => {},
  onForceUpload = () => {},
}) {
  const displayedHoldings = holdings;
  const syncLoading = sync.status === 'loading';
  // 浮動「切換群組」色塊鈕:點開主鈕,原地往上展開每個群組各一顆的色塊小圓鈕
  // (用群組自己的顏色),點哪顆就切到哪個群組;「全部」跟「+新增群組」也各佔
  // 一顆,收合在同一個位置。主鈕放在跟其他頁面「回上一層」鈕相同的 bottom-56
  // right-4 位置——首頁本來就沒有返回鈕,這個位置是空的,讓同一個視覺角落在
  // 每個頁面都有一致的浮動鈕可以按。
  const [groupDialOpen, setGroupDialOpen] = useState(false);
  return (
    <div className="pb-24">
      <div className="flex items-center justify-between px-4 pt-4">
        <button
          onClick={() => activeGroup && onOpenSettings(activeGroup.id)}
          className={`p-2 rounded-full ${isLight ? 'hover:bg-slate-100' : 'hover:bg-slate-800'}`}
        >
          <Settings className="w-5 h-5 opacity-70" />
        </button>
        <button
          onClick={onOpenSwitcher}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${
            isLight ? 'border-slate-300 bg-white' : 'border-slate-600 bg-slate-800'
          }`}
        >
          <span
            className="w-3 h-3 rounded-sm shrink-0"
            style={{ background: activeGroup ? activeGroup.color : '#94a3b8' }}
          />
          <span className="font-bold text-sm">{activeGroup ? activeGroup.name : '全部'}</span>
          <ChevronDown className="w-4 h-4 opacity-60" />
        </button>
        <div className="flex items-center">
          <button
            onClick={onRefreshPrices}
            disabled={refreshingPrices}
            className={`p-2 rounded-full ${isLight ? 'hover:bg-slate-100' : 'hover:bg-slate-800'} disabled:opacity-50`}
            title="重新抓取最新股價/市值"
          >
            <RefreshCw className={`w-5 h-5 opacity-70 ${refreshingPrices ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={onOpenImport}
            className={`p-2 rounded-full ${isLight ? 'hover:bg-slate-100' : 'hover:bg-slate-800'}`}
            title="CSV 匯入交易"
          >
            <Upload className="w-5 h-5 opacity-70" />
          </button>
          <button
            onClick={onOpenBackup}
            className={`p-2 rounded-full ${isLight ? 'hover:bg-slate-100' : 'hover:bg-slate-800'}`}
            title="備份與還原"
            aria-label="備份與還原"
          >
            <Archive className="w-5 h-5 opacity-70" />
          </button>
          {userEmail && (
            <button
              onClick={() => {
                if (window.confirm(`登出 ${userEmail}?\n資料已經同步在雲端,登出不會刪除任何資料。`)) {
                  onSignOut();
                }
              }}
              className={`p-2 rounded-full ${isLight ? 'hover:bg-slate-100' : 'hover:bg-slate-800'}`}
              title={`已登入:${userEmail}(點擊登出)`}
            >
              <LogOut className="w-5 h-5 opacity-70" />
            </button>
          )}
        </div>
      </div>

      {/* 雲端同步狀態:下載中/無法連線要明確提示,不然空白畫面會被誤會成「資料不見了」 */}
      {syncLoading && (
        <div
          data-testid="sync-banner"
          className={`mx-4 mt-3 rounded-xl px-3 py-2 text-sm flex items-center gap-2 ${
            isLight ? 'bg-sky-50 text-sky-800' : 'bg-sky-900/40 text-sky-200'
          }`}
        >
          <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
          <span>正在從雲端下載你的持股資料…下載完成前,這台裝置的變更不會上傳。</span>
        </div>
      )}
      {sync.status === 'error' && (
        <div
          data-testid="sync-banner"
          className={`mx-4 mt-3 rounded-xl px-3 py-2 text-sm flex items-center gap-2 ${
            isLight ? 'bg-amber-50 text-amber-800' : 'bg-amber-900/40 text-amber-200'
          }`}
        >
          <CloudOff className="w-4 h-4 shrink-0" />
          <span className="flex-1">
            {sync.error === 'save'
              ? '變更還沒上傳到雲端(網路不穩?),已先存在這台裝置。'
              : sync.error === 'shrink'
              ? `這次變更會讓雲端少掉 ${sync.shrinkCount} 筆交易,為了安全先沒有上傳。確定是你要的,再按「仍要上傳」。`
              : '無法連線雲端,目前顯示這台裝置上的資料;連上之前,變更只會存在這台裝置。'}
          </span>
          <button
            onClick={sync.error === 'shrink' ? onForceUpload : onRetrySync}
            className="shrink-0 px-2 py-1 rounded-lg font-bold bg-amber-500 text-white"
          >
            {sync.error === 'shrink' ? '仍要上傳' : '重試'}
          </button>
        </div>
      )}
      {sync.blocked && sync.blocked.count > 0 && (
        <div
          data-testid="sync-blocked"
          className={`mx-4 mt-3 rounded-xl px-3 py-2 text-sm ${isLight ? 'bg-amber-50 text-amber-800' : 'bg-amber-900/40 text-amber-200'}`}
        >
          <div>
            雲端資料少了 {sync.blocked.count} 筆交易(可能是其他裝置還在用舊版程式,或同步出錯),
            已保留這台裝置的資料並重新上傳到雲端。
          </div>
          <div className="flex gap-2 mt-2">
            <button onClick={onDismissBlocked} className="flex-1 py-1.5 rounded-lg bg-amber-500 text-white font-bold">
              保留這台的資料
            </button>
            <button onClick={onAcceptRemote} className="flex-1 py-1.5 rounded-lg border border-amber-500/60">
              改用雲端版本(刪除這 {sync.blocked.count} 筆)
            </button>
          </div>
        </div>
      )}
      {sync.restoredCount > 0 && (
        <div
          className={`mx-4 mt-3 rounded-xl px-3 py-2 text-sm flex items-center gap-2 ${
            isLight ? 'bg-emerald-50 text-emerald-800' : 'bg-emerald-900/40 text-emerald-200'
          }`}
        >
          <Cloud className="w-4 h-4 shrink-0" />
          <span className="flex-1">已把這台裝置上 {sync.restoredCount} 筆雲端沒有的交易補上傳。</span>
          <button onClick={onDismissRestored} className="shrink-0 p-1" aria-label="關閉">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {sync.status === 'synced' && sync.lastSyncedAt && (
        <div className={`px-4 pt-2 text-xs flex items-center justify-center gap-1 ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>
          <Cloud className="w-3 h-3" />
          已同步 {sync.lastSyncedAt.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}
        </div>
      )}

      {/* Adam要求的版面調整:原本這兩個位置分別放「庫存市值」「未實現損益」,
          現在位置、字型格式都不變,改放「總損益(不顯示%)」「庫存市值」。 */}
      <div className="px-4 pt-3 text-center">
        <div className="text-4xl font-mono font-bold tracking-tight">{formatSigned(totalSummary.totalPnl)}</div>
        <div className={`mt-1 font-mono font-bold ${pnlColorClass(totalSummary.marketValue, isLight)}`}>
          {formatMoney(totalSummary.marketValue)}
        </div>
      </div>

      <div className="px-4 mt-5 flex items-center justify-between">
        <div className="font-bold">績效數據</div>
        <div className="flex items-center gap-3">
          <button
            onClick={onOpenHeatmap}
            className={`text-xs font-bold ${isLight ? 'text-amber-600' : 'text-amber-400'}`}
          >
            熱力圖 &gt;
          </button>
          <button
            onClick={onOpenTodayTx}
            className={`text-xs font-bold ${isLight ? 'text-amber-600' : 'text-amber-400'}`}
          >
            今日交易 &gt;
          </button>
          <button
            onClick={onOpenSummary}
            className={`text-xs font-bold ${isLight ? 'text-amber-600' : 'text-amber-400'}`}
          >
            查看全部 &gt;
          </button>
        </div>
      </div>
      {/* 同樣是版面調整:「今日損益」位置不變,下方括號多加「今日已實現損益」;
          原本「總損益」的位置、格式不變,改放「未實現損益」。 */}
      <div className="px-4 mt-2 flex gap-2 pb-1">
        <StatCard
          isLight={isLight}
          label="今日損益"
          value={`${formatSigned(totalSummary.todayPnl)}｜${formatPct(totalSummary.todayPnlPct)}`}
          valueClass={pnlColorClass(totalSummary.todayPnl, isLight)}
          subValue={`今日已實現損益${formatSigned(totalSummary.todayRealizedPnl)}`}
          subValueClass={pnlColorClass(totalSummary.todayRealizedPnl, isLight)}
          sizeClass="flex-1 min-w-0"
          onClick={onOpenTodayPnl}
          testId="home-today-pnl-card"
        />
        <StatCard
          isLight={isLight}
          label="未實現損益"
          value={`${formatSigned(totalSummary.unrealizedPnl)}｜${formatPct(totalSummary.unrealizedPnlPct)}`}
          valueClass={pnlColorClass(totalSummary.unrealizedPnl, isLight)}
          sizeClass="flex-1 min-w-0"
        />
      </div>

      {/* 這個區塊(標題列+持股卡片)的左右留白從 px-4 收窄到 px-3,
          騰出來的寬度讓卡片內部欄位(尤其股名)能排得下更多字,
          跟上方總覽/績效數據區塊的 px-4 略有一點點落差,但差距很小(4px)
          幾乎看不出來,換來的卡片內部空間比較划算。 */}
      <div className="px-3 mt-5 flex items-center justify-between">
        <div className="font-bold">
          持股紀錄{' '}
          <span className={`text-xs font-normal ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
            顯示{holdings.length}檔{hiddenCount > 0 ? `，隱藏${hiddenCount}檔` : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {hiddenCount > 0 && (
            <button
              onClick={onToggleHidden}
              className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                showHidden
                  ? 'bg-amber-500 text-white'
                  : isLight
                  ? 'bg-slate-100 text-slate-600'
                  : 'bg-slate-800 text-slate-300'
              }`}
            >
              {showHidden ? '隱藏已清倉' : '顯示已出場部位'}
            </button>
          )}
          <button
            onClick={onToggleSelectMode}
            className={`text-xs font-bold px-2.5 py-1 rounded-full ${
              selectMode
                ? 'bg-amber-500 text-white'
                : isLight
                ? 'bg-slate-100 text-slate-600'
                : 'bg-slate-800 text-slate-300'
            }`}
          >
            {selectMode ? '完成' : '框選移動'}
          </button>
        </div>
      </div>

      <div className="px-3 mt-2 space-y-2">
        {displayedHoldings.length === 0 && (
          <div className={`text-center py-10 text-sm ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>
            {syncLoading ? '正在從雲端載入持股…' : '這個群組還沒有任何持股,點右下角「＋」新增第一筆交易。'}
          </div>
        )}
        {displayedHoldings.map((h) => {
          const isClosed = h.summary.shares === 0;

          // 已清倉(庫存0股)的標的:現價/市值這些欄位都沒有意義(不會再變動),
          // 改比照「交易紀錄」裡已框選分類的收合卡片呈現方式——左邊名稱+交易
          // 期間/筆數,右邊直接秀已實現損益,而不是硬套用一般持股那組現價/
          // 市值欄位全部顯示0或「-」。外層卡片的 class(rounded-xl px-3 py-3)
          // 跟一般持股保持一致,格子大小才不會跑掉。
          if (isClosed) {
            const sortedTxs = [...(h.txs || [])].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
            const txCount = sortedTxs.length;
            const dateRange = txCount
              ? sortedTxs[0].date === sortedTxs[txCount - 1].date
                ? sortedTxs[0].date
                : `${sortedTxs[0].date} ~ ${sortedTxs[txCount - 1].date}`
              : '-';
            return (
              <div
                key={h.symbol}
                onClick={() => (selectMode ? onToggleSelectSymbol(h.symbol) : onOpenDetail(h.symbol))}
                className={`w-full flex items-center gap-2 rounded-xl px-3 py-3 cursor-pointer ${
                  isLight ? 'bg-slate-100 hover:bg-slate-200' : 'bg-slate-800/60 hover:bg-slate-800'
                }`}
              >
                {selectMode && (
                  <div
                    className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 ${
                      selectedSymbols.has(h.symbol)
                        ? 'bg-amber-500 border-amber-500'
                        : isLight
                        ? 'border-slate-400'
                        : 'border-slate-500'
                    }`}
                  >
                    {selectedSymbols.has(h.symbol) && <Check className="w-3.5 h-3.5 text-white" />}
                  </div>
                )}
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${isLight ? 'bg-slate-400' : 'bg-slate-500'}`} />
                <div className="flex-1 min-w-0 text-left">
                  {(() => {
                    const lb = symbolLabel(h.symbol, h.name);
                    return (
                      <div className={`font-bold truncate ${lb.codeFirst ? 'text-base font-mono' : 'text-sm'}`}>
                        {lb.primary}
                        {lb.secondary && (
                          <span
                            className={`ml-1.5 text-[11px] font-normal font-sans ${isLight ? 'text-slate-500' : 'text-slate-400'}`}
                          >
                            {lb.secondary}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                  <div className={`text-[11px] truncate ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                    {dateRange}｜共{txCount}筆
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className={`font-mono font-bold text-lg ${pnlColorClass(h.summary.totalPnl, isLight)}`}>
                    {formatSigned(h.summary.totalPnl)}
                  </div>
                  <div className={`text-[11px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>已實現損益</div>
                </div>
              </div>
            );
          }

          return (
            <div
              key={h.symbol}
              onClick={() => (selectMode ? onToggleSelectSymbol(h.symbol) : onOpenDetail(h.symbol))}
              className={`w-full flex items-center gap-2 rounded-xl px-2.5 py-2 cursor-pointer ${
                isLight ? 'bg-slate-100 hover:bg-slate-200' : 'bg-slate-800/60 hover:bg-slate-800'
              }`}
            >
              {selectMode && (
                <div
                  className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 ${
                    selectedSymbols.has(h.symbol)
                      ? 'bg-amber-500 border-amber-500'
                      : isLight
                      ? 'border-slate-400'
                      : 'border-slate-500'
                  }`}
                >
                  {selectedSymbols.has(h.symbol) && <Check className="w-3.5 h-3.5 text-white" />}
                </div>
              )}
              {/* Adam 反映:上一版後兩欄用 auto 寬度會依每一列自己的內容撐開,
                  導致不同標的的欄位邊界對不齊(他覺得 00945B 那列的比例最好看)。
                  改回「每欄固定寬度」,所有列共用同一組欄寬,數字再怎麼變都是
                  同一個邊界對齊,看起來才像同一個表格。均價/現價那欄固定 92px
                  (容得下 4 位數價格如 9999.99),市值/總損益那欄固定 128px
                  (容得下總損益帶正負號的 7 位數金額);股名欄(第一欄)吃掉
                  剩下的所有空間,搭配 line-clamp-2,欄位不夠寬時換行而不是被
                  省略號截斷。 */}
              <div
                className="flex-1 min-w-0 grid gap-1.5 text-left"
                style={{ gridTemplateColumns: 'minmax(0,1fr) 92px 128px' }}
              >
                <div className="min-w-0">
                  {symbolLabel(h.symbol, h.name).codeFirst ? (
                    <>
                      {/* ETF:代號是主角,放大放前面;名稱縮成一行小字 */}
                      <div className="font-mono font-bold text-lg leading-snug tracking-tight">{h.symbol}</div>
                      {h.name !== h.symbol && (
                        <div className={`text-xs truncate ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>{h.name}</div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className={`text-xs ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>{h.symbol}</div>
                      <div className="font-bold text-base leading-snug line-clamp-2 break-words">{h.name}</div>
                    </>
                  )}
                  <div className={`text-xs ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                    {formatMoney(h.summary.shares)}股
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className={`text-xs font-mono ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                    {h.summary.pureAvgPrice.toFixed(2)}
                  </div>
                  <div className={`font-mono font-bold text-lg whitespace-nowrap ${pnlColorClass(h.summary.todayPnl, isLight)}`}>
                    {h.summary.currentPrice ? h.summary.currentPrice.toFixed(2) : h.loading ? '…' : '-'}
                  </div>
                  <div className={`text-xs font-mono ${pnlColorClass(h.summary.todayPnl, isLight)}`}>
                    {formatPct(h.summary.todayPnlPct)}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  {/* Adam 反映:最右邊欄位該放大的是「總損益／%」,不是市值——
                      市值降為小字當背景資訊,總損益跟總損益%兩行才是這欄的主角,
                      跟左邊「均價/現價/今日%」那欄的現價一樣用 text-lg 當主視覺。 */}
                  <div className={`text-xs font-mono ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                    {formatMoney(h.summary.marketValue)}
                  </div>
                  <div className={`font-mono font-bold text-lg whitespace-nowrap ${pnlColorClass(h.summary.totalPnl, isLight)}`}>
                    {formatSigned(h.summary.totalPnl)}
                  </div>
                  <div className={`font-mono font-bold text-base whitespace-nowrap ${pnlColorClass(h.summary.totalPnl, isLight)}`}>
                    {formatPct(h.summary.totalPnlPct)}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {!selectMode && (
        <button
          onClick={onAddTx}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 w-14 h-14 rounded-full bg-amber-500 text-white shadow-lg flex items-center justify-center z-30"
        >
          <Plus className="w-6 h-6" />
        </button>
      )}
      {selectMode && selectedSymbols.size > 0 && (
        <button
          onClick={onOpenMoveSymbols}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3.5 rounded-full bg-amber-500 text-white shadow-lg flex items-center gap-2 z-30 font-bold text-sm"
        >
          <Folder className="w-4 h-4" />
          移動群組({selectedSymbols.size})
        </button>
      )}

      {!selectMode && (
        <>
          {groupDialOpen && (
            <div className="fixed inset-0 z-20" onClick={() => setGroupDialOpen(false)} />
          )}
          <div className="fixed bottom-56 right-4 z-30 flex flex-col items-center gap-2.5">
            {groupDialOpen && (
              // 群組一多,全部展開可能會超出畫面、搆不到;改成固定高度的捲動區,
              // 使用者可以把想要的那顆滑到拇指方便按的位置,不用整欄都攤開。
              <div
                className="flex flex-col items-center gap-2.5 max-h-56 overflow-y-auto overscroll-contain py-1"
                style={{ WebkitOverflowScrolling: 'touch' }}
              >
                <button
                  onClick={() => {
                    onNewGroup();
                    setGroupDialOpen(false);
                  }}
                  className="w-11 h-11 shrink-0 rounded-full shadow-lg flex items-center justify-center bg-amber-500 text-white"
                  title="新增群組"
                >
                  <Plus className="w-5 h-5" />
                </button>
                <button
                  onClick={() => {
                    onSelectGroup(ALL_GROUP_ID);
                    setGroupDialOpen(false);
                  }}
                  className={`w-11 h-11 shrink-0 rounded-full shadow-lg flex items-center justify-center bg-gradient-to-br from-slate-400 to-slate-600 text-white text-[11px] font-bold ${
                    data.activeGroupId === ALL_GROUP_ID ? 'ring-2 ring-white' : ''
                  }`}
                  title="全部(群組總覽)"
                >
                  全部
                </button>
                {data.groups.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => {
                      onSelectGroup(g.id);
                      setGroupDialOpen(false);
                    }}
                    style={{ background: g.color }}
                    className={`w-11 h-11 shrink-0 rounded-full shadow-lg flex items-center justify-center text-white text-[11px] font-bold ${
                      g.id === data.activeGroupId ? 'ring-2 ring-white' : ''
                    }`}
                    title={g.name}
                  >
                    {g.name.slice(0, 2)}
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={() => setGroupDialOpen((v) => !v)}
              style={{ background: activeGroup ? activeGroup.color : '#64748b' }}
              className="w-12 h-12 shrink-0 rounded-full shadow-xl flex items-center justify-center text-white"
              title="切換群組"
            >
              <Folder className="w-5 h-5" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ============== 個股詳情 ==============

export function StockDetailView({
  isLight,
  data,
  symbol,
  name,
  summary,
  transactions,
  tags,
  onBack,
  onAddTx,
  onOpenAction,
  selectMode,
  selectedTxIds,
  onToggleSelectMode,
  onToggleSelectTx,
  onOpenTagPicker,
  onRemoveTag = () => {},
}) {
  const [tab, setTab] = useState('transactions');
  const [showDayPnl, setShowDayPnl] = useState(false);
  const [expandedTagIds, setExpandedTagIds] = useState(() => new Set());
  const sorted = [...transactions].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  // 框選套用標籤時,選取的這幾筆交易「淨股數」要等於0,才代表構成一個完整的
  // 已清倉波段,之後才能各自獨立、準確地計算這組自己的已實現損益。
  const selectedNetShares = netShareDelta(sorted.filter((tx) => selectedTxIds.has(tx.id)));
  const selectedTaggedCount = sorted.filter((tx) => selectedTxIds.has(tx.id) && tx.tagId).length;

  // 已經套用同一個標籤的交易,在畫面上合併成一張可收合的「已清倉」卡片,累積
  // 越多組波段也不會讓交易紀錄越滑越長。只在「第一次遇到」(因為是新到舊
  // 排序,也就是這組裡最新的一筆)的位置插入卡片,組內其餘交易不再重複列出。
  const seenTagIds = new Set();
  const renderItems = [];
  sorted.forEach((tx) => {
    if (tx.tagId) {
      if (seenTagIds.has(tx.tagId)) return;
      seenTagIds.add(tx.tagId);
      const tag = tags.find((t) => t.id === tx.tagId);
      const groupTxs = sorted.filter((t) => t.tagId === tx.tagId);
      renderItems.push({ kind: 'group', date: tx.date, tag, tagId: tx.tagId, txs: groupTxs });
    } else {
      renderItems.push({ kind: 'tx', date: tx.date, tx });
    }
  });

  const grouped = {};
  renderItems.forEach((item) => {
    const month = item.date.slice(0, 7).replace('-', '/');
    if (!grouped[month]) grouped[month] = [];
    grouped[month].push(item);
  });

  const typeColor = (t) =>
    t === TX_TYPES.BUY
      ? isLight
        ? 'text-red-600'
        : 'text-red-400'
      : t === TX_TYPES.SELL
      ? isLight
        ? 'text-emerald-600'
        : 'text-emerald-400'
      : isLight
      ? 'text-amber-600'
      : 'text-amber-400';

  const toggleGroupExpanded = (tagId) => {
    setExpandedTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  };

  // showDate:在「依日期分段」底下,日期已經寫在分段標題,列裡就不重複;
  // 標籤卡片展開後的交易可能跨好幾天,才在列裡顯示日期
  // 先進先出配對:買進列旁註記「已在何時賣出」。整份交易一起配對(不受標籤收合影響)
  const fifo = useMemo(() => matchFifo(transactions), [transactions]);
  const sellNote = (tx) => {
    if (tx.type !== TX_TYPES.BUY) return '';
    const ms = fifo.buyMatches[tx.id] || [];
    if (ms.length === 0) return '';
    // 同一天的多筆賣出合併;整批賣完只寫日期,只賣掉一部分或分多天賣就附上股數
    const byDate = [];
    ms.forEach((m) => {
      const last = byDate[byDate.length - 1];
      if (last && last.date === m.date) last.shares += m.shares;
      else byDate.push({ date: m.date, shares: m.shares });
    });
    const md = (d) => String(d).slice(5).replace('-', '/');
    const whole = byDate.length === 1 && fifo.buyRemaining[tx.id] === 0 && byDate[0].shares === tx.shares;
    const text = byDate.map((x) => (whole ? md(x.date) : `${md(x.date)} 賣${formatMoney(x.shares)}`)).join('、');
    const rest = fifo.buyRemaining[tx.id];
    return `(賣出 ${text}${rest > 0 ? `,餘${formatMoney(rest)}股` : ''})`;
  };

  const renderTxRow = (tx, { showDate = true } = {}) => (
    <div
      key={tx.id}
      onClick={() => (selectMode ? onToggleSelectTx(tx.id) : onOpenAction(tx))}
      className={`flex items-center gap-2 rounded-xl px-3 py-2.5 cursor-pointer ${
        isLight ? 'bg-slate-100' : 'bg-slate-800/60'
      }`}
    >
      {selectMode && (
        <div
          className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 ${
            selectedTxIds.has(tx.id)
              ? 'bg-amber-500 border-amber-500'
              : isLight
              ? 'border-slate-400'
              : 'border-slate-500'
          }`}
        >
          {selectedTxIds.has(tx.id) && <Check className="w-3.5 h-3.5 text-white" />}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className={`font-bold text-sm ${typeColor(tx.type)}`}>
          {TX_TYPE_LABELS[tx.type]}
          {sellNote(tx) && (
            <span data-testid="sell-note" className={`ml-1 text-[11px] font-normal ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
              {sellNote(tx)}
            </span>
          )}
        </div>
        {showDate && <div className={`text-xs ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>{tx.date}</div>}
        {tx.type !== TX_TYPES.CASH_DIVIDEND && (
          <div className="font-mono font-bold text-sm">{tx.price.toFixed(2)}</div>
        )}
      </div>
      <div className="text-right shrink-0">
        <div className="font-mono font-bold text-sm">{formatSigned(tx.amount)}</div>
        {tx.type !== TX_TYPES.CASH_DIVIDEND && (
          <div className={`font-mono text-xs ${typeColor(tx.type)}`}>
            {tx.type === TX_TYPES.SELL ? '-' : '+'}
            {formatMoney(tx.shares)}股
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="pb-24">
      <div className="flex items-center gap-2 px-4 pt-4">
        <button onClick={onBack} className="w-10 h-10 -ml-2 -my-2 flex items-center justify-center shrink-0">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 text-center -ml-7">
          {symbolLabel(symbol, name).codeFirst ? (
            <>
              <div className="font-mono font-bold text-xl leading-tight">{symbol}</div>
              {name !== symbol && <div className={`text-xs ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>{name}</div>}
            </>
          ) : (
            <>
              <div className={`text-xs ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>{symbol}</div>
              <div className="font-bold">{name}</div>
            </>
          )}
        </div>
      </div>

      {/* 在「詳細數據」分頁時,把市值大數字跟這排統計卡收起來,
          讓下面的數據表格不用滑動就能一次看完;切回「交易紀錄」分頁時照常顯示。 */}
      {tab === 'transactions' && (
        <>
          <div className="px-4 pt-2 text-center">
            <div className="text-3xl font-mono font-bold tracking-tight">{formatMoney(summary.marketValue)}</div>
            <div className={`mt-1 font-mono font-bold text-sm ${pnlColorClass(summary.unrealizedPnl, isLight)}`}>
              {formatSigned(summary.unrealizedPnl)}｜{formatPct(summary.unrealizedPnlPct)}
            </div>
          </div>

          <div className="px-4 mt-3 flex gap-2 overflow-x-auto">
            <StatCard isLight={isLight} label="持有股數" value={`${formatMoney(summary.shares)}股`} />
            {/* 今日損益放在持有股數與現價之間:主值是金額、下方小字是百分比(不加括號) */}
            <StatCard
              isLight={isLight}
              label="今日損益"
              value={formatSigned(summary.todayPnl)}
              valueClass={pnlColorClass(summary.todayPnl, isLight)}
              subValue={formatPct(summary.todayPnlPct)}
              subValueClass={pnlColorClass(summary.todayPnl, isLight)}
              subValueParens={false}
              onClick={() => setShowDayPnl(true)}
              testId="detail-today-pnl-card"
            />
            <StatCard isLight={isLight} label="現價" value={summary.currentPrice.toFixed(2)} />
            <StatCard isLight={isLight} label="買進均價" value={summary.avgPrice.toFixed(2)} />
          </div>
        </>
      )}

      {showDayPnl && (
        <TodayPnlPopup
          isLight={isLight}
          title={`今日損益明細｜${symbolLabel(symbol, name).primary}`}
          rows={[{ symbol, name, pnl: summary.todayPnl, parts: summary.todayPnlParts }]}
          onClose={() => setShowDayPnl(false)}
        />
      )}

      <div
        className={`sticky top-0 z-10 mt-4 flex gap-5 px-4 border-b ${
          isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-700'
        }`}
      >
        {[
          { key: 'transactions', label: '交易紀錄' },
          { key: 'data', label: '詳細數據' },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`py-2.5 text-sm font-bold border-b-2 ${
              tab === t.key
                ? 'border-amber-400 text-amber-500'
                : 'border-transparent opacity-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'data' && (
        <div className="px-4 mt-3">
          <SectionHeader isLight={isLight}>交易</SectionHeader>
          <DataRow isLight={isLight} label="庫存股數" value={`${formatMoney(summary.shares)}股`} />
          <DataRow isLight={isLight} label="現價" value={summary.currentPrice.toFixed(2)} />
          <DataRow isLight={isLight} label="買進均價" value={summary.avgPrice.toFixed(2)} />
          <DataRow isLight={isLight} label="投資期間" value={`${summary.investmentYears.toFixed(2)}年`} />

          <SectionHeader isLight={isLight}>損益</SectionHeader>
          <DataRow isLight={isLight} label="市值" value={formatMoney(summary.marketValue)} />
          <DataRow
            isLight={isLight}
            label="總損益"
            value={`${formatSigned(summary.totalPnl)}｜${formatPct(summary.totalPnlPct)}`}
            colorClass={pnlColorClass(summary.totalPnl, isLight)}
          />
          <DataRow
            isLight={isLight}
            indent={1}
            label="未實現損益"
            value={`${formatSigned(summary.unrealizedPnl)}｜${formatPct(summary.unrealizedPnlPct)}`}
            colorClass={pnlColorClass(summary.unrealizedPnl, isLight)}
          />
          <DataRow
            isLight={isLight}
            indent={1}
            label="今日損益"
            value={`${formatSigned(summary.todayPnl)}｜${formatPct(summary.todayPnlPct)}`}
            colorClass={pnlColorClass(summary.todayPnl, isLight)}
          />
          <DataRow
            isLight={isLight}
            indent={1}
            label="已實現損益"
            value={`${formatSigned(summary.realizedPnl)}｜${formatPct(summary.realizedPnlPct)}`}
            colorClass={pnlColorClass(summary.realizedPnl, isLight)}
          />
          <DataRow
            isLight={isLight}
            indent={2}
            label="本日已實現損益"
            value={`(${formatSigned(summary.todayRealizedPnl)})`}
            colorClass={pnlColorClass(summary.todayRealizedPnl, isLight)}
          />
          <DataRow
            isLight={isLight}
            indent={2}
            label="資本利得"
            value={`${formatSigned(summary.capitalGain)}｜${formatPct(summary.capitalGainPct)}`}
            colorClass={pnlColorClass(summary.capitalGain, isLight)}
          />
          <DataRow
            isLight={isLight}
            indent={2}
            label="現金股利"
            value={`${formatSigned(summary.cashDividend)}｜${formatPct(summary.cashDividendPct)}`}
            colorClass={pnlColorClass(summary.cashDividend, isLight)}
          />
          <DataRow isLight={isLight} label="股票股利" value={`${formatMoney(summary.stockDividendShares)}股`} />
          <DataRow
            isLight={isLight}
            label="年化殖利率"
            value={formatPct(summary.annualizedYieldPct)}
            colorClass={pnlColorClass(summary.annualizedYieldPct, isLight)}
          />
          <DataRow
            isLight={isLight}
            label="年化報酬率"
            value={formatPct(summary.annualizedReturnPct)}
            colorClass={pnlColorClass(summary.annualizedReturnPct, isLight)}
          />

          <SectionHeader isLight={isLight}>成本</SectionHeader>
          <DataRow isLight={isLight} label="交易成本" value={formatMoney(summary.tradeCost)} />
          <DataRow isLight={isLight} indent={1} label="手續費" value={formatMoney(summary.fee)} />
          <DataRow isLight={isLight} indent={1} label="證券交易稅" value={formatMoney(summary.tax)} />
          <DataRow isLight={isLight} label="投入資本" value={formatMoney(summary.investedCapital)} />
          <DataRow isLight={isLight} label="持有成本" value={formatMoney(summary.costBasis)} />
        </div>
      )}

      {tab === 'transactions' && (
        <div className="px-4 mt-3">
          <div className="flex items-center justify-between">
            <div className="font-bold">
              交易紀錄{' '}
              <span className={`text-xs font-normal ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                {sorted.length}筆
              </span>
            </div>
            <button
              onClick={onToggleSelectMode}
              className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                selectMode
                  ? 'bg-amber-500 text-white'
                  : isLight
                  ? 'bg-slate-100 text-slate-600'
                  : 'bg-slate-800 text-slate-300'
              }`}
            >
              {selectMode ? '完成框選' : '框選分類'}
            </button>
          </div>

          {Object.entries(grouped).map(([month, items]) => (
            <div key={month} className="mt-3">
              <div className={`text-xs mb-1.5 ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>{month}</div>
              {/* 同一天的交易歸成一段,段與段之間用日期標題與分隔線隔開,一眼看出哪幾筆是同一天的 */}
              {groupByDay(items).map(([day, dayItems]) => (
                <div key={day} data-testid="tx-day-group" className="mb-3">
                  <div
                    className={`flex items-center gap-2 mb-1.5 text-xs font-bold ${isLight ? 'text-slate-600' : 'text-slate-300'}`}
                  >
                    <span>{formatDayHeader(day)}</span>
                    <span className={`flex-1 h-px ${isLight ? 'bg-slate-200' : 'bg-slate-700'}`} />
                    {dayItems.length > 1 && (
                      <span className={`font-normal ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>{dayItems.length}筆</span>
                    )}
                  </div>
                  <div className="space-y-2">
                    {dayItems.map((item) => {
                      if (item.kind === 'tx') return renderTxRow(item.tx, { showDate: false });

                      const { tag, tagId, txs: groupTxs } = item;
                      const groupSummary = computeSymbolSummary(groupTxs);
                      const groupNet = netShareDelta(groupTxs);
                      // 框選模式下一律展開:已套用標籤的交易收在卡片裡,不展開就選不到、也就沒辦法移除標籤
                      const expanded = selectMode || expandedTagIds.has(tagId);
                      const groupDates = groupTxs.map((t) => t.date).sort();
                      const dateRange =
                        groupDates[0] === groupDates[groupDates.length - 1]
                          ? groupDates[0]
                          : `${groupDates[0]} ~ ${groupDates[groupDates.length - 1]}`;
                      return (
                        <div
                          key={tagId}
                          className={`rounded-xl overflow-hidden ${
                            isLight ? 'bg-slate-50 border border-slate-200' : 'bg-slate-800/30 border border-slate-700'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => toggleGroupExpanded(tagId)}
                            className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
                          >
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ background: tag?.color || '#94a3b8' }}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="font-bold text-sm truncate">
                                {tag?.name || '已清倉'}
                                {groupNet !== 0 && (
                                  <span className="ml-1.5 text-[10px] font-normal text-rose-500">
                                    ⚠淨股數{formatSigned(groupNet)}股
                                  </span>
                                )}
                              </div>
                              <div className={`text-[11px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                                {dateRange}｜共{groupTxs.length}筆
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div
                                className={`font-mono font-bold text-sm ${pnlColorClass(groupSummary.realizedPnl, isLight)}`}
                              >
                                {formatSigned(groupSummary.realizedPnl)}
                              </div>
                              <div className={`text-[11px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                                已實現損益
                              </div>
                            </div>
                            <ChevronDown
                              className={`w-4 h-4 opacity-60 shrink-0 transition-transform ${
                                expanded ? 'rotate-180' : ''
                              }`}
                            />
                          </button>
                          {expanded && (
                            <div className="px-2 pb-2 space-y-2">{groupTxs.map((tx) => renderTxRow(tx))}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {!selectMode && (
        <button
          onClick={() => onAddTx(symbol)}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 w-14 h-14 rounded-full bg-amber-500 text-white shadow-lg flex items-center justify-center z-30"
        >
          <Plus className="w-6 h-6" />
        </button>
      )}
      {selectMode && selectedTxIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-1.5">
          {/* 淨股數不是0只是提醒,不擋套用標籤——使用者自己清楚是不是完整清倉波段。 */}
          {selectedNetShares !== 0 && (
            <div
              className={`px-3 py-1 rounded-full text-xs font-bold shadow ${
                isLight ? 'bg-amber-50 text-amber-700' : 'bg-amber-900/60 text-amber-300'
              }`}
            >
              ⚠淨股數{formatSigned(selectedNetShares)}股,建議為0再套用
            </div>
          )}
          <div className="flex items-center gap-2">
            {/* 選到的交易裡有已套用標籤的,才出現「移除標籤」;數字是其中有標籤的筆數 */}
            {selectedTaggedCount > 0 && (
              <button
                onClick={onRemoveTag}
                data-testid="remove-tag-btn"
                className={`px-4 py-3.5 rounded-full shadow-lg flex items-center gap-2 font-bold text-sm ${
                  isLight ? 'bg-white text-rose-600 border border-rose-300' : 'bg-slate-800 text-rose-300 border border-rose-500/60'
                }`}
              >
                <X className="w-4 h-4" />
                移除標籤({selectedTaggedCount})
              </button>
            )}
            <button
              onClick={onOpenTagPicker}
              className="px-5 py-3.5 rounded-full bg-amber-500 text-white shadow-lg flex items-center gap-2 font-bold text-sm"
            >
              <Tag className="w-4 h-4" />
              套用標籤({selectedTxIds.size})
            </button>
          </div>
        </div>
      )}

      <button
        onClick={onBack}
        className={`fixed bottom-56 right-4 z-30 w-12 h-12 rounded-full shadow-xl flex items-center justify-center ${
          isLight ? 'bg-slate-700 text-white' : 'bg-slate-200 text-slate-900'
        }`}
      >
        <ArrowLeft className="w-5 h-5" />
      </button>
    </div>
  );
}

function SectionHeader({ isLight, children }) {
  return <div className="font-bold text-base mt-2.5 mb-0.5">{children}</div>;
}

function DataRow({ isLight, label, value, indent = 0, colorClass = '' }) {
  return (
    <div
      className={`flex items-center justify-between py-1 border-b ${
        isLight ? 'border-slate-100' : 'border-slate-800'
      }`}
      style={{ paddingLeft: indent * 16 }}
    >
      <span className={`text-sm ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>{label}</span>
      <span className={`font-mono font-bold text-sm ${colorClass}`}>{value}</span>
    </div>
  );
}

// ============== 總覽詳細資料(首頁「查看全部」) ==============

function AllSummaryDetailView({ isLight, summary, title, onBack }) {
  return (
    <div className="pb-24">
      <div className="flex items-center gap-2 px-4 pt-4">
        <button onClick={onBack} className="w-10 h-10 -ml-2 -my-2 flex items-center justify-center shrink-0">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 text-center -ml-7">
          <div className="font-bold">{title}</div>
        </div>
      </div>

      <div className="px-4 pt-2 text-center">
        <div className="text-3xl font-mono font-bold tracking-tight">{formatMoney(summary.marketValue)}</div>
        <div className={`mt-1 font-mono font-bold text-sm ${pnlColorClass(summary.unrealizedPnl, isLight)}`}>
          {formatSigned(summary.unrealizedPnl)}｜{formatPct(summary.unrealizedPnlPct)}
        </div>
      </div>

      <div className="px-4 mt-3 flex gap-2 overflow-x-auto">
        <StatCard
          isLight={isLight}
          label="今日損益"
          value={`${formatSigned(summary.todayPnl)}｜${formatPct(summary.todayPnlPct)}`}
          valueClass={pnlColorClass(summary.todayPnl, isLight)}
        />
        <StatCard
          isLight={isLight}
          label="總損益"
          value={`${formatSigned(summary.totalPnl)}｜${formatPct(summary.totalPnlPct)}`}
          valueClass={pnlColorClass(summary.totalPnl, isLight)}
        />
        <StatCard
          isLight={isLight}
          label="已實現損益"
          value={formatSigned(summary.realizedPnl)}
          valueClass={pnlColorClass(summary.realizedPnl, isLight)}
        />
        <StatCard
          isLight={isLight}
          label="年化報酬率"
          value={formatPct(summary.annualizedReturnPct)}
          valueClass={pnlColorClass(summary.annualizedReturnPct, isLight)}
        />
      </div>

      <div className="px-4 mt-2">
        <SectionHeader isLight={isLight}>損益</SectionHeader>
        <DataRow
          isLight={isLight}
          label="總損益"
          value={`${formatSigned(summary.totalPnl)}｜${formatPct(summary.totalPnlPct)}`}
          colorClass={pnlColorClass(summary.totalPnl, isLight)}
        />
        <DataRow
          isLight={isLight}
          indent={1}
          label="未實現損益"
          value={`${formatSigned(summary.unrealizedPnl)}｜${formatPct(summary.unrealizedPnlPct)}`}
          colorClass={pnlColorClass(summary.unrealizedPnl, isLight)}
        />
        <DataRow
          isLight={isLight}
          indent={1}
          label="今日損益"
          value={`${formatSigned(summary.todayPnl)}｜${formatPct(summary.todayPnlPct)}`}
          colorClass={pnlColorClass(summary.todayPnl, isLight)}
        />
        <DataRow
          isLight={isLight}
          indent={1}
          label="已實現損益"
          value={`${formatSigned(summary.realizedPnl)}｜${formatPct(summary.realizedPnlPct)}`}
          colorClass={pnlColorClass(summary.realizedPnl, isLight)}
        />
        <DataRow
          isLight={isLight}
          indent={2}
          label="資本利得"
          value={`${formatSigned(summary.capitalGain)}｜${formatPct(summary.capitalGainPct)}`}
          colorClass={pnlColorClass(summary.capitalGain, isLight)}
        />
        <DataRow
          isLight={isLight}
          indent={2}
          label="現金股利"
          value={`${formatSigned(summary.cashDividend)}｜${formatPct(summary.cashDividendPct)}`}
          colorClass={pnlColorClass(summary.cashDividend, isLight)}
        />
        <DataRow
          isLight={isLight}
          label="年化殖利率"
          value={formatPct(summary.annualizedYieldPct)}
          colorClass={pnlColorClass(summary.annualizedYieldPct, isLight)}
        />
        <DataRow
          isLight={isLight}
          label="年化報酬率"
          value={formatPct(summary.annualizedReturnPct)}
          colorClass={pnlColorClass(summary.annualizedReturnPct, isLight)}
        />

        <SectionHeader isLight={isLight}>成本</SectionHeader>
        <DataRow isLight={isLight} label="交易成本" value={formatMoney(summary.tradeCost)} />
        <DataRow isLight={isLight} indent={1} label="手續費" value={formatMoney(summary.fee)} />
        <DataRow isLight={isLight} indent={1} label="證券交易稅" value={formatMoney(summary.tax)} />
        <DataRow isLight={isLight} label="投入資本" value={formatMoney(summary.investedCapital)} />
        <DataRow isLight={isLight} label="持有成本" value={formatMoney(summary.costBasis)} />
      </div>

      <button
        onClick={onBack}
        className={`fixed bottom-56 right-4 z-30 w-12 h-12 rounded-full shadow-xl flex items-center justify-center ${
          isLight ? 'bg-slate-700 text-white' : 'bg-slate-200 text-slate-900'
        }`}
      >
        <ArrowLeft className="w-5 h-5" />
      </button>
    </div>
  );
}

// ============== 今日交易明細(首頁「績效數據」旁「今日交易」)==============
// 跟上面「查看全部」一樣是從首頁點進來的獨立頁面,但列的不是損益總覽,而是
// 「今天」這個日期(交易當天的日期欄位,不是現在幾點)所有個股的每一筆交易
// 明細,方便收盤後快速核對今天到底按了哪些買賣/股利紀錄,不用一檔一檔點進
// 持股明細去找。items 跟著首頁的群組篩選(txBySymbol 已經依目前群組過濾過),
// 切換群組時看到的「今日交易」自然也只會是這個群組裡的。
// export 只是為了單元測試(檢查當日進/出/總計摘要)
// ---------- 持股熱力圖 ----------
// 兩層:第一層「群組」(格子大小 = 群組市值,格內列出個股),點群組進第二層「個股」;
// 「全部」= 不分群組的個股圖。顏色代表今日漲跌(台股習慣:紅漲綠跌,越深越多),
// 格內只顯示金額(市值)與比重,不顯示股價;點個股跳出細節框。
function heatColor(pct) {
  if (pct === null || pct === undefined || !isFinite(pct)) return 'hsl(215, 14%, 78%)';
  const t = Math.min(Math.abs(pct) / 3, 1); // 漲跌 3% 以上顏色最深
  if (Math.abs(pct) < 0.005) return 'hsl(215, 14%, 80%)';
  return pct > 0 ? `hsl(0, ${42 + 18 * t}%, ${86 - 26 * t}%)` : `hsl(140, ${22 + 16 * t}%, ${80 - 24 * t}%)`;
}

function useBoxWidth(fallback = 360) {
  const ref = useRef(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setWidth(Math.round(w));
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  return [ref, width];
}

export function HeatmapView({ isLight, model, onBack }) {
  // level: null = 第一層(群組);否則是 group id 或 ALL_GROUP_ID(第二層)
  const [level, setLevel] = useState(null);
  const [picked, setPicked] = useState(null);
  const [boxRef, width] = useBoxWidth();
  const height = Math.max(380, Math.round((typeof window !== 'undefined' ? window.innerHeight : 800) * 0.62));

  const current = level === null ? null : level === ALL_GROUP_ID ? model.total : model.groups.find((g) => g.id === level) || null;
  const totalValue = model.total.marketValue;

  const tiles = useMemo(() => {
    if (level === null) return squarify(model.groups.map((g) => ({ key: g.id, value: g.marketValue })), 0, 0, width, height);
    if (!current) return [];
    return squarify(current.items.map((it) => ({ key: it.symbol, value: it.marketValue })), 0, 0, width, height);
  }, [level, current, model, width, height]);

  const pct = (v, base) => (base > 0 ? `${((v / base) * 100).toFixed(2)}%` : '-');
  const muted = isLight ? 'text-slate-500' : 'text-slate-400';
  const handleBack = () => (level === null ? onBack() : setLevel(null));
  const title = level === null ? '持股熱力圖' : `熱力圖｜${current ? current.name : ''}`;
  const headerValue = level === null ? totalValue : current ? current.marketValue : 0;
  const empty = tiles.length === 0;

  return (
    <div className="pb-24">
      <div className="flex items-center gap-2 px-4 pt-4">
        <button onClick={handleBack} className="w-10 h-10 -ml-2 -my-2 flex items-center justify-center shrink-0" aria-label="返回">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 text-center -ml-7">
          <div className="font-bold">{title}</div>
        </div>
      </div>

      <div className="px-4 pt-2 text-center">
        <div className="font-mono font-bold text-2xl" data-testid="heatmap-total">{formatMoney(headerValue)}</div>
        <div className={`text-xs mt-0.5 ${muted}`}>
          {level === null ? '點群組看個股' : `占全部 ${pct(headerValue, totalValue)}`}｜顏色=今日漲跌(紅漲綠跌)
        </div>
        {level === null && model.groups.length > 0 && (
          <button
            onClick={() => setLevel(ALL_GROUP_ID)}
            className={`mt-2 text-xs font-bold px-3 py-1 rounded-full ${isLight ? 'bg-amber-100 text-amber-700' : 'bg-amber-500/20 text-amber-300'}`}
          >
            全部個股 &gt;
          </button>
        )}
      </div>

      <div className="px-2 mt-3">
        <div ref={boxRef} className="relative w-full overflow-hidden rounded-lg" style={{ height }} data-testid="heatmap-box">
          {empty && (
            <div className={`absolute inset-0 flex items-center justify-center text-sm ${muted}`}>
              還沒有可顯示的持股(需要有現價與庫存)
            </div>
          )}
          {tiles.map((t) => {
            const isGroupLevel = level === null;
            const g = isGroupLevel ? model.groups.find((x) => x.id === t.key) : null;
            const it = isGroupLevel ? null : current.items.find((x) => x.symbol === t.key);
            const color = heatColor(isGroupLevel ? g.changePct : it.changePct);
            const fs = Math.max(10, Math.min(20, Math.sqrt(t.w * t.h) / 7));
            const showText = t.w >= 38 && t.h >= 26;
            const showAmount = showText && t.h >= fs * 3.6 && t.w >= 64;
            const base = isGroupLevel ? totalValue : current.marketValue;
            const value = isGroupLevel ? g.marketValue : it.marketValue;
            const label = isGroupLevel ? g.name : symbolLabel(it.symbol, it.name).primary;
            // 群組格:把組內個股(ETF 代號/個股股名)依市值列在下面,放不下的由 overflow 切掉
            const listH = t.h - fs * 4.4;
            const memberText = isGroupLevel
              ? g.items.map((m) => symbolLabel(m.symbol, m.name).primary).join('、')
              : '';
            return (
              <div
                key={t.key}
                data-testid={isGroupLevel ? `hm-group-${t.key}` : `hm-stock-${t.key}`}
                onClick={() => (isGroupLevel ? setLevel(t.key) : setPicked(it))}
                className="absolute cursor-pointer overflow-hidden text-center text-slate-800 flex items-center justify-center"
                style={{ left: t.x, top: t.y, width: t.w, height: t.h, background: color, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.85)' }}
              >
                {showText && (
                  <div className="w-full px-1 leading-tight">
                    <div className="font-bold break-words" style={{ fontSize: fs }}>{label}</div>
                    <div className="font-mono" style={{ fontSize: Math.max(10, fs * 0.8) }}>{pct(value, base)}</div>
                    {showAmount && (
                      <div className="font-mono" style={{ fontSize: Math.max(10, fs * 0.8) }}>{formatMoney(value)}</div>
                    )}
                    {isGroupLevel && showAmount && listH >= 14 && (
                      <div
                        className="mt-1 overflow-hidden text-slate-700/80 break-words"
                        style={{ fontSize: 11, lineHeight: '14px', maxHeight: Math.floor(listH / 14) * 14 }}
                      >
                        {memberText}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 浮動「回上一層」鈕:每一層都有,位置跟其他頁面一致。個股層回群組層,群組層回首頁 */}
      <button
        onClick={handleBack}
        aria-label="回上一層"
        data-testid="heatmap-float-back"
        className={`fixed bottom-56 right-4 z-30 w-12 h-12 rounded-full shadow-xl flex items-center justify-center ${
          isLight ? 'bg-slate-700 text-white' : 'bg-slate-200 text-slate-900'
        }`}
      >
        <ArrowLeft className="w-5 h-5" />
      </button>

      {picked && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-6" onClick={() => setPicked(null)}>
          <div className="absolute inset-0 bg-black/50" />
          <div
            data-testid="heatmap-popup"
            onClick={(e) => e.stopPropagation()}
            className={`relative w-full max-w-xs rounded-xl px-5 py-4 shadow-2xl ${isLight ? 'bg-white text-slate-900' : 'bg-slate-800 text-white'}`}
          >
            {(() => {
              const lb = symbolLabel(picked.symbol, picked.name);
              return (
                <div className="text-center mb-3">
                  <div className="font-bold text-lg font-mono">{lb.codeFirst ? lb.primary : lb.secondary}</div>
                  {(lb.codeFirst ? lb.secondary : lb.primary) && (
                    <div className="font-bold">{lb.codeFirst ? lb.secondary : lb.primary}</div>
                  )}
                </div>
              );
            })()}
            {[
              ['持股比重', pct(picked.marketValue, current ? current.marketValue : totalValue)],
              ['持股數量', `${formatMoney(picked.shares)}股`],
              ['市值', formatMoney(picked.marketValue)],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between py-1">
                <span className={muted}>{k}</span>
                <span className="font-mono font-bold">{v}</span>
              </div>
            ))}
            <div className="flex justify-between py-1">
              <span className={muted}>現價</span>
              <span className={`font-mono font-bold ${pnlColorClass(picked.changePct, isLight)}`}>
                {picked.price ? picked.price.toFixed(2) : '-'}
                {picked.changePct !== null && picked.changePct !== undefined ? `(${formatPct(picked.changePct)})` : ''}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 同一檔的交易排在一起:檔與檔之間依「第一次出現」的順序(維持原本時間序),
// 同一檔內維持原順序。為什麼不按代號排序:使用者習慣照當天下單先後看。
export function groupBySymbol(items) {
  const order = new Map();
  items.forEach((tx) => {
    if (!order.has(tx.symbol)) order.set(tx.symbol, order.size);
  });
  return items
    .map((tx, idx) => ({ tx, idx }))
    .sort((a, b) => order.get(a.tx.symbol) - order.get(b.tx.symbol) || a.idx - b.idx)
    .map((x) => x.tx);
}

export function TodayTransactionsView({ isLight, items, stockNames, todayStr, onBack, onOpenAction }) {
  const typeColor = (t) =>
    t === TX_TYPES.BUY
      ? isLight
        ? 'text-red-600'
        : 'text-red-400'
      : t === TX_TYPES.SELL
      ? isLight
        ? 'text-emerald-600'
        : 'text-emerald-400'
      : isLight
      ? 'text-amber-600'
      : 'text-amber-400';

  const symbolCount = new Set(items.map((tx) => tx.symbol)).size;
  // 當日交割總結:進 = 買進應付合計、出 = 賣出應收合計、總計 = 出 − 進(正數是要收錢,負數是要付錢)。
  // 金額直接用每筆交易存下來的 amount(已含手續費、證交稅),跟券商交割單同一個口徑;
  // 股利不是當天交割的款項,不算進來。
  const buyTotal = items.filter((tx) => tx.type === TX_TYPES.BUY).reduce((sum, tx) => sum + Math.abs(tx.amount || 0), 0);
  const sellTotal = items.filter((tx) => tx.type === TX_TYPES.SELL).reduce((sum, tx) => sum + Math.abs(tx.amount || 0), 0);
  const hasTrades = items.some((tx) => tx.type === TX_TYPES.BUY || tx.type === TX_TYPES.SELL);

  return (
    <div className="pb-24">
      <div className="flex items-center gap-2 px-4 pt-4">
        <button onClick={onBack} className="w-10 h-10 -ml-2 -my-2 flex items-center justify-center shrink-0">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 text-center -ml-7">
          <div className="font-bold">今日交易明細</div>
        </div>
      </div>

      <div className="px-4 pt-2 text-center">
        <div className={`text-xs ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>{todayStr}</div>
        <div className="text-sm font-bold mt-1">
          共{items.length}筆交易{items.length > 0 ? `｜${symbolCount}檔個股` : ''}
        </div>
        {hasTrades && (
          <div data-testid="today-summary" className="font-mono text-sm mt-2 flex justify-center flex-wrap gap-x-3">
            <span className={typeColor(TX_TYPES.BUY)}>進 {formatMoney(buyTotal)}</span>
            <span className={typeColor(TX_TYPES.SELL)}>出 {formatMoney(sellTotal)}</span>
            <span className="font-bold">總計 {formatSigned(sellTotal - buyTotal)}</span>
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <div className={`px-4 pt-10 text-center text-sm ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>
          今天還沒有任何交易紀錄
        </div>
      ) : (
        <div className="px-4 mt-4 space-y-2">
          {groupBySymbol(items).map((tx, i, arr) => (
            <div
              key={tx.id}
              // 換到下一檔時多留一點間距,同一檔的幾筆(例如券商拆成兩筆成交)視覺上連在一起
              style={i > 0 && arr[i - 1].symbol !== tx.symbol ? { marginTop: 14 } : undefined}
              // 點一筆交易直接開「編輯/複製/移動/刪除」選單,跟在個股頁點交易紀錄一樣,
              // 不用先跳到個股頁再找一次那筆交易
              onClick={() => onOpenAction(tx)}
              className={`flex items-center gap-2 rounded-xl px-3 py-2.5 cursor-pointer ${
                isLight ? 'bg-slate-100' : 'bg-slate-800/60'
              }`}
            >
              <div className="flex-1 min-w-0">
                {(() => {
                  const lb = symbolLabel(tx.symbol, stockNames[tx.symbol]);
                  return (
                    <div className={`font-bold truncate ${lb.codeFirst ? 'text-base font-mono' : 'text-sm'}`}>
                      {lb.primary}
                      {lb.secondary && (
                        <span
                          className={`ml-1.5 text-[11px] font-normal font-sans ${isLight ? 'text-slate-500' : 'text-slate-400'}`}
                        >
                          {lb.secondary}
                        </span>
                      )}
                    </div>
                  );
                })()}
                <div className={`text-xs font-bold ${typeColor(tx.type)}`}>{TX_TYPE_LABELS[tx.type]}</div>
                {tx.type !== TX_TYPES.CASH_DIVIDEND && (
                  <div className={`font-mono text-xs ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                    {tx.price.toFixed(2)}
                  </div>
                )}
              </div>
              <div className="text-right shrink-0">
                {/* 數量在上、交易總金額在下(右下角):使用者先看股數,再看這筆實收/實付金額 */}
                {tx.type !== TX_TYPES.CASH_DIVIDEND && (
                  <div className={`font-mono text-xs ${typeColor(tx.type)}`}>
                    {tx.type === TX_TYPES.SELL ? '-' : '+'}
                    {formatMoney(tx.shares)}股
                  </div>
                )}
                <div className="font-mono font-bold text-sm" data-testid="tx-amount">{formatSigned(tx.amount)}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={onBack}
        className={`fixed bottom-56 right-4 z-30 w-12 h-12 rounded-full shadow-xl flex items-center justify-center ${
          isLight ? 'bg-slate-700 text-white' : 'bg-slate-200 text-slate-900'
        }`}
      >
        <ArrowLeft className="w-5 h-5" />
      </button>
    </div>
  );
}

// ============== 主元件 ==============

// 匯出只為了單元測試(PortfolioTracker.prices.test.js 直接渲染,略過 Google 登入畫面)
export function PortfolioTrackerInner({ isLight, uid, userEmail, onSignOut }) {
  const [data, setData] = useState(() => loadPortfolioData());
  const [stockNames, setStockNames] = useState(() => ({ ...TW_STOCK_NAMES }));
  // 開頁當下先同步從 localStorage 的股價快取把每一檔已經抓過的代號「秒開」
  // 出上次抓到的價格,不要等異步的即時抓取跑完才有東西可以顯示。原本這裡是
  // 空物件起手,畫面要等第一次 fetchPriceForSymbol 的結果回來才有價格,中間
  // 這段空窗期 currentPrice 預設為0,導致市值/損益欄位會先閃一下「0」跟一個
  // 嚇人的鉅額虧損數字,如果這次背景重新抓取剛好失敗(例如多檔同時發動把
  // 代理伺服器擠爆逾時),使用者看到的就會一直停在這個錯誤的0,不會自動
  // 恢復——明明 localStorage 裡其實已經有正確的舊資料,卻完全沒被拿來墊檔。
  //
  // 後來發現光靠股價歷史快取墊檔不夠:那份快取一檔約 50 萬字元,幾檔就塞滿 localStorage,
  // dataCache 會把最久沒更新的幾檔刪掉,被刪的那幾檔開啟時就是空白。所以另外存一份很小的
  // 「上一次顯示的現價」(portfolioQuotes.js 的 portfolio_last_quotes_v1),兩者取比較新的。
  const lastQuotesRef = useRef(null);
  if (lastQuotesRef.current === null) lastQuotesRef.current = loadLastQuotes(window.localStorage);
  const seedFor = (symbol) => seedQuote(symbol, { lastQuotes: lastQuotesRef.current, loadPriceCache });
  const [prices, setPrices] = useState(() => {
    const initial = {};
    const seenSymbols = new Set((loadPortfolioData().transactions || []).map((tx) => tx.symbol));
    seenSymbols.forEach((symbol) => {
      const q = seedFor(symbol);
      if (q) initial[symbol] = { ...q, loading: true };
    });
    return initial;
  });
  // 每次現價有變動,就存一份「上一次顯示的現價」,下次開啟時直接先顯示這份。
  useEffect(() => {
    lastQuotesRef.current = saveLastQuotes(window.localStorage, prices);
  }, [prices]);
  const pendingRef = useRef(new Set());
  const dataRef = useRef(data);
  dataRef.current = data;

  const [view, setView] = useState('list');
  const [detailSymbol, setDetailSymbol] = useState(null);
  const [showHidden, setShowHidden] = useState(false);

  const [showSwitcher, setShowSwitcher] = useState(false);
  const [groupEditor, setGroupEditor] = useState(null); // { group, isNew } | null
  const [showAddTx, setShowAddTx] = useState(false);
  const [showImportCsv, setShowImportCsv] = useState(false);
  const [showBackup, setShowBackup] = useState(false);
  const [addTxSymbol, setAddTxSymbol] = useState(null);
  const [editingTx, setEditingTx] = useState(null);
  const [copyingTx, setCopyingTx] = useState(null);
  const [actionTx, setActionTx] = useState(null);
  const [movingTx, setMovingTx] = useState(null);

  const [selectMode, setSelectMode] = useState(false);
  const [selectedTxIds, setSelectedTxIds] = useState(new Set());
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [showTodayPnl, setShowTodayPnl] = useState(false);

  // ---- 持股列表「框選移動群組」----
  const [symbolSelectMode, setSymbolSelectMode] = useState(false);
  const [selectedSymbols, setSelectedSymbols] = useState(new Set());
  const [movingSymbols, setMovingSymbols] = useState(null); // string[] | null

  // ---- 跨裝置同步(詳細規則見 portfolioSync.js 開頭的說明) ----
  // status:off(沒登入)/ loading(正在讀雲端)/ synced(已同步)/ error(讀不到雲端或上傳失敗)
  // 關鍵:syncReadyRef 為 true(已經成功讀過雲端並合併)之前,本機的任何變動都只存本機,
  // 絕不上傳——2026-10 的事故就是開頁時本機空白資料搶在雲端讀完之前上傳,蓋掉了雲端正本。
  const [sync, setSync] = useState(() => ({ status: uid ? 'loading' : 'off', lastSyncedAt: null, restoredCount: 0, error: null }));
  const [syncAttempt, setSyncAttempt] = useState(0);
  const syncReadyRef = useRef(false);
  // 最後一次「確定跟雲端一致」的內容(JSON),本機資料跟它一樣就不用再上傳
  const remoteJsonRef = useRef(null);

  // 雲端目前有幾筆交易(上傳前檢查「會不會一次少掉一大批」用);
  // allowShrinkRef:使用者明確要求的大量減少(從備份還原、改用雲端版本、按「仍要上傳」)才放行
  const lastRemoteTxCountRef = useRef(0);
  const allowShrinkRef = useRef(false);
  const deviceIdRef = useRef(null);
  if (deviceIdRef.current === null) deviceIdRef.current = getDeviceId(window.localStorage);

  const markSynced = (savedData) => {
    const clean = normalizePortfolioData(savedData);
    remoteJsonRef.current = JSON.stringify(clean);
    lastRemoteTxCountRef.current = clean.transactions.length;
    allowShrinkRef.current = false;
    saveSyncMeta(window.localStorage, uid, clean);
    setSync((s) => ({ ...s, status: 'synced', lastSyncedAt: new Date(), error: null, shrinkCount: 0 }));
  };
  const uploadNow = (d, { immediate = false } = {}) => {
    const nextCount = ((d && d.transactions) || []).length;
    if (!allowShrinkRef.current && isSuspiciousShrink(lastRemoteTxCountRef.current, nextCount)) {
      // 一次少掉一大批交易:很可能是程式出錯(例如空白資料),先不上傳,請使用者確認
      setSync((s) => ({ ...s, status: 'error', error: 'shrink', shrinkCount: lastRemoteTxCountRef.current - nextCount }));
      return;
    }
    saveRemoteData(uid, stampForUpload(d, deviceIdRef.current), {
      immediate,
      onSaved: (payload) => markSynced(payload),
      onError: () => setSync((s) => ({ ...s, status: 'error', error: 'save' })),
    });
  };

  useEffect(() => {
    savePortfolioData(data); // 本機快取:離線、或雲端同步還沒跑完時也能馬上讀寫
    maybeSaveAutoBackup(window.localStorage, data, new Date().toISOString().slice(0, 10)); // 每天一份,空白資料不存
    if (!uid || !syncReadyRef.current) return; // 還沒讀過雲端:先不上傳
    if (JSON.stringify(JSON.parse(JSON.stringify(data))) === remoteJsonRef.current) return; // 跟雲端一樣
    uploadNow(data);
  }, [data, uid]);

  // 登入(或按「重試」)時:先讀雲端 → 跟本機三方合併 → 才開始雙向同步。
  useEffect(() => {
    syncReadyRef.current = false;
    remoteJsonRef.current = null;
    if (!uid) {
      setSync({ status: 'off', lastSyncedAt: null, restoredCount: 0, error: null });
      return undefined;
    }
    setSync((s) => ({ ...s, status: 'loading', error: null }));
    let cancelled = false;
    let unsubscribe = () => {};

    // 收到雲端資料(第一次讀取、或之後別台裝置改了)時的共同處理
    const applyRemote = (rawRemote) => {
      const remote = rawRemote ? normalizePortfolioData(rawRemote) : null;
      const { data: merged, needsUpload, addedTxCount, blockedDeletions } = mergeForSync({
        local: dataRef.current,
        remote,
        meta: loadSyncMeta(window.localStorage),
        uid,
        // 沒有新版蓋章的雲端資料(舊版程式寫的)不可信:它少掉的交易不當成刪除
        trustDeletions: isTrustedRemote(rawRemote),
      });
      if (remote) {
        remoteJsonRef.current = JSON.stringify(remote);
        lastRemoteTxCountRef.current = remote.transactions.length;
        // 記下「雲端此刻有哪些交易」;本機補上去的那些等上傳成功後(markSynced)才記。
        // 擋下刪除時不更新:那些交易還要當成「已同步過」,使用者選「改用雲端版本」才真的刪
        if (!blockedDeletions) saveSyncMeta(window.localStorage, uid, remote);
      }
      if (blockedDeletions > 0) {
        setSync((s) => ({ ...s, blocked: { count: blockedDeletions, remote } }));
        // 補回雲端屬於「把雲端恢復成原本的樣子」,不受大量減少檢查限制(這裡只會變多)
      }
      setData((prev) => (JSON.stringify(prev) === JSON.stringify(merged) ? prev : merged));
      return { merged, needsUpload, addedTxCount };
    };

    (async () => {
      try {
        // 手機網路不穩時 getDoc 可能等很久,15 秒還沒回來就先顯示「無法連線」,讓使用者可以重試
        const remote = await Promise.race([
          fetchRemoteDataOnce(uid),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000)),
        ]);
        if (cancelled) return;
        const { merged, needsUpload, addedTxCount } = applyRemote(remote);
        syncReadyRef.current = true;
        setSync((s) => ({ ...s, restoredCount: addedTxCount }));
        if (needsUpload) uploadNow(merged, { immediate: true });
        else markSynced(remote ? JSON.parse(remoteJsonRef.current) : merged);
      } catch (e) {
        console.error('讀取雲端資料失敗,先繼續使用本機資料(不會上傳,避免蓋掉雲端)', e);
        if (!cancelled) setSync((s) => ({ ...s, status: 'error', error: 'load' }));
        return;
      }
      if (cancelled) return;
      unsubscribe = subscribeRemoteData(
        uid,
        (remote, { hasPendingWrites } = {}) => {
          // 自己剛寫的回音、或還有變更沒送出時,不拿雲端蓋本機(會吃掉剛剛的操作)
          if (!remote || hasPendingWrites || hasPendingRemoteSave()) return;
          const json = JSON.stringify(normalizePortfolioData(remote));
          if (json === remoteJsonRef.current) return;
          const { merged, needsUpload } = applyRemote(remote);
          if (needsUpload) uploadNow(merged);
          else setSync((s) => ({ ...s, status: 'synced', lastSyncedAt: new Date(), error: null }));
        },
        (e) => console.error('雲端同步訂閱中斷', e)
      );
    })();

    return () => {
      cancelled = true;
      unsubscribe();
      cancelPendingRemoteSave();
    };
  }, [uid, syncAttempt]);

  // 切換「持股列表 / 個股詳情」畫面時捲回最上方。
  // 如果使用者在列表往下滑很多之後才點進某一檔,detail 畫面會沿用同一個捲動位置,
  // 返回按鈕就被捲到畫面外面,看起來像是「按了沒反應」,其實只是找不到按鈕。
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);

  const txBySymbol = useMemo(() => getTransactionsByGroup(data, data.activeGroupId), [data]);
  const symbols = useMemo(() => Object.keys(txBySymbol), [txBySymbol]);
  const symbolsKey = symbols.join(',');
  // 所有群組的代號:熱力圖第一層要看全部群組,現價不能只抓目前選到的群組
  const allDataSymbols = useMemo(() => Array.from(new Set(data.transactions.map((tx) => tx.symbol))), [data.transactions]);
  const allSymbolsKey = allDataSymbols.join(',');

  const stockNamesRef = useRef(stockNames);
  stockNamesRef.current = stockNames;

  // 抓單一代號的現價,force=true 時無條件重新即時抓一次(略過「快取是否已經
  // 跟上」的判斷),給下面「手動刷新」按鈕跟「收盤後自動刷新」共用。
  const fetchPriceForSymbol = async (symbol, { force = false } = {}) => {
    setPrices((p) => ({ ...p, [symbol]: { ...(p[symbol] || {}), loading: true } }));
    try {
      const result = await fetchStockPriceData(symbol, { force });
      const d = (result && result.data) || [];
      const last = d[d.length - 1];
      // 這次沒抓到任何資料(即時抓取失敗、也沒有快取可以退回)時,不要把
      // price 蓋成0——那樣會讓市值/損益瞬間變成一個假的鉅額虧損,而且一旦
      // 卡在失敗就不會自動恢復。保留目前畫面上原本的值(通常是開頁時從
      // localStorage 快取墊檔的那個價格),只標記 error,下次重新整理或
      // 手動刷新成功時自然會換成新值。真的完全沒有任何舊資料可用的全新
      // 代號,才會維持沒有 price 欄位、由畫面顯示「…」或「-」。
      // 有新資料時用 applyQuote:只有比畫面上現有的更新才覆蓋,避免這筆晚到的昨收
      // 蓋掉剛剛拿到的盤中即時報價。
      setPrices((p) =>
        last
          ? applyQuote(p, symbol, quoteFromDaily(d))
          : { ...p, [symbol]: { ...(p[symbol] || {}), loading: false, error: true } }
      );
      if (!stockNamesRef.current[symbol]) {
        const nm = await fetchStockDisplayName(symbol);
        if (nm) setStockNames((sn) => ({ ...sn, [symbol]: nm }));
      }
    } catch (e) {
      // 同樣道理:例外狀況也不蓋成0,保留原本畫面上的值。
      setPrices((p) => ({ ...p, [symbol]: { ...(p[symbol] || {}), loading: false, error: true } }));
    }
  };

  useEffect(() => {
    const fresh = allDataSymbols.filter((symbol) => !pendingRef.current.has(symbol));
    if (fresh.length === 0) return;
    fresh.forEach((symbol) => pendingRef.current.add(symbol));
    // 先墊檔:雲端同步進來的代號(本機持股資料裡原本沒有)開頁初始化時沒被墊到,
    // 這裡補上,畫面先顯示上一次的數據,不要空白等網路。
    setPrices((p) => {
      let next = p;
      fresh.forEach((symbol) => {
        if (next[symbol] && typeof next[symbol].price === 'number') return;
        const q = seedFor(symbol);
        if (q) next = { ...next, [symbol]: { ...q, loading: true } };
      });
      return next;
    });
    fresh.forEach((symbol) => fetchPriceForSymbol(symbol));
    // 同時查一次即時報價(一個請求查完這批代號):盤中開啟也能看到現在的價格,
    // 不只昨天的收盤價。失敗就算了,日資料照常更新。
    fetchLiveQuotes(fresh).then((quotes) => {
      const syms = Object.keys(quotes);
      if (syms.length === 0) return;
      setPrices((p) => {
        let next = p;
        syms.forEach((sym) => {
          const wasLoading = next[sym] && next[sym].loading;
          next = applyQuote(next, sym, quoteFromLive(quotes[sym]));
          // 日資料還在抓的話,保留「讀取中」狀態,讓它抓完再收尾
          if (wasLoading) next = { ...next, [sym]: { ...next[sym], loading: true } };
        });
        return next;
      });
    });
  }, [allSymbolsKey]);

  const [refreshingPrices, setRefreshingPrices] = useState(false);

  // 手動/自動刷新共用:先把「目前所有持股」的最新價格都抓回來、全部確定
  // 抓完(不管成功或失敗)之後,才一次套用到畫面上——不是像上面單檔初次
  // 載入那樣,一檔抓完就馬上更新畫面。原因是實測發現持股檔數多的時候,
  // 半途網路不穩或某個來源逾時,會讓畫面在刷新途中看到「部分已經換成新
  // 數字、部分還是舊的、甚至短暫出現抓取失敗的0」這種新舊夾雜、對不起來
  // 的狀態,使用者會覺得「數字變得不準」。改成全部收集完、確定每一檔的
  // 結果後,一次性地用單一個 setPrices 套用:抓成功的才覆蓋,抓失敗/逾時
  // 的那幾檔完全不動,直接維持刷新前的舊數字,不會被清空或歸零。
  //
  // 2026-10:更新鈕要「不管是不是盤中,按下去就更新所有持股的股價」。日資料來源都要收盤後
  // 才有當天那一筆,所以同時查一次即時報價(上市、上櫃都有),每檔取兩者中比較新的那個。
  const refreshAllPrices = async () => {
    if (refreshingPrices || allDataSymbols.length === 0) return;
    setRefreshingPrices(true);
    try {
      const [results, liveQuotes] = await Promise.all([
        Promise.all(
          allDataSymbols.map(async (symbol) => {
            try {
              const result = await fetchStockPriceData(symbol, { force: true });
              const q = quoteFromDaily(result && result.data);
              return q ? { symbol, q } : null; // 沒抓到新資料,稍後略過、不動這一檔原本的數字
            } catch (e) {
              return null;
            }
          })
        ),
        fetchLiveQuotes(allDataSymbols).catch(() => ({})),
      ]);
      setPrices((p) => {
        let next = p;
        results.forEach((r) => {
          if (r) next = applyQuote(next, r.symbol, r.q);
        });
        Object.keys(liveQuotes).forEach((sym) => {
          next = applyQuote(next, sym, quoteFromLive(liveQuotes[sym]));
        });
        return next;
      });
      // 股票名稱缺的話順便補,不影響上面價格的「全部確定完成才套用」邏輯。
      allDataSymbols.forEach((symbol) => {
        if (stockNamesRef.current[symbol]) return;
        fetchStockDisplayName(symbol).then((nm) => {
          if (nm) setStockNames((sn) => ({ ...sn, [symbol]: nm }));
        });
      });
    } finally {
      setRefreshingPrices(false);
    }
  };

  // 手動刷新按鈕點擊時呼叫。
  const handleRefreshPrices = () => refreshAllPrices();

  // 自動刷新那個 useEffect 只依賴 symbolsKey 建立計時器,不會每次 render 都
  // 重建,所以要用 ref 存最新版本的 refreshAllPrices(每次 render 都會拿到
  // 當下最新的 symbols/refreshingPrices),避免計時器內部呼叫到建立當下、
  // 可能已經過期的舊版本函式。
  const refreshAllPricesRef = useRef(refreshAllPrices);
  refreshAllPricesRef.current = refreshAllPrices;

  // 自動刷新:台股收盤(13:30)後留5分鐘緩衝,交易日下午1:35起、使用者有打開
  // 「我的持股」頁面的話,每分鐘檢查一次,當天只會自動觸發一次(用
  // localStorage 記錄今天是否已經刷新過,重新整理頁面或隔天都不受影響)。
  // 不是伺服器排程,所以只在頁面有打開的情況下才會生效;沒開著的話,下次
  // 打開時(只要已經過了1:35)會立刻補刷新一次,不用特地等到下一個1:35。
  useEffect(() => {
    if (symbols.length === 0) return undefined;
    const AUTO_REFRESH_HOUR = 13;
    const AUTO_REFRESH_MINUTE = 35;
    const AUTO_REFRESH_STORAGE_KEY = 'portfolio_price_auto_refresh_date';

    const checkAndMaybeRefresh = () => {
      const tw = getTaipeiDateTimeParts(new Date());
      const refDate = new Date(Date.UTC(tw.year, tw.month, tw.day));
      if (isNonTradingDay(refDate)) return;
      const isAfterThreshold =
        tw.hour > AUTO_REFRESH_HOUR || (tw.hour === AUTO_REFRESH_HOUR && tw.minute >= AUTO_REFRESH_MINUTE);
      if (!isAfterThreshold) return;
      const todayStr = `${tw.year}-${String(tw.month + 1).padStart(2, '0')}-${String(tw.day).padStart(2, '0')}`;
      let lastDone = null;
      try {
        lastDone = localStorage.getItem(AUTO_REFRESH_STORAGE_KEY);
      } catch (e) {
        // localStorage 不可用時安靜放棄記錄,頂多每次打開都重刷一次,不影響正確性。
      }
      if (lastDone === todayStr) return;
      try {
        localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, todayStr);
      } catch (e) {}
      refreshAllPricesRef.current();
    };

    checkAndMaybeRefresh();
    const timer = setInterval(checkAndMaybeRefresh, 60000);
    return () => clearInterval(timer);
  }, [symbolsKey]);

  const allSymbolHoldings = useMemo(
    () =>
      symbols.map((symbol) => {
        const txs = txBySymbol[symbol];
        const priceInfo = prices[symbol] || {};
        const summary = computeSymbolSummary(txs, {
          currentPrice: priceInfo.price || 0,
          prevClose: priceInfo.prevClose,
          groups: data.groups,
        });
        return { symbol, name: stockNames[symbol] || symbol, summary, loading: priceInfo.loading, txs };
      }),
    [symbols, txBySymbol, prices, stockNames, data.groups]
  );

  const openPositions = allSymbolHoldings.filter((h) => h.summary.shares > 0);
  const hiddenCount = allSymbolHoldings.length - openPositions.length;
  // 持有中依市值排;已出場的接在後面,依最後一筆賣出日期 新 → 舊(見 sortHoldingsForDisplay)
  const visibleHoldings = sortHoldingsForDisplay(showHidden ? allSymbolHoldings : openPositions);
  const totalSummary = useMemo(
    () => aggregateSummaries(allSymbolHoldings.map((h) => h.summary)),
    [allSymbolHoldings]
  );

  const activeGroup = data.groups.find((g) => g.id === data.activeGroupId) || null;

  // 熱力圖資料:只有開著熱力圖時才計算(要對每個群組各算一次,平常不浪費)
  const heatmapModel = useMemo(
    () => (view === 'heatmap' ? buildHeatmapModel(data, prices, stockNames) : { total: { marketValue: 0, items: [] }, groups: [] }),
    [view, data, prices, stockNames]
  );

  // ---- 今日交易明細(首頁「績效數據」旁「今日交易」) ----
  // 「今天」比對的是交易自己的日期欄位(YYYY-MM-DD),跟 computeSymbolSummary
  // 算「今日損益」用的 todayDate 預設值一致,不是看現在幾點。txBySymbol 本身
  // 已經依目前選到的群組篩選過,所以這裡列出來的也自然只會是這個群組的。
  const todayDateStr = new Date().toISOString().split('T')[0];
  const todayTransactions = useMemo(() => {
    const list = [];
    Object.entries(txBySymbol).forEach(([symbol, txs]) => {
      txs.forEach((tx) => {
        if (tx.date === todayDateStr) list.push({ ...tx, symbol });
      });
    });
    return list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }, [txBySymbol, todayDateStr]);

  // ---- 群組操作 ----
  const handleSelectGroup = (groupId) => setData((d) => ({ ...d, activeGroupId: groupId }));
  const handleNewGroup = () => setGroupEditor({ group: null, isNew: true });
  const handleOpenGroupSettings = (groupId) => {
    const g = data.groups.find((x) => x.id === groupId);
    if (g) setGroupEditor({ group: g, isNew: false });
  };
  const handleSaveGroup = (patch) => {
    if (groupEditor.isNew) {
      setData((d) => createGroup(d, patch));
    } else {
      setData((d) => updateGroup(d, groupEditor.group.id, patch));
    }
    setGroupEditor(null);
  };
  const handleDeleteGroup = (groupId) => {
    setData((d) => deleteGroup(d, groupId));
    setGroupEditor(null);
  };

  // ---- 交易操作 ----
  const openAddTx = (symbol) => {
    setAddTxSymbol(symbol || null);
    setEditingTx(null);
    setCopyingTx(null);
    setShowAddTx(true);
  };
  const handleSubmitTx = (txPayload) => {
    if (editingTx) {
      setData((d) => updateTransaction(d, editingTx.id, txPayload));
    } else {
      // 複製的交易沿用原本的標籤(同一張委託拆成多筆成交時,通常也想歸在同一組)
      const payload = copyingTx && copyingTx.tagId ? { ...txPayload, tagId: copyingTx.tagId } : txPayload;
      setData((d) => addTransaction(d, payload));
    }
    setShowAddTx(false);
    setEditingTx(null);
    setCopyingTx(null);
    setAddTxSymbol(null);
  };
  const handleDeleteTxFromForm = (txId) => {
    setData((d) => deleteTransaction(d, txId));
    setShowAddTx(false);
    setEditingTx(null);
  };
  const handleEditTx = (tx) => {
    setCopyingTx(null);
    setEditingTx(tx);
    setAddTxSymbol(tx.symbol);
    setShowAddTx(true);
  };
  // 複製:開新增表單,帶入原交易的欄位(去掉 id/建立時間,存的時候是新的一筆)
  const handleCopyTx = (tx) => {
    const { id, createdAt, ...rest } = tx;
    setEditingTx(null);
    setCopyingTx({ ...rest, copiedFrom: id });
    setAddTxSymbol(tx.symbol);
    setShowAddTx(true);
  };
  const handleDeleteTx = (txId) => setData((d) => deleteTransaction(d, txId));
  const handleMoveTx = (txId, groupId) => setData((d) => moveTransactionToGroup(d, txId, groupId));

  // ---- CSV 匯入 ----
  // 一次性把所有匯入的交易套用到同一份資料上再存檔,避免逐筆 setState 互相蓋過。
  const handleImportTransactions = (rows) => {
    setData((d) => rows.reduce((acc, row) => addTransaction(acc, row), d));
    setShowImportCsv(false);
  };

  // ---- 持股列表「框選移動群組」----
  const handleToggleSymbolSelectMode = () => {
    setSymbolSelectMode((v) => !v);
    setSelectedSymbols(new Set());
  };
  const handleToggleSelectSymbol = (symbol) =>
    setSelectedSymbols((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  const handleMoveSymbols = (symbols, groupId) => {
    setData((d) => moveSymbolsToGroup(d, symbols, groupId));
    setSymbolSelectMode(false);
    setSelectedSymbols(new Set());
  };

  // ---- 批次標籤 ----
  const handleApplyTag = (tagId) => {
    setData((d) => applyTagToTransactions(d, Array.from(selectedTxIds), tagId));
    setSelectedTxIds(new Set());
    setSelectMode(false);
  };
  // 移除標籤:選到的交易回到一般列表(標籤本身保留,之後可再套用)
  const handleRemoveTag = () => {
    setData((d) => removeTagFromTransactions(d, Array.from(selectedTxIds)));
    setSelectedTxIds(new Set());
    setSelectMode(false);
  };
  const handleCreateTag = (name, color) => {
    // 手動框選已清倉波段時,不想每組都還要特地取名字——名稱留空就自動按照
    // 這檔股票目前已經用掉幾個標籤來編號(已清倉1、已清倉2...)。
    const trimmed = (name || '').trim();
    const usedTagIds = new Set(detailTxs.map((tx) => tx.tagId).filter(Boolean));
    const autoName = trimmed || `已清倉${usedTagIds.size + 1}`;
    setData((d) => createTagAndApply(d, { name: autoName, color }, Array.from(selectedTxIds)));
    setSelectedTxIds(new Set());
    setSelectMode(false);
  };

  const detailTxs = detailSymbol ? txBySymbol[detailSymbol] || [] : [];
  const detailHolding = allSymbolHoldings.find((h) => h.symbol === detailSymbol);

  const containerClass = isLight ? 'text-slate-900' : 'text-white';

  return (
    <div className={containerClass}>
      {view === 'list' && (
        <HoldingsListView
          isLight={isLight}
          data={data}
          holdings={visibleHoldings}
          hiddenCount={hiddenCount}
          showHidden={showHidden}
          onToggleHidden={() => setShowHidden((v) => !v)}
          totalSummary={totalSummary}
          onOpenDetail={(symbol) => {
            setDetailSymbol(symbol);
            setView('detail');
          }}
          onOpenSwitcher={() => setShowSwitcher(true)}
          onSelectGroup={handleSelectGroup}
          onNewGroup={handleNewGroup}
          onOpenSettings={handleOpenGroupSettings}
          onOpenSummary={() => setView('summary')}
          onOpenTodayTx={() => setView('todayTx')}
          onOpenHeatmap={() => setView('heatmap')}
          onOpenTodayPnl={() => setShowTodayPnl(true)}
          onAddTx={() => openAddTx(null)}
          onOpenImport={() => setShowImportCsv(true)}
          activeGroup={activeGroup}
          selectMode={symbolSelectMode}
          selectedSymbols={selectedSymbols}
          onToggleSelectMode={handleToggleSymbolSelectMode}
          onToggleSelectSymbol={handleToggleSelectSymbol}
          userEmail={userEmail}
          onSignOut={onSignOut}
          onOpenMoveSymbols={() => setMovingSymbols(Array.from(selectedSymbols))}
          onRefreshPrices={handleRefreshPrices}
          refreshingPrices={refreshingPrices}
          sync={sync}
          onRetrySync={() => setSyncAttempt((n) => n + 1)}
          onDismissRestored={() => setSync((st) => ({ ...st, restoredCount: 0 }))}
          onOpenBackup={() => setShowBackup(true)}
          onDismissBlocked={() => setSync((st) => ({ ...st, blocked: null }))}
          onAcceptRemote={() => {
            const remote = sync.blocked && sync.blocked.remote;
            setSync((st) => ({ ...st, blocked: null }));
            if (!remote) return;
            allowShrinkRef.current = true;
            saveSyncMeta(window.localStorage, uid, remote);
            setData(remote);
          }}
          onForceUpload={() => {
            allowShrinkRef.current = true;
            uploadNow(dataRef.current, { immediate: true });
          }}
        />
      )}

      {view === 'summary' && (
        <AllSummaryDetailView
          isLight={isLight}
          summary={totalSummary}
          title={activeGroup ? activeGroup.name : '全部'}
          onBack={() => setView('list')}
        />
      )}

      {view === 'heatmap' && <HeatmapView isLight={isLight} model={heatmapModel} onBack={() => setView('list')} />}

      {view === 'todayTx' && (
        <TodayTransactionsView
          isLight={isLight}
          items={todayTransactions}
          stockNames={stockNames}
          todayStr={todayDateStr}
          onBack={() => setView('list')}
          onOpenAction={(tx) => setActionTx(tx)}
        />
      )}

      {view === 'detail' && detailSymbol && (
        <StockDetailView
          isLight={isLight}
          data={data}
          symbol={detailSymbol}
          name={stockNames[detailSymbol] || detailSymbol}
          summary={
            detailHolding
              ? detailHolding.summary
              : computeSymbolSummary(detailTxs, {
                  currentPrice: (prices[detailSymbol] || {}).price || 0,
                  prevClose: (prices[detailSymbol] || {}).prevClose,
                  groups: data.groups,
                })
          }
          transactions={detailTxs}
          tags={data.tags}
          onBack={() => {
            setView('list');
            setDetailSymbol(null);
            setSelectMode(false);
            setSelectedTxIds(new Set());
          }}
          onAddTx={openAddTx}
          onOpenAction={(tx) => setActionTx(tx)}
          selectMode={selectMode}
          selectedTxIds={selectedTxIds}
          onToggleSelectMode={() => {
            setSelectMode((v) => !v);
            setSelectedTxIds(new Set());
          }}
          onToggleSelectTx={(txId) =>
            setSelectedTxIds((prev) => {
              const next = new Set(prev);
              if (next.has(txId)) next.delete(txId);
              else next.add(txId);
              return next;
            })
          }
          onOpenTagPicker={() => setShowTagPicker(true)}
          onRemoveTag={handleRemoveTag}
        />
      )}

      {showSwitcher && (
        <GroupSwitcherSheet
          isLight={isLight}
          data={data}
          onClose={() => setShowSwitcher(false)}
          onSelect={handleSelectGroup}
          onNewGroup={handleNewGroup}
          onOpenSettings={handleOpenGroupSettings}
        />
      )}

      {groupEditor && (
        <GroupEditorModal
          isLight={isLight}
          group={groupEditor.group}
          isNew={groupEditor.isNew}
          onClose={() => setGroupEditor(null)}
          onSave={handleSaveGroup}
          onDelete={handleDeleteGroup}
        />
      )}

      {showAddTx && (
        <TransactionFormModal
          isLight={isLight}
          data={data}
          initial={editingTx || copyingTx || (addTxSymbol ? { symbol: addTxSymbol } : null)}
          onClose={() => {
            setShowAddTx(false);
            setEditingTx(null);
            setCopyingTx(null);
            setAddTxSymbol(null);
          }}
          onSubmit={handleSubmitTx}
          onDelete={handleDeleteTxFromForm}
        />
      )}

      {actionTx && (
        <TxActionSheet
          isLight={isLight}
          tx={actionTx}
          onClose={() => setActionTx(null)}
          onEdit={handleEditTx}
          onCopy={handleCopyTx}
          onMove={(tx) => setMovingTx(tx)}
          onDelete={handleDeleteTx}
        />
      )}

      {movingTx && (
        <MoveGroupSheet
          isLight={isLight}
          data={data}
          title="移動到群組"
          currentGroupId={movingTx.groupId}
          onClose={() => setMovingTx(null)}
          onConfirm={(groupId) => handleMoveTx(movingTx.id, groupId)}
        />
      )}

      {movingSymbols && (
        <MoveGroupSheet
          isLight={isLight}
          data={data}
          title={`移動 ${movingSymbols.length} 檔持股到群組`}
          currentGroupId={null}
          onClose={() => setMovingSymbols(null)}
          onConfirm={(groupId) => handleMoveSymbols(movingSymbols, groupId)}
        />
      )}

      {showBackup && (
        <BackupSheet
          isLight={isLight}
          data={data}
          onClose={() => setShowBackup(false)}
          onRestore={(backup) => {
            allowShrinkRef.current = true; // 使用者明確選了這份備份,就算筆數比雲端少也照樣上傳
            setData(normalizePortfolioData(backup));
          }}
        />
      )}
      {showImportCsv && (
        <ImportCsvModal
          isLight={isLight}
          data={data}
          onClose={() => setShowImportCsv(false)}
          onImport={handleImportTransactions}
        />
      )}

      {showTodayPnl && (
        <TodayPnlPopup
          isLight={isLight}
          title={`今日損益明細｜${activeGroup ? activeGroup.name : '全部'}`}
          rows={allSymbolHoldings.map((h) => ({
            symbol: h.symbol,
            name: h.name,
            pnl: h.summary.todayPnl,
            parts: h.summary.todayPnlParts,
          }))}
          onClose={() => setShowTodayPnl(false)}
        />
      )}

      {showTagPicker && (
        <TagPickerModal
          isLight={isLight}
          tags={data.tags}
          netShares={netShareDelta(detailTxs.filter((tx) => selectedTxIds.has(tx.id)))}
          selectedCount={selectedTxIds.size}
          onClose={() => setShowTagPicker(false)}
          onApply={handleApplyTag}
          onCreate={handleCreateTag}
        />
      )}
    </div>
  );
}

// ============== 登入門檻 ==============
//
// 「我的持股」存的是個人交易紀錄,需要登入才能使用、也才能跨裝置同步;
// App.js 裡其他分頁(回測比較、定期定額)不需要登入,所以登入判斷只包在
// 這一層,不影響其他功能。
//
// 登入方式的演進(留著方便以後排查類似問題):
// 1. 一開始用 signInWithRedirect(整頁導向去 Google 再導回來),手機瀏覽器
//    (Brave、Chrome 都一樣)導回來後讀不到登入結果,卡在無限循環。
// 2. 改用 signInWithPopup(彈出視窗),桌機正常,但手機瀏覽器幾乎都直接
//    擋掉彈出視窗(auth/popup-blocked),退回方案1 等於沒解決。
// 3. 實測關閉 Brave Shields、允許 Chrome 第三方 Cookie 都沒有用,研判是
//    新版手機瀏覽器的「儲存空間隔離」機制(本站網域 vs. Firebase 用的
//    firebaseapp.com 網域,被視為不同網域)——這是瀏覽器內建、無法關閉
//    的安全機制,不是設定問題。
// 4. 最終改用 Google 官方的 Google Identity Services(GIS)按鈕——不透過
//    Firebase 的彈出視窗/導向機制,而是直接拿到一個登入憑證(ID token),
//    再用 signInWithCredential 交給 Firebase,跳過前面造成問題的跨網域
//    機制。對使用者來說體驗一樣(點一下、選帳號、登入完成)。
//    舊的 signInWithPopup/signInWithRedirect 保留當手動備援,以防 GIS
//    腳本本身被某些攔截器誤擋。
export default function PortfolioTracker({ isLight }) {
  const [authState, setAuthState] = useState({ status: 'loading', user: null, error: null, attempting: null });
  const googleButtonRef = useRef(null);

  // 把每一種可能出錯的地方都包起來,直接顯示在畫面上(紅字或灰字),而不是
  // 只寫 console.error——手機上沒辦法方便看開發者工具,全部顯示出來才能
  // 實際看到發生了什麼事。
  const describeError = (prefix, e) =>
    `${prefix}:${(e && (e.code || e.name)) || '未知錯誤'}${e && e.message ? '(' + e.message + ')' : ''}`;

  useEffect(() => {
    // 這裡保留 getRedirectResult,是給「手動備援」那條 signInWithRedirect
    // 路徑用的——如果真的走到那一步,導回來後要靠這裡把結果(或錯誤)
    // 撈出來。
    //
    // 注意:下面 onAuthStateChanged 的回呼在「使用者狀態還是沒登入」時,
    // 故意保留原本的 error(用 s.error,不是寫死 null),避免之後才觸發的
    // null 回呼把前面設好的錯誤訊息洗掉。只有登入「成功」時才清空 error。
    getRedirectResult(auth).catch((e) => {
      console.error('Google 登入失敗(導向備援)', e);
      setAuthState((s) => ({ ...s, error: describeError('登入失敗(導向備援)', e) }));
    });
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setAuthState((s) => ({ status: user ? 'in' : 'out', user, error: user ? null : s.error, attempting: null }));
    });
    return unsubscribe;
  }, []);

  const handleGoogleCredential = (response) => {
    setAuthState((s) => ({ ...s, error: null, attempting: '登入中…' }));
    const credential = GoogleAuthProvider.credential(response.credential);
    signInWithCredential(auth, credential).catch((e) => {
      console.error('Google 登入失敗(GIS 憑證交換)', e);
      setAuthState((s) => ({ ...s, attempting: null, error: describeError('登入失敗', e) }));
    });
  };

  // 載入、渲染 Google 官方的登入按鈕(腳本在 public/index.html 載入:
  // https://accounts.google.com/gsi/client)。腳本是 async 載入的,元件
  // 掛載當下不一定讀得到 window.google,所以用輪詢等它準備好。
  useEffect(() => {
    if (authState.status !== 'out') return;
    let cancelled = false;
    let attempts = 0;
    const tryRender = () => {
      if (cancelled) return;
      if (window.google?.accounts?.id && googleButtonRef.current) {
        window.google.accounts.id.initialize({
          client_id: '452210413265-tirgrra93dub2hmdkjke3m8njthq0pd6.apps.googleusercontent.com',
          callback: handleGoogleCredential,
        });
        window.google.accounts.id.renderButton(googleButtonRef.current, {
          type: 'standard',
          theme: isLight ? 'outline' : 'filled_black',
          size: 'large',
          text: 'signin_with',
          shape: 'pill',
          width: 300,
          locale: 'zh_TW',
        });
        return;
      }
      attempts += 1;
      if (attempts < 50) {
        setTimeout(tryRender, 200);
      } else {
        console.error('Google 登入元件載入逾時(accounts.google.com/gsi/client 沒有準備好)');
        setAuthState((s) => ({ ...s, error: 'Google 登入元件載入失敗,請檢查網路連線後重新整理頁面,或改用下面的備用登入方式' }));
      }
    };
    tryRender();
    return () => {
      cancelled = true;
    };
  }, [authState.status, isLight]);

  // 備用登入方式:萬一上面 Google 官方按鈕沒辦法載入或使用(例如被某些
  // 廣告/追蹤攔截器誤擋了 accounts.google.com/gsi/client),保留舊的
  // signInWithPopup 當手動備援,被擋下來會自動再退回 signInWithRedirect,
  // 不會完全卡死、至少多一條路可以試。
  const handleFallbackLogin = () => {
    setAuthState((s) => ({ ...s, error: null, attempting: '嘗試使用彈出視窗登入(備用方式)…' }));
    let popupPromise;
    try {
      popupPromise = signInWithPopup(auth, googleProvider);
    } catch (syncError) {
      setAuthState((s) => ({ ...s, attempting: null, error: describeError('登入時發生例外(彈出視窗)', syncError) }));
      return;
    }
    popupPromise
      .then(() => setAuthState((s) => ({ ...s, attempting: null })))
      .catch((e) => {
        if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') {
          setAuthState((s) => ({ ...s, attempting: null }));
          return;
        }
        const fallbackCodes = ['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'];
        if (fallbackCodes.includes(e.code)) {
          setAuthState((s) => ({ ...s, attempting: '彈出視窗被擋,改用導向登入…' }));
          try {
            signInWithRedirect(auth, googleProvider);
          } catch (syncError2) {
            setAuthState((s) => ({ ...s, attempting: null, error: describeError('登入時發生例外(導向備援)', syncError2) }));
          }
          return;
        }
        setAuthState((s) => ({ ...s, attempting: null, error: describeError('登入失敗(彈出視窗)', e) }));
      });
  };

  if (authState.status === 'loading') {
    return (
      <div className={`py-20 text-center text-sm ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>
        讀取登入狀態中…
      </div>
    );
  }

  if (authState.status === 'out') {
    return (
      <div className="max-w-sm mx-auto px-6 py-20 text-center">
        <h2 className={`text-xl font-bold mb-3 ${isLight ? 'text-slate-800' : 'text-slate-100'}`}>
          登入後使用「我的持股」
        </h2>
        <p className={`text-sm mb-6 leading-relaxed ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
          登入後,持股紀錄會自動備份到雲端,手機、電腦登入同一個帳號就能看到同一份資料。
        </p>
        {authState.attempting && (
          <p className={`text-sm mb-4 break-words ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>{authState.attempting}</p>
        )}
        {authState.error && (
          <p className="text-sm text-rose-500 mb-4 break-words">{authState.error}</p>
        )}
        <div ref={googleButtonRef} className="flex justify-center mb-4" />
        <button
          onClick={handleFallbackLogin}
          className={`text-xs underline ${isLight ? 'text-slate-400 hover:text-slate-600' : 'text-slate-500 hover:text-slate-300'}`}
        >
          上面按鈕沒反應?點這裡改用備用登入方式
        </button>
      </div>
    );
  }

  return (
    <PortfolioTrackerInner
      isLight={isLight}
      uid={authState.user.uid}
      userEmail={authState.user.email}
      onSignOut={() => signOut(auth)}
    />
  );
}
