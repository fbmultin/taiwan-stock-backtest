# Step 0 用的真實資料快照

來源:FinMind 免費資料集 TaiwanStockPrice(收盤價)+ TaiwanStockDividendResult(除息),抓取日 2026-10-04。
- close_split_adj:收盤價,已依 src/data/twStockSplits.js 校正 0050 於 2025-06-18 的 1 拆 4(之前的價格除以 4)。
- total_ret:含息日報酬 = (P_t + 當日除息金額) / P_{t-1} − 1。
- 已剔除成交量為 0 的日子。

為什麼不直接用 app 的 dataCache.js:Step 0 在 Node 沙盒裡跑,沙盒連不到 FinMind,所以先把快照存進 repo。
注意:這只是驗證檢定方法用的資料快照,不是 app 執行時的資料來源。
