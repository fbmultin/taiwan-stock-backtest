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
// 2. 單一策略模擬
// ---------------------------------------------------------------------------

// config = {
//   startDate: 'YYYY-MM-DD',
//   monthlyAmount: number,          // 每月定期定額金額
//   investDay: number,              // 每月投入日(1~31),遇非交易日順延至當月第一個交易日;
//                                    // 若當月已無 >= investDay 的交易日,改用當月最後一個交易日
//   maLines: {
//     ma20: { enabled, deviationPct, topUpMode: 'fixed' | 'multiple', topUpValue },
//     ma60: { ... },
//     ma120: { ... },
//   },
//   monthlyTriggerCap: number,      // 每月三線共用的加碼觸發次數上限(0 = 不加碼)
//   reinvestRatio: number,          // 配息再投入比例 0~1
// }
//
// 加碼觸發邏輯:
//   - deviationPct 是正數,代表「收盤價低於均線多少 %」才觸發,
//     即 (price - ma) / ma <= -deviationPct/100。
//   - 「當天第一次進入觸發區間就觸發」:用前一天是否已在區間內的狀態做邊緣觸發判斷,
//     連續處於區間內不會重複觸發,離開區間後再次跌回來才算新的一次。
//   - 三線依 ma20 → ma60 → ma120 的順序檢查,共用同一個每月觸發次數上限,
//     誰先用完額度、之後的觸發即使進入區間也不會真的買進(但狀態仍會更新,
//     離開/再進入區間的判斷不受額度用完影響)。
const buildMonthlyInvestDates = (days, investDay) => {
  const byMonth = new Map();
  days.forEach((d) => {
    const monthKey = d.date.slice(0, 7);
    if (!byMonth.has(monthKey)) byMonth.set(monthKey, []);
    byMonth.get(monthKey).push(d);
  });
  const investDateSet = new Set();
  byMonth.forEach((monthDays) => {
    const target = monthDays.find(
      (d) => parseInt(d.date.slice(8, 10), 10) >= investDay
    );
    const chosen = target || monthDays[monthDays.length - 1];
    investDateSet.add(chosen.date);
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
  const { startDate, monthlyAmount, investDay, maLines, monthlyTriggerCap, reinvestRatio } =
    config;

  const startTs = new Date(startDate).getTime();
  const days = preprocessedData.filter((d) => d.timestamp >= startTs);
  if (days.length === 0) return null;

  const investDateSet = buildMonthlyInvestDates(days, investDay);

  let shares = 0; // 投入資金(定期定額+加碼)買到的股數
  let reinvestShares = 0; // 配息再投入買到的股數
  let cashBalance = 0; // 未再投入的配息現金
  let totalInvested = 0; // 總投入本金(不含配息再投入金額)
  let totalDividends = 0; // 累計配息金額(不論有沒有再投入)

  let currentMonthKey = null;
  let monthlyTriggerCount = 0;
  const insideBand = { ma20: false, ma60: false, ma120: false };
  const valueSeries = [];

  days.forEach((day) => {
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

    // 2. 三線加碼觸發檢查
    MA_LINE_KEYS.forEach((lineKey) => {
      const lineConfig = maLines[lineKey];
      if (!lineConfig || !lineConfig.enabled) return;
      const ma = day[lineKey];
      if (ma === null || ma === undefined || !(ma > 0)) return;

      const deviation = (day.price - ma) / ma; // 負值代表跌破均線
      const threshold = -Math.abs(lineConfig.deviationPct) / 100;
      const isInBandNow = deviation <= threshold;

      if (isInBandNow && !insideBand[lineKey]) {
        if (monthlyTriggerCap > 0 && monthlyTriggerCount < monthlyTriggerCap) {
          const topUpAmount =
            lineConfig.topUpMode === 'multiple'
              ? monthlyAmount * lineConfig.topUpValue
              : lineConfig.topUpValue;
          if (topUpAmount > 0) {
            shares += topUpAmount / day.price;
            totalInvested += topUpAmount;
            monthlyTriggerCount += 1;
          }
        }
      }
      insideBand[lineKey] = isInBandNow;
    });

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

export const COMBINATION_COUNT_WARNING_THRESHOLD = 2000;
export const COMBINATION_COUNT_HARD_LIMIT = 20000;

// optimizerConfig = {
//   base: { startDate, monthlyAmount, investDay },
//   maLines: {
//     ma20: { enabled, topUpMode, deviationRange: {min,max,step}, topUpRange: {min,max,step} },
//     ma60: { ... }, ma120: { ... },
//   },
//   monthlyTriggerCapRange: { min, max, step },
//   reinvestRatioRange: { min, max, step }, // 單位:百分比(0~100)
// }
export const buildParamCombinations = (optimizerConfig) => {
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

  const allLists = [...lineValueLists, capValues, reinvestValues];
  const combos = [];
  const cartesian = (idx, current) => {
    if (idx === allLists.length) {
      combos.push(current.slice());
      return;
    }
    allLists[idx].forEach((val) => {
      current.push(val);
      cartesian(idx + 1, current);
      current.pop();
    });
  };
  cartesian(0, []);

  return combos.map(([ma20, ma60, ma120, cap, reinvestPct]) => ({
    startDate: base.startDate,
    monthlyAmount: base.monthlyAmount,
    investDay: base.investDay,
    maLines: {
      ma20: ma20 || { enabled: false },
      ma60: ma60 || { enabled: false },
      ma120: ma120 || { enabled: false },
    },
    monthlyTriggerCap: cap,
    reinvestRatio: reinvestPct / 100,
  }));
};

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
