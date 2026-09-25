// 定期定額策略最佳化 —— 純運算引擎(不含任何 React/畫面邏輯)。
//
// 涵蓋:
//   1. 均線(MA20/MA60/MA120)與除息日預處理
//   2. 單一策略的定期定額 + 三線加碼 + 配息再投入模擬(runDcaStrategy)
//   3. 參數範圍 → 組合展開(buildParamCombinations)
//   4. 批次最佳化跑批 + 依目標排序取前 N 名(runOptimizationBatch)

// ---------------------------------------------------------------------------
// 1. 均線與除息日預處理
// ---------------------------------------------------------------------------

export const MA_PERIODS = { ma20: 20, ma60: 60, ma120: 120 };
export const MA_LINE_KEYS = ['ma20', 'ma60', 'ma120'];
export const MA_LINE_LABELS = { ma20: '月線(MA20)', ma60: '季線(MA60)', ma120: '半年線(MA120)' };

// 簡單移動平均:第 i 天的均線 = 第 i-period+1 天到第 i 天(共 period 天)收盤價平均。
// 資料不足 period 天時該點為 null。
const computeMovingAverage = (priceData, period) => {
  const result = new Array(priceData.length).fill(null);
  let sum = 0;
  for (let i = 0; i < priceData.length; i++) {
    sum += priceData[i].price;
    if (i >= period) sum -= priceData[i - period].price;
    if (i >= period - 1) result[i] = sum / period;
  }
  return result;
};

// 預處理:把 MA20/MA60/MA120 與除息日標記都算好,回傳一份新陣列(不修改原始
// priceData),每個元素在原本的 {date, price, ...} 之外多出:
//   ma20 / ma60 / ma120: 該日的均線值(資料不足時為 null)
//   isExDivDate: 該日是否為除息日
//   divAmount: 該日的配息金額(非除息日為 0)
// 傳入的 stockResult 是 dataCache.fetchStockPriceData() 的回傳格式
// ({ data, divDates, dividendsMap, ... })。
export const preprocessPriceSeries = (stockResult) => {
  const priceData = stockResult.data;
  const maByPeriod = {
    ma20: computeMovingAverage(priceData, MA_PERIODS.ma20),
    ma60: computeMovingAverage(priceData, MA_PERIODS.ma60),
    ma120: computeMovingAverage(priceData, MA_PERIODS.ma120),
  };

  const divByDate = new Map();
  (stockResult.divDates || []).forEach((ts) => {
    const dateStr = new Date(ts).toISOString().split('T')[0];
    const keySec = Math.floor(ts / 1000);
    const info =
      stockResult.dividendsMap?.[keySec.toString()] ||
      stockResult.dividendsMap?.[keySec] ||
      stockResult.dividendsMap?.[ts];
    const amount = info?.amount || 0;
    if (amount > 0) divByDate.set(dateStr, amount);
  });

  return priceData.map((d, i) => ({
    ...d,
    ma20: maByPeriod.ma20[i],
    ma60: maByPeriod.ma60[i],
    ma120: maByPeriod.ma120[i],
    isExDivDate: divByDate.has(d.date),
    divAmount: divByDate.get(d.date) || 0,
  }));
};

// ---------------------------------------------------------------------------
// 1b. K線穿越均線加碼引擎(Tab1「ETF回測比較」與 Tab2「定期定額策略最佳化」共用)
// ---------------------------------------------------------------------------
// 詳見設計文件「K線穿越均線加碼規則重新設計」。三種子模式(跌破/回檔/站回)+
// 每條均線各自獨立的交易日冷卻期 + 金字塔倍數 × 距上次加碼遞減折扣 + 盤整偵測
// (避開情境二)+ 總量保護機制(第三層)。原本這份邏輯只存在於 App.js,dcaEngine.js
// (Tab2)自己另外維護一套簡化版(單一跌破模式、三線共用「每月最多1次」配額,也
// 就是這份新設計原本要修正的舊漏洞)。現在統一搬到這裡當成唯一的共用實作,
// App.js 與 Tab2 都改成呼叫這裡,確保兩邊行為完全一致、以後只要改一處。

export const KLINE_SUBMODE_KEYS = ['breakdown', 'pullback', 'recovery'];
export const KLINE_SUBMODE_LABELS = {
  breakdown: '跌破加碼',
  pullback: '回檔加碼',
  recovery: '站回加碼',
};
export const DEFAULT_KLINE_SUBMODE_ENABLED = () => ({
  breakdown: true,
  pullback: false,
  recovery: false,
});
// 金字塔倍數的常用預設組合(第一個「均等」等於沒有金字塔效果,方便使用者比較);
// 使用者仍可在 UI 自訂欄位個別覆寫任一均線的倍數。
export const KLINE_PYRAMID_PRESETS = [
  { name: '均等(1x/1x/1x)', values: { ma20: 1, ma60: 1, ma120: 1 } },
  { name: '溫和遞增(1x/1.5x/2x)', values: { ma20: 1, ma60: 1.5, ma120: 2 } },
  { name: '陡升(1x/2x/3x)', values: { ma20: 1, ma60: 2, ma120: 3 } },
];

