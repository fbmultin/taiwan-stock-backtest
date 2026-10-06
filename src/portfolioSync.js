// 「我的持股」跨裝置同步的合併邏輯(純函式,方便單元測試)。
//
// 為什麼要有這個檔案(2026-10 事故):
//   原本登入後的流程是「本機資料一變就 0.8 秒後上傳雲端」與「去雲端下載正本」同時開始,
//   而開頁那一刻本機資料就算「變了一次」。手機清掉瀏覽器資料後重新登入,本機只有一份
//   空白預設資料;雲端下載只要超過 0.8 秒(手機網路很常見),空白資料就先上傳,把雲端
//   正本蓋掉了——之後其他裝置一打開,又會以雲端為準把自己的本機資料也換成空白。
//
// 新的規則:
//   1. 沒有先成功讀到雲端之前,絕對不上傳(由 PortfolioTracker 的同步狀態把關)。
//   2. 讀到雲端後不是單純「雲端蓋本機」,而是三方合併:
//      - 以雲端為主(跨裝置的正本);
//      - 本機有、雲端沒有的交易:如果「上次同步時雲端還有」→ 代表別台裝置刪掉了,跟著刪;
//        否則 → 是這台裝置離線新增、或從沒上傳過的,補進去並上傳。
//      「上次同步時雲端有哪些交易」記在 localStorage 的同步紀錄(SYNC_META_KEY),
//      每次成功上傳或採用雲端資料後更新。
//   3. 舊版沒有同步紀錄的裝置(例如出事前就有完整資料的那台電腦)一律視為「沒上傳過」,
//      本機有的交易全部補回雲端——這同時也是把被蓋掉的雲端資料救回來的路徑。

export const SYNC_META_KEY = 'portfolio_sync_meta_v1';

const ids = (list) => new Set((Array.isArray(list) ? list : []).map((x) => x && x.id).filter(Boolean));

export function loadSyncMeta(storage) {
  try {
    const raw = storage && storage.getItem(SYNC_META_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === 'object' ? v : null;
  } catch (e) {
    return null;
  }
}

// 記下「這個帳號、這一刻雲端上有哪些交易/群組/標籤」,下次合併時用來分辨「別處刪掉的」與「這裡新增的」
export function saveSyncMeta(storage, uid, data) {
  const meta = {
    uid,
    syncedAt: new Date().toISOString(),
    txIds: Array.from(ids(data && data.transactions)),
    groupIds: Array.from(ids(data && data.groups)),
    tagIds: Array.from(ids(data && data.tags)),
  };
  try {
    if (storage) storage.setItem(SYNC_META_KEY, JSON.stringify(meta));
  } catch (e) {
    // 空間不足或私密瀏覽:頂多下次合併時把本機交易都當成「沒上傳過」,只會多補、不會少
  }
  return meta;
}

// 合併本機與雲端資料。
//   local:這台裝置目前的資料(已經過 loadPortfolioData 的格式整理)
//   remote:雲端資料(null 代表這個帳號雲端還沒有任何資料)
//   meta:上次同步紀錄(loadSyncMeta 的結果,可能是 null)
//   uid:目前登入的帳號
// 回傳 { data, needsUpload, addedTxCount }
export function mergeForSync({ local, remote, meta, uid }) {
  const localTx = (local && local.transactions) || [];
  if (!remote) {
    // 雲端還沒有資料:本機有交易才上傳(不要把一份空白預設資料當成正本推上去)
    return { data: local, needsUpload: localTx.length > 0, addedTxCount: 0 };
  }
  const remoteGroups = Array.isArray(remote.groups) ? remote.groups : [];
  const remoteTx = Array.isArray(remote.transactions) ? remote.transactions : [];
  const remoteTags = Array.isArray(remote.tags) ? remote.tags : [];

  // 同步紀錄屬於別的帳號(在這台裝置換了帳號登入):本機那份是別人的資料,不能併進這個帳號
  if (meta && meta.uid && meta.uid !== uid) {
    return { data: { ...remote, groups: remoteGroups, transactions: remoteTx, tags: remoteTags }, needsUpload: false, addedTxCount: 0 };
  }
  const syncedTx = new Set((meta && meta.txIds) || []);
  const remoteTxIds = ids(remoteTx);
  const addedTx = localTx.filter((t) => t && t.id && !remoteTxIds.has(t.id) && !syncedTx.has(t.id));

  // 補進來的交易所屬的群組/標籤,雲端沒有就一起帶過去(只帶有用到的,避免每台新裝置
  // 開出來的那個空白預設群組也被塞進雲端)
  const remoteGroupIds = ids(remoteGroups);
  const neededGroupIds = new Set(addedTx.map((t) => t.groupId).filter((g) => g && !remoteGroupIds.has(g)));
  const addedGroups = ((local && local.groups) || []).filter((g) => neededGroupIds.has(g.id));
  const remoteTagIds = ids(remoteTags);
  const neededTagIds = new Set();
  addedTx.forEach((t) => (Array.isArray(t.tagIds) ? t.tagIds : t.tagId ? [t.tagId] : []).forEach((id) => {
    if (!remoteTagIds.has(id)) neededTagIds.add(id);
  }));
  const addedTags = ((local && local.tags) || []).filter((t) => neededTagIds.has(t.id));

  let groups = remoteGroups.concat(addedGroups);
  // 雲端被清成沒有任何群組時,至少保留本機的群組,畫面才有地方放交易
  if (groups.length === 0) groups = (local && local.groups) || [];
  const groupIdSet = ids(groups);
  const preferredActive = local && local.activeGroupId;
  const activeGroupId =
    preferredActive && (groupIdSet.has(preferredActive) || preferredActive === '__all__')
      ? preferredActive
      : remote.activeGroupId && (groupIdSet.has(remote.activeGroupId) || remote.activeGroupId === '__all__')
      ? remote.activeGroupId
      : groups[0] && groups[0].id;

  const data = {
    ...remote,
    version: remote.version || 1,
    groups,
    tags: remoteTags.concat(addedTags),
    transactions: remoteTx.concat(addedTx),
    activeGroupId,
  };
  return { data, needsUpload: addedTx.length > 0 || addedGroups.length > 0, addedTxCount: addedTx.length };
}
