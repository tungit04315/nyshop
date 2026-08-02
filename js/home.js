// ============================================================
// home.js
// Controller cho index.html (Homepage).
// - Khối dữ liệu THẬT (đọc Firestore): Danh mục, Flash Sale, Best Seller,
//   Hàng mới, Deal trong ngày, Banner (từ settings).
// - Khối DEMO UI thuần (theo đúng yêu cầu đề bài "Thương hiệu"): không
//   gắn Firestore, không tạo logic nghiệp vụ.
// Không xử lý giỏ hàng / đặt hàng — thuộc Giai đoạn sau.
// ============================================================

import { refreshLayoutEffects } from "./layout.js";
import { escapeHtml, showToast, formatCurrency } from "./shop-helpers.js";
import {
  getSiteSettings,
  getCategories,
  getLatestProducts,
  getDealProducts,
  getActiveFlashSales,
  getProductById,
} from "../firebase/firestore-service.js";
import { renderProductGrid } from "../components/product-card.js";
import { renderCategoryGrid } from "../components/category-card.js";
import { skeletonProductGrid, skeletonCategoryGrid } from "../components/skeleton.js";

const ICON_IMAGE_FALLBACK = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
    <rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>
  </svg>`;

// Lưu lại các timer đang chạy (Flash Sale + Deal trong ngày) để có thể
// clearTimeout khi rời trang (disposePage) — tránh tick() tiếp tục chạy
// ngầm sau khi <main> của trang này đã bị router thay thế.
let countdownTimers = [];

/**
 * Đếm ngược thời gian — dùng cho khối Flash Sale (demo) và Deal trong ngày.
 * @param {HTMLElement} el - phần tử chứa .countdown__box (h/m/s)
 * @param {number} durationMs - thời lượng đếm ngược tính từ lúc tải trang
 */
function startCountdown(el, durationMs) {
  if (!el) return;
  const endTime = Date.now() + durationMs;
  const boxH = el.querySelector('[data-cd="h"]');
  const boxM = el.querySelector('[data-cd="m"]');
  const boxS = el.querySelector('[data-cd="s"]');
  const pad = (n) => String(n).padStart(2, "0");

  function tick() {
    const diff = Math.max(0, endTime - Date.now());
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    if (boxH) boxH.textContent = pad(h);
    if (boxM) boxM.textContent = pad(m);
    if (boxS) boxS.textContent = pad(s);
    if (diff > 0) {
      const timerId = setTimeout(() => requestAnimationFrame(tick), 1000);
      countdownTimers.push(timerId);
    }
  }
  tick();
}

/**
 * Hero Banner + 2 Banner phụ: lấy bannerUrl từ settings (nếu Admin đã
 * cấu hình), ngược lại giữ nền gradient mặc định.
 */
async function hydrateHero(settings) {
  const media = document.getElementById("hero-media");
  if (!media || !settings?.bannerUrl) return;
  media.innerHTML = `<img data-src="${escapeHtml(settings.bannerUrl)}" alt="Banner" />`;
  refreshLayoutEffects(media);
}

/**
 * Khối Danh mục — dữ liệu thật từ Firestore "categories"
 */
async function renderCategoriesSection() {
  const grid = document.getElementById("categories-grid");
  if (!grid) return;
  grid.innerHTML = skeletonCategoryGrid(6);
  const categories = await getCategories(12);
  if (!categories.length) {
    grid.innerHTML = `<div class="catalog-empty" style="grid-column:1/-1;padding:32px 0;">
        <div class="catalog-empty__title">Chưa có danh mục nào</div>
        <p>Danh mục sẽ hiển thị ở đây khi Admin thêm dữ liệu.</p>
      </div>`;
    return;
  }
  grid.innerHTML = renderCategoryGrid(categories);
  refreshLayoutEffects(grid);
}

/**
 * Khối Best Seller — Giai đoạn 1 hiển thị theo sản phẩm mới nhất do
 * chưa có số liệu "đã bán" thật; việc tính best-seller theo doanh số
 * thực tế thuộc Giai đoạn sau.
 */
async function renderBestSellerSection() {
  const grid = document.getElementById("bestseller-grid");
  if (!grid) return;
  grid.innerHTML = skeletonProductGrid(4);
  const products = await getLatestProducts(4);
  renderOrEmptyProducts(grid, products, "Chưa có sản phẩm bán chạy để hiển thị.");
}

/**
 * Khối Hàng mới — sản phẩm mới tạo gần nhất
 */
async function renderNewArrivalsSection() {
  const grid = document.getElementById("newarrivals-grid");
  if (!grid) return;
  grid.innerHTML = skeletonProductGrid(4);
  const products = await getLatestProducts(8);
  renderOrEmptyProducts(grid, products.slice(4, 8).length ? products.slice(4, 8) : products, "Chưa có sản phẩm mới để hiển thị.");
}

/**
 * Khối Deal trong ngày — sản phẩm đang có giá khuyến mãi
 */
async function renderDealSection() {
  const grid = document.getElementById("deal-grid");
  if (!grid) return;
  grid.innerHTML = skeletonProductGrid(3);
  const products = await getDealProducts(3);
  renderOrEmptyProducts(grid, products, "Hiện chưa có deal khuyến mãi nào.");
}

function renderOrEmptyProducts(grid, products, emptyText) {
  if (!products.length) {
    grid.innerHTML = `<div class="catalog-empty" style="grid-column:1/-1;padding:32px 0;">
        <div class="catalog-empty__title">${escapeHtml(emptyText)}</div>
      </div>`;
    return;
  }
  grid.innerHTML = renderProductGrid(products);
  refreshLayoutEffects(grid);
}

/**
 * Khối Flash Sale — lấy dữ liệu THẬT từ Firestore ("flashSales", do Admin
 * cấu hình ở trang admin/flashsale.html). Trước đây khối này là UI Demo
 * tĩnh (không đọc Firestore) nên mọi thay đổi ở Admin không phản ánh ra
 * Storefront — đây là bug đã được sửa.
 *
 * Chọn chương trình đang "running" (isActive && startTime <= now <= endTime)
 * có startTime gần nhất; nếu không có chương trình nào đang chạy thì ẩn
 * khối Flash Sale. Ảnh sản phẩm không lưu trong document "flashSales" (chỉ
 * lưu productId/productName/giá/số lượng) nên phải load thêm document
 * "products" tương ứng để lấy "thumbnailUrl".
 */
async function renderFlashSaleSection() {
  const section = document.getElementById("flash-sale-grid")?.closest("section");
  const grid = document.getElementById("flash-sale-grid");
  if (!grid) return;

  grid.innerHTML = skeletonProductGrid(5);

  const now = new Date();
  const flashSales = await getActiveFlashSales();
  const running = flashSales
    .filter((fs) => new Date(fs.startTime) <= now && now <= new Date(fs.endTime))
    .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
  const currentSale = running[0] || null;

  if (!currentSale || !(currentSale.products || []).length) {
    if (section) section.style.display = "none";
    return;
  }
  if (section) section.style.display = "";

  const items = currentSale.products;
  const productDocs = await Promise.all(items.map((it) => getProductById(it.productId)));

  grid.innerHTML = items
    .map((item, idx) => {
      const product = productDocs[idx];
      const thumb = product?.thumbnailUrl || "";
      const quantity = Number(item.quantity) || 0;
      const sold = Number(item.sold) || 0;
      const soldPercent = quantity > 0 ? Math.min(100, Math.round((sold / quantity) * 100)) : 0;

      return `
      <div class="flash-card" data-product-id="${escapeHtml(item.productId || "")}">
        <div class="flash-card__media">
          ${thumb ? `<img src="${escapeHtml(thumb)}" alt="${escapeHtml(item.productName || "")}" loading="lazy" />` : ICON_IMAGE_FALLBACK}
        </div>
        <div class="flash-card__body">
          <div class="flash-card__name">${escapeHtml(item.productName || "")}</div>
          <div><span class="flash-card__price">${formatCurrency(item.flashPrice)}</span><span class="flash-card__old-price">${formatCurrency(item.originalPrice)}</span></div>
          <div class="flash-card__bar"><div class="flash-card__bar-fill" style="width:${soldPercent}%"></div></div>
          <div class="flash-card__sold">Đã bán ${soldPercent}%</div>
        </div>
      </div>`;
    })
    .join("");

  const endMs = new Date(currentSale.endTime).getTime() - Date.now();
  startCountdown(document.getElementById("flash-countdown"), Math.max(0, endMs));
}

/**
 * Khối Thương hiệu — demo UI theo đúng yêu cầu đề bài (không cần dữ
 * liệu thật, ưu tiên giao diện đẹp).
 */
function renderBrandsDemo() {
  const grid = document.getElementById("brands-grid");
  if (!grid) return;
  const brands = ["NOVA", "URBAN", "LUMIX", "TECHIA", "VIVA", "AERO"];
  grid.innerHTML = brands.map((b) => `<div class="brand-card">${b}</div>`).join("");
}

function bindNewsletterForm() {
  const form = document.getElementById("newsletter-form");
  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    showToast("Cảm ơn bạn đã đăng ký nhận bản tin!");
    form.reset();
  });
}

/**
 * Điểm khởi động trang — được gọi bởi site-router.js mỗi khi Trang chủ
 * được hiển thị (tải lần đầu HOẶC điều hướng SPA từ trang khác tới).
 */
export async function initPage() {
  const settings = await getSiteSettings();

  hydrateHero(settings);
  renderCategoriesSection();
  renderFlashSaleSection();
  renderBestSellerSection();
  renderNewArrivalsSection();
  renderDealSection();
  renderBrandsDemo();
  bindNewsletterForm();
  startCountdown(document.getElementById("deal-countdown"), 8 * 3600000 + 12 * 60000);

  refreshLayoutEffects(document);
}

/**
 * Được site-router.js gọi ngay TRƯỚC khi rời khỏi Trang chủ — dừng mọi
 * bộ đếm ngược đang chạy ngầm (Flash Sale + Deal trong ngày).
 */
export function disposePage() {
  countdownTimers.forEach(clearTimeout);
  countdownTimers = [];
}