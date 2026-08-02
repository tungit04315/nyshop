// ============================================================
// src/admin.js
// Kiểm tra quyền Admin.
// - checkAdminRole: Cloud Function (onCall) để client tự kiểm tra lại
//   quyền hạn của chính mình khi cần (vd. hiển thị/ẩn 1 tính năng nhạy
//   cảm phía client mà không muốn tin tưởng hoàn toàn dữ liệu cache).
// - assertAdmin: helper dùng NỘI BỘ bởi các Cloud Function khác (mail,
//   vouchers, stock...) khi cần đảm bảo người gọi là admin đã duyệt
//   trước khi thực hiện hành động nhạy cảm.
// ============================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { db } = require("../admin");

/**
 * Đọc hồ sơ phân quyền của 1 uid từ Firestore (users/{uid}).
 * @param {string} uid
 * @returns {Promise<{role?:string, status?:string}|null>}
 */
async function getUserProfile(uid) {
    const snap = await db.collection("users").doc(uid).get();
    return snap.exists ? snap.data() : null;
}

/**
 * Ném HttpsError('permission-denied') nếu người gọi không phải admin đã duyệt.
 * Dùng ở đầu các Cloud Function admin-only.
 * @param {import('firebase-functions/v2/https').CallableRequest} request
 * @returns {Promise<{uid:string, profile:Object}>}
 */
async function assertAdmin(request) {
    const uid = request.auth?.uid;
    if (!uid) {
        throw new HttpsError("unauthenticated", "Bạn cần đăng nhập để thực hiện thao tác này.");
    }
    const profile = await getUserProfile(uid);
    if (!profile || profile.role !== "admin" || profile.status !== "approved") {
        throw new HttpsError("permission-denied", "Tài khoản không có quyền quản trị.");
    }
    return { uid, profile };
}

/**
 * Cloud Function (callable): trả về quyền hạn hiện tại của người gọi.
 * Request: {} (không cần tham số, dùng request.auth)
 * Response: { isAdmin: boolean, role: string|null, status: string|null }
 */
const checkAdminRole = onCall(async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
        throw new HttpsError("unauthenticated", "Bạn cần đăng nhập để kiểm tra quyền.");
    }

    const profile = await getUserProfile(uid);
    const isAdmin = !!profile && profile.role === "admin" && profile.status === "approved";

    return {
        isAdmin,
        role: profile?.role || null,
        status: profile?.status || null,
    };
});

module.exports = { checkAdminRole, assertAdmin, getUserProfile };
