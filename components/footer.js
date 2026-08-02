// ============================================================
// components/footer.js
// Component Footer dùng chung cho mọi trang. Thông tin liên hệ, mạng xã
// hội lấy từ Firestore "settings/general" (do Admin cấu hình); nếu chưa
// có dữ liệu thì hiển thị giá trị mặc định để không bị rỗng UI.
// ============================================================

import { getSiteSettings } from "../firebase/firestore-service.js";
import { escapeHtml } from "../js/shop-helpers.js";

const ICONS = {
  phone: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3 19.5 19.5 0 01-6-6 19.8 19.8 0 01-3-8.7A2 2 0 014.1 2h3a2 2 0 012 1.7c.1 1 .3 2 .7 3a2 2 0 01-.4 2.1L8 10.3a16 16 0 006 6l1.5-1.4a2 2 0 012.1-.4c1 .4 2 .6 3 .7a2 2 0 011.7 2z"/></svg>`,
  mail: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/></svg>`,
  pin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1118 0z"/><circle cx="12" cy="10" r="3"/></svg>`,
  fb: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 21v-7.5H16l.4-3H13.5V8.4c0-.9.3-1.5 1.6-1.5H16.5V4.2C16.2 4.2 15.2 4 14 4c-2.4 0-4 1.5-4 4.1v2.4H7.5v3H10V21h3.5z"/></svg>`,
  zalo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 15V9h1.5l3 4V9H14v6h-1.5l-3-4v4H8z"/></svg>`,
  youtube: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="4"/><path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none"/></svg>`,
};

function footerHtml() {
  return `
    <div class="container">
      <div class="footer__top">
        <div>
          <div class="footer__brand-mark">
            <div class="footer__logo-mark" data-footer-logo-mark>S</div>
            <span class="footer__logo-text" data-footer-site-name>ShopViet</span>
          </div>
          <p class="footer__desc">Nền tảng mua sắm trực tuyến với trải nghiệm mượt mà, sản phẩm chính hãng và dịch vụ tận tâm.</p>
          <div class="footer__socials">
            <a href="#" class="footer__social-btn" data-footer-facebook aria-label="Facebook">${ICONS.fb}</a>
            <a href="#" class="footer__social-btn" data-footer-zalo aria-label="Zalo">${ICONS.zalo}</a>
            <a href="#" class="footer__social-btn" data-footer-youtube aria-label="YouTube">${ICONS.youtube}</a>
          </div>
        </div>

        <div>
          <div class="footer__col-title">Về chúng tôi</div>
          <a href="#" class="footer__link">Giới thiệu</a>
          <a href="#" class="footer__link">Tuyển dụng</a>
          <a href="#" class="footer__link">Điều khoản dịch vụ</a>
          <a href="#" class="footer__link">Chính sách bảo mật</a>
        </div>

        <div>
          <div class="footer__col-title">Hỗ trợ khách hàng</div>
          <a href="#" class="footer__link">Trung tâm trợ giúp</a>
          <a href="#" class="footer__link">Hướng dẫn mua hàng</a>
          <a href="#" class="footer__link">Chính sách đổi trả</a>
          <a href="#" class="footer__link">Vận chuyển &amp; Giao nhận</a>
        </div>

        <div>
          <div class="footer__col-title">Danh mục</div>
          <a href="products.html" class="footer__link">Tất cả sản phẩm</a>
          <a href="index.html#brands" class="footer__link">Thương hiệu</a>
          <a href="index.html#flash-sale" class="footer__link">Flash Sale</a>
        </div>

        <div>
          <div class="footer__col-title">Liên hệ</div>
          <div class="footer__contact-item">${ICONS.phone}<span data-footer-hotline>1900 6868</span></div>
          <div class="footer__contact-item">${ICONS.mail}<span data-footer-email>hotro@shopviet.vn</span></div>
          <div class="footer__contact-item">${ICONS.pin}<span data-footer-address>123 Nguyễn Huệ, Q.1, TP.HCM</span></div>
        </div>
      </div>

      <div class="footer__bottom">
        <span>© ${new Date().getFullYear()} <span data-footer-site-name>ShopViet</span>. Đã đăng ký bản quyền.</span>
        <div class="footer__payments">
          <span class="footer__payment-badge">VISA</span>
          <span class="footer__payment-badge">MASTERCARD</span>
          <span class="footer__payment-badge">MOMO</span>
          <span class="footer__payment-badge">COD</span>
        </div>
      </div>
    </div>
  `;
}

async function hydrateFooter(footerEl) {
  const settings = await getSiteSettings();
  if (!settings) return;
  if (settings.hotline) footerEl.querySelector("[data-footer-hotline]").textContent = settings.hotline;
  if (settings.email) footerEl.querySelector("[data-footer-email]").textContent = settings.email;
  if (settings.address) footerEl.querySelector("[data-footer-address]").textContent = settings.address;
  if (settings.facebook) footerEl.querySelector("[data-footer-facebook]").href = settings.facebook;
  if (settings.zalo) footerEl.querySelector("[data-footer-zalo]").href = settings.zalo;
  if (settings.youtube) footerEl.querySelector("[data-footer-youtube]").href = settings.youtube;
  if (settings.logoUrl) {
    footerEl.querySelector("[data-footer-logo-mark]").innerHTML =
      `<img src="${escapeHtml(settings.logoUrl)}" alt="${escapeHtml(settings.siteName || "Logo")}" />`;
  }
}

/**
 * Điểm khởi động Footer — gọi 1 lần trên mỗi trang.
 * @param {string} selector - selector của phần tử placeholder <footer id="site-footer">
 */
export async function mountFooter(selector = "#site-footer") {
  const footerEl = document.querySelector(selector);
  if (!footerEl) return;
  footerEl.classList.add("footer");
  footerEl.innerHTML = footerHtml();
  hydrateFooter(footerEl);
}
