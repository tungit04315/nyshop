// ============================================================
// components/category-card.js
// Component tái sử dụng: render 1 Danh mục dạng Card (icon + tên).
// Dùng ở: Homepage (khối Danh mục), Mega Menu (Header).
// ============================================================

import { escapeHtml } from "../js/shop-helpers.js";

// Icon mặc định dùng chung cho mọi danh mục (Giai đoạn 1 chưa có field
// icon riêng trong Firestore "categories" — Admin chỉ lưu {name, createdAt}).
const CATEGORY_ICON = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
    <rect x="3" y="3" width="7" height="7" rx="1.5"/>
    <rect x="14" y="3" width="7" height="7" rx="1.5"/>
    <rect x="3" y="14" width="7" height="7" rx="1.5"/>
    <rect x="14" y="14" width="7" height="7" rx="1.5"/>
  </svg>
`;

/**
 * Sinh HTML cho 1 Category Card
 * @param {Object} category - { id, name }
 */
export function renderCategoryCard(category) {
  const { id = "", name = "Danh mục" } = category || {};
  return `
    <a href="products.html?category=${encodeURIComponent(id)}" class="category-card">
      <div class="category-card__icon">${CATEGORY_ICON}</div>
      <div class="category-card__name">${escapeHtml(name)}</div>
    </a>
  `;
}

export function renderCategoryGrid(categories = []) {
  return categories.map(renderCategoryCard).join("");
}

/**
 * Sinh HTML danh sách link cho 1 cột trong Mega Menu
 * @param {Array} categories
 * @param {number} maxPerCol - số mục tối đa mỗi cột trước khi cắt
 */
export function renderMegaMenuLinks(categories = []) {
  return categories
    .map(
      (c) => `<a href="products.html?category=${encodeURIComponent(c.id)}" class="mega-menu__link">${escapeHtml(c.name)}</a>`
    )
    .join("");
}
