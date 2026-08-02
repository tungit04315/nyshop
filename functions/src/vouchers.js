// ============================================================
// src/vouchers.js
// Xác thực Voucher.
// Kiểm tra mã giảm giá có hợp lệ với đơn hàng hiện tại không:
// tồn tại, đang bật (isActive), còn trong hạn (startDate/endDate),
// chưa vượt số lượt sử dụng (usageLimit/usedCount), đơn hàng đạt giá
// trị tối thiểu (minOrderValue), và (nếu áp dụng theo phạm vi) sản phẩm/
// khách hàng có nằm trong applyTargets không.
// Chạy bằng Admin SDK nên KHÔNG cần đọc trực tiếp collection "vouchers"
// từ client (Firestore Rules đã chặn đọc công khai) — client chỉ cần
// gọi function này để biết mã có hợp lệ + số tiền được giảm là bao nhiêu.
// ============================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { db } = require("../admin");

/**
 * Request: {
 *   code: string,
 *   orderTotal: number,           // tổng giá trị đơn hàng trước khi giảm giá
 *   productIds?: string[],        // id các sản phẩm trong giỏ (để kiểm tra applyScope = "products")
 *   customerId?: string,          // uid khách hàng (để kiểm tra applyScope = "customers")
 * }
 * Response: { valid: true, discount: number, voucher: {...} } | HttpsError
 */
const validateVoucher = onCall(async (request) => {
    const { code, orderTotal, productIds = [], customerId } = request.data || {};

    if (!code || typeof orderTotal !== "number") {
        throw new HttpsError("invalid-argument", "Thiếu mã voucher hoặc tổng giá trị đơn hàng.");
    }

    const snap = await db.collection("vouchers").where("code", "==", String(code).toUpperCase()).limit(1).get();
    if (snap.empty) {
        throw new HttpsError("not-found", "Mã voucher không tồn tại.");
    }

    const voucherDoc = snap.docs[0];
    const v = voucherDoc.data();

    if (!v.isActive) {
        throw new HttpsError("failed-precondition", "Mã voucher hiện không còn hoạt động.");
    }

    const now = new Date();
    if (v.startDate && now < new Date(v.startDate)) {
        throw new HttpsError("failed-precondition", "Mã voucher chưa tới ngày áp dụng.");
    }
    if (v.endDate && now > new Date(v.endDate)) {
        throw new HttpsError("failed-precondition", "Mã voucher đã hết hạn.");
    }

    if (typeof v.usageLimit === "number" && (v.usedCount || 0) >= v.usageLimit) {
        throw new HttpsError("resource-exhausted", "Mã voucher đã hết lượt sử dụng.");
    }

    if (v.minOrderValue && orderTotal < v.minOrderValue) {
        throw new HttpsError(
            "failed-precondition",
            `Đơn hàng cần tối thiểu ${Number(v.minOrderValue).toLocaleString("vi-VN")} ₫ để áp dụng mã này.`
        );
    }

    if (v.applyScope === "products") {
        const targets = new Set(v.applyTargets || []);
        const matched = productIds.some((id) => targets.has(id));
        if (!matched) {
            throw new HttpsError("failed-precondition", "Mã voucher không áp dụng cho sản phẩm trong giỏ hàng.");
        }
    } else if (v.applyScope === "customers") {
        const targets = new Set(v.applyTargets || []);
        if (!customerId || !targets.has(customerId)) {
            throw new HttpsError("failed-precondition", "Mã voucher không áp dụng cho tài khoản của bạn.");
        }
    }

    let discount = v.discountType === "percent" ? (orderTotal * Number(v.value || 0)) / 100 : Number(v.value || 0);
    if (v.discountType === "percent" && v.maxDiscount) {
        discount = Math.min(discount, Number(v.maxDiscount));
    }
    discount = Math.min(discount, orderTotal);

    return {
        valid: true,
        discount: Math.round(discount),
        voucher: {
            id: voucherDoc.id,
            code: v.code,
            discountType: v.discountType,
            value: v.value,
        },
    };
});

/**
 * Cloud Function (callable): liệt kê các voucher đang khả dụng cho 1 khách
 * hàng (Trang cá nhân / Giỏ hàng / Checkout). Vì "vouchers" không đọc công
 * khai được từ client (xem firestore.rules), việc liệt kê phải đi qua đây
 * (Admin SDK bỏ qua rule) để tránh lộ voucher chưa/không áp dụng cho khách.
 *
 * Request: { customerId?: string|null } // null/không có -> khách vãng lai
 * Response: { vouchers: [{ id, code, discountType, value, maxDiscount,
 *   minOrderValue, applyScope, applyTargets, startDate, endDate,
 *   usageLimit, usedCount }] }
 */
const getMyVouchers = onCall(async (request) => {
    const customerId = request.data?.customerId || null;

    const snap = await db.collection("vouchers").where("isActive", "==", true).get();
    const now = new Date();

    const vouchers = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((v) => {
            if (v.startDate && new Date(v.startDate) > now) return false;
            if (v.endDate && new Date(v.endDate) < now) return false;
            if (typeof v.usageLimit === "number" && (v.usedCount || 0) >= v.usageLimit) return false;
            if (v.applyScope === "customers") {
                return !!customerId && (v.applyTargets || []).includes(customerId);
            }
            // "all" và "products" đều hiển thị (điều kiện sản phẩm sẽ được
            // kiểm tra chính xác lúc áp mã ở validateVoucher, dựa trên giỏ hàng).
            return true;
        })
        // Không trả field nội bộ không cần thiết cho client
        .map((v) => ({
            id: v.id,
            code: v.code,
            discountType: v.discountType,
            value: v.value,
            maxDiscount: v.maxDiscount ?? null,
            minOrderValue: v.minOrderValue || 0,
            applyScope: v.applyScope || "all",
            applyTargets: v.applyScope === "products" ? v.applyTargets || [] : [],
            startDate: v.startDate || null,
            endDate: v.endDate || null,
            usageLimit: v.usageLimit ?? null,
            usedCount: v.usedCount || 0,
        }));

    return { vouchers };
});

module.exports = { validateVoucher, getMyVouchers };
