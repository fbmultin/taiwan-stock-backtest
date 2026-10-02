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
} from 'lucide-react';
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
import { fetchStockPriceData, fetchStockDisplayName } from './dataCache';
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
  createGroup,
  updateGroup,
  deleteGroup,
  createTagAndApply,
  applyTagToTransactions,
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
  netShareDelta,
  computeSymbolSummary,
  aggregateSummaries,
  getTransactionsByGroup,
  formatMoney,
  formatSigned,
  formatPct,
  pnlColorClass,
} from './portfolioStore';

// ============== 共用小工具 ==============

const todayStr = () => new Date().toISOString().split('T')[0];

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

function TransactionFormModal({ isLight, data, initial, onClose, onSubmit, onDelete }) {
  const keyboardInset = useKeyboardInset();
  const isEdit = Boolean(initial && initial.id);
  const presetSymbol = initial && initial.symbol ? initial.symbol : '';
  const [symbol, setSymbol] = useState(presetSymbol);
  const [type, setType] = useState((initial && initial.type) || TX_TYPES.BUY);
  const [date, setDate] = useState((initial && initial.date) || todayStr());
  const [price, setPrice] = useState(initial && initial.price ? String(initial.price) : '');
  const [shares, setShares] = useState(initial && initial.shares ? String(initial.shares) : '');
  const [amountOverride, setAmountOverride] = useState(
    initial && initial.type === TX_TYPES.CASH_DIVIDEND && initial.amount ? String(initial.amount) : ''
  );
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
  const priceTouchedRef = useRef(isEdit); // 編輯既有交易時視為「已手動設定」,不要被自動帶入蓋掉
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
  const taxRate = isEtf ? 0.001 : 0.003;
  const tax = type === TX_TYPES.SELL ? estimateTax(priceNum, sharesNum, { isDayTrade, taxRate }) : 0;
  const computedAmount =
    type === TX_TYPES.BUY
      ? -(priceNum * sharesNum + fee)
      : type === TX_TYPES.SELL
      ? priceNum * sharesNum - fee - tax
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
            <div className="text-sm font-bold">{isEdit ? '編輯交易' : '新增交易'}</div>
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
            <FieldBox label="金額" icon={<span className="opacity-60 font-mono">$</span>} isLight={isLight}>
              <input
                type="number"
                value={amountOverride}
                onChange={(e) => setAmountOverride(e.target.value)}
                placeholder="0"
                className={inputBase}
              />
              <span className="text-xs opacity-60">NTD</span>
            </FieldBox>
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
                      setPrice((prev) => String(stepPrice(parseFloat(prev) || 0, -1)));
                    }}
                    className="w-11 h-11 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      priceTouchedRef.current = true;
                      setPrice((prev) => String(stepPrice(parseFloat(prev) || 0, 1)));
                    }}
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
          <div className="text-xs opacity-60 -mt-2">1張 = 1000股</div>

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
                    證交稅({isEtf ? '0.1%' : '0.3%'}):{formatMoney(tax)} 元{isDayTrade ? '(當沖減半)' : ''}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          style={{ bottom: `calc(1.5rem + ${keyboardInset}px)` }}
          className={`fixed right-4 z-[80] w-12 h-12 rounded-full shadow-xl flex items-center justify-center ${
            isLight ? 'bg-white text-slate-700 border border-slate-200' : 'bg-slate-800 text-white border border-slate-600'
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
      const tax =
        r.type === TX_TYPES.SELL ? estimateTax(r.price, r.shares, { isDayTrade, taxRate: isEtf ? 0.001 : 0.003 }) : 0;
      const amount = r.type === TX_TYPES.BUY ? -(r.price * r.shares + fee) : r.price * r.shares - fee - tax;
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

// ============== 交易操作選單(編輯/移動/刪除) ==============

function TxActionSheet({ isLight, tx, onClose, onEdit, onMove, onDelete }) {
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
  const blocked = netShares !== 0;
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

        {blocked && (
          <div
            className={`text-xs rounded-lg px-3 py-2 mb-3 ${
              isLight ? 'bg-amber-50 text-amber-700' : 'bg-amber-900/30 text-amber-300'
            }`}
          >
            已選{selectedCount}筆,淨股數{formatSigned(netShares)}股——要淨股數為0(完整買賣平倉)才能套用標籤。
          </div>
        )}

        <div className="space-y-1 max-h-48 overflow-y-auto">
          {tags.map((t) => (
            <button
              key={t.id}
              disabled={blocked}
              onClick={() => {
                onApply(t.id);
                onClose();
              }}
              className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-left disabled:opacity-40 ${
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
              disabled={blocked}
              onClick={() => {
                onCreate(name.trim(), color);
                setCreating(false);
                setName('');
              }}
              className="w-full py-2 rounded-full bg-amber-500 text-white font-bold text-sm disabled:opacity-40"
            >
              建立並套用
            </button>
          </div>
        ) : (
          <button
            onClick={() => setCreating(true)}
            disabled={blocked}
            className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg mt-1 text-sm font-bold disabled:opacity-40 ${
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

function StatCard({ isLight, label, value, valueClass = '', sizeClass = 'shrink-0 min-w-[110px]' }) {
  return (
    <div
      className={`rounded-xl px-3 py-2.5 ${sizeClass} ${
        isLight ? 'bg-slate-100' : 'bg-slate-800/60'
      }`}
    >
      <div className={`text-[11px] mb-1 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>{label}</div>
      <div className={`text-base font-mono font-bold ${valueClass}`}>{value}</div>
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
  onOpenSettings,
  onOpenSummary,
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
}) {
  // 「隱藏已清倉」:跟首頁的「顯示已出場部位」各自獨立的額外開關,只要清單裡
  // 有已出場部位(hiddenCount > 0,不限框選模式)就一定會顯示,方便使用者在
  // 已經打開「顯示已出場部位」瀏覽的情況下,框選移動時能臨時再把這些已清倉的
  // 部位濾掉,不用特地跑去關掉上面那個全域開關。預設關閉,不影響原本行為。
  const [hideClosed, setHideClosed] = useState(false);
  const displayedHoldings = hideClosed ? holdings.filter((h) => h.summary.shares > 0) : holdings;
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
            onClick={onOpenImport}
            className={`p-2 rounded-full ${isLight ? 'hover:bg-slate-100' : 'hover:bg-slate-800'}`}
            title="CSV 匯入交易"
          >
            <Upload className="w-5 h-5 opacity-70" />
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

      <div className="px-4 pt-3 text-center">
        <div className="text-4xl font-mono font-bold tracking-tight">{formatMoney(totalSummary.marketValue)}</div>
        <div className={`mt-1 font-mono font-bold ${pnlColorClass(totalSummary.unrealizedPnl, isLight)}`}>
          {formatSigned(totalSummary.unrealizedPnl)}｜{formatPct(totalSummary.unrealizedPnlPct)}
        </div>
      </div>

      <div className="px-4 mt-5 flex items-center justify-between">
        <div className="font-bold">績效數據</div>
        <button
          onClick={onOpenSummary}
          className={`text-xs font-bold ${isLight ? 'text-amber-600' : 'text-amber-400'}`}
        >
          查看全部 &gt;
        </button>
      </div>
      <div className="px-4 mt-2 flex gap-2 pb-1">
        <StatCard
          isLight={isLight}
          label="今日損益"
          value={`${formatSigned(totalSummary.todayPnl)}｜${formatPct(totalSummary.todayPnlPct)}`}
          valueClass={pnlColorClass(totalSummary.todayPnl, isLight)}
          sizeClass="flex-1 min-w-0"
        />
        <StatCard
          isLight={isLight}
          label="總損益"
          value={`${formatSigned(totalSummary.totalPnl)}｜${formatPct(totalSummary.totalPnlPct)}`}
          valueClass={pnlColorClass(totalSummary.totalPnl, isLight)}
          sizeClass="flex-1 min-w-0"
        />
      </div>

      <div className="px-4 mt-5 flex items-center justify-between">
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
              className={`text-xs font-bold ${isLight ? 'text-amber-600' : 'text-amber-400'}`}
            >
              {showHidden ? '隱藏已出場' : '顯示已出場部位'}
            </button>
          )}
          {hiddenCount > 0 && (
            <button
              onClick={() => setHideClosed((v) => !v)}
              className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                hideClosed
                  ? 'bg-amber-500 text-white'
                  : isLight
                  ? 'bg-slate-100 text-slate-600'
                  : 'bg-slate-800 text-slate-300'
              }`}
            >
              隱藏已清倉
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

      <div className="px-4 mt-2 space-y-2">
        {displayedHoldings.length === 0 && (
          <div className={`text-center py-10 text-sm ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>
            這個群組還沒有任何持股,點右下角「＋」新增第一筆交易。
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
                  <div className="font-bold text-sm truncate">
                    {h.name}
                    <span className={`ml-1.5 text-[11px] font-normal ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                      {h.symbol}
                    </span>
                  </div>
                  <div className={`text-[11px] truncate ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                    已清倉｜{dateRange}｜共{txCount}筆
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className={`font-mono font-bold text-sm ${pnlColorClass(h.summary.totalPnl, isLight)}`}>
                    {formatSigned(h.summary.totalPnl)}
                  </div>
                  <div className={`text-[11px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                    已實現損益｜{formatPct(h.summary.totalPnlPct)}
                  </div>
                </div>
              </div>
            );
          }

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
              <div className="flex-1 min-w-0 grid grid-cols-3 gap-2 text-left">
                <div className="min-w-0">
                  <div className={`text-[11px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>{h.symbol}</div>
                  <div className="font-bold text-sm truncate">{h.name}</div>
                  <div className={`text-[11px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                    {formatMoney(h.summary.shares)}股
                  </div>
                </div>
                <div className="text-right">
                  <div className={`text-[11px] font-mono ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                    {h.summary.pureAvgPrice.toFixed(2)}
                  </div>
                  <div className={`font-mono font-bold ${pnlColorClass(h.summary.todayPnl, isLight)}`}>
                    {h.summary.currentPrice ? h.summary.currentPrice.toFixed(2) : h.loading ? '…' : '-'}
                  </div>
                  <div className={`text-[11px] font-mono ${pnlColorClass(h.summary.todayPnl, isLight)}`}>
                    {formatPct(h.summary.todayPnlPct)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono font-bold">{formatMoney(h.summary.marketValue)}</div>
                  <div className={`text-[11px] font-mono ${pnlColorClass(h.summary.totalPnl, isLight)}`}>
                    {formatSigned(h.summary.totalPnl)}
                  </div>
                  <div className={`text-[11px] font-mono ${pnlColorClass(h.summary.totalPnl, isLight)}`}>
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
    </div>
  );
}

// ============== 個股詳情 ==============

function StockDetailView({
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
}) {
  const [tab, setTab] = useState('transactions');
  const [expandedTagIds, setExpandedTagIds] = useState(() => new Set());
  const sorted = [...transactions].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  // 框選套用標籤時,選取的這幾筆交易「淨股數」要等於0,才代表構成一個完整的
  // 已清倉波段,之後才能各自獨立、準確地計算這組自己的已實現損益。
  const selectedNetShares = netShareDelta(sorted.filter((tx) => selectedTxIds.has(tx.id)));

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

  const renderTxRow = (tx) => (
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
        <div className={`font-bold text-sm ${typeColor(tx.type)}`}>{TX_TYPE_LABELS[tx.type]}</div>
        <div className={`text-xs ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>{tx.date}</div>
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
          <div className={`text-xs ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>{symbol}</div>
          <div className="font-bold">{name}</div>
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
            <StatCard isLight={isLight} label="現價" value={summary.currentPrice.toFixed(2)} />
            <StatCard isLight={isLight} label="買進均價" value={summary.avgPrice.toFixed(2)} />
            <StatCard
              isLight={isLight}
              label="今日損益"
              value={formatPct(summary.todayPnlPct)}
              valueClass={pnlColorClass(summary.todayPnl, isLight)}
            />
          </div>
        </>
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
              <div className="space-y-2">
                {items.map((item) => {
                  if (item.kind === 'tx') return renderTxRow(item.tx);

                  const { tag, tagId, txs: groupTxs } = item;
                  const groupSummary = computeSymbolSummary(groupTxs);
                  const groupNet = netShareDelta(groupTxs);
                  const expanded = expandedTagIds.has(tagId);
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
        selectedNetShares === 0 ? (
          <button
            onClick={onOpenTagPicker}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3.5 rounded-full bg-amber-500 text-white shadow-lg flex items-center gap-2 z-30 font-bold text-sm"
          >
            <Tag className="w-4 h-4" />
            套用標籤({selectedTxIds.size})
          </button>
        ) : (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3.5 rounded-full bg-slate-400 text-white shadow-lg flex items-center gap-2 z-30 font-bold text-sm">
            <Tag className="w-4 h-4" />
            淨股數{formatSigned(selectedNetShares)}股,需為0
          </div>
        )
      )}

      <button
        onClick={onBack}
        className={`fixed bottom-6 right-4 z-30 w-12 h-12 rounded-full shadow-xl flex items-center justify-center ${
          isLight ? 'bg-white text-slate-700 border border-slate-200' : 'bg-slate-800 text-white border border-slate-600'
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
        className={`fixed bottom-6 right-4 z-30 w-12 h-12 rounded-full shadow-xl flex items-center justify-center ${
          isLight ? 'bg-white text-slate-700 border border-slate-200' : 'bg-slate-800 text-white border border-slate-600'
        }`}
      >
        <ArrowLeft className="w-5 h-5" />
      </button>
    </div>
  );
}

// ============== 主元件 ==============

function PortfolioTrackerInner({ isLight, uid, userEmail, onSignOut }) {
  const [data, setData] = useState(() => loadPortfolioData());
  const [stockNames, setStockNames] = useState(() => ({ ...TW_STOCK_NAMES }));
  const [prices, setPrices] = useState({});
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
  const [addTxSymbol, setAddTxSymbol] = useState(null);
  const [editingTx, setEditingTx] = useState(null);
  const [actionTx, setActionTx] = useState(null);
  const [movingTx, setMovingTx] = useState(null);

  const [selectMode, setSelectMode] = useState(false);
  const [selectedTxIds, setSelectedTxIds] = useState(new Set());
  const [showTagPicker, setShowTagPicker] = useState(false);

  // ---- 持股列表「框選移動群組」----
  const [symbolSelectMode, setSymbolSelectMode] = useState(false);
  const [selectedSymbols, setSelectedSymbols] = useState(new Set());
  const [movingSymbols, setMovingSymbols] = useState(null); // string[] | null

  useEffect(() => {
    savePortfolioData(data); // 本機快取:離線、或下面雲端同步還沒跑完時也能馬上讀寫
    saveRemoteData(uid, data); // 已登入時才會真的寫出去(內建 debounce)
  }, [data, uid]);

  // 登入狀態改變時,跟雲端對一次資料:
  // - 雲端已經有資料 -> 用雲端那份蓋過本機(雲端是跨裝置的正本)
  // - 雲端還沒有資料(這個帳號第一次登入) -> 把本機現有資料當成起點上傳
  // 之後透過 onSnapshot 持續訂閱,另一台裝置改了資料也會即時同步過來。
  useEffect(() => {
    if (!uid) return undefined;
    let cancelled = false;
    let unsubscribe = () => {};

    (async () => {
      try {
        const remote = await fetchRemoteDataOnce(uid);
        if (cancelled) return;
        if (remote) {
          setData((prev) => (JSON.stringify(prev) === JSON.stringify(remote) ? prev : remote));
        } else {
          saveRemoteData(uid, dataRef.current, { immediate: true });
        }
      } catch (e) {
        console.error('讀取雲端資料失敗,先繼續使用本機資料', e);
      }

      unsubscribe = subscribeRemoteData(uid, (remote) => {
        if (!remote) return;
        setData((prev) => (JSON.stringify(prev) === JSON.stringify(remote) ? prev : remote));
      }, (e) => console.error('雲端同步訂閱中斷', e));
    })();

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [uid]);

  // 切換「持股列表 / 個股詳情」畫面時捲回最上方。
  // 如果使用者在列表往下滑很多之後才點進某一檔,detail 畫面會沿用同一個捲動位置,
  // 返回按鈕就被捲到畫面外面,看起來像是「按了沒反應」,其實只是找不到按鈕。
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);

  const txBySymbol = useMemo(() => getTransactionsByGroup(data, data.activeGroupId), [data]);
  const symbols = useMemo(() => Object.keys(txBySymbol), [txBySymbol]);
  const symbolsKey = symbols.join(',');

  useEffect(() => {
    symbols.forEach(async (symbol) => {
      if (pendingRef.current.has(symbol)) return;
      pendingRef.current.add(symbol);
      setPrices((p) => ({ ...p, [symbol]: { ...(p[symbol] || {}), loading: true } }));
      try {
        const result = await fetchStockPriceData(symbol);
        const d = result.data || [];
        const last = d[d.length - 1];
        const prev = d[d.length - 2];
        setPrices((p) => ({
          ...p,
          [symbol]: { price: last ? last.price : 0, prevClose: prev ? prev.price : null, loading: false },
        }));
        if (!stockNames[symbol]) {
          const nm = await fetchStockDisplayName(symbol);
          if (nm) setStockNames((sn) => ({ ...sn, [symbol]: nm }));
        }
      } catch (e) {
        setPrices((p) => ({ ...p, [symbol]: { price: 0, prevClose: null, loading: false, error: true } }));
      }
    });
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
  const visibleHoldings = (showHidden ? allSymbolHoldings : openPositions)
    .slice()
    .sort((a, b) => b.summary.marketValue - a.summary.marketValue);
  const totalSummary = useMemo(
    () => aggregateSummaries(allSymbolHoldings.map((h) => h.summary)),
    [allSymbolHoldings]
  );

  const activeGroup = data.groups.find((g) => g.id === data.activeGroupId) || null;

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
    setShowAddTx(true);
  };
  const handleSubmitTx = (txPayload) => {
    if (editingTx) {
      setData((d) => updateTransaction(d, editingTx.id, txPayload));
    } else {
      setData((d) => addTransaction(d, txPayload));
    }
    setShowAddTx(false);
    setEditingTx(null);
    setAddTxSymbol(null);
  };
  const handleDeleteTxFromForm = (txId) => {
    setData((d) => deleteTransaction(d, txId));
    setShowAddTx(false);
    setEditingTx(null);
  };
  const handleEditTx = (tx) => {
    setEditingTx(tx);
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
          onOpenSettings={handleOpenGroupSettings}
          onOpenSummary={() => setView('summary')}
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
          initial={editingTx || (addTxSymbol ? { symbol: addTxSymbol } : null)}
          onClose={() => {
            setShowAddTx(false);
            setEditingTx(null);
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

      {showImportCsv && (
        <ImportCsvModal
          isLight={isLight}
          data={data}
          onClose={() => setShowImportCsv(false)}
          onImport={handleImportTransactions}
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
