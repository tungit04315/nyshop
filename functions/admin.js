// ============================================================
// admin.js
// Khởi tạo Firebase Admin SDK DUY NHẤT 1 LẦN, dùng chung cho toàn bộ
// Cloud Functions. Mọi file khác trong /functions phải require từ đây
// thay vì tự gọi initializeApp() để tránh lỗi "app already exists".
// ============================================================

const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

if (getApps().length === 0) {
    initializeApp();
}

const db = getFirestore();
const auth = getAuth();

module.exports = { db, auth, FieldValue, Timestamp };