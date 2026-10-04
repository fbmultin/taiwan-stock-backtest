# Step C:回檔雷達(第一層)的獨立對照

依「給股魚棚_第一層實作指令.md」第 7 節與「給股魚棚_資料錯誤更正與StepC.md」第三階段。

- `run_app.js`:直接載入 main 分支的 `src/pullbackStats.js`、`src/pullbackData.js`(只用 Babel 做 ESM → CommonJS 語法轉換,不改計算),算出回檔、事件、事件群、各格統計、今日狀態,以及 app 資料管線(原始價 + 除息 → `toSeries`)的含息還原價。
- `stepc.py`:依設計文件文字獨立重寫同一套計算,逐項比對(容許誤差 1e-9),並記錄 0050 修正版與有誤版的差異。
- 序列:0050 用 `total_ret_fixed`;0051、0055、006201 用 `total_ret`;另跑一次有誤的 0050 `total_ret`(`0050_bad`)。
- 執行:`APP_DIR=<main 分支 checkout,需已 npm install> python3 stepc.py`;結果在 `out/report.md`、`out/summary.json`(`series.json`、`app_results.json` 是中間檔,不進版控)。
