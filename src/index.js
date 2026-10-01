import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import * as serviceWorkerRegistration from './serviceWorkerRegistration';

const rootElement = document.getElementById('root');
const root = createRoot(rootElement);

root.render(
  <StrictMode>
    <App />
  </StrictMode>
);

// 註冊 PWA 用的 service worker:新版本裝好後直接讓它接管、重新整理一次,
// 這樣每次部署新版，使用者不用自己手動清快取就能看到最新內容。
serviceWorkerRegistration.register({
  onUpdate: (registration) => {
    if (registration.waiting) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
    if (!window.__swReloaded) {
      window.__swReloaded = true;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload();
      });
    }
  },
});