// 建立某檔標的完整歷史的均線序列查詢結構,給下面 createKlineTopUpEngine 的
// 「回檔加碼」上升趨勢判斷、「盤整偵測」trailing window 計算使用——兩者都需要
// 往回看「今天」之前 N 個交易日的均線值,只看完整歷史(不受回測區間起點限制)
// 才不會在區間剛開始的幾天因為看不到足夠的歷史資料而誤判。
// 傳入已經跑過 preprocessPriceSeries 的陣列(避免重複計算一次均線)。
export const buildKlineMaSeriesFromPreprocessed = (preprocessedList) => {
  const list = preprocessedList.map((d) => ({
    date: d.date,
    ma20: d.ma20,
    ma60: d.ma60,
    ma120: d.ma120,
  }));
  const indexByDate = new Map();
  list.forEach((d, i) => indexByDate.set(d.date, i));
  return { list, indexByDate };
};

// 給還沒預處理過的原始股價資料(dataCache.fetchStockPriceData 的回傳格式)用的
// 便利版本:內部自己呼叫一次 preprocessPriceSeries。
export const buildKlineMaSeries = (stock) =>
  buildKlineMaSeriesFromPreprocessed(preprocessPriceSeries(stock));

// K線穿越均線加碼的完整判斷引擎:三種子模式(跌破/回檔/站回)+ 每條均線各自獨立
// 的交易日冷卻期 + 金字塔倍數 × 距上次加碼遞減折扣 + 盤整偵測(避開情境二)+
// 總量保護機制(第三層)。回傳的 evaluateDay(day, dayIndex) 每天呼叫一次(day 依序
// 來自回測範圍內的資料,dayIndex 是這次回測範圍內的第幾天,從0起算,用來計算
// 冷卻期與遞減折扣經過的交易日數),回傳這一天(可能橫跨多條均線)發生的
// 加碼/跳過事件陣列。
export const createKlineTopUpEngine = (maSeries, opts) => {
  const {
    subModeConfig,
    cooldownDays,
    pyramidMultiplier,
    pullbackLookbackDays,
    pullbackTolerancePct,
    recoveryConfirmDays,
    decayWindowDays,
    decayFloorPct,
    chopEnabled,
    chopWindowDays,
    chopThresholdPct,
    totalCapEnabled,
    totalCapCount,
  } = opts;
  const { list, indexByDate } = maSeries;

  let klinePrevLow = null;
  const prevMaByLine = { ma20: null, ma60: null, ma120: null };
  const lineState = {};
  MA_LINE_KEYS.forEach((lineKey) => {
    lineState[lineKey] = {
      // 距上次加碼的遞減折扣:不分子模式,同一條均線只要「最近一次成功加碼」算起。
      lastTopUpDayIndex: null,
      // 每條均線 × 每種子模式各自獨立的冷卻計時器(互不阻擋)。
      lastTopUpDayIndexBySubmode: { breakdown: null, pullback: null, recovery: null },
      recoveryBelowActive: false,
      recoveryAboveStreak: 0,
    };
  });
  let totalTopUpCount = 0;

  const evaluateDay = (day, dayIndex) => {
    const events = [];
    const fullIdx = indexByDate.get(day.date);
    const hasLow = typeof day.low === 'number' && Number.isFinite(day.low);

    MA_LINE_KEYS.forEach((lineKey) => {
      const modes = subModeConfig[lineKey] || {};
      if (!modes.breakdown && !modes.pullback && !modes.recovery) return;

      const entry = fullIdx !== undefined ? list[fullIdx] : null;
      const ma = entry ? entry[lineKey] : null;
      if (ma === null || ma === undefined || !(ma > 0)) return;
      const prevMa = prevMaByLine[lineKey];
      const state = lineState[lineKey];

      // 上升趨勢判斷(回檔加碼用):回看 N 個交易日,若目前均線值高於 N 天前均線值,
      // 即視為上升——只用已經過去的資料,trailing window,無 look-ahead bias。
      let isUpTrend = false;
      if (modes.pullback && fullIdx !== undefined) {
        const pastIdx = fullIdx - pullbackLookbackDays;
        const pastMa = pastIdx >= 0 && list[pastIdx] ? list[pastIdx][lineKey] : null;
        if (pastMa !== null && pastMa !== undefined && pastMa > 0) {
          isUpTrend = ma > pastMa;
        }
      }

      // 站回加碼狀態機:用收盤價判斷站上/站下均線。belowActive 一旦為 true,
      // 之後每天收盤價站上均線就累加 aboveStreak;streak 達「確認天數+1」時
      // 視為條件成立(N=0 時,站回當天 streak=1 就成立,等同立刻買進)。
      // 條件成立但被冷卻期/盤整/總量上限擋下時,狀態刻意不重置,讓它有機會在
      // 之後解除限制的那一天補上觸發,而不是憑空消失。
      let recoveryConditionMet = false;
      if (modes.recovery && typeof day.price === 'number' && day.price > 0) {
        if (day.price < ma) {
          state.recoveryBelowActive = true;
          state.recoveryAboveStreak = 0;
        } else if (state.recoveryBelowActive) {
          state.recoveryAboveStreak += 1;
          recoveryConditionMet = state.recoveryAboveStreak >= recoveryConfirmDays + 1;
        }
      }

      // 跌破加碼:延用最初就有的判斷——前一日最低點高於前一日均線(完全站上),
      // 且今日最低點跌破或觸及今日均線。
      const breakdownTriggered =
        modes.breakdown &&
        klinePrevLow !== null &&
        prevMa !== null &&
        prevMa > 0 &&
        klinePrevLow > prevMa &&
        hasLow &&
        day.low <= ma;

      // 回檔加碼:上升趨勢中,價格接近或觸及均線但未跌破(容忍度可設定)。
      const pullbackTriggered =
        modes.pullback &&
        isUpTrend &&
        hasLow &&
        day.low >= ma &&
        day.low <= ma * (1 + pullbackTolerancePct / 100);

      // 同一天同一條均線最多只算一種子模式觸發,優先序:跌破 > 站回 > 回檔。
      let subMode = null;
      if (breakdownTriggered) subMode = 'breakdown';
      else if (recoveryConditionMet) subMode = 'recovery';
      else if (pullbackTriggered) subMode = 'pullback';

      if (subMode) {
        // 盤整偵測(避開情境二):trailing window 只看已經過去(含今天)的均線值,
        // 若判定為盤整,這條均線本次的所有加碼子模式全部跳過,不只是打折。
        let isChop = false;
        if (chopEnabled && fullIdx !== undefined && fullIdx - chopWindowDays + 1 >= 0) {
          let maxV = -Infinity;
          let minV = Infinity;
          for (let i = fullIdx - chopWindowDays + 1; i <= fullIdx; i++) {
            const v = list[i] ? list[i][lineKey] : null;
            if (v === null || v === undefined || !(v > 0)) continue;
            if (v > maxV) maxV = v;
            if (v < minV) minV = v;
          }
          if (maxV > -Infinity && minV < Infinity) {
            isChop = (maxV - minV) / ma < chopThresholdPct / 100;
          }
        }

        if (isChop) {
          events.push({
            lineKey,
            subMode,
            ratio: 0,
            skipReason: '判定為盤整',
          });
        } else {
          const lastSub = state.lastTopUpDayIndexBySubmode[subMode];
          const cooldownOk =
            lastSub === null || dayIndex - lastSub >= cooldownDays[lineKey];
          const capOk = !totalCapEnabled || totalTopUpCount < totalCapCount;

          if (!cooldownOk) {
            events.push({ lineKey, subMode, ratio: 0, skipReason: '冷卻期未滿' });
          } else if (!capOk) {
            events.push({
              lineKey,
              subMode,
              ratio: 0,
              skipReason: '已達合計加碼次數上限',
            });
          } else {
            const multiplier = pyramidMultiplier[lineKey] || 1;
            const lastAny = state.lastTopUpDayIndex;
            let decayRatio = 1;
            if (lastAny !== null && decayWindowDays > 0) {
              const gap = dayIndex - lastAny;
              if (gap < decayWindowDays) {
                const floor = decayFloorPct / 100;
                decayRatio = floor + (1 - floor) * (gap / decayWindowDays);
              }
            }
            events.push({
              lineKey,
              subMode,
              ratio: multiplier * decayRatio,
              multiplier,
              decayRatio,
              skipReason: null,
            });
            state.lastTopUpDayIndex = dayIndex;
            state.lastTopUpDayIndexBySubmode[subMode] = dayIndex;
            if (subMode === 'recovery') {
              state.recoveryBelowActive = false;
              state.recoveryAboveStreak = 0;
            }
            totalTopUpCount += 1;
          }
        }
      }

      prevMaByLine[lineKey] = ma;
    });

    klinePrevLow = hasLow ? day.low : null;
    return events;
  };

  return { evaluateDay };
};

