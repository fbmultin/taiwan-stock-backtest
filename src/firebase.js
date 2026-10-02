// Firebase 初始化:集中管理登入(Authentication)跟雲端資料庫(Firestore)。
//
// 這組 config 不是密碼或密鑰,是 Firebase 官方設計給瀏覽器端程式碼使用的
// 公開設定值,放進程式碼裡、推上 GitHub 都沒關係——真正的存取權限控管是
// 在 Firestore 的「安全性規則」那邊(只有登入的本人才能讀寫自己那份資料),
// 不是靠隱藏這組設定值。

import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyDt4Xto7K7bbWnrLsR9q4tWOJo5Kw0ghDU',
  authDomain: 'twstock-a4ef0.firebaseapp.com',
  projectId: 'twstock-a4ef0',
  storageBucket: 'twstock-a4ef0.firebasestorage.app',
  messagingSenderId: '452210413265',
  appId: '1:452210413265:web:fadcf5eeadc4f4705efff0',
};

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(firebaseApp);
