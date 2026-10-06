// Vercel Serverless Function(部署在 /api/twPrice,跟前端同一個網域)。
//
// 為什麼需要這支:「我的持股」的股價原本只靠 FinMind → 證交所(TWSE)→ Yahoo 三層。
// 其中證交所那層只有「上市」股票,而且是唯一一個瀏覽器能直接呼叫(有開放 CORS)
// 的官方來源;上櫃股票(例如金居 8358、元大美債20年 00679B)在 FinMind 失敗時
// (例如免費額度用完,每個 IP 每小時 300 次,手機電信業者的共用 IP 很容易被別人用掉)
// 只剩 Yahoo,而 Yahoo 要繞的四個公用 CORS 代理,2026-10 實測全部打不通
// (allorigins/codetabs 逾時、thingproxy 連不上、corsproxy.io 改成要金鑰)。
// 結果就是:上市股票總有證交所墊底,上櫃股票卻常常「怎麼刷新都不會更新」。
//
// 櫃買中心(TPEx)與證交所即時報價(mis.twse.com.tw)都有資料,但都沒有開放 CORS,
// 瀏覽器不能直接呼叫。所以跟 api/marketSnapshot.js 一樣,改由伺服器端代抓:
// 伺服器對伺服器不受 CORS 限制,前端呼叫自己網域的 /api/twPrice 就是同源請求。
//
// 用法:
//   /api/twPrice?type=quote&symbols=2330,8358,00679B
//     → 證交所 MIS 即時(盤中)/當日收盤報價,上市、上櫃都查得到(同時送 tse_、otc_
//       兩種代號,哪個市場有就回哪個),不分盤中盤後,一次查完所有持股。
//   /api/twPrice?type=tpexMonth&symbol=8358&month=2026-10
//     → 櫃買中心「個股日成交資訊」一個月的日收盤資料(上櫃股票的官方備援)。

const UA = 'Mozilla/5.0 (compatible; taiwan-stock-backtest/1.0)';
const SYMBOL_RE = /^[0-9A-Z]{4,6}$/;
// MIS 一次查太多檔會被拒絕或很慢;每個代號要送 tse_/otc_ 兩個,所以 30 檔 = 60 個查詢。
const QUOTE_CHUNK = 30;
const MAX_SYMBOLS = 120;

const fetchJson = async (url, headers = {}) => {
  const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const text = await res.text();
  try {
    return JSON.parse(text.trim());
  } catch (e) {
    return null;
  }
};

// MIS 的數字欄位是字串(例如 "551.0000"),沒有成交時是 "-"
const num = (v) => {
  const x = parseFloat(String(v == null ? '' : v).replace(/,/g, ''));
  return Number.isFinite(x) && x > 0 ? x : null;
};

const fetchQuotes = async (symbols) => {
  const out = {};
  for (let i = 0; i < symbols.length; i += QUOTE_CHUNK) {
    const chunk = symbols.slice(i, i + QUOTE_CHUNK);
    // 代號保持大寫:實測 00679B 寫成小寫 00679b 時 MIS 會查不到
    const exCh = chunk.flatMap((s) => [`tse_${s}.tw`, `otc_${s}.tw`]).join('|');
    const json = await fetchJson(
      `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(exCh)}&json=1&delay=0`,
      { Referer: 'https://mis.twse.com.tw/stock/index.jsp' }
    ).catch(() => null);
    const arr = (json && Array.isArray(json.msgArray) && json.msgArray) || [];
    arr.forEach((m) => {
      const symbol = String(m.c || '').toUpperCase();
      if (!symbol) return; // 不存在的市場組合(例如 tse_8358)會回一筆空殼,略過
      // z = 最新成交價;盤中某一刻剛好沒有成交時是 "-",改用 pz(前一筆成交價)
      const price = num(m.z) || num(m.pz);
      const d = String(m.d || '');
      if (!price || !/^\d{8}$/.test(d)) return;
      out[symbol] = {
        symbol,
        market: m.ex || '',
        name: m.n || '',
        price,
        prevClose: num(m.y),
        date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
        time: /^\d{2}:\d{2}:\d{2}$/.test(m.t || '') ? m.t : '00:00:00',
      };
    });
  }
  return out;
};

// 民國年 "115/10/06" → "2026-10-06"
const rocToIso = (s) => {
  const p = String(s).split('/');
  if (p.length !== 3) return null;
  const y = parseInt(p[0], 10) + 1911;
  if (!Number.isFinite(y)) return null;
  return `${y}-${p[1].padStart(2, '0')}-${p[2].padStart(2, '0')}`;
};

const fetchTpexMonth = async (symbol, month) => {
  const [y, m] = month.split('-');
  const json = await fetchJson(
    `https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock?code=${symbol}&date=${y}/${m}/01&response=json`
  ).catch(() => null);
  const table = json && Array.isArray(json.tables) ? json.tables[0] : null;
  const rows = (table && Array.isArray(table.data) && table.data) || [];
  // 欄位:日期、成交張數、成交仟元、開盤、最高、最低、收盤、漲跌、筆數
  return rows
    .map((r) => {
      const date = rocToIso(r[0]);
      const close = num(r[6]);
      if (!date || !close) return null;
      return { date, open: num(r[3]), high: num(r[4]), low: num(r[5]), close };
    })
    .filter(Boolean);
};

module.exports = async function handler(req, res) {
  const { type } = req.query;
  try {
    if (type === 'quote') {
      const symbols = Array.from(
        new Set(
          String(req.query.symbols || '')
            .split(',')
            .map((s) => s.trim().toUpperCase())
            .filter((s) => SYMBOL_RE.test(s))
        )
      ).slice(0, MAX_SYMBOLS);
      if (!symbols.length) {
        res.status(400).json({ error: 'missing symbols' });
        return;
      }
      const quotes = await fetchQuotes(symbols);
      // 即時報價不要讓邊緣快取留住,否則按「更新」會拿到舊的報價
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ quotes, fetchedAt: new Date().toISOString() });
      return;
    }
    if (type === 'tpexMonth') {
      const symbol = String(req.query.symbol || '').toUpperCase();
      const month = String(req.query.month || '');
      if (!SYMBOL_RE.test(symbol) || !/^\d{4}-\d{2}$/.test(month)) {
        res.status(400).json({ error: 'invalid symbol or month' });
        return;
      }
      const rows = await fetchTpexMonth(symbol, month);
      // 過去月份的資料不會再變,可以讓邊緣快取久一點;當月的資料每天會多一筆,只快取幾分鐘
      const now = new Date(Date.now() + 8 * 3600 * 1000); // 台灣時間
      const thisMonth = now.toISOString().slice(0, 7);
      res.setHeader('Cache-Control', month < thisMonth ? 's-maxage=604800' : 's-maxage=300');
      res.status(200).json({ rows });
      return;
    }
    res.status(400).json({ error: 'invalid type, expected quote or tpexMonth' });
  } catch (e) {
    res.status(502).json({ error: 'upstream fetch failed' });
  }
};
