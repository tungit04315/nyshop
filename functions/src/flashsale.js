// ============================================================
// src/flashsale.js
// Kiểm tra Flash Sale.
// Cloud Function chạy định kỳ (scheduled), quét toàn bộ chương trình
// Flash Sale đang isActive=true nhưng đã qua endTime -> tự động tắt
// (isActive=false) để Admin Dashboard / Frontend Shop luôn hiển thị
// đúng trạng thái mà không phụ thuộc vào việc client tự tính hạn.
// ============================================================

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { db } = require("../admin");
const { logSystemEventInternal } = require("./logs");

/**
 * Chạy mỗi 5 phút: tắt các Flash Sale đã hết hạn.
 */
const checkFlashSale = onSchedule("every 5 minutes", async () => {
    const now = new Date().toISOString();

    const snap = await db.collection("flashSales").where("isActive", "==", true).where("endTime", "<=", now).get();

    if (snap.empty) return;

    const batch = db.batch();
    const names = [];
    snap.forEach((docSnap) => {
        batch.update(docSnap.ref, { isActive: false });
        names.push(docSnap.data().name || docSnap.id);
    });
    await batch.commit();

    await logSystemEventInternal({
        type: "flash_sale_auto_expired",
        targetCollection: "flashSales",
        message: `Tự động kết thúc ${snap.size} chương trình Flash Sale đã hết hạn: ${names.join(", ")}`,
    });
});

module.exports = { checkFlashSale };
