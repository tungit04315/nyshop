// ============================================================
// components/skeleton.js
// Sinh HTML skeleton (placeholder) trong lúc chờ dữ liệu Firestore.
// Tái sử dụng cho mọi khối: product grid, category grid, search dropdown.
// ============================================================

/**
 * Skeleton cho 1 Product Card
 */
export function skeletonProductCard() {
  return `
    <div class="product-card product-card--skeleton">
      <div class="product-card__media skeleton"></div>
      <div class="product-card__body">
        <div class="skeleton skeleton--text" style="width:40%;margin-bottom:8px;"></div>
        <div class="skeleton skeleton--title" style="margin-bottom:10px;"></div>
        <div class="skeleton skeleton--text" style="width:50%;"></div>
      </div>
    </div>
  `;
}

/**
 * Render N skeleton Product Card vào 1 lưới (grid)
 * @param {number} count
 */
export function skeletonProductGrid(count = 8) {
  return Array.from({ length: count }, () => skeletonProductCard()).join("");
}

/**
 * Skeleton cho 1 Category Card
 */
export function skeletonCategoryCard() {
  return `
    <div class="category-card">
      <div class="skeleton" style="width:56px;height:56px;border-radius:999px;"></div>
      <div class="skeleton skeleton--text" style="width:70%;"></div>
    </div>
  `;
}

export function skeletonCategoryGrid(count = 6) {
  return Array.from({ length: count }, () => skeletonCategoryCard()).join("");
}

/**
 * Skeleton cho 1 dòng kết quả trong Search dropdown
 */
export function skeletonSearchRow() {
  return `
    <div class="search-dropdown__item search-dropdown__skeleton-row">
      <div class="skeleton" style="width:42px;height:42px;border-radius:10px;"></div>
      <div style="flex:1;">
        <div class="skeleton skeleton--text" style="width:80%;margin-bottom:6px;"></div>
        <div class="skeleton skeleton--text" style="width:40%;"></div>
      </div>
    </div>
  `;
}

export function skeletonSearchList(count = 4) {
  return Array.from({ length: count }, () => skeletonSearchRow()).join("");
}

/**
 * Skeleton cho khối mega-menu (khi danh mục chưa tải xong)
 */
export function skeletonMegaMenuColumns(cols = 3, rows = 5) {
  let html = "";
  for (let c = 0; c < cols; c++) {
    html += `<div><div class="skeleton skeleton--text" style="width:60%;margin-bottom:12px;"></div>`;
    for (let r = 0; r < rows; r++) {
      html += `<div class="skeleton skeleton--text" style="width:${80 - r * 6}%;margin-bottom:10px;"></div>`;
    }
    html += `</div>`;
  }
  return html;
}
