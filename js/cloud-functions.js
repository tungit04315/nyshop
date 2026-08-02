// ============================================================
// cloud-functions.js
// Lớp gọi Cloud Functions (callable) dùng chung cho Storefront.
// Voucher KHÔNG được đọc trực tiếp từ Firestore phía client (xem
// firestore.rules) — mọi thao tác liên quan voucher đi qua các hàm ở
// đây (chạy bằng Admin SDK phía server).
// ============================================================

import { functionsInstance } from "../firebase/firebase-config.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

/**
 * Lấy danh sách voucher đang khả dụng cho 1 khách hàng.
 * @param {string|null} customerId - uid khách hàng (null nếu khách vãng lai -> chỉ trả voucher applyScope "all"/"products")
 * @returns {Promise<Array>}
 */
export async function fetchMyVouchers(customerId = null) {
    const callable = httpsCallable(functionsInstance, "getMyVouchers");
    const res = await callable({ customerId });
    return res.data?.vouchers || [];
}

/**
 * Xác thực 1 mã voucher cho đơn hàng hiện tại (dùng ở Giỏ hàng / Checkout).
 * @param {{code:string, orderTotal:number, productIds?:string[], customerId?:string}} payload
 * @returns {Promise<{valid:boolean, discount:number, voucher:Object}>}
 */
export async function validateVoucherCode(payload) {
    const callable = httpsCallable(functionsInstance, "validateVoucher");
    const res = await callable(payload);
    return res.data;
}

// Kiểm tra tồn kho trước khi đặt hàng KHÔNG còn ở đây (không còn dùng Cloud
// Function "checkStock") — xem firebase/firestore-service.js: checkStockDirect(),
// đọc thẳng Firestore từ client (products đã "allow read: if true").

/**
 * Tra cứu đơn hàng công khai (khách vãng lai, không cần đăng nhập) bằng
 * SĐT hoặc Email — chạy qua Cloud Function vì Firestore Rules không thể
 * giới hạn an toàn 1 query "list" theo giá trị tùy ý người dùng nhập
 * (khác trường hợp voucher/flashSale chỉ cần so với 1 boolean cố định).
 * @param {{phone?: string, email?: string}} payload
 * @returns {Promise<Array>}
 */
export async function lookupMyOrders(payload) {
    const callable = httpsCallable(functionsInstance, "lookupOrders");
    const res = await callable(payload);
    return res.data?.orders || [];
}

/**
 * Diễn giải lỗi trả về từ Cloud Functions (HttpsError) sang tiếng Việt dễ hiểu.
 * Các function ở server đã trả `error.message` tiếng Việt sẵn nên phần lớn
 * trường hợp chỉ cần lấy message, hàm này chỉ xử lý các mã lỗi hạ tầng chung.
 */
export function translateFunctionsError(error) {
    const code = error?.code || "";
    if (code === "functions/unavailable" || code === "functions/deadline-exceeded") {
        return "Không thể kết nối máy chủ. Vui lòng kiểm tra mạng và thử lại.";
    }
    return error?.message || "Đã xảy ra lỗi. Vui lòng thử lại.";
}