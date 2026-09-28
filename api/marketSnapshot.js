// Vercel Serverless Function(部署在 /api/marketSnapshot,跟前端同一個網域)。
//
// 個股股本(實收資本額)/ ETF發行單位數這兩份官方資料,查過之後發現
// openapi.twse.com.tw 跟 tpex.org.tw/openapi 這兩個「開放資料」網域完全沒有
// 設定 CORS(不像個股/大盤股價用的 www.twse.com.tw/exchangeReport 那個舊網域
// 有開放 Access-Control-Allow-Origin: *),瀏覽器端 JS 直接呼叫一定會被瀏覽器
// 擋下來;而原本專案裡拿來繞過 CORS 的公用代理(allorigins.win、codetabs.com、
// thingproxy.freeboard.io、corsproxy.io)實測對這三個政府網域的網址完全打不通
// (代理伺服器自己連不上、逾時,或是要收費金鑰),不是穩定可用的路。
//
// 改成在 Vercel 上跑一個伺服器端的小 function 來抓:伺服器對伺服器的請求
// 不受瀏覽器 CORS 政策限制,前端只要呼叫「自己網域」底下的 /api/marketSnapshot
// 就是同源請求,完全不會有 CORS 問題。同時順便在這裡把原始資料整理成
// { 代碼: {...} } 的查表格式再回傳,前端不用再解析每筆資料裡一堆用不到的欄位
// (公司地址、董事長之類的),回傳的資料也小很多。
//
// 用法:/api/marketSnapshot?type=capital 查個股股本、
//      /api/marketSnapshot?type=etfUnits 查ETF發行單位數、
//      /api/marketSnapshot?type=etfFees 查ETF總費用率批次快照(見下方
//      buildEtfFeesMap 說明,一次只涵蓋約七成多的ETF)、
//      /api/marketSnapshot?type=etfFeeLookup&symbol=代碼 查單一ETF的總費用率
//      (給前端在上面那份批次快照沒收錄到某檔標的時,個別即時查這一檔就好,
//      不用整份重新抓一次,見下方 fetchEtfFeeForSymbol 說明)。

const fetchJson = async (url) => {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; taiwan-stock-backtest/1.0)' },
  });
  if (!res.ok) return null;
  try {
    return await res.json();
  } catch (e) {
    return null;
  }
};

const fetchText = async (url) => {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; taiwan-stock-backtest/1.0)' },
  });
  if (!res.ok) return null;
  try {
    return await res.text();
  } catch (e) {
    return null;
  }
};

const buildCapitalMap = async () => {
  const map = {};

  // 上市公司:證交所「上市公司基本資料」,實收資本額欄位是中文欄名。
  const twseData = await fetchJson(
    'https://openapi.twse.com.tw/v1/opendata/t187ap03_L'
  ).catch(() => null);
  if (Array.isArray(twseData)) {
    twseData.forEach((row) => {
      const symbol = row['公司代號'];
      const capital = parseFloat(row['實收資本額']);
      if (symbol && Number.isFinite(capital)) {
        map[symbol] = { paidInCapital: capital };
      }
    });
  }

  // 上櫃公司:櫃買中心對應資料,欄位命名完全不同(英文欄位,部分欄名裡有
  // 實際的英文句點,例如 "Paidin.Capital.NTDollars")。
  const tpexData = await fetchJson(
    'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O'
  ).catch(() => null);
  if (Array.isArray(tpexData)) {
    tpexData.forEach((row) => {
      const symbol = row['SecuritiesCompanyCode'];
      const capital = parseFloat(row['Paidin.Capital.NTDollars']);
      if (symbol && Number.isFinite(capital)) {
        map[symbol] = { paidInCapital: capital };
      }
    });
  }

  return map;
};

const buildEtfUnitsMap = async () => {
  const map = {};

  // 這份「基金基本資料彙總表」本身就只收錄交易所交易的ETF,不含一般不掛牌
  // 交易的開放式基金,不需要額外篩選類型。
  const json = await fetchJson(
    'https://openapi.twse.com.tw/v1/opendata/t187ap47_L'
  ).catch(() => null);
  if (Array.isArray(json)) {
    json.forEach((row) => {
      const symbol = row['基金代號'];
      const units = parseFloat(row['發行單位數/轉換數']);
      if (symbol && Number.isFinite(units)) {
        map[symbol] = { unitsOutstanding: units };
      }
    });
  }

  return map;
};

// --- ETF總費用率(境內約270檔ETF,官方完全沒有這份資料) ---
//
// 查證交所(TWSE)、櫃買中心(TPEx)的官方開放資料目錄(逐條核對過兩邊全部的
// 資料集清單)後確認:兩邊都沒有任何一份「ETF費用率/經理費/保管費」的公開
// 資料集,這是資料本身的限制,不是我們找不到門路。專案原本(twEtfFees.js)
// 是人工一檔一檔查基金公司官網/公開說明書手動維護,只收錄了少數幾檔,新標的
// 沒有登錄就完全不會顯示這個資訊。
//
// 改成從 MoneyDJ「ETF總費用率排行」頁面(www.moneydj.com/etf/x/rank/rank0005.xdjhtm)
// 抓:這是第三方財經網站整理的資料,不是官方,但這個排行的「總費用率」欄位
// 用的正是主管機關規定基金公司必須依實際財報揭露的「總費用率」數字(不是
// 公開說明書上那種「經理費+保管費」的名目費率),涵蓋範圍是境內幾乎全部
// ETF、而且是依規定計算出來的實際數字,比我們自己土法煉鋼加總經理費/保管費
// 更準確(例如00913,原本人工查表用「經理費0.40%+保管費0.03%」估出0.43%,
// 但這裡抓到的實際總費用率是0.94%,差了一倍以上,推測是因為主動調整成分股
// 的交易成本、外國稅負等名目費率沒算進去的額外成本);缺點是這個頁面一次
// 只列「由低到高」或「由高到低」排序的前100檔,兩個方向都各抓一次、合併起來
// 大約可以涵蓋200檔上下(全部約270檔,中間費用率不上不下的那些會抓不到,
// 之後如果有查到還是缺的標的,一樣可以在 twEtfFees.js 手動補一筆當備援)。
//
// 這份資料本來就不是每天在變,加上是抓第三方網站、不想太頻繁去打對方的
// 伺服器,所以只需要大概一個月更新一次;下面 handler 那邊會把這個 type 的
// 邊緣快取時間設定得比股本/ETF規模那兩個長很多,道理相同。
const MONEYDJ_FEE_RANK_URLS = [
  // 總費用率由低到高排序的前100檔
  'https://www.moneydj.com/etf/x/rank/rank0005.xdjhtm?erank=allex&eord=t100160&esort=2',
  // 總費用率由高到低排序的前100檔(跟上面那個實測完全不重複,兩個合併
  // 大約可以蓋到全部ETF的七成多)
  'https://www.moneydj.com/etf/x/rank/rank0005.xdjhtm?erank=allex&eord=t100160&esort=1',
];

// 這個排行頁面是傳統伺服器端渲染的HTML表格(不是前端SPA打API組出來的),
// 直接用簡單的規則比對抓「代碼」跟「col10」(表頭核對過是「總費用率」那一欄,
// col09 是「管理費」單一數字、不是總費用率,兩者不一樣,不要抓錯欄)這兩個
// 值就好,不需要引入完整的HTML parser函式庫。用 <tr 切開成一列一列,每一列
// 各自找「etfid='代碼.TW'」跟「col10">數字」,兩個都找得到才算一筆有效資料;
// 找不到就跳過(例如表頭那一列、或頁面上其他跟這個表格無關的區塊)。
const parseFeeRankingPage = (html) => {
  const map = {};
  if (typeof html !== 'string') return map;
  const rows = html.split('<tr');
  rows.forEach((row) => {
    const codeMatch = row.match(/etfid='([^'.]+)\.TW'/);
    const totalMatch = row.match(/class="col10">([^<]*)</);
    if (!codeMatch || !totalMatch) return;
    const symbol = codeMatch[1];
    const totalExpenseRatio = parseFloat(totalMatch[1]);
    if (symbol && Number.isFinite(totalExpenseRatio)) {
      map[symbol] = totalExpenseRatio;
    }
  });
  return map;
};

const buildEtfFeesMap = async () => {
  const map = {};
  for (const url of MONEYDJ_FEE_RANK_URLS) {
    const html = await fetchText(url).catch(() => null);
    Object.assign(map, parseFeeRankingPage(html));
  }
  return map;
};

// --- 單一ETF總費用率查詢(給批次快照沒收錄到的標的當場個別查) ---
//
// 上面 buildEtfFeesMap 抓的排行頁面一次只列「總費用率」最低/最高各100檔,
// 兩個方向合併起來大約只能涵蓋境內約270檔ETF裡的七成多,費用率不上不下、
// 落在中間的那些反而會漏掉——實測發現這批「漏網之魚」剛好包含好幾檔
// 存股族很常用的熱門ETF(例如0056、00878、00919、00713、00915),因為
// 這些主流ETF的費用率大多落在中段,不會被極端排序抓到。
//
// MoneyDJ另外有一個「單一ETF基本資料」頁面(basic0004.xdjhtm,用?etfid=
// 代碼.tw查詢),可以直接查任何一檔ETF的資料,不受排行榜只列前100名的限制;
// 裡面的「總管理費用(%)」欄位實測跟排行頁面的「總費用率」欄位是同一個數字
// (例如00913兩邊都是0.94、00929兩邊都是0.9,交叉比對一致),所以可以拿來
// 當作批次快照查不到時的個別查詢管道。查不存在的代碼(例如一般個股,不是
// ETF)這個頁面會回傳「查無此ETF」的極小頁面,底下的正則表達式自然比對
// 不到、回傳null,不會誤判成0或其他錯誤數字。
const parseSingleEtfFeePage = (html) => {
  if (typeof html !== 'string') return null;
  const match = html.match(/總管理費用\(%\)<\/th>\s*<td[^>]*>([^<]*)<\/td>/);
  if (!match) return null;
  const value = parseFloat(match[1]);
  return Number.isFinite(value) ? value : null;
};

const fetchEtfFeeForSymbol = async (symbol) => {
  const html = await fetchText(
    `https://www.moneydj.com/etf/x/basic/basic0004.xdjhtm?etfid=${encodeURIComponent(
      symbol
    )}.tw`
  ).catch(() => null);
  return parseSingleEtfFeePage(html);
};

// 用 module.exports(CommonJS)而不是 export default:專案的 package.json
// 沒有設定 "type": "module",用 CommonJS 是 Vercel Node.js Function 保證
// 相容的寫法,不必依賴建置工具是否自動判斷/轉譯 ESM 語法。
module.exports = async function handler(req, res) {
  const { type, symbol } = req.query;

  try {
    // 單一ETF總費用率查詢,回傳格式跟其他type不一樣(不是整批查表,是
    // { totalExpenseRatio: 數字或null }),所以獨立成自己的分支處理。
    if (type === 'etfFeeLookup') {
      if (!symbol || typeof symbol !== 'string') {
        res.status(400).json({ error: 'missing symbol' });
        return;
      }
      const totalExpenseRatio = await fetchEtfFeeForSymbol(symbol);
      // 跟批次的etfFees用同樣長度的邊緣快取(30天+30天):同一檔標的短期內
      // 不會一直被不同使用者重複查詢,就算被查也不想太頻繁去打第三方網站。
      res.setHeader(
        'Cache-Control',
        's-maxage=2592000, stale-while-revalidate=2592000'
      );
      res.status(200).json({ totalExpenseRatio });
      return;
    }

    let map = {};
    let cacheControl = 's-maxage=43200, stale-while-revalidate=86400';
    if (type === 'capital') {
      map = await buildCapitalMap();
    } else if (type === 'etfUnits') {
      map = await buildEtfUnitsMap();
    } else if (type === 'etfFees') {
      map = await buildEtfFeesMap();
      // 這份改抓第三方網站,不想太頻繁去打對方伺服器,邊緣快取設定成
      // 30天(s-maxage)+30天(stale-while-revalidate),等於最長大概兩個月
      // 才會真的重新抓一次;抓不到某檔本來就當作「這批沒收錄」處理,
      // 不需要因為這樣就縮短快取時間、逼近更頻繁地重抓。
      cacheControl = 's-maxage=2592000, stale-while-revalidate=2592000';
    } else {
      res.status(400).json({
        error: 'invalid type, expected capital, etfUnits, etfFees or etfFeeLookup',
      });
      return;
    }

    // 這份資料一天內不會變,交給 Vercel 邊緣快取一段時間,減少重複打對方
    // API/網站的次數;stale-while-revalidate 讓快取過期的那次查詢先回舊
    // 資料,背景重新整理,使用者不會因為快取剛好過期就多等一次完整抓取時間。
    res.setHeader('Cache-Control', cacheControl);
    res.status(200).json(map);
  } catch (e) {
    res.status(502).json({ error: 'upstream fetch failed' });
  }
};