// ---------------------------------------------------------------------------
// 2. 單一策略模擬
// ---------------------------------------------------------------------------

// config = {
//   startDate: 'YYYY-MM-DD',
//   monthlyAmount: number,          // 每月定期定額金額
//   investDay: number,              // 每月投入日(1~31),遇非交易日順延至當月第一個交易日;
//                                    // 若當月已無 >= investDay 的交易日,改用當月最後一個交易日
//   reinvestRatio: number,          // 配息再投入比例 0~1
//   useKLineCrossTrigger: boolean,  // false=舊版「偏離%」模式,true=新版「K線穿越」模式
//                                    // (與 Tab1 共用 createKlineTopUpEngine,行為完全一致)
//
//   ---- useKLineCrossTrigger === false(偏離%模式)專用 ----
//   maLines: {
//     ma20: { enabled, deviationPct, topUpMode: 'fixed' | 'multiple', topUpValue },
//     ma60: { ... },
//     ma120: { ... },
//   },
//   monthlyTriggerCap: number,      // 每月三線共用的加碼觸發次數上限(0 = 不加碼)
//
//   ---- useKLineCrossTrigger === true(K線穿越模式)專用 ----
//   klineBaseAmount: number,        // 加碼基準金額(對應 Tab1「加碼策略設定」的每次加碼金額)
//   klineConfig: {                  // 直接餵給 createKlineTopUpEngine 的設定物件,見上面 1b 節
//     subModeConfig, cooldownDays, pyramidMultiplier, pullbackLookbackDays,
//     pullbackTolerancePct, recoveryConfirmDays, decayWindowDays, decayFloorPct,
//     chopEnabled, chopWindowDays, chopThresholdPct, totalCapEnabled, totalCapCount,
//   },
// }
//
// 偏離%模式加碼觸發邏輯(useKLineCrossTrigger=false 時,邏輯完全不變):
//   - deviationPct 是正數,代表「收盤價低於均線多少 %」才觸發,
//     即 (price - ma) / ma <= -deviationPct/100。
//   - 「當天第一次進入觸發區間就觸發」:用前一天是否已在區間內的狀態做邊緣觸發判斷,
//     連續處於區間內不會重複觸發,離開區間後再次跌回來才算新的一次。
//   - 三線依 ma20 → ma60 → ma120 的順序檢查,共用同一個每月觸發次數上限,
//     誰先用完額度、之後的觸發即使進入區間也不會真的買進(但狀態仍會更新,
//     離開/再進入區間的判斷不受額度用完影響)。
export const buildMonthlyInvestDates = (days, investDay) => {
  const byMonth = new Map();
  days.forEach((d) => {
    const monthKey = d.date.slice(0, 7);
    if (!byMonth.has(monthKey)) byMonth.set(monthKey, []);
    byMonth.get(monthKey).push(d);
  });
  const monthKeys = Array.from(byMonth.keys());
  const investDateSet = new Set();
  // 頭尾兩個月常常是「不完整」的月份(回測起始日、結束日不是剛好切在月初/月底),
  // 這兩個邊界月份需要特別判斷,否則會多算出一次不存在的加碼:
  // - 第一個月:如果資料開始的日期本身就已經晚於加碼日(例如加碼日設5號、
  //   資料卻從15號才開始),代表這個月的加碼日在回測起始前就已經過了,不該把
  //   「資料的第一天」誤當成一次加碼。
  // - 最後一個月:如果整個月都找不到「日期 >= 加碼日」的交易日(代表加碼日
  //   還沒到回測結束日),也不該硬用當月最後一個交易日頂替一次加碼。
  // 中間的完整月份仍維持原本邏輯:找不到 >= 加碼日的交易日時(通常是月底遇到
  // 國定假日),用當月最後一個交易日頂替,確保每個完整月份都有一次加碼。
  monthKeys.forEach((monthKey, idx) => {
    const monthDays = byMonth.get(monthKey);
    const isFirstMonth = idx === 0;
    const isLastMonth = idx === monthKeys.length - 1;
    const firstDayNum = parseInt(monthDays[0].date.slice(8, 10), 10);
    if (isFirstMonth && firstDayNum > investDay) return;

    const target = monthDays.find(
      (d) => parseInt(d.date.slice(8, 10), 10) >= investDay
    );
    if (target) {
      investDateSet.add(target.date);
      return;
    }
    if (!isLastMonth) {
      investDateSet.add(monthDays[monthDays.length - 1].date);
    }
  });
  return investDateSet;
};

