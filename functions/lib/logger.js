// ============================================================
// lib/logger.js
// Ghi log hệ thống dùng chung cho mọi Cloud Function ("Log hệ thống").
// Log được ghi vào collection systemLogs (cùng collection mà phía
// client — orders.js, settings.js — cũng ghi khi thao tác trực tiếp).
// Dùng Admin SDK nên luôn bỏ qua Firestore Rules.
// ============================================================

const { db, FieldValue } = require("../admin");

/**
 * Ghi 1 bản ghi log hệ thống.
 * @param {Object} entry
 * @param {string} entry.type - loại sự kiện, vd "order_status_email", "stock_update", "flash_sale_expired"
 * @param {string} [entry.targetCollection]
 * @param {string} [entry.targetId]
 * @param {string} entry.message - mô tả ngắn gọn, dễ đọc (tiếng Việt)
 * @param {'info'|'success'|'warning'|'error'} [entry.level='info']
 * @param {Object} [entry.meta] - dữ liệu bổ sung tuỳ ngữ cảnh (không bắt buộc)
 */
async function logSystemEvent(entry) {
    try {
        await db.collection("systemLogs").add({
            type: entry.type,
            targetCollection: entry.targetCollection || null,
            targetId: entry.targetId || null,
            message: entry.message,
            level: entry.level || "info",
            source: "cloud_function",
            meta: entry.meta || null,
            createdAt: FieldValue.serverTimestamp(),
        });
    } catch (err) {
        // Log lỗi ra Cloud Logging thay vì throw — 1 lỗi ghi log không được phép
        // làm sập luồng nghiệp vụ chính (gửi email, cập nhật tồn kho...).
        console.error("Không thể ghi systemLogs:", err);
    }
}

module.exports = { logSystemEvent };