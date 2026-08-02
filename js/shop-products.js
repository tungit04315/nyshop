// ============================================================
// products.js
// Controller cho products.html — Giai đoạn 1 CHỈ hiển thị danh sách
// sản phẩm đang bán từ Firestore. Bộ lọc (danh mục, khoảng giá), sắp
// xếp, và phân trang thật sẽ được lập trình ở Giai đoạn sau — ở đây
// chỉ dựng UI (đã disable tương tác) để layout sẵn sàng kế thừa.
// ============================================================

import { refreshLayoutEffects } from "./layout.js";
import { escapeHtml } from "./shop-helpers.js";
import { getAllActiveProducts, getCategories } from "../firebase/firestore-service.js";
import { renderProductGrid } from "../components/product-card.js";
import { skeletonProductGrid } from "../components/skeleton.js";

const EMPTY_ICON = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
    <circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/>
  </svg>`;

/**
 * Render danh sách checkbox danh mục (chỉ hiển thị, chưa gắn lọc thật —
 * xem ghi chú trong products.css: .filter-option { cursor: not-allowed })
 */
async function renderCategoryFilters() {
  const list = document.getElementById("filter-category-list");
  if (!list) return;
  const categories = await getCategories(10);
  if (!categories.length) {
    list.innerHTML = `<div style="font-size:12.5px;color:var(--color-text-muted);">Chưa có danh mục.</div>`;
    return;
  }
  list.innerHTML = categories
    .map(
      (c) => `
      <label class="filter-option">
        <span style="display:flex;align-items:center;gap:10px;">
          <span class="filter-option__check"></span>
          ${escapeHtml(c.name)}
        </span>
      </label>`
    )
    .join("");
}

/**
 * Render danh sách sản phẩm chính của trang
 */
async function renderProducts() {
  const grid = document.getElementById("products-grid");
  const countEl = document.getElementById("catalog-result-count");
  const bannerCountEl = document.getElementById("page-banner-count");
  if (!grid) return;

  grid.innerHTML = skeletonProductGrid(8);
  const products = await getAllActiveProducts(40);

  if (!products.length) {
    grid.innerHTML = `
      <div class="catalog-empty">
        ${EMPTY_ICON}
        <div class="catalog-empty__title">Chưa có sản phẩm nào</div>
        <p>Sản phẩm sẽ hiển thị tại đây ngay khi được thêm từ trang Quản trị.</p>
      </div>`;
  } else {
    grid.innerHTML = renderProductGrid(products);
    refreshLayoutEffects(grid);
  }

  if (countEl) countEl.innerHTML = `Hiển thị <strong>${products.length}</strong> sản phẩm`;
  if (bannerCountEl) bannerCountEl.textContent = `${products.length} sản phẩm`;
}

/**
 * Điểm khởi động trang — được gọi bởi site-router.js mỗi khi trang
 * Sản phẩm được hiển thị.
 */
export async function initPage() {
  renderCategoryFilters();
  renderProducts();
}