const computeYearlyBreakdown = (valueSeries) => {
  const byYear = new Map();
  valueSeries.forEach((v) => {
    byYear.set(v.date.slice(0, 4), v); // 陣列已依時間排序,後面的會覆蓋前面的 → 留下該年度最後一筆
  });
  const years = Array.from(byYear.keys()).sort();
  const rows = [];
  let prevEndValue = 0;
  years.forEach((year, idx) => {
    const yearEnd = byYear.get(year);
    // 年度報酬%是簡化呈現:用「今年底市值 - 去年底市值」相對於去年底市值估算,
    // 若當年度有新增投入,這個百分比會同時反映市場漲跌與資金投入的影響,
    // 並非嚴格的 money-weighted 年化報酬。第一年因為沒有「去年底市值」可比,
    // 改用「今年底市值 - 今年度累計投入」相對於累計投入金額計算。
    const yearReturnPct =
      idx === 0
        ? yearEnd.totalInvested > 0
          ? ((yearEnd.totalValue - yearEnd.totalInvested) / yearEnd.totalInvested) * 100
          : 0
        : prevEndValue > 0
        ? ((yearEnd.totalValue - prevEndValue) / prevEndValue) * 100
        : 0;
    rows.push({
      year,
      endValue: yearEnd.totalValue,
      totalInvested: yearEnd.totalInvested,
      yearReturnPct,
    });
    prevEndValue = yearEnd.totalValue;
  });
  return rows;
};

