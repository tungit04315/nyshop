// ============================================================
// firebase-config.js
// Khởi tạo Firebase App (Authentication, Firestore, Storage)
// Sử dụng Firebase SDK v10 (modular) qua CDN
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

// TODO: Thay bằng cấu hình dự án Firebase thực tế của bạn
// (Lấy tại Firebase Console > Project Settings > General > Your apps)
const firebaseConfig = {
    apiKey: "AIzaSyDcbGna9d9bL-rE7Y3ZFZEFYlqpuCrbAHs",
    authDomain: "web-ghetaplung.firebaseapp.com",
    projectId: "web-ghetaplung",
    storageBucket: "web-ghetaplung.firebasestorage.app",
    messagingSenderId: "878750778057",
    appId: "1:878750778057:web:2d296af9279874f7650318",
    measurementId: "G-D8ZTEJ812C"
};

// Khởi tạo app
const app = initializeApp(firebaseConfig);

// Export các service dùng chung cho toàn bộ hệ thống
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functionsInstance = getFunctions(app, "us-central1"); // Cloud Functions (validate voucher, gửi email, kiểm tra tồn kho...)