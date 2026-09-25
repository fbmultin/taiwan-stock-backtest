// --- 台灣證券交易所國定假日 / 休市日 ---
// 整理自 TWSE 公告與財經媒體彙整的開休市日期表 (2025-2027)。
// 2027 年之後遇到跨年份時，農曆假期等浮動假日需每年底依官方公告更新。
// 週末已由 isWeekend 另行判斷，此表僅需列出「非週末」的休市日即可，
// 但為求對照方便，仍將部分本身為週末的假日一併列出（不影響判斷結果）。
//
// 這份交易日曆抽成獨立模組，供 App.js(ETF回測比較)與 DcaOptimizer.js
// (定期定額策略最佳化)共用同一份假日表與「前一個交易日」判斷邏輯，
// 避免兩個分頁各自維護一份、日後容易兜不起來。
export const TW_MARKET_HOLIDAYS = {
  // 2025（民國114年）
  '2025-01-01': '元旦',
  '2025-01-23': '春節調整假',
  '2025-01-24': '春節調整假',
  '2025-01-27': '春節',
  '2025-01-28': '除夕',
  '2025-01-29': '春節初一',
  '2025-01-30': '春節初二',
  '2025-01-31': '春節初三',
  '2025-02-28': '和平紀念日',
  '2025-04-03': '兒童節補假',
  '2025-04-04': '清明節',
  '2025-05-01': '勞動節',
  '2025-05-30': '端午節',
  '2025-09-29': '教師節補假',
  '2025-10-06': '中秋節',
  '2025-10-10': '國慶日',
  '2025-10-24': '台灣光復節補假',
  '2025-12-25': '行憲紀念日',
  // 2026（民國115年）
  '2026-01-01': '元旦',
  '2026-02-12': '春節調整假',
  '2026-02-13': '春節調整假',
  '2026-02-16': '除夕前一日',
  '2026-02-17': '除夕',
  '2026-02-18': '春節初一',
  '2026-02-19': '春節初二',
  '2026-02-20': '春節初三',
  '2026-02-27': '和平紀念日補假',
  '2026-04-03': '兒童節補假',
  '2026-04-05': '民族掃墓節',
  '2026-04-06': '民族掃墓節補假',
  '2026-05-01': '勞動節',
  '2026-06-19': '端午節',
  '2026-09-25': '中秋節',
  '2026-09-28': '教師節',
  '2026-10-09': '國慶日補假',
  '2026-10-26': '台灣光復節補假',
  '2026-12-25': '行憲紀念日',
  // 2027（民國116年，暫為推估值，請於官方公告後校正）
  '2027-01-01': '元旦',
  '2027-02-02': '春節調整假',
  '2027-02-03': '春節調整假',
  '2027-02-04': '春節',
  '2027-02-05': '除夕',
  '2027-02-08': '春節初一',
  '2027-02-09': '春節初二',
  '2027-02-10': '春節初三',
  '2027-03-01': '和平紀念日補假',
  '2027-04-05': '清明節',
  '2027-04-06': '兒童節補假',
  '2027-04-30': '勞動節補假',
  '2027-06-09': '端午節',
  '2027-09-15': '中秋節',
  '2027-09-28': '教師節',
  '2027-10-11': '國慶日補假',
  '2027-10-25': '台灣光復節',
  '2027-12-24': '行憲紀念日補假',
};

// 這裡刻意一律用 getUTCDay/toISOString(而不是本地時區的 getDay)判斷,是因為
// 本檔案與 dataCache.js 抓回來的股價/配息資料,日期都是「YYYY-MM-DD」字串,
// 用 new Date(dateString) 解析時 JS 一律當成 UTC 午夜處理。若這裡改用本地時區
// 判斷星期幾,只要程式實際執行的瀏覽器/伺服器時區不是 UTC(例如台灣 UTC+8),
// 就會跟股價資料的日期基準對不齊,导致「最後一個交易日」抓成前一天甚至更早
// (這正是先前回測結束日、排名表報酬率對不上的根本原因)。只要這個模組全程
// 都用 UTC 為基準,不管實際執行環境時區為何都能得到一致、正確的結果。
export const isWeekend = (date) => date.getUTCDay() === 0 || date.getUTCDay() === 6;

export const isTaiwanMarketHoliday = (date) => {
  const dateStr = date.toISOString().split('T')[0];
  return Boolean(TW_MARKET_HOLIDAYS[dateStr]);
};

// 非交易日 = 週末 或 台股國定假日/休市日
export const isNonTradingDay = (date) =>
  isWeekend(date) || isTaiwanMarketHoliday(date);

// 兩個分頁的所有計算「終點」統一採用同一套「資料抓取基準日」規則:
// - 台灣時間下午 3:30 之後:資料源(FinMind/TWSE/Yahoo)當天的收盤價通常已經到位,
//   以「今天」為基準日(若今天本身不是交易日,再往前找最近一個交易日)。
// - 台灣時間下午 3:30 之前:當天資料還沒到位,以「前一天」為基準日,往前找最近
//   一個交易日,避免抓到尾盤價/即時報價跟隔天資料源正式收錄的收盤價對不上,
//   造成回測結果不穩定。
// 判斷「現在幾點」一律換算成台灣時間(UTC+8),不論實際執行環境(使用者瀏覽器)
// 本身的系統時區為何,避免時區設定不同造成誤判。
const TAIPEI_TIMEZONE = 'Asia/Taipei';
const MARKET_DATA_READY_HOUR = 15;
const MARKET_DATA_READY_MINUTE = 30;

const getTaipeiDateTimeParts = (date) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TAIPEI_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const map = {};
  parts.forEach(({ type, value }) => {
    map[type] = value;
  });
  return {
    year: parseInt(map.year, 10),
    month: parseInt(map.month, 10) - 1,
    day: parseInt(map.day, 10),
    hour: parseInt(map.hour, 10),
    minute: parseInt(map.minute, 10),
  };
};

export const getLastCompletedTradingDay = (referenceDate = new Date()) => {
  const tw = getTaipeiDateTimeParts(referenceDate);
  const isAfterDataReadyTime =
    tw.hour > MARKET_DATA_READY_HOUR ||
    (tw.hour === MARKET_DATA_READY_HOUR && tw.minute >= MARKET_DATA_READY_MINUTE);

  // 用 Date.UTC 建立「台灣當地那一天」對應的 UTC 午夜時間點,而不是用
  // new Date(year, month, day)(本地時區午夜)。原因同上:股價資料的日期
  // 一律是 UTC 午夜基準,這裡也要用同一基準,往後所有比較/位移
  // (setUTCDate)才會跟股價資料的日期精準對齊,不受執行環境時區影響。
  const d = new Date(Date.UTC(tw.year, tw.month, tw.day));
  if (!isAfterDataReadyTime) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  while (isNonTradingDay(d)) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return d;
};