export const runDcaStrategy = (preprocessedData, config) => {
  const {
    startDate,
    monthlyAmount,
    investDay,
    reinvestRatio,
    useKLineCrossTrigger,
    maLines,
    monthlyTriggerCap,
    klineBaseAmount,
    klineConfig,
  } = config;

  const startTs = new Date(startDate).getTime();
  const days = preprocessedData.filter((d) => d.timestamp >= startTs);
  if (days.length === 0) return null;

  const investDateSet = buildMonthlyInvestDates(days, investDay);

  let shares = 0; // 投入資金(定期定額+加碼)買到的股數
  let reinvestShares = 0; // 配息再投入買到的股數
  let cashBalance = 0; // 未再投入的配息現金
  let totalInvested = 0; // 總投入本金(不含配息再投入金額)
  let totalDividends = 0; // 累計配息金額(不論有沒有再投入)

  // 偏離%模式(useKLineCrossTrigger=false)專用狀態,邏輯完全不變。
  let currentMonthKey = null;
  let monthlyTriggerCount = 0;
  const insideBand = { ma20: false, ma60: false, ma120: false };

  // K線穿越模式(useKLineCrossTrigger=true):直接沿用 Tab1(ETF回測比較)
  // 同一顆 createKlineTopUpEngine,兩邊行為保證一致,不再各自維護一套判斷邏輯。
  const klineMaSeries = useKLineCrossTrigger ? buildKlineMaSeriesFromPreprocessed(days) : null;
  const klineEngine =
    useKLineCrossTrigger && klineMaSeries && klineConfig
      ? createKlineTopUpEngine(klineMaSeries, klineConfig)
      : null;

  const valueSeries = [];
  const topUpEvents = []; // 每一次實際成交(或被擋下)的加碼記錄

  days.forEach((day, dayIndex) => {
    const monthKey = day.date.slice(0, 7);
    if (monthKey !== currentMonthKey) {
      currentMonthKey = monthKey;
      monthlyTriggerCount = 0;
    }

    // 1. 定期定額扣款
    if (investDateSet.has(day.date) && monthlyAmount > 0) {
      shares += monthlyAmount / day.price;
      totalInvested += monthlyAmount;
    }

    // 2. 加碼觸發檢查
    if (useKLineCrossTrigger) {
      if (klineEngine && klineBaseAmount > 0) {
        const events = klineEngine.evaluateDay(day, dayIndex);
        events.forEach((ev) => {
          const amount = klineBaseAmount * ev.ratio;
          const baseEvent = {
            date: day.date,
            lineKey: ev.lineKey,
            lineLabel: MA_LINE_LABELS[ev.lineKey],
            subMode: ev.subMode,
            subModeLabel: KLINE_SUBMODE_LABELS[ev.subMode],
            triggerMode: 'kline',
            price: day.price,
          };
          if (!ev.skipReason && amount > 0) {
            const topUpShares = amount / day.price;
            shares += topUpShares;
            totalInvested += amount;
            topUpEvents.push({
              ...baseEvent,
              multiplier: ev.multiplier,
              decayRatio: ev.decayRatio,
              topUpAmount: amount,
              shares: topUpShares,
              skipped: false,
            });
          } else {
            topUpEvents.push({
              ...baseEvent,
              topUpAmount: 0,
              shares: 0,
              skipped: true,
              skipReason: ev.skipReason,
            });
          }
        });
      }
    } else {
      // 偏離%模式:三線依序檢查,共用同一個每月觸發次數上限,邏輯完全不變。
      MA_LINE_KEYS.forEach((lineKey) => {
        const lineConfig = maLines[lineKey];
        if (!lineConfig || !lineConfig.enabled) return;
        const ma = day[lineKey];
        if (ma === null || ma === undefined || !(ma > 0)) return;

        const deviation = (day.price - ma) / ma; // 負值代表跌破均線
        const threshold = -Math.abs(lineConfig.deviationPct) / 100;
        const isInBandNow = deviation <= threshold;
        const triggeredToday = isInBandNow && !insideBand[lineKey];
        insideBand[lineKey] = isInBandNow;

        if (triggeredToday) {
          const withinCap = monthlyTriggerCap > 0 && monthlyTriggerCount < monthlyTriggerCap;
          const baseEvent = {
            date: day.date,
            lineKey,
            lineLabel: MA_LINE_LABELS[lineKey],
            triggerMode: 'deviation',
            price: day.price,
            ma,
            deviationPct: deviation * 100,
            thresholdPct: lineConfig.deviationPct,
            topUpMode: lineConfig.topUpMode,
            topUpValue: lineConfig.topUpValue,
          };
          if (withinCap) {
            const topUpAmount =
              lineConfig.topUpMode === 'multiple'
                ? monthlyAmount * lineConfig.topUpValue
                : lineConfig.topUpValue;
            if (topUpAmount > 0) {
              const topUpShares = topUpAmount / day.price;
              shares += topUpShares;
              totalInvested += topUpAmount;
              monthlyTriggerCount += 1;
              topUpEvents.push({ ...baseEvent, topUpAmount, shares: topUpShares, skipped: false });
            }
          } else if (monthlyTriggerCap > 0) {
            // 有啟用加碼,但當月配額已被其他線用完:記錄下來讓使用者知道「這次沒買到」的原因。
            topUpEvents.push({ ...baseEvent, topUpAmount: 0, shares: 0, skipped: true });
          }
        }
      });
    }

    // 3. 除息配息:以除息日當天收盤價買入再投入部分
    if (day.isExDivDate && day.divAmount > 0) {
      const totalSharesHeld = shares + reinvestShares;
      const dividendCash = totalSharesHeld * day.divAmount;
      if (dividendCash > 0) {
        totalDividends += dividendCash;
        const reinvestCash = dividendCash * (reinvestRatio ?? 0);
        cashBalance += dividendCash - reinvestCash;
        if (reinvestCash > 0) {
          reinvestShares += reinvestCash / day.price;
        }
      }
    }

    const totalSharesHeld = shares + reinvestShares;
    valueSeries.push({
      date: day.date,
      totalValue: totalSharesHeld * day.price + cashBalance,
      priceOnlyValue: shares * day.price, // 不含息:只計投入資金買到的股數,排除配息與再投入的影響
      totalInvested,
    });
  });

  const last = valueSeries[valueSeries.length - 1];
  const finalTotalValue = last.totalValue;
  const finalPriceOnlyValue = last.priceOnlyValue;
  const finalTotalInvested = last.totalInvested;
  const finalPrice = days[days.length - 1].price;

  const totalReturnPct =
    finalTotalInvested > 0
      ? ((finalPriceOnlyValue - finalTotalInvested) / finalTotalInvested) * 100
      : 0;
  const dividendReturnPct =
    finalTotalInvested > 0
      ? ((finalTotalValue - finalTotalInvested) / finalTotalInvested) * 100
      : 0;

  const startTime = new Date(days[0].date).getTime();
  const endTime = new Date(days[days.length - 1].date).getTime();
  const years = Math.max((endTime - startTime) / (365.25 * 86400000), 1 / 365.25);
  const cagr =
    finalTotalInvested > 0 && finalTotalValue > 0
      ? (Math.pow(finalTotalValue / finalTotalInvested, 1 / years) - 1) * 100
      : 0;

  // 最大回撤:以含息市值(mark-to-market)時間序列計算,峰值採歷史新高、
  // 回撤 = (當前值 - 歷史新高) / 歷史新高,取全程最小值(最負)。
  let peak = -Infinity;
  let maxDrawdownPct = 0;
  valueSeries.forEach((v) => {
    if (v.totalValue > peak) peak = v.totalValue;
    if (peak > 0) {
      const dd = ((v.totalValue - peak) / peak) * 100;
      if (dd < maxDrawdownPct) maxDrawdownPct = dd;
    }
  });

  return {
    config,
    totalInvested: finalTotalInvested,
    finalMarketValue: finalTotalValue,
    totalReturnPct,
    dividendReturnPct,
    cagr,
    totalDividends,
    maxDrawdownPct,
    yearlyBreakdown: computeYearlyBreakdown(valueSeries),
    finalPrice,
    startDate: days[0].date,
    endDate: days[days.length - 1].date,
    valueSeries,
    topUpEvents,
  };
};

