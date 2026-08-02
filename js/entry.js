// ============================================================
// entry.js
// Điểm khởi động DUY NHẤT cho mọi trang Admin (được nhúng ở cuối mỗi
// admin/*.html thay cho từng file <page>.js riêng lẻ).
//
// Nhiệm vụ (chỉ chạy 1 LẦN duy nhất mỗi khi trình duyệt tải trang thật sự,
// vd: F5, gõ URL, hoặc mở link lần đầu):
//   1. Xác thực + kiểm tra quyền admin (guardAdminRoute)
//   2. Dựng khung layout dùng chung: inject sidebar, gắn thông tin user,
//      gắn nút đăng xuất (initLayout) — CHỈ 1 LẦN, sidebar sẽ không bị
//      dựng lại nữa trong suốt phiên làm việc.
//   3. Bàn giao cho spa-router.js để xử lý toàn bộ điều hướng nội bộ
//      (click vào menu) mà KHÔNG tải lại toàn trang / không dựng lại sidebar.
// ============================================================

import { guardAdminRoute } from "./auth.js";
import { initLayout } from "./layout-common.js";
import { initRouter } from "./spa-router.js";

guardAdminRoute((userData) => {
    initLayout(userData);
    initRouter(userData);
});
