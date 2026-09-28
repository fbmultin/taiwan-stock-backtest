import React, { useEffect, useState } from 'react';
import { Database, Star, Save } from 'lucide-react';
import { PRESETS, MY_PRESET_STORAGE_KEY } from './presets';

// 快速套用列:套用固定的標的組合預設(PRESETS)、套用/儲存使用者自訂的
// 「我的常用標的」(存在瀏覽器 localStorage)、以及清空目前輸入。
// 「ETF回測比較」與「定期定額策略最佳化」兩個分頁都使用這個共用元件,
// 吃同一份 presets.js 資料、同一把 localStorage key——之後異動 presets.js
// 的內容,或在任一分頁按「設為常用」,兩個分頁都會同步生效,不用兩邊各改一次。
//
// props:
// - onApply(stocksArray): 套用一組標的(固定6格陣列,可含空字串)時呼叫,
//   由使用端決定套用到自己分頁的哪個輸入狀態(6格加碼輸入 或 逗號字串)。
// - getCurrentStocks(): 按「設為常用」時,取得目前分頁已啟用/已輸入的標的
//   陣列,用來存成使用者自己的常用組合。
// - onClear: 按「清空」時呼叫;沒有提供的話,預設呼叫 onApply(6個空字串)。
const QuickApplyBar = ({ isLight, onApply, getCurrentStocks, onClear }) => {
  const [myPresetStocks, setMyPresetStocks] = useState(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(MY_PRESET_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMyPresetStocks(parsed);
        }
      }
    } catch (e) {
      // localStorage 不可用(例如無痕模式)時安靜忽略,不影響其餘功能
    }
  }, []);

  // 一鍵套用「我的常用標的」,取代目前輸入,不用每次重打
  const handleApplyMyPreset = () => {
    if (!myPresetStocks || myPresetStocks.length === 0) {
      alert(
        '尚未設定「我的常用標的」。請先輸入想要的標的組合,再按旁邊的「設為常用」儲存,之後就能一鍵套用。'
      );
      return;
    }
    onApply(myPresetStocks);
  };

  // 將目前已啟用的標的組合儲存為「我的常用標的」(存在瀏覽器 localStorage)
  const handleSaveMyPreset = () => {
    const current = (getCurrentStocks ? getCurrentStocks() : []).filter(
      (s) => s !== ''
    );
    if (current.length === 0) {
      alert('目前沒有已啟用的標的可以儲存,請先輸入至少一檔標的。');
      return;
    }
    try {
      localStorage.setItem(MY_PRESET_STORAGE_KEY, JSON.stringify(current));
      setMyPresetStocks(current);
      alert(
        `已將目前 ${current.length} 檔標的(${current.join(
          '、'
        )})設為常用組合,之後按「常用」即可一鍵套用。`
      );
    } catch (e) {
      alert('儲存失敗,可能是瀏覽器不支援或已停用本機儲存功能。');
    }
  };

  return (
    <div
      className={`flex flex-wrap items-center gap-2 mb-4 p-2 rounded-lg border ${
        isLight ? 'bg-slate-100 border-slate-300' : 'bg-slate-800/50 border-slate-700/50'
      }`}
    >
      <span className={`text-xs font-bold mr-2 ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
        <Database className="w-4 h-4 inline mr-1" />
        快速套用:
      </span>
      <button
        onClick={handleApplyMyPreset}
        title={
          myPresetStocks
            ? `套用我的常用標的: ${myPresetStocks.join('、')}`
            : '尚未設定,請先輸入標的後按右側「設為常用」儲存'
        }
        className={`text-xs px-3 py-1.5 rounded-md transition-colors border flex items-center gap-1 font-bold ${
          isLight
            ? 'bg-amber-50 hover:bg-amber-600 hover:text-white text-amber-700 border-amber-300 hover:border-amber-500'
            : 'bg-amber-900/30 hover:bg-amber-600 hover:text-white text-amber-300 border-amber-700/60 hover:border-amber-500'
        }`}
      >
        <Star className="w-3.5 h-3.5" /> 常用
      </button>
      <button
        onClick={handleSaveMyPreset}
        title="將目前輸入的標的組合儲存為「我的常用標的」"
        className={`text-xs px-2 py-1.5 rounded-md transition-colors border flex items-center gap-1 ${
          isLight
            ? 'bg-slate-200 hover:bg-slate-300 text-slate-700 border-slate-300'
            : 'bg-slate-700 hover:bg-slate-600 text-slate-300 border-slate-600'
        }`}
      >
        <Save className="w-3.5 h-3.5" /> 設為常用
      </button>
      {PRESETS.map((preset, idx) => (
        <button
          key={idx}
          onClick={() => onApply(preset.stocks)}
          className={`text-xs px-3 py-1.5 rounded-md transition-colors border hover:bg-emerald-600 hover:text-white hover:border-emerald-500 ${
            isLight
              ? 'bg-slate-200 text-slate-700 border-slate-300'
              : 'bg-slate-700 text-slate-300 border-slate-600'
          }`}
        >
          {preset.name}
        </button>
      ))}
      <button
        onClick={() => (onClear ? onClear() : onApply(['', '', '', '', '', '']))}
        className={`text-xs px-3 py-1.5 rounded-md transition-colors border hover:bg-rose-600 hover:text-white ml-auto ${
          isLight
            ? 'bg-rose-50 text-rose-600 border-rose-300 hover:border-rose-500'
            : 'bg-rose-900/40 text-rose-300 border-rose-800 hover:border-rose-500'
        }`}
      >
        清空
      </button>
    </div>
  );
};

export default QuickApplyBar;
