// ============================================================
// src/mail.js
// Gửi Email dùng chung cho toàn hệ thống (nodemailer qua SMTP).
// - sendEmail: Cloud Function (onCall) — client (Admin Dashboard) gọi
//   trực tiếp khi cần gửi email thông báo (vd. đổi trạng thái đơn hàng).
// - sendOrderStatusEmail: helper NỘI BỘ, dùng bởi trigger onOrderStatusChange
//   (src/orders.js) để tự động gửi email ngay khi trạng thái đơn hàng
//   được cập nhật trên Firestore, không phụ thuộc vào việc client có
//   gọi sendEmail hay không (đảm bảo khách luôn được thông báo).
//
// Cấu hình SMTP đọc từ biến môi trường (Cloud Functions v2 params),
// KHÔNG hard-code thông tin đăng nhập trong code.
//   firebase functions:secrets:set SMTP_USER
//   firebase functions:secrets:set SMTP_PASS
// ============================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineString, defineSecret } = require("firebase-functions/params");
const nodemailer = require("nodemailer");
const { db } = require("../admin");
const { assertAdmin } = require("./admin");
const { logSystemEventInternal } = require("./logs");

const SMTP_HOST = defineString("SMTP_HOST", { default: "smtp.gmail.com" });
const SMTP_PORT = defineString("SMTP_PORT", { default: "465" });
const SMTP_USER = defineSecret("SMTP_USER");
const SMTP_PASS = defineSecret("SMTP_PASS");
const MAIL_FROM = defineString("MAIL_FROM", { default: "ShopAdmin <no-reply@shopadmin.vn>" });

let cachedTransporter = null;

function getTransporter() {
    if (cachedTransporter) return cachedTransporter;
    cachedTransporter = nodemailer.createTransport({
        host: SMTP_HOST.value(),
        port: Number(SMTP_PORT.value()),
        secure: Number(SMTP_PORT.value()) === 465,
        auth: {
            user: SMTP_USER.value(),
            pass: SMTP_PASS.value(),
        },
    });
    return cachedTransporter;
}

// Nhãn tiếng Việt cho từng trạng thái đơn hàng (dùng để soạn nội dung email)
const ORDER_STATUS_LABEL = {
    pending: "Chờ xử lý",
    confirmed: "Đã xác nhận",
    packing: "Đang đóng gói",
    shipping: "Đang giao hàng",
    completed: "Đã giao thành công",
    cancelled: "Đã hủy",
};

/**
 * Soạn + gửi 1 email thông báo đổi trạng thái đơn hàng cho khách.
 * @param {Object} order - dữ liệu đơn hàng (đã có id gộp vào)
 * @param {string} newStatus
 */
async function sendOrderStatusEmail(order, newStatus) {
    if (!order.customerEmail) return { skipped: true, reason: "Đơn hàng không có email khách hàng." };

    const statusLabel = ORDER_STATUS_LABEL[newStatus] || newStatus;
    const subject = `Đơn hàng #${order.orderCode || order.id} - ${statusLabel}`;
    const html = `
    <p>Xin chào ${escapeHtml(order.customerName || "Quý khách")},</p>
    <p>Đơn hàng <strong>#${escapeHtml(order.orderCode || order.id)}</strong> của bạn vừa được cập nhật trạng thái:</p>
    <p style="font-size:16px;"><strong>${escapeHtml(statusLabel)}</strong></p>
    <p>Tổng giá trị đơn hàng: <strong>${Number(order.total || 0).toLocaleString("vi-VN")} ₫</strong></p>
    <p>Cảm ơn bạn đã mua sắm cùng chúng tôi.</p>
  `;

    const transporter = getTransporter();
    await transporter.sendMail({
        from: MAIL_FROM.value(),
        to: order.customerEmail,
        subject,
        html,
    });

    return { sent: true };
}

function escapeHtml(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

/**
 * Cloud Function (callable): gửi email theo template.
 * Chỉ admin đã duyệt mới được gọi trực tiếp (client Admin Dashboard).
 * Request: { template: 'orderStatus', orderId: string, status: string }
 */
const sendEmail = onCall({ secrets: [SMTP_USER, SMTP_PASS] }, async (request) => {
    await assertAdmin(request);

    const { template, orderId, status } = request.data || {};

    if (template === "orderStatus") {
        if (!orderId || !status) {
            throw new HttpsError("invalid-argument", "Thiếu orderId hoặc status.");
        }
        const orderSnap = await db.collection("orders").doc(orderId).get();
        if (!orderSnap.exists) {
            throw new HttpsError("not-found", "Không tìm thấy đơn hàng.");
        }
        const order = { id: orderSnap.id, ...orderSnap.data() };

        try {
            const result = await sendOrderStatusEmail(order, status);
            await logSystemEventInternal({
                type: "email_sent",
                targetCollection: "orders",
                targetId: orderId,
                message: `Đã gửi email thông báo trạng thái "${status}" cho đơn #${order.orderCode || orderId}`,
            });
            return result;
        } catch (err) {
            await logSystemEventInternal({
                type: "email_failed",
                targetCollection: "orders",
                targetId: orderId,
                message: `Gửi email thất bại cho đơn #${order.orderCode || orderId}: ${err.message}`,
                level: "error",
            });
            throw new HttpsError("internal", "Gửi email thất bại. Vui lòng thử lại sau.");
        }
    }

    throw new HttpsError("invalid-argument", `Template email "${template}" không hợp lệ.`);
});

module.exports = { sendEmail, sendOrderStatusEmail, SMTP_USER, SMTP_PASS };
