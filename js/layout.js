// ============================================================
// layout.js
// Khởi tạo khung layout dùng chung cho MỌI trang của Storefront:
// mount Header + Footer, kích hoạt lazy-load ảnh và scroll-reveal.
// Mỗi trang (home.js, products.js...) import initLayout() rồi tự thêm
// logic riêng của trang đó.
// ============================================================

import { mountHeader } from "../components/header.js";
import { mountFooter } from "../components/footer.js";
import { lazyLoadImages, initScrollReveal } from "./shop-helpers.js";

/**
 * Khởi tạo layout chung. Trả về Promise để trang gọi có thể `await`
 * trước khi tiếp tục render nội dung riêng (đảm bảo Header/Footer đã
 * gắn vào DOM để không bị "nhảy" layout).
 */
export async function initLayout() {
  await Promise.all([mountHeader("#site-header"), mountFooter("#site-footer")]);
}

/**
 * Gọi sau khi 1 khối nội dung mới được render (vd: sau khi đổ sản phẩm
 * vào lưới) để kích hoạt lazy-load ảnh + hiệu ứng reveal cho khối đó.
 * @param {HTMLElement|Document} root
 */
export function refreshLayoutEffects(root = document) {
  lazyLoadImages(root);
  initScrollReveal(root);
}