// ---------------------------------------------------------------------------
// 3. 參數範圍 → 組合展開
// ---------------------------------------------------------------------------

// 產生某個數值範圍的離散搜尋點(含頭尾);step 不合法或 min>=max 時只回傳 [min]。
const expandRange = (min, max, step) => {
  if (!(step > 0) || !(max > min)) return [min];
  const values = [];
  for (let v = min; v <= max + 1e-9; v += step) {
    values.push(Math.round(v * 10000) / 10000);
  }
  return values.length > 0 ? values : [min];
};

// 組合數上限:K線穿越模式的搜尋維度比偏離%模式多(見下面 buildKlineParamCombinations
// 的說明),所以比舊版稍微放寬,但仍然是「跑起來不會把瀏覽器分頁卡死」的保守值——
// 使用者若刻意把每個維度都設成大範圍/小間距,還是會被這個上限擋下來,需要縮小範圍
// 或加大間距。
export const COMBINATION_COUNT_WARNING_THRESHOLD = 3000;
export const COMBINATION_COUNT_HARD_LIMIT = 30000;

const cartesianCombine = (lists) => {
  const combos = [];
  const walk = (idx, current) => {
    if (idx === lists.length) {
      combos.push(current.slice());
      return;
    }
    lists[idx].forEach((val) => {
      current.push(val);
      walk(idx + 1, current);
      current.pop();
    });
  };
  walk(0, []);
  return combos;
};

// ---- 偏離%模式(useKLineCrossTrigger=false)的組合展開,邏輯與參數形狀完全不變 ----
//
// optimizerConfig(偏離%模式)= {
//   base: { startDate, monthlyAmount, investDay },
//   maLines: {
//     ma20: { enabled, topUpMode, deviationRange: {min,max,step}, topUpRange: {min,max,step} },
//     ma60: { ... }, ma120: { ... },
//   },
//   monthlyTriggerCapRange: { min, max, step },
//   reinvestRatioRange: { min, max, step }, // 單位:百分比(0~100)
// }
const buildDeviationParamCombinations = (optimizerConfig) => {
  const { base, maLines, monthlyTriggerCapRange, reinvestRatioRange } = optimizerConfig;

  const lineValueLists = MA_LINE_KEYS.map((key) => {
    const line = maLines[key];
    if (!line || !line.enabled) return [null]; // null = 這條線在這次最佳化搜尋中完全停用
    const deviations = expandRange(
      line.deviationRange.min,
      line.deviationRange.max,
      line.deviationRange.step
    );
    const topUps = expandRange(line.topUpRange.min, line.topUpRange.max, line.topUpRange.step);
    const combos = [];
    deviations.forEach((deviationPct) => {
      topUps.forEach((topUpValue) => {
        combos.push({ enabled: true, deviationPct, topUpMode: line.topUpMode, topUpValue });
      });
    });
    return combos;
  });

  const capValues = expandRange(
    monthlyTriggerCapRange.min,
    monthlyTriggerCapRange.max,
    monthlyTriggerCapRange.step
  );
  const reinvestValues = expandRange(
    reinvestRatioRange.min,
    reinvestRatioRange.max,
    reinvestRatioRange.step
  );

  const combos = cartesianCombine([...lineValueLists, capValues, reinvestValues]);

  return combos.map(([ma20, ma60, ma120, cap, reinvestPct]) => ({
    startDate: base.startDate,
    monthlyAmount: base.monthlyAmount,
    investDay: base.investDay,
    useKLineCrossTrigger: false,
    maLines: {
      ma20: ma20 || { enabled: false },
      ma60: ma60 || { enabled: false },
      ma120: ma120 || { enabled: false },
    },
    monthlyTriggerCap: cap,
    reinvestRatio: reinvestPct / 100,
  }));
};

