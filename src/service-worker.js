/* eslint-disable no-restricted-globals */

// 這支 service worker 在 build 時會由 react-scripts 內建的 Workbox 自動把
// 每個 build 產物(JS/CSS/HTML)的檔名+hash 填進 self.__WB_MANIFEST,
// 瀏覽器安裝這支 service worker 時就會把那些檔案都快取下來——這就是
// PWA「加到主畫面後可以離線開啟」跟「不用每次都重新整個下載」的機制。

import { clientsClaim } from 'workbox-core';
import { ExpirationPlugin } from 'workbox-expiration';
import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { StaleWhileRevalidate } from 'workbox-strategies';

clientsClaim();

// 預先快取 build 出來的所有靜態檔案(這行是 Workbox 的必要寫法,
// self.__WB_MANIFEST 會在 build 時被自動替換成實際的檔案清單)。
precacheAndRoute(self.__WB_MANIFEST);

// App 是單頁應用(SPA),所有「導覽」(直接輸入網址、重新整理)都導回
// index.html,交給前端路由自己處理,離線時也能照常打開 App 本身。
const fileExtensionRegexp = new RegExp('/[^/?]+\\.[^/]+$');
registerRoute(
  ({ request, url }) => {
    if (request.mode !== 'navigate') return false;
    if (url.pathname.startsWith('/_')) return false;
    if (url.pathname.match(fileExtensionRegexp)) return false;
    return true;
  },
  createHandlerBoundToURL(process.env.PUBLIC_URL + '/index.html')
);

// 圖片類資源用「先回快取、背景同時更新」的策略,離線或網路不穩時
// 還是能馬上顯示上一次看到的版本。
registerRoute(
  ({ url }) =>
    url.origin === self.location.origin && url.pathname.endsWith('.png'),
  new StaleWhileRevalidate({
    cacheName: 'images',
    plugins: [new ExpirationPlugin({ maxEntries: 50 })],
  })
);

// 讓前端在偵測到新版本時,可以呼叫
// registration.waiting.postMessage({ type: 'SKIP_WAITING' })
// 叫新版本立刻接管,不用使用者自己關掉所有分頁再打開。
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
