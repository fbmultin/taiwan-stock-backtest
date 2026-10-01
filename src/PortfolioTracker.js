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
} from 'lucide-react';
import TW_STOCK_NAMES from './data/twStockNames';
import { fetchStockPriceData, fetchStockDisplayName } from './dataCache';
import {
  TX_TYPES,
  TX_TYPE_LABELS,
  ALL_GROUP_ID,
  DEFAULT_GROUP_COLORS,
  loadPortfolioData,
  savePortfolioData,
  createGroup,
  updateGroup,
  deleteGroup,
  createTagAndApply,
  applyTagToTransactions,
  addTransaction,
  updateTransaction,
  deleteTransaction,
  moveTransactionToGroup,
  estimateFee,
  estimateTax,
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

function FieldBox({ label, icon, children, isLight }) {
  return (
    <div
      className={`relative border rounded-xl px-3 pt-4 pb-3 ${
        isLight ? 'border-slate-300 bg-white' : 'border-slate-600 bg-slate-800/40'
      }`}
    >
      <span
        className={`absolute -top-2.5 left-3 px-1 text-[11px] ${
          isLight ? 'bg-white text-slate-500' : 'bg-slate-900 text-slate-400'
        }`}
      >
        {label}
      </span>
      <div className="flex items-center gap-2">
        {icon}
        {children}
      </div>
    </div>
  );
}

// ============== 新增/編輯交易 Modal ==============

function TransactionFormModal({ isLight, data, initial, onClose, onSubmit, onDelete }) {
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
  const [feeDiscountPct, setFeeDiscountPct] = useState(() => {
    const g = data.groups.find((x) => x.id === groupId);
    return g ? g.feeDiscountPct : 100;
  });
  const [showGroupPicker, setShowGroupPicker] = useState(false);
  const nameGuess = TW_STOCK_NAMES[symbol.toUpperCase()] || '';

  const group = data.groups.find((g) => g.id === groupId) || data.groups[0];
  const priceNum = parseFloat(price) || 0;
  const sharesNum = parseFloat(shares) || 0;
  const isBuySell = type === TX_TYPES.BUY || type === TX_TYPES.SELL;
  const autoFee = isBuySell ? estimateFee({ ...group, feeDiscountPct }, priceNum, sharesNum) : 0;
  const fee = fixedFee ? parseFloat(manualFee) || 0 : autoFee;
  const tax = type === TX_TYPES.SELL ? estimateTax(priceNum, sharesNum) : 0;
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

  const inputBase = `flex-1 bg-transparent outline-none text-lg font-mono font-bold ${
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
          <button onClick={onClose} className="p-1 -ml-1">
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
                <FieldBox label="價格" icon={<span className="opacity-60 font-mono">$</span>} isLight={isLight}>
                  <input
                    type="number"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="0.00"
                    className={inputBase}
                  />
                  <span className="text-xs opacity-60 shrink-0">NTD</span>
                </FieldBox>
              )}
              {type !== TX_TYPES.STOCK_DIVIDEND && (
                <div className="flex gap-1 shrink-0 pt-1">
                  <button
                    type="button"
                    onClick={() => setPrice(String(Math.max(0, (parseFloat(price) || 0) - 0.05).toFixed(2)))}
                    className="w-11 h-11 rounded-xl bg-amber-500 text-white flex items-center justify-center"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPrice(String(((parseFloat(price) || 0) + 0.05).toFixed(2)))}
                    className="w-11 h-11 rounded-xl bg-amber-500 text-white flex items-center justify-center"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          )}

          <FieldBox label="數量(股)" icon={<span className="opacity-60">#</span>} isLight={isLight}>
            <input
              type="number"
              value={shares}
              onChange={(e) => setShares(e.target.value)}
              placeholder="數量"
              className={inputBase}
            />
          </FieldBox>
          <div className="text-xs opacity-60 -mt-2">1張 = 1000股</div>

          {isBuySell && (
            <>
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
                    <span>手續費優惠</span>
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
                {type === TX_TYPES.SELL && <span>證交稅:{formatMoney(tax)} 元</span>}
              </div>
            </>
          )}

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
                      setFeeDiscountPct(g.feeDiscountPct);
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

function MoveGroupSheet({ isLight, data, tx, onClose, onConfirm }) {
  return (
    <div className="fixed inset-0 z-[75] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className={`relative w-full sm:max-w-sm sm:rounded-2xl rounded-t-2xl pb-6 pt-2 ${
          isLight ? 'bg-white text-slate-900' : 'bg-slate-800 text-white'
        }`}
      >
        <div className="text-center font-bold py-2">移動到群組</div>
        {data.groups.map((g) => (
          <button
            key={g.id}
            onClick={() => {
              onConfirm(tx.id, g.id);
              onClose();
            }}
            className={`w-full flex items-center gap-3 px-5 py-3 text-left ${
              isLight ? 'hover:bg-slate-100' : 'hover:bg-slate-700'
            }`}
          >
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: g.color }} />
            <span className="flex-1">{g.name}</span>
            {g.id === tx.groupId && <Check className="w-4 h-4 text-emerald-500" />}
          </button>
        ))}
      </div>
    </div>
  );
}

// ============== 批次標籤選擇 ==============

function TagPickerModal({ isLight, tags, onClose, onApply, onCreate }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(DEFAULT_GROUP_COLORS[2]);
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
          標記這幾筆交易屬於同一個操作波段,方便你自己日後辨識(只有你看得到標籤文字)。
        </div>
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
              placeholder="標籤名稱,例如:低接波段"
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
              disabled={!name.trim()}
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
  const [feeDiscountPct, setFeeDiscountPct] = useState(group?.feeDiscountPct ?? 100);
  const [minFeeNormal, setMinFeeNormal] = useState(group?.minFeeNormal ?? 20);
  const [minFeeOdd, setMinFeeOdd] = useState(group?.minFeeOdd ?? 20);

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className={`relative w-full sm:max-w-sm sm:rounded-2xl rounded-t-2xl max-h-[90vh] overflow-y-auto ${
          isLight ? 'bg-white text-slate-900' : 'bg-slate-900 text-white'
        }`}
      >
        <div className="flex items-center gap-3 px-4 pt-4 pb-2">
          <button onClick={onClose} className="p-1 -ml-1">
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

          <div className={`border rounded-xl px-4 py-3 ${isLight ? 'border-slate-300' : 'border-slate-600'}`}>
            <div className="flex items-center justify-between text-sm mb-2">
              <span>預設手續費優惠</span>
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

          <FieldBox label="一般交易手續費低消" icon={<span className="opacity-60 font-mono">$</span>} isLight={isLight}>
            <input
              type="number"
              value={minFeeNormal}
              onChange={(e) => setMinFeeNormal(parseFloat(e.target.value) || 0)}
              className={`flex-1 bg-transparent outline-none text-lg font-mono font-bold ${
                isLight ? 'text-slate-900' : 'text-white'
              }`}
            />
          </FieldBox>
          <FieldBox label="零股交易手續費低消" icon={<span className="opacity-60 font-mono">$</span>} isLight={isLight}>
            <input
              type="number"
              value={minFeeOdd}
              onChange={(e) => setMinFeeOdd(parseFloat(e.target.value) || 0)}
              className={`flex-1 bg-transparent outline-none text-lg font-mono font-bold ${
                isLight ? 'text-slate-900' : 'text-white'
              }`}
            />
          </FieldBox>

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
                onSave({ name: name.trim() || '未命名群組', color, feeDiscountPct, minFeeNormal, minFeeOdd })
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

function StatCard({ isLight, label, value, valueClass = '' }) {
  return (
    <div
      className={`rounded-xl px-3 py-2.5 shrink-0 min-w-[110px] ${
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
  activeGroup,
}) {
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
        <div className="w-9" />
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
      <div className="px-4 mt-2 flex gap-2 overflow-x-auto pb-1">
        <StatCard
          isLight={isLight}
          label="今日損益"
          value={`${formatSigned(totalSummary.todayPnl)}｜${formatPct(totalSummary.todayPnlPct)}`}
          valueClass={pnlColorClass(totalSummary.todayPnl, isLight)}
        />
        <StatCard
          isLight={isLight}
          label="總損益"
          value={`${formatSigned(totalSummary.totalPnl)}｜${formatPct(totalSummary.totalPnlPct)}`}
          valueClass={pnlColorClass(totalSummary.totalPnl, isLight)}
        />
      </div>

      <div className="px-4 mt-5 flex items-center justify-between">
        <div className="font-bold">
          持股紀錄{' '}
          <span className={`text-xs font-normal ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
            顯示{holdings.length}檔{hiddenCount > 0 ? `，隱藏${hiddenCount}檔` : ''}
          </span>
        </div>
        {hiddenCount > 0 && (
          <button
            onClick={onToggleHidden}
            className={`text-xs font-bold ${isLight ? 'text-amber-600' : 'text-amber-400'}`}
          >
            {showHidden ? '隱藏已出場' : '顯示已出場部位'}
          </button>
        )}
      </div>

      <div className="px-4 mt-2 space-y-2">
        {holdings.length === 0 && (
          <div className={`text-center py-10 text-sm ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>
            這個群組還沒有任何持股,點右下角「＋」新增第一筆交易。
          </div>
        )}
        {holdings.map((h) => (
          <button
            key={h.symbol}
            onClick={() => onOpenDetail(h.symbol)}
            className={`w-full grid grid-cols-3 gap-2 rounded-xl px-3 py-3 text-left ${
              isLight ? 'bg-slate-100 hover:bg-slate-200' : 'bg-slate-800/60 hover:bg-slate-800'
            }`}
          >
            <div className="min-w-0">
              <div className={`text-[11px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>{h.symbol}</div>
              <div className="font-bold text-sm truncate">{h.name}</div>
              <div className={`text-[11px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                {formatMoney(h.summary.shares)}股
              </div>
            </div>
            <div className="text-right">
              <div className={`text-[11px] font-mono ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                {h.summary.avgPrice.toFixed(2)}
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
          </button>
        ))}
      </div>

      <button
        onClick={onAddTx}
        className="fixed bottom-6 left-1/2 -translate-x-1/2 w-14 h-14 rounded-full bg-amber-500 text-white shadow-lg flex items-center justify-center z-30"
      >
        <Plus className="w-6 h-6" />
      </button>
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
  const sorted = [...transactions].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const grouped = {};
  sorted.forEach((tx) => {
    const month = tx.date.slice(0, 7).replace('-', '/');
    if (!grouped[month]) grouped[month] = [];
    grouped[month].push(tx);
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

  return (
    <div className="pb-24">
      <div className="flex items-center gap-2 px-4 pt-4">
        <button onClick={onBack} className="p-1">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 text-center -ml-7">
          <div className={`text-xs ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>{symbol}</div>
          <div className="font-bold">{name}</div>
        </div>
      </div>

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

          {Object.entries(grouped).map(([month, txs]) => (
            <div key={month} className="mt-3">
              <div className={`text-xs mb-1.5 ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>{month}</div>
              <div className="space-y-2">
                {txs.map((tx) => {
                  const tag = tags.find((t) => t.id === tx.tagId);
                  return (
                    <div
                      key={tx.id}
                      onClick={() => (selectMode ? onToggleSelectTx(tx.id) : onOpenAction(tx))}
                      className={`flex items-center gap-2 rounded-xl px-3 py-2.5 cursor-pointer ${
                        isLight ? 'bg-slate-100' : 'bg-slate-800/60'
                      }`}
                      style={tag ? { borderLeft: `3px solid ${tag.color}` } : undefined}
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
                          {TX_TYPE_LABELS[tx.type]}{' '}
                          {tag && (
                            <span
                              className="ml-1 text-[10px] font-normal px-1.5 py-0.5 rounded-full align-middle"
                              style={{ background: `${tag.color}33`, color: tag.color }}
                            >
                              {tag.name}
                            </span>
                          )}
                        </div>
                        <div className={`text-xs ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                          {tx.date}
                        </div>
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
        <button
          onClick={onOpenTagPicker}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3.5 rounded-full bg-amber-500 text-white shadow-lg flex items-center gap-2 z-30 font-bold text-sm"
        >
          <Tag className="w-4 h-4" />
          套用標籤({selectedTxIds.size})
        </button>
      )}
    </div>
  );
}

function SectionHeader({ isLight, children }) {
  return <div className="font-bold text-base mt-5 mb-1.5">{children}</div>;
}

function DataRow({ isLight, label, value, indent = 0, colorClass = '' }) {
  return (
    <div
      className={`flex items-center justify-between py-2.5 border-b ${
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
        <button onClick={onBack} className="p-1">
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
    </div>
  );
}

// ============== 主元件 ==============

export default function PortfolioTracker({ isLight }) {
  const [data, setData] = useState(() => loadPortfolioData());
  const [stockNames, setStockNames] = useState(() => ({ ...TW_STOCK_NAMES }));
  const [prices, setPrices] = useState({});
  const pendingRef = useRef(new Set());

  const [view, setView] = useState('list');
  const [detailSymbol, setDetailSymbol] = useState(null);
  const [showHidden, setShowHidden] = useState(false);

  const [showSwitcher, setShowSwitcher] = useState(false);
  const [groupEditor, setGroupEditor] = useState(null); // { group, isNew } | null
  const [showAddTx, setShowAddTx] = useState(false);
  const [addTxSymbol, setAddTxSymbol] = useState(null);
  const [editingTx, setEditingTx] = useState(null);
  const [actionTx, setActionTx] = useState(null);
  const [movingTx, setMovingTx] = useState(null);

  const [selectMode, setSelectMode] = useState(false);
  const [selectedTxIds, setSelectedTxIds] = useState(new Set());
  const [showTagPicker, setShowTagPicker] = useState(false);

  useEffect(() => {
    savePortfolioData(data);
  }, [data]);

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
        });
        return { symbol, name: stockNames[symbol] || symbol, summary, loading: priceInfo.loading };
      }),
    [symbols, txBySymbol, prices, stockNames]
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

  // ---- 批次標籤 ----
  const handleApplyTag = (tagId) => {
    setData((d) => applyTagToTransactions(d, Array.from(selectedTxIds), tagId));
    setSelectedTxIds(new Set());
    setSelectMode(false);
  };
  const handleCreateTag = (name, color) => {
    setData((d) => createTagAndApply(d, { name, color }, Array.from(selectedTxIds)));
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
          activeGroup={activeGroup}
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
          tx={movingTx}
          onClose={() => setMovingTx(null)}
          onConfirm={handleMoveTx}
        />
      )}

      {showTagPicker && (
        <TagPickerModal
          isLight={isLight}
          tags={data.tags}
          onClose={() => setShowTagPicker(false)}
          onApply={handleApplyTag}
          onCreate={handleCreateTag}
        />
      )}
    </div>
  );
}
