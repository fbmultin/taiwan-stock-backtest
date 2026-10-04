# Step 0 用的真實資料快照

來源:FinMind 免費資料集 TaiwanStockPrice(收盤價)+ TaiwanStockDividendResult(除息),抓取日 2026-10-04。
- close_split_adj:收盤價,已依 src/data/twStockSplits.js 校正 0050 於 2025-06-18 的 1 拆 4(之前的價格除以 4)。
- total_ret:含息日報酬 = (P_t + 當日除息金額) / P_{t-1} − 1。
- 已剔除成交量為 0 的日子。

為什麼不直接用 app 的 dataCache.js:Step 0 在 Node 沙盒裡跑,沙盒連不到 FinMind,所以先把快照存進 repo。
注意:這只是驗證檢定方法用的資料快照,不是 app 執行時的資料來源。

## ⚠ 2026-10-05 更正：`0050_ret.csv` 的 `total_ret` 有誤，之後請用 `0050_ret_fixed.csv`
- **錯誤**：分割（2025-06-18 一拆四）之前的 29 個除息日，把原始單位的除息金額直接加到已除以 4 的價格上，含息報酬被高估（單日最多 20.9 個百分點；全期累積 188.3 倍，修正後 25.5 倍）。這份檔案的 `total_ret` 與 `research/step0_rerun/data/0050.csv` 逐日相同，同樣有誤。
- **影響範圍**：第一次 Step 0 中涉及 0050 的格子不可信（見設計文件 10.1.2 的更正與 13.12）；0056、006208、00692 沒有分割，不受影響。
- **處理方式**：`0050_ret.csv` 不改（已記錄的結果要能重現）；新增 `0050_ret_fixed.csv`（欄位 `date, close_split_adj, total_ret_fixed`），受影響的 29 天用修正值，其餘日子照抄 `0050_ret.csv`。由 `python3 research/fix_snapshots.py` 產生。
