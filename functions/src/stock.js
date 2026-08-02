// ============================================================
// src/stock.js
// Kiểm tra & Cập nhật tồn kho.
// - checkStock: Cloud Function (onCall) dùng bởi Frontend Shop TRƯỚC
//   khi tạo đơn hàng, đảm bảo tất cả sản phẩm trong giỏ còn đủ số lượng.
// - updateStock: Cloud Function Firestore Trigger (onDocumentUpdated)
//   theo dõi collection "orders" — khi đơn CHUYỂN sang "confirmed" lần
//   đầu tiên -> trừ tồn kho + cộng soldCount (transaction, an toàn khi
//   nhiều đơn cùng lúc); khi đơn bị "cancelled" SAU KHI đã trừ kho ->
//   hoàn lại tồn kho. Dùng field nội bộ `stockAdjusted` trên order để
//   đảm bảo mỗi đơn chỉ bị trừ/hoàn kho đúng 1 lần (idempotent).
// ============================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { db } = require("../admin");
const { logSystemEventInternal } = require("./logs");

/**
 * Cloud Function (callable): kiểm tra tồn kho cho 1 danh sách sản phẩm.
 * Request: { items: [{ productId: string, quantity: number }] }
 * Response: { ok: true } hoặc HttpsError('failed-precondition') kèm chi tiết sản phẩm thiếu hàng.
 */
const checkStock = onCall(async (request) => {
    const items = request.data?.items;
    if (!Array.isArray(items) || items.length === 0) {
        throw new HttpsError("invalid-argument", "Danh sách sản phẩm không hợp lệ.");
    }

    const shortages = [];
    await Promise.all(
        items.map(async (item) => {
            const snap = await db.collection("products").doc(item.productId).get();
            const stock = snap.exists ? Number(snap.data().stock) || 0 : 0;
            if (!snap.exists || stock < Number(item.quantity || 0)) {
                shortages.push({
                    productId: item.productId,
                    productName: snap.exists ? snap.data().name : "Không tìm thấy sản phẩm",
                    available: stock,
                    requested: item.quantity,
                });
            }
        })
    );

    if (shortages.length > 0) {
        throw new HttpsError("failed-precondition", "Một số sản phẩm không đủ tồn kho.", { shortages });
    }

    return { ok: true };
});

/**
 * Trigger: theo dõi thay đổi trên orders/{orderId}.
 */
const updateStock = onDocumentUpdated("orders/{orderId}", async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();
    const orderId = event.params.orderId;

    if (before.status === after.status) return; // không đổi trạng thái, bỏ qua

    const items = Array.isArray(after.items) ? after.items : [];
    if (items.length === 0) return;

    // ---- Đơn được xác nhận lần đầu -> trừ tồn kho + cộng đã bán ----
    if (after.status === "confirmed" && !after.stockAdjusted) {
        await db.runTransaction(async (tx) => {
            for (const item of items) {
                const ref = db.collection("products").doc(item.productId);
                const snap = await tx.get(ref);
                if (!snap.exists) continue;
                const currentStock = Number(snap.data().stock) || 0;
                const currentSold = Number(snap.data().soldCount) || 0;
                const qty = Number(item.quantity) || 0;
                tx.update(ref, {
                    stock: Math.max(0, currentStock - qty),
                    soldCount: currentSold + qty,
                });
            }
            tx.update(db.collection("orders").doc(orderId), { stockAdjusted: true });
        });

        await logSystemEventInternal({
            type: "stock_deducted",
            targetCollection: "orders",
            targetId: orderId,
            message: `Đã trừ tồn kho cho đơn #${after.orderCode || orderId} (${items.length} sản phẩm).`,
        });
    }

    // ---- Đơn bị hủy SAU KHI đã trừ kho -> hoàn lại tồn kho ----
    if (after.status === "cancelled" && before.stockAdjusted && !after.stockRestored) {
        await db.runTransaction(async (tx) => {
            for (const item of items) {
                const ref = db.collection("products").doc(item.productId);
                const snap = await tx.get(ref);
                if (!snap.exists) continue;
                const currentStock = Number(snap.data().stock) || 0;
                const currentSold = Number(snap.data().soldCount) || 0;
                const qty = Number(item.quantity) || 0;
                tx.update(ref, {
                    stock: currentStock + qty,
                    soldCount: Math.max(0, currentSold - qty),
                });
            }
            tx.update(db.collection("orders").doc(orderId), { stockRestored: true });
        });

        await logSystemEventInternal({
            type: "stock_restored",
            targetCollection: "orders",
            targetId: orderId,
            message: `Đã hoàn lại tồn kho cho đơn bị hủy #${after.orderCode || orderId}.`,
        });
    }
});

module.exports = { checkStock, updateStock };