// ---- K線穿越模式(useKLineCrossTrigger=true)的組合展開 ----
//
// 跟 Tab1(ETF回測比較)共用同一套「金字塔倍數 × 遞減折扣 × 盤整偵測 × 總量上限」
// 的參數概念,但為了避免組合數爆炸,刻意把其中兩類「本來是每條均線各自一個數字」
// 的參數收斂成單一搜尋維度,而不是逐條均線展開(那樣組合數會以三次方成長):
//   1. 金字塔倍數:不對 MA20/MA60/MA120 各自展開 min/max/step,改成「使用者勾選
//      要嘗試哪幾組倍數組合(預設 3 組 + 可自訂 1 組)」的離散清單,一組 = 一個組合。
//   2. 冷卻天數:所有已啟用的均線/子模式統一套用同一個搜尋範圍,不分別展開。
// 其餘(回檔回看天數、回檔容忍度、站回確認天數、遞減折扣視窗/下限、盤整視窗/閾值、
// 配息再投入比例)維持「各自一個 min/max/step 範圍」的設計,跟偏離%模式一致。
// 子模式開關(跌破/回檔/站回)與總量上限本身是使用者直接設定的風控/策略選擇,
// 不是最佳化的搜尋目標,所以不展開範圍,每個組合都套用同一份固定設定。
//
// optimizerConfig(K線穿越模式)= {
//   base: { startDate, monthlyAmount, investDay },
//   klineBaseAmount: number,
//   klineSubModeEnabled: { ma20: {breakdown,pullback,recovery}, ma60: {...}, ma120: {...} },
//   klinePyramidPresets: [ { name, values: {ma20,ma60,ma120} }, ... ], // 至少 1 組
//   klineCooldownRange, klinePullbackLookbackRange, klinePullbackToleranceRange,
//   klineRecoveryConfirmRange, klineDecayWindowRange, klineDecayFloorRange: { min, max, step },
//   klineChopEnabled: boolean,
//   klineChopWindowRange, klineChopThresholdRange: { min, max, step }, // chopEnabled=false 時不展開
//   klineTotalCapEnabled: boolean,
//   klineTotalCapCount: number, // 固定值,不搜尋
//   reinvestRatioRange: { min, max, step },
// }
const buildKlineParamCombinations = (optimizerConfig) => {
  const {
    base,
    klineBaseAmount,
    klineSubModeEnabled,
    klinePyramidPresets,
    klineCooldownRange,
    klinePullbackLookbackRange,
    klinePullbackToleranceRange,
    klineRecoveryConfirmRange,
    klineDecayWindowRange,
    klineDecayFloorRange,
    klineChopEnabled,
    klineChopWindowRange,
    klineChopThresholdRange,
    klineTotalCapEnabled,
    klineTotalCapCount,
    reinvestRatioRange,
  } = optimizerConfig;

  const pyramidChoices =
    klinePyramidPresets && klinePyramidPresets.length > 0
      ? klinePyramidPresets
      : [{ name: '均等(1x/1x/1x)', values: { ma20: 1, ma60: 1, ma120: 1 } }];
  const cooldownValues = expandRange(
    klineCooldownRange.min,
    klineCooldownRange.max,
    klineCooldownRange.step
  );
  const lookbackValues = expandRange(
    klinePullbackLookbackRange.min,
    klinePullbackLookbackRange.max,
    klinePullbackLookbackRange.step
  );
  const toleranceValues = expandRange(
    klinePullbackToleranceRange.min,
    klinePullbackToleranceRange.max,
    klinePullbackToleranceRange.step
  );
  const confirmValues = expandRange(
    klineRecoveryConfirmRange.min,
    klineRecoveryConfirmRange.max,
    klineRecoveryConfirmRange.step
  );
  const decayWindowValues = expandRange(
    klineDecayWindowRange.min,
    klineDecayWindowRange.max,
    klineDecayWindowRange.step
  );
  const decayFloorValues = expandRange(
    klineDecayFloorRange.min,
    klineDecayFloorRange.max,
    klineDecayFloorRange.step
  );
  // 盤整偵測整體關閉時,視窗/閾值不展開範圍,固定用單一值即可,避免在無意義的
  // 維度上重複跑一堆相同結果的組合。
  const chopWindowValues = klineChopEnabled
    ? expandRange(klineChopWindowRange.min, klineChopWindowRange.max, klineChopWindowRange.step)
    : [klineChopWindowRange?.min ?? 10];
  const chopThresholdValues = klineChopEnabled
    ? expandRange(
        klineChopThresholdRange.min,
        klineChopThresholdRange.max,
        klineChopThresholdRange.step
      )
    : [klineChopThresholdRange?.min ?? 2];
  const reinvestValues = expandRange(
    reinvestRatioRange.min,
    reinvestRatioRange.max,
    reinvestRatioRange.step
  );

  const combos = cartesianCombine([
    pyramidChoices,
    cooldownValues,
    lookbackValues,
    toleranceValues,
    confirmValues,
    decayWindowValues,
    decayFloorValues,
    chopWindowValues,
    chopThresholdValues,
    reinvestValues,
  ]);

  return combos.map(
    ([
      preset,
      cooldown,
      lookback,
      tolerance,
      confirm,
      decayWindow,
      decayFloor,
      chopWindow,
      chopThreshold,
      reinvestPct,
    ]) => ({
      startDate: base.startDate,
      monthlyAmount: base.monthlyAmount,
      investDay: base.investDay,
      useKLineCrossTrigger: true,
      klineBaseAmount,
      klineConfig: {
        subModeConfig: klineSubModeEnabled,
        cooldownDays: { ma20: cooldown, ma60: cooldown, ma120: cooldown },
        pyramidMultiplier: preset.values,
        pyramidPresetName: preset.name,
        pullbackLookbackDays: lookback,
        pullbackTolerancePct: tolerance,
        recoveryConfirmDays: confirm,
        decayWindowDays: decayWindow,
        decayFloorPct: decayFloor,
        chopEnabled: klineChopEnabled,
        chopWindowDays: chopWindow,
        chopThresholdPct: chopThreshold,
        totalCapEnabled: klineTotalCapEnabled,
        totalCapCount: klineTotalCapCount,
      },
      reinvestRatio: reinvestPct / 100,
    })
  );
};

