// ============================================================
// src/logs.js
// Log hệ thống.
// - logSystemEventInternal: helper NỘI BỘ (re-export từ lib/logger.js),
//   dùng bởi các Cloud Function khác (mail.js, stock.js, orders.js...)
//   để ghi log mà không cần biết chi tiết cấu trúc Firestore.
// - logSystemEvent: Cloud Function (onCall) — cho phép Admin Dashboard
//   ghi 1 log hệ thống thủ công khi cần (vd. ghi chú thao tác đặc biệt
//   không thuộc luồng nghiệp vụ tự động nào).
// ============================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { assertAdmin } = require("./admin");
const { logSystemEvent: logSystemEventInternal } = require("../lib/logger");

/**
 * Cloud Function (callable): ghi 1 bản ghi log hệ thống thủ công.
 * Request: { type: string, message: string, targetCollection?: string, targetId?: string, level?: string }
 */
const logSystemEvent = onCall(async (request) => {
    const { uid, profile } = await assertAdmin(request);

    const { type, message, targetCollection, targetId, level } = request.data || {};
    if (!type || !message) {
        throw new HttpsError("invalid-argument", "Thiếu type hoặc message.");
    }

    await logSystemEventInternal({
        type,
        message,
        targetCollection,
        targetId,
        level,
        meta: { actorUid: uid, actorEmail: profile.email || null },
    });

    return { ok: true };
});

module.exports = { logSystemEvent, logSystemEventInternal };
