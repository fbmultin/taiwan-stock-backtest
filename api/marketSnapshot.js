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
//      /api/marketSnapshot?type=etfUnits 查ETF發行單位數。

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

// 用 module.exports(CommonJS)而不是 export default:專案的 package.json
// 沒有設定 "type": "module",用 CommonJS 是 Vercel Node.js Function 保證
// 相容的寫法,不必依賴建置工具是否自動判斷/轉譯 ESM 語法。
module.exports = async function handler(req, res) {
  const { type } = req.query;

  try {
    let map = {};
    if (type === 'capital') {
      map = await buildCapitalMap();
    } else if (type === 'etfUnits') {
      map = await buildEtfUnitsMap();
    } else {
      res.status(400).json({ error: 'invalid type, expected capital or etfUnits' });
      return;
    }

    // 這份資料一天內不會變,交給 Vercel 邊緣快取 12 小時,減少重複打政府網站
    // API 的次數;stale-while-revalidate 讓快取過期的那次查詢先回舊資料,
    // 背景重新整理,使用者不會因為快取剛好過期就多等一次完整抓取時間。
    res.setHeader(
      'Cache-Control',
      's-maxage=43200, stale-while-revalidate=86400'
    );
    res.status(200).json(map);
  } catch (e) {
    res.status(502).json({ error: 'upstream fetch failed' });
  }
};
