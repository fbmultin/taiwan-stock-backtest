# Step 0 重跑的資料快照
來源：FinMind 免費資料集（TaiwanStockPrice + TaiwanStockDividendResult），抓取日 2026-10-04，截至 2026-10-02。
- 只保留有成交（Trading_Volume>0）的日子。
- close_split_adj：依 src/data/twStockSplits.js 校正分割（0050 2025-06-18 一拆四、0052 2025-11-26 一拆七）。
- total_ret：(P_t + 當日除息) / P_{t-1} − 1，第一列為 0。
- 006203、006204 已剔除首筆 2011-04-14（掛牌前資料）。
- 可檢定天數 n = 列數 − 251。
