// ============================================================
// site-entry.js
// Điểm khởi động DUY NHẤT cho mọi trang Storefront (Users).
// Thay vì mỗi trang tự nhúng script riêng (js/home.js, js/cart.js...),
// mọi trang giờ nhúng đúng 1 file này. Nó khởi tạo router SPA
// (site-router.js), router sẽ mount Header/Footer 1 lần rồi tự gọi
// initPage() của trang hiện tại, và tiếp quản mọi lượt điều hướng
// nội bộ tiếp theo mà không tải lại toàn trang.
// ============================================================

import { initSiteRouter } from "./site-router.js";

initSiteRouter();
