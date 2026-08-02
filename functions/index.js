// ============================================================
// index.js
// Điểm khởi tạo DUY NHẤT cho toàn bộ Cloud Functions của ShopAdmin.
// Mỗi function được viết trong functions/src/<tên-module>.js theo đúng
// nghiệp vụ đảm nhiệm (giống quy ước "1 file JS = 1 trách nhiệm" đã dùng ở
// phía Admin Dashboard: helpers.js, toast.js, modal.js...), index.js chỉ
// khởi tạo Admin SDK 1 lần rồi re-export.
// ============================================================

// Khởi tạo Admin SDK 1 LẦN DUY NHẤT (guard bằng getApps() bên trong admin.js).
// Mọi module con trong /src đều require("../admin") thay vì tự initializeApp().
require("./admin");

const { checkAdminRole } = require("./src/admin");
const { sendEmail } = require("./src/mail");
const { validateVoucher, getMyVouchers } = require("./src/vouchers");
const { checkFlashSale } = require("./src/flashsale");
const { updateStock } = require("./src/stock");
const { logSystemEvent } = require("./src/logs");
const { onOrderStatusChange, lookupOrders } = require("./src/orders");

module.exports = {
    // ---- Kiểm tra quyền Admin ----
    checkAdminRole,

    // ---- Gửi Email ----
    sendEmail,

    // ---- Xác thực Voucher ----
    validateVoucher,

    // ---- Liệt kê Voucher khả dụng theo tài khoản (Trang cá nhân, Checkout) ----
    getMyVouchers,

    // ---- Kiểm tra Flash Sale (tự động hết hạn theo lịch) ----
    checkFlashSale,

    // ---- Cập nhật tồn kho (trigger khi đơn được xác nhận/hủy) ----
    // Kiểm tra tồn kho TRƯỚC khi đặt hàng giờ đọc trực tiếp Firestore từ
    // client (firebase/firestore-service.js: checkStockDirect), không còn
    // Cloud Function "checkStock" nữa.
    updateStock,

    // ---- Log hệ thống (callable dùng cho các thao tác thủ công) ----
    logSystemEvent,

    // ---- Đơn hàng: tự động lưu lịch sử + ghi log + gửi email khi đổi trạng thái ----
    onOrderStatusChange,

    // ---- Tra cứu đơn hàng công khai bằng SĐT/Email (khách vãng lai) ----
    lookupOrders,
};