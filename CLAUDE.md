# 專案說明(給 Claude 看的背景資訊)

這份檔案是給任何在這個 repo 裡工作的 Claude 對話看的背景知識,目的是讓新開的對話不用每次都重新問一輪部署方式、技術雷點跟架構。程式碼本身的邏輯請直接讀程式碼(很多地方已經有繁中註解說明「為什麼這樣寫」),這份檔案只補那些光看程式碼看不出來的事。

## 溝通方式

Adam(使用者)習慣全程用繁體中文溝通,請一律用繁體中文回覆。程式碼裡的註解也維持繁中,尤其是「為什麼這樣設計」這種不是一眼就能看懂的邏輯,務必留註解說明原因,不只是寫 what,要寫 why。

## 部署架構

- GitHub repo:`fbmultin/taiwan-stock-backtest`,`main` 分支
- Vercel 會自動監聽 `main` 分支推送並重新部署,正式網址:`https://taiwan-stock-backtest-two.vercel.app`
- Firebase 專案:`twstock-a4ef0`(Firestore 用於「我的持股」跨裝置同步,以及股價/配息資料的共用快取)
- 前端框架:Create React App(`react-scripts`),前端 SPA;另有少數 Vercel 伺服器端函式放在 `api/`(`marketSnapshot.js` 股本/ETF規模/費用率、`twPrice.js` 即時報價與櫃買中心日資料),用來代抓沒有開放 CORS 的官方資料,前端以同網域 `/api/...` 呼叫(本機 `npm start` 沒有這些路徑,呼叫失敗時程式會安靜退回其他來源)

## 重要雷點

**Tailwind 不是 npm 套件,是透過 CDN(Play CDN)載入的**,設定寫在 `public/index.html`(或建置後的 `index.html`)裡的 `<script>` 區塊,不是獨立的 `tailwind.config.js` 檔案(這個 repo 根本沒有這個檔案)。而且裡面已經把具名字級(`text-xs`/`text-sm`/`text-lg`/`text-xl`/`text-2xl`/`text-3xl`/`text-4xl`)**全部放大過**,實際渲染出來的 px 數比 Tailwind 預設值大(例如 `text-lg` 實際是 21px,不是預設的 18px)。改動任何跟字級相關的程式碼之前,一定要先看這段設定,不要用 Tailwind 官方預設值去估算版面空間,會算錯。

**`git push` 無法直接使用**——這個環境的 git proxy 會擋掉直接推送(`403: remote: access denied by the git proxy`)。所有推送到 GitHub 的動作都必須透過 GitHub API(這個 session 裡用的是 `mcp__GitHub__COMPOSIO_REMOTE_WORKBENCH` 這個工具跑 Python,呼叫 `GITHUB_GET_REPOSITORY_CONTENT` / `GITHUB_COMMIT_MULTIPLE_FILES`;如果换了工具名稱,找這個 session 裡等效的 GitHub API 存取方式即可),標準流程:

1. 用 GitHub API 抓遠端檔案目前的內容與 blob sha,用 `hashlib.sha1` 計算並確認跟本地「改動前」的 blob sha(`git hash-object`)一致,避免推送時蓋掉別人在遠端的新改動。
2. 在抓下來的遠端內容上套用跟本地完全相同的字串替換(old_str/new_str 要跟 Edit 工具用的一模一樣,不要重打),並確認替換次數剛好是 1 次。
3. 算出替換後內容的 blob sha,確認跟本地「改動後」的目標 sha 一致。
4. 用 `GITHUB_COMMIT_MULTIPLE_FILES` 提交。
5. 回到本地 clone,`git fetch origin main -q && git reset --hard origin/main -q`,再跑一次 `CI=true npm run build` 確認「Compiled successfully」且跟遠端版本一致。

**每次改完程式碼,推送前一定要跑 `CI=true npm run build`**,確認輸出是 `Compiled successfully`,沒有錯誤或警告才算完成。

## App 架構(三個分頁)

- **ETF回測比較**(`src/App.js`,目前這個檔案很大,5000+ 行):單筆本金一次性投入,可選擇疊加「每月固定日期加碼」和/或「K線穿越均線加碼」,多檔ETF/股票同時比較報酬率走勢。
- **定期定額策略最佳化**(`src/DcaOptimizer.js` 畫面 + `src/dcaEngine.js` 純運算引擎):每月固定扣款,搭配均線乖離或K線穿越條件觸發加碼,股數只會增加不會賣出。`dcaEngine.js` 裡有一套「參數範圍 → 組合展開 → 分批背景跑 → 依目標排序取前N名」的框架(`buildParamCombinations` / `runOptimizationBatch`),之後如果要做新的回測引擎(例如正在規劃的「現金等訊號逢低買進」或「相對高停利/相對低買回」策略),這套框架的模式可以直接沿用,但策略本身的買賣邏輯要另外寫——跟目前這個「只買不賣」的 DCA+加碼模型是不同的機制。
- **我的持股**(`src/PortfolioTracker.js` 畫面 + `src/portfolioStore.js` 資料邏輯):個人實際持股的交易紀錄、群組管理、損益試算,資料存 Firebase Firestore 做跨裝置同步。`portfolioStore.js` 裡已經有手續費/證交稅試算公式(`estimateFee` / `estimateTax`),如果之後要幫回測引擎加上交易成本模型,這裡有現成公式可以參考沿用。

## 其他共用模組

- `src/dataCache.js`:股價/配息資料抓取與快取(localStorage + Firestore 共用快取),資料來源依序嘗試 FinMind → TWSE(上市)→ TPEx(上櫃,經 `/api/twPrice`)→ Yahoo(公用 CORS 代理,2026-10 實測幾乎都打不通,只是最後一道)。另有 `fetchLiveQuotes`(證交所即時報價,經 `/api/twPrice`)給「我的持股」更新鈕用。`fetchStockPriceData` 預設會做輕量增量抓取(只抓近期資料再合併),不是每次都重抓全部歷史。
- `src/tradingCalendar.js`:台股交易日曆(國定假日、週末判斷)。
- `src/firebase.js`:Firebase 初始化。

## 目前進行中的規劃(2026年10月)

正在設計一個新的回測引擎,起因是 Adam 看到財經 KOL 清流君、股魚的「逢低加碼」相關文章,想實際驗證清流君的「現金等訊號、整筆買進、持有固定期間後賣出」策略,以及 Adam 自己「相對高點停利、相對低點買回」的想法,是否真的優於單筆買進持有——而且要用能校正「測了上百組參數組合,難免挑到看起來不錯的」這種資料探勘偏誤的統計方法(Hansen 的 SPA、Romano–Wolf 的 StepM 多重假設檢定),不是隨便挑一組門檻就下結論。(2026-10-05 更新:實測發現以現有資料量,這類檢定只能偵測到年化約 40% 以上的優勢,實務上無法判定門檻有效,詳見設計文件 13.10。)

完整設計(資料與訊號定義、檢定公式、已驗證的實作細節、容易翻錯的 10 個地方、分階段實作順序等)寫在 **`docs/backtest-engine-design.md`**,那份文件才是技術細節的唯一依據,遇到設計相關問題先讀那份,不要只看這裡的摘要。目前仍是設計階段,**尚未寫進 app**。Step 0(用模擬資料驗證檢定方法的假陽性率)已跑兩次,兩次都沒通過事前標準,而且檢定力太低,無法判定哪個門檻有效,所以「第二層:顯著性檢定」暫不上線,改為先做「第一層:描述性數字與持股提醒」;詳見該文件的 10.1.2、10.1.3 與 13.10。

**設計要改,就改文件本身(Adam 明訂的規矩)**:實作過程中只要發現設計需要調整(例如 Step 0 沒過、區塊長度 L 要改、規則集合要調整、某個【待決定】定案了),一律直接修改 `docs/backtest-engine-design.md`(一樣走上面的 GitHub API 推送流程),並更新文件開頭的「最後更新」日期。不要只在對話裡講一講就算了——對話記憶會隨時間丟失,文件不會。Step 0 的模擬程式與資料快照放在 `research/step0/`,重跑放在 `research/step0_rerun/`(兩者都在分支 `research/step0` 裡,main 上沒有,不會被打包進 app)。
