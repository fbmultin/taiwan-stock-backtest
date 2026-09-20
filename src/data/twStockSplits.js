// 台股近 20 年股票分割/反分割對照表(個股 + ETF)。
// 資料由使用者依證交所公告整理提供,精準度優於一般行情資料源,視為權威資料。
//
// 欄位說明:
//   symbol      證券代號(不含 .TW/.TWO 後綴)
//   date        恢復買賣日期(YYYY-MM-DD)— 股價從舊股本切換到新股本的分界點。
//               此日期「之前」的價格屬於舊股本水準,「此日期起(含)」已是新股本水準。
//   type        'split'(分割,股數變多、股價變小)或 'reverse'(反分割,股數變少、股價變大)
//   ratio       分割/反分割倍數(例:1拆4 → 4;7股合1股 → 7)。可為小數(例:1拆3.33)。
//   priceBefore 停止買賣前最後收盤價(舊股本)
//   priceAfter  恢復買賣參考價(新股本)
//   label       顯示用的簡短說明
//
// 是否需要用 ratio 回推校正歷史價格,App 會在抓到資料後自動比對「恢復日前最後一筆價格」
// 較接近 priceBefore 還是 priceAfter 來判斷(不同資料源是否已回溯調整並不一致),
// 不會無條件套用,避免重複校正。
// 太景-KY(4157)2014/01/16 的紀錄屬性為「無面額美金→0.001美元」的初次掛牌面額微調
// (價格 52.00→52.00 無變化、分割比例為「-」),並非真正的股票分割,故未收錄於此表。
//
// 這份表是特定時間點的快照,之後如有新的分割/反分割案例,需要手動補充更新。
const TW_STOCK_SPLITS = [
  // ── 個股分割 ──
  { symbol: '6789', date: '2019-07-01', type: 'split', ratio: 20, priceBefore: 280.00, priceAfter: 14.00, label: '采鈺 1拆20' },
  { symbol: '6548', date: '2019-09-09', type: 'split', ratio: 10, priceBefore: 330.00, priceAfter: 33.00, label: '長華科 1拆10' },
  { symbol: '3093', date: '2021-08-02', type: 'split', ratio: 4, priceBefore: 140.00, priceAfter: 35.00, label: '港建 1拆4' },
  { symbol: '6741', date: '2022-08-29', type: 'split', ratio: 2, priceBefore: 162.00, priceAfter: 81.00, label: '朋億 1拆2' },
  { symbol: '2236', date: '2022-10-24', type: 'split', ratio: 2, priceBefore: 72.00, priceAfter: 36.00, label: '百達-KY 1拆2' },
  { symbol: '6650', date: '2023-04-17', type: 'split', ratio: 3.33, priceBefore: 223.00, priceAfter: 66.90, label: '帝圖 1拆3.33' },
  { symbol: '3499', date: '2023-08-14', type: 'split', ratio: 2, priceBefore: 34.20, priceAfter: 17.10, label: '環天科 1拆2' },
  { symbol: '5210', date: '2023-11-20', type: 'split', ratio: 4, priceBefore: 38.00, priceAfter: 9.50, label: '天揚 1拆4' },
  { symbol: '6841', date: '2024-02-19', type: 'split', ratio: 2, priceBefore: 180.00, priceAfter: 90.00, label: '長佳智能 1拆2' },
  { symbol: '6763', date: '2024-09-09', type: 'split', ratio: 10, priceBefore: 580.00, priceAfter: 58.00, label: '綠界科技 1拆10' },
  { symbol: '2948', date: '2024-11-18', type: 'split', ratio: 2, priceBefore: 84.00, priceAfter: 42.00, label: '寶陞 1拆2' },
  { symbol: '5314', date: '2025-01-13', type: 'split', ratio: 4, priceBefore: 320.00, priceAfter: 80.00, label: '世紀 1拆4' },
  { symbol: '2941', date: '2025-05-12', type: 'split', ratio: 2, priceBefore: 120.00, priceAfter: 60.00, label: '米斯特 1拆2' },
  { symbol: '8937', date: '2026-05-11', type: 'split', ratio: 4, priceBefore: 148.00, priceAfter: 37.00, label: '合騏 1拆4' },
  { symbol: '8084', date: '2026-08-10', type: 'split', ratio: 2, priceBefore: 62.00, priceAfter: 31.00, label: '巨虹 1拆2' },
  { symbol: '8070', date: '2020-08-17', type: 'split', ratio: 10, priceBefore: 190.00, priceAfter: 19.00, label: '長華 1拆10' },
  { symbol: '6531', date: '2021-10-18', type: 'split', ratio: 2, priceBefore: 750.00, priceAfter: 375.00, label: '愛普 1拆2' },
  { symbol: '6415', date: '2022-07-13', type: 'split', ratio: 4, priceBefore: 2485.00, priceAfter: 621.25, label: '矽力-KY 1拆4' },
  { symbol: '5536', date: '2022-09-19', type: 'split', ratio: 2, priceBefore: 210.00, priceAfter: 105.00, label: '聖暉 1拆2' },
  { symbol: '6782', date: '2024-09-09', type: 'split', ratio: 2, priceBefore: 250.00, priceAfter: 125.00, label: '視陽 1拆2' },
  { symbol: '6875', date: '2025-08-11', type: 'split', ratio: 2, priceBefore: 112.00, priceAfter: 56.00, label: '國邑 1拆2' },

  // ── ETF 分割/反分割 ──
  { symbol: '00632R', date: '2024-12-11', type: 'reverse', ratio: 7, priceBefore: 3.28, priceAfter: 22.96, label: '元大台灣50反1 7合1(反分割)' },
  { symbol: '00676R', date: '2025-02-19', type: 'reverse', ratio: 6, priceBefore: 2.04, priceAfter: 12.23, label: '富邦臺灣加權反1 6合1(反分割)' },
  { symbol: '00663L', date: '2025-06-11', type: 'split', ratio: 7, priceBefore: 170.15, priceAfter: 24.30, label: '國泰臺灣加權正2 1拆7(分割)' },
  { symbol: '0050', date: '2025-06-18', type: 'split', ratio: 4, priceBefore: 188.65, priceAfter: 47.16, label: '元大台灣50 1拆4(分割)' },
  { symbol: '00673R', date: '2025-10-22', type: 'reverse', ratio: 4, priceBefore: 7.02, priceAfter: 28.08, label: '期元大S&P原油反1 4合1(反分割)' },
  { symbol: '00706L', date: '2025-10-22', type: 'reverse', ratio: 4, priceBefore: 5.54, priceAfter: 22.16, label: '期元大S&P日圓正2 4合1(反分割)' },
  { symbol: '0052', date: '2025-11-26', type: 'split', ratio: 7, priceBefore: 245.30, priceAfter: 35.04, label: '富邦科技 1拆7(分割)' },
  { symbol: '00715L', date: '2025-12-10', type: 'reverse', ratio: 2, priceBefore: 10.43, priceAfter: 20.86, label: '期街口布蘭特正2 2合1(反分割)' },
  { symbol: '00631L', date: '2026-03-31', type: 'split', ratio: 22, priceBefore: 443.15, priceAfter: 20.14, label: '元大台灣50正2 1拆22(分割)' },
  { symbol: '00674R', date: '2026-04-22', type: 'reverse', ratio: 5, priceBefore: 5.18, priceAfter: 25.90, label: '期元大S&P黃金反1 5合1(反分割)' },
  { symbol: '00685L', date: '2026-07-07', type: 'split', ratio: 24, priceBefore: 306.00, priceAfter: 12.75, label: '群益臺灣加權正2 1拆24(分割)' },
];

export default TW_STOCK_SPLITS;
