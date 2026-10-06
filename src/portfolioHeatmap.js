// 「持股熱力圖」的資料模型(純函式):把所有群組各自的持股算成市值、比重、漲跌幅。
//
// 為什麼不直接用首頁的 holdings:首頁的持股只含「目前選到的群組」,
// 熱力圖第一層要同時看所有群組,所以這裡自己對每個群組各算一次。
import { ALL_GROUP_ID, computeSymbolSummary, getTransactionsByGroup } from './portfolioStore';

// 一組持股的合計漲跌幅(%):用「現值 / 昨收值」算,比單純平均各檔 % 準(大部位權重大)。
// 沒有昨收的標的不納入漲跌計算,但仍算進市值。
export function weightedChangePct(items) {
  let cur = 0;
  let prev = 0;
  items.forEach((it) => {
    if (it.changePct === null || it.changePct === undefined) return;
    cur += it.marketValue;
    prev += it.marketValue / (1 + it.changePct / 100);
  });
  return prev > 0 ? (cur / prev - 1) * 100 : null;
}

function buildItems(data, groupId, prices, stockNames) {
  const bySymbol = getTransactionsByGroup(data, groupId);
  const items = [];
  Object.keys(bySymbol).forEach((symbol) => {
    const info = prices[symbol] || {};
    const price = info.price || 0;
    const s = computeSymbolSummary(bySymbol[symbol], {
      currentPrice: price,
      prevClose: info.prevClose,
      groups: data.groups,
    });
    // 已出場(0股)或還沒有現價(市值算不出來)的不放進圖,否則會是面積 0 的格子
    if (!(s.shares > 0) || !(s.marketValue > 0)) return;
    const changePct = info.prevClose > 0 && price > 0 ? (price / info.prevClose - 1) * 100 : null;
    items.push({
      symbol,
      name: stockNames[symbol] || symbol,
      shares: s.shares,
      price,
      changePct,
      marketValue: s.marketValue,
    });
  });
  items.sort((a, b) => b.marketValue - a.marketValue);
  return items;
}

const sumValue = (items) => items.reduce((s, it) => s + it.marketValue, 0);

export function buildHeatmapModel(data, prices, stockNames) {
  const allItems = buildItems(data, ALL_GROUP_ID, prices || {}, stockNames || {});
  const total = { id: ALL_GROUP_ID, name: '全部', marketValue: sumValue(allItems), changePct: weightedChangePct(allItems), items: allItems };
  const groups = (data.groups || [])
    .map((g) => {
      const items = buildItems(data, g.id, prices || {}, stockNames || {});
      return { id: g.id, name: g.name, color: g.color, marketValue: sumValue(items), changePct: weightedChangePct(items), items };
    })
    .filter((g) => g.marketValue > 0)
    .sort((a, b) => b.marketValue - a.marketValue);
  return { total, groups };
}
