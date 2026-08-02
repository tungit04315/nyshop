// ============================================================
// src/orders.js
// Trigger đơn hàng: onOrderStatusChange
// Theo dõi collection "orders" — mỗi khi field `status` thay đổi,
// TỰ ĐỘNG thực hiện đúng 3 việc mà nghiệp vụ "Đổi trạng thái" yêu cầu:
//   1) Lưu lịch sử vào subcollection orders/{orderId}/statusHistory
//   2) Ghi log hệ thống vào collection systemLogs
//   3) Gửi email thông báo cho khách hàng (sendOrderStatusEmail)
// Xử lý tập trung ở server (thay vì client tự ghi) để đảm bảo dữ liệu
// nhất quán, không trùng lặp, và hoạt động đúng dù trạng thái được đổi
// từ Admin Dashboard hay từ bất kỳ nguồn nào khác trong tương lai.
// ============================================================

const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { FieldValue } = require("../admin");
const { db } = require("../admin");
const { logSystemEventInternal } = require("./logs");
const { sendOrderStatusEmail, SMTP_USER, SMTP_PASS } = require("./mail");

const { onCall, HttpsError } = require("firebase-functions/v2/https");

/**
 * lookupOrders — Tra cứu đơn hàng công khai (khách vãng lai, không cần đăng nhập)
 * bằng SĐT hoặc Email.
 *
 * LÝ DO PHẢI DÙNG CLOUD FUNCTION (không đi thẳng Firestore Client SDK như
 * vouchers/flashSales): Firestore Security Rules cho "list" chỉ có thể xác
 * minh những điều kiện KHÔNG phụ thuộc vào giá trị người dùng nhập (ví dụ
 * isActive == true chỉ có 2 khả năng, đúng với MỌI voucher active). Còn với
 * "customerPhone == số điện thoại bất kỳ mà khách gõ vào", rule không có
 * cách nào biết trước giá trị đó để giới hạn — nếu mở "list" trực tiếp trên
 * "orders", cách duy nhất khả thi là mở toàn bộ collection (lộ địa chỉ/SĐT/
 * đơn hàng của TẤT CẢ khách hàng), nên bắt buộc phải lọc ở server bằng
 * Admin SDK rồi chỉ trả về đúng phần dữ liệu cần thiết.
 *
 * Request: { phone?: string, email?: string } — cần ít nhất 1 trong 2.
 * Response: { orders: Array<{ id, orderCode, createdAt, status, items,
 *             subtotal, shippingFee, voucherDiscount, total, statusHistory }> }
 */
const lookupOrders = onCall(async (request) => {
    const phone = String(request.data?.phone || "").trim();
    const email = String(request.data?.email || "").trim().toLowerCase();

    if (!phone && !email) {
        throw new HttpsError("invalid-argument", "Vui lòng nhập số điện thoại hoặc email để tra cứu.");
    }

    const snapshots = [];
    if (phone) {
        snapshots.push(await db.collection("orders").where("customerPhone", "==", phone).limit(20).get());
    }
    if (email) {
        snapshots.push(await db.collection("orders").where("customerEmail", "==", email).limit(20).get());
    }

    // Gộp kết quả từ cả 2 query (nếu khách nhập cả SĐT lẫn Email) và loại trùng theo id.
    const byId = new Map();
    for (const snap of snapshots) {
        for (const doc of snap.docs) byId.set(doc.id, doc);
    }

    if (byId.size === 0) {
        return { orders: [] };
    }

    // Lấy kèm lịch sử trạng thái (statusHistory) để dựng Timeline.
    const orders = await Promise.all(
        Array.from(byId.values()).map(async (doc) => {
            const o = doc.data();
            const historySnap = await doc.ref.collection("statusHistory").orderBy("createdAt", "asc").get();
            return {
                id: doc.id,
                orderCode: o.orderCode || doc.id.slice(0, 8).toUpperCase(),
                createdAt: o.createdAt ? o.createdAt.toDate().toISOString() : null,
                status: o.status || "pending",
                items: (o.items || []).map((it) => ({
                    productId: it.productId || null,
                    productName: it.productName || "",
                    thumbnail: it.thumbnail || "",
                    quantity: Number(it.quantity) || 0,
                    price: Number(it.price) || 0,
                })),
                subtotal: Number(o.subtotal) || 0,
                shippingFee: Number(o.shippingFee) || 0,
                voucherCode: o.voucherCode || null,
                voucherDiscount: Number(o.voucherDiscount) || 0,
                total: Number(o.total) || 0,
                shippingAddress: o.shippingAddress || "",
                statusHistory: historySnap.docs.map((h) => {
                    const hd = h.data();
                    return {
                        fromStatus: hd.fromStatus || null,
                        toStatus: hd.toStatus,
                        createdAt: hd.createdAt ? hd.createdAt.toDate().toISOString() : null,
                    };
                }),
            };
        })
    );

    // Đơn mới nhất lên trước.
    orders.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    return { orders };
});

const onOrderStatusChange = onDocumentUpdated({ document: "orders/{orderId}", secrets: [SMTP_USER, SMTP_PASS] }, async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();
    const orderId = event.params.orderId;

    if (before.status === after.status) return; // chỉ xử lý khi status thực sự đổi

    const order = { id: orderId, ...after };

    // ---- 1) Lưu lịch sử ----
    await db.collection("orders").doc(orderId).collection("statusHistory").add({
        fromStatus: before.status || null,
        toStatus: after.status,
        changedByUid: after.lastChangedByUid || null,
        changedByEmail: after.lastChangedByEmail || null,
        createdAt: FieldValue.serverTimestamp(),
    });

    // ---- 2) Ghi log hệ thống ----
    await logSystemEventInternal({
        type: "order_status_change",
        targetCollection: "orders",
        targetId: orderId,
        message: `Đơn #${after.orderCode || orderId} đổi trạng thái từ "${before.status}" sang "${after.status}"`,
        meta: { actorEmail: after.lastChangedByEmail || null },
    });

    // ---- 3) Gửi email cho khách (không throw ra ngoài để không làm fail trigger) ----
    try {
        await sendOrderStatusEmail(order, after.status);
    } catch (err) {
        console.error(`Gửi email thất bại cho đơn ${orderId}:`, err);
        await logSystemEventInternal({
            type: "email_failed",
            targetCollection: "orders",
            targetId: orderId,
            message: `Gửi email thông báo thất bại cho đơn #${after.orderCode || orderId}: ${err.message}`,
            level: "error",
        });
    }
});

module.exports = { onOrderStatusChange, lookupOrders };
