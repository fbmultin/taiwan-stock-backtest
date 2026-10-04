# Step 0 重跑的資料快照
來源：FinMind 免費資料集（TaiwanStockPrice + TaiwanStockDividendResult），抓取日 2026-10-04，截至 2026-10-02。
- 只保留有成交（Trading_Volume>0）的日子。
- close_split_adj：依 src/data/twStockSplits.js 校正分割（0050 2025-06-18 一拆四、0052 2025-11-26 一拆七）。
- total_ret：(P_t + 當日除息) / P_{t-1} − 1，第一列為 0。
- 006203、006204 已剔除首筆 2011-04-14（掛牌前資料）。
- 可檢定天數 n = 列數 − 251。

## ⚠ 2026-10-05 更正：0050、0052 的 `total_ret` 有誤，之後請用 `total_ret_fixed`
- **錯誤**：在「分割之前的除息日」，`total_ret` 把原始單位的除息金額（`div` 欄）直接加到分割校正後的價格（`close_split_adj`）上，沒有一起除以分割倍數，那幾天的含息報酬被高估。
  - 0050（2025-06-18 一拆四）：29 天受影響，單日最多高估 20.9 個百分點；全期累積 188.3 倍 → 修正後 25.5 倍。
  - 0052（2025-11-26 一拆七）：14 天受影響，單日最多高估 50.8 個百分點；全期累積 563 倍 → 修正後 25.4 倍。
- **影響範圍**：見設計文件 `docs/backtest-engine-design.md` 13.12。三檔正式閘門（0051、0055、006201）沒有分割，不受影響；受影響的是案例 A（用 0050 估 GARCH 參數）與輔助位移報告中的 0050、0052。
- **處理方式**：既有欄位一個字都沒改（已記錄的 Step 0 結果要能重現），只在每個檔案最後新增一欄 `total_ret_fixed`。規則：日期早於分割日時，除息金額先除以分割倍數，再算 `(close_split_adj + 修正後除息) / 前一日 close_split_adj − 1`；其餘日期與 `total_ret` 完全相同。沒有分割的 7 檔，`total_ret_fixed` 與 `total_ret` 逐字相同。
- **重現**：`python3 research/fix_snapshots.py`（在 repo 根目錄執行，會印出上面的驗證數字）。
- **之後請用 `total_ret_fixed`**；`total_ret` 只為了重現既有結果而保留。
