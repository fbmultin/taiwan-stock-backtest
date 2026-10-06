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
// ---------- 第二次事故(2026-10)後加的兩道保險 ----------
// 情境:電腦從備份還原成功後,手機打開——手機上跑的還是瀏覽器快取裡的「舊版程式」(PWA 要等
// 新版下載完才會換),舊版照樣把空白資料上傳蓋掉雲端;電腦收到後,三方合併判斷「這些交易
// 上次同步時雲端都有、現在沒了 → 別台裝置刪的」,於是跟著全刪。
//   1. 寫入時蓋章(_sync.schema = 2)。沒有章的雲端資料一定是舊版程式寫的,不可信:
//      它少掉的交易不當成刪除,這台照樣保留並重新上傳(自動把雲端補回來)。
//   2. 大量刪除保護:就算是新版寫的,一次少掉「5 筆以上而且超過本機三成」的交易,
//      也不自動刪除,先保留並提示使用者,由使用者決定要不要接受雲端版本。
export const SYNC_SCHEMA = 2;
export const isTrustedRemote = (raw) => Boolean(raw && raw._sync && raw._sync.schema >= SYNC_SCHEMA);
export function stampForUpload(data, deviceId) {
  return { ...data, _sync: { schema: SYNC_SCHEMA, writer: deviceId || '', at: new Date().toISOString() } };
}
export const isMassDeletion = (deleted, localCount) => deleted >= 5 && deleted > localCount * 0.3;

// 上傳前檢查:這次上傳會讓雲端少掉一大批交易嗎?(防止任何程式錯誤把雲端清空)
export function isSuspiciousShrink(lastRemoteTxCount, nextTxCount) {
  const lost = (lastRemoteTxCount || 0) - (nextTxCount || 0);
  return isMassDeletion(lost, lastRemoteTxCount || 0);
}

export function mergeForSync({ local, remote, meta, uid, trustDeletions = true }) {
  const localTx = (local && local.transactions) || [];
  if (!remote) {
    // 雲端還沒有資料:本機有交易才上傳(不要把一份空白預設資料當成正本推上去)
    return { data: local, needsUpload: localTx.length > 0, addedTxCount: 0, blockedDeletions: 0 };
  }
  const remoteGroups = Array.isArray(remote.groups) ? remote.groups : [];
  const remoteTx = Array.isArray(remote.transactions) ? remote.transactions : [];
  const remoteTags = Array.isArray(remote.tags) ? remote.tags : [];

  // 同步紀錄屬於別的帳號(在這台裝置換了帳號登入):本機那份是別人的資料,不能併進這個帳號
  if (meta && meta.uid && meta.uid !== uid) {
    return {
      data: { ...remote, groups: remoteGroups, transactions: remoteTx, tags: remoteTags },
      needsUpload: false,
      addedTxCount: 0,
      blockedDeletions: 0,
    };
  }
  const syncedTx = new Set((meta && meta.txIds) || []);
  const remoteTxIds = ids(remoteTx);
  const missing = localTx.filter((t) => t && t.id && !remoteTxIds.has(t.id));
  // 「上次同步時雲端有、現在沒有」= 看起來是別處刪掉的
  const deletedElsewhere = missing.filter((t) => syncedTx.has(t.id));
  // 不可信的雲端(舊版程式寫的),或一次刪太多:不刪,當成這台要補回去的
  const blockedDeletions = !trustDeletions || isMassDeletion(deletedElsewhere.length, localTx.length) ? deletedElsewhere.length : 0;
  const addedTx = blockedDeletions > 0 ? missing : missing.filter((t) => !syncedTx.has(t.id));

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
  return {
    data,
    needsUpload: addedTx.length > 0 || addedGroups.length > 0,
    addedTxCount: addedTx.length - blockedDeletions,
    blockedDeletions,
  };
}

// ---------- 備份與還原 ----------
//
// 2026-10 事故之後加的安全網:同步出錯時,資料至少還有一份可以手動還原。
//   1. 「下載備份檔」:整份資料存成 JSON 檔,存在使用者自己的電腦/手機裡。
//   2. 「自動備份」:這台裝置每天第一次開啟、而且有交易時,在 localStorage 另存一份
//      (portfolio_auto_backup_v1)。同步把資料清空時,這份不會被動到。
//   3. 「從備份還原」:讀進備份檔或自動備份,取代目前資料並同步到雲端。

export const AUTO_BACKUP_KEY = 'portfolio_auto_backup_v1';
export const BACKUP_FORMAT = 'taiwan-stock-backtest/portfolio-backup';

export function makeBackupFile(data) {
  return JSON.stringify({ format: BACKUP_FORMAT, version: 1, exportedAt: new Date().toISOString(), data }, null, 1);
}

// 接受兩種格式:本 App 下載的備份檔,或直接是持股資料本身(例如從瀏覽器資料庫救回來的那份)。
// 不是有效的持股資料就丟出錯誤,讓畫面顯示原因。
export function parseBackupFile(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    throw new Error('檔案不是有效的 JSON');
  }
  const data = obj && obj.format === BACKUP_FORMAT ? obj.data : obj;
  if (!data || !Array.isArray(data.transactions) || !Array.isArray(data.groups)) {
    throw new Error('檔案裡找不到持股資料(交易紀錄/群組)');
  }
  return data;
}

export function summarizeBackup(data) {
  const tx = (data && data.transactions) || [];
  const dates = tx.map((t) => t.date).filter(Boolean).sort();
  return {
    txCount: tx.length,
    groupCount: ((data && data.groups) || []).length,
    symbolCount: new Set(tx.map((t) => t.symbol)).size,
    lastDate: dates.length ? dates[dates.length - 1] : null,
  };
}

export function loadAutoBackup(storage) {
  try {
    const raw = storage && storage.getItem(AUTO_BACKUP_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return v && v.data && Array.isArray(v.data.transactions) ? v : null;
  } catch (e) {
    return null;
  }
}

// 每天最多存一次;沒有交易的空白資料不存(不能讓空白蓋掉前一份好的備份)
export function maybeSaveAutoBackup(storage, data, today) {
  const tx = (data && data.transactions) || [];
  if (tx.length === 0) return false;
  const prev = loadAutoBackup(storage);
  if (prev && prev.date === today) return false;
  try {
    storage.setItem(AUTO_BACKUP_KEY, JSON.stringify({ date: today, savedAt: new Date().toISOString(), data }));
    return true;
  } catch (e) {
    return false; // 空間不足:放棄,不影響使用
  }
}

// 這台裝置的識別碼(寫進 _sync.writer,方便日後追查是哪台裝置寫的)
export function getDeviceId(storage) {
  try {
    let id = storage.getItem('portfolio_device_id');
    if (!id) {
      id = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      storage.setItem('portfolio_device_id', id);
    }
    return id;
  } catch (e) {
    return '';
  }
}