export const buildParamCombinations = (optimizerConfig) =>
  optimizerConfig.useKLineCrossTrigger
    ? buildKlineParamCombinations(optimizerConfig)
    : buildDeviationParamCombinations(optimizerConfig);

// ---------------------------------------------------------------------------
// 4. 批次最佳化跑批 + 排序
// ---------------------------------------------------------------------------

export const OPTIMIZE_OBJECTIVES = {
  CAGR: 'cagr',
  DIVIDEND_RETURN: 'dividendReturn',
  MIN_DRAWDOWN: 'minDrawdown',
  BALANCED: 'balanced',
};

export const OPTIMIZE_OBJECTIVE_LABELS = {
  [OPTIMIZE_OBJECTIVES.CAGR]: '最高 CAGR(年化報酬率)',
  [OPTIMIZE_OBJECTIVES.DIVIDEND_RETURN]: '最高含息報酬',
  [OPTIMIZE_OBJECTIVES.MIN_DRAWDOWN]: '最低最大回撤',
  [OPTIMIZE_OBJECTIVES.BALANCED]: '平衡(報酬與穩定性各半)',
};

const scoreForObjective = (result, objective) => {
  switch (objective) {
    case OPTIMIZE_OBJECTIVES.CAGR:
      return result.cagr;
    case OPTIMIZE_OBJECTIVES.DIVIDEND_RETURN:
      return result.dividendReturnPct;
    case OPTIMIZE_OBJECTIVES.MIN_DRAWDOWN:
      // 回撤本身是負值或 0,取負號讓「分數越高越好」的排序邏輯一致
      // (回撤幅度越小、也就是越接近 0,分數越高)。
      return -Math.abs(result.maxDrawdownPct);
    case OPTIMIZE_OBJECTIVES.BALANCED:
    default:
      // 平衡:含息報酬與(100 - 回撤幅度)各半,避免其中一項數值範圍差太多主導排序結果。
      return result.dividendReturnPct * 0.5 + (100 - Math.abs(result.maxDrawdownPct)) * 0.5;
  }
};

// 分批執行,避免大量組合一次跑完卡住瀏覽器畫面;每跑完一批就 setTimeout(0) 讓出一次
// 主執行緒,onProgress(done, total) 讓呼叫端可以更新進度條。
export const runOptimizationBatch = async ({
  preprocessedData,
  paramCombinations,
  objective,
  topN = 5,
  batchSize = 150,
  onProgress,
}) => {
  const results = [];
  for (let i = 0; i < paramCombinations.length; i += batchSize) {
    const batch = paramCombinations.slice(i, i + batchSize);
    batch.forEach((config) => {
      const result = runDcaStrategy(preprocessedData, config);
      if (result) {
        results.push({ config, result, score: scoreForObjective(result, objective) });
      }
    });
    if (onProgress) {
      onProgress(Math.min(i + batchSize, paramCombinations.length), paramCombinations.length);
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topN);
};
