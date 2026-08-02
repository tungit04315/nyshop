// ============================================================
// components/product-card.js
// Component tái sử dụng: render 1 sản phẩm dạng Card.
// Dùng ở: Homepage (Best Seller, Hàng mới, Deal), Products.html.
// Giai đoạn 2: có thêm nút "Thêm vào giỏ hàng" nhanh — xử lý thực tế
// (đọc giá/tồn kho mới nhất, ghi LocalStorage/Firestore) được gắn tập
// trung ở components/header.js (delegated click trên [data-quick-add])
// để mọi trang dùng Product Card đều có nút hoạt động mà không cần tự
// import lại logic giỏ hàng.
// ============================================================

import { formatCurrency, escapeHtml } from "../js/shop-helpers.js";

const EMPTY_IMAGE_ICON = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
    <rect x="3" y="3" width="18" height="18" rx="3"/>
    <circle cx="8.5" cy="8.5" r="1.5"/>
    <path d="M21 15l-5-5L5 21"/>
  </svg>
`;

const CART_ICON = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <circle cx="9" cy="21" r="1.5"/><circle cx="19" cy="21" r="1.5"/>
    <path d="M2.5 3h2l2.4 12.4a2 2 0 002 1.6h8.7a2 2 0 002-1.6L21 8H6"/>
  </svg>
`;

const CHECK_ICON = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 6L9 17l-5-5"/></svg>
`;

/**
 * Sinh HTML cho 1 Product Card
 * @param {Object} product - dữ liệu sản phẩm từ Firestore (collection "products")
 * @returns {string}
 */
export function renderProductCard(product) {
  const {
    id = "",
    name = "Sản phẩm",
    categoryName = "",
    price = 0,
    salePrice = 0,
    status = "active",
    thumbnailUrl = "",
    images = [],
  } = product || {};

  // Ảnh sản phẩm được lưu tách riêng trong album Firestore ("productImages"),
  // document sản phẩm chỉ giữ "thumbnailUrl" (bản sao URL ảnh chính) để hiển
  // thị nhanh ở đây mà không cần đọc thêm album. Giữ fallback "images[0].url"
  // cho dữ liệu sản phẩm cũ tạo trước khi áp dụng cấu trúc album.
  const thumb = thumbnailUrl || (images && images[0] ? images[0].url : "");
  const hasSale = Number(salePrice) > 0 && Number(salePrice) < Number(price);
  const finalPrice = hasSale ? salePrice : price;
  const isOutOfStock = status === "out_of_stock";
  const discountPercent = hasSale ? Math.round((1 - Number(salePrice) / Number(price)) * 100) : 0;

  return `
    <div class="product-card" data-product-id="${escapeHtml(id)}">
      <div class="product-card__media">
        <div class="product-card__badges">
          ${hasSale ? `<span class="badge badge--danger">-${discountPercent}%</span>` : ""}
        </div>
        ${isOutOfStock ? `<div class="product-card__badge-out">Hết hàng</div>` : ""}
        ${thumb
      ? `<img data-src="${escapeHtml(thumb)}" alt="${escapeHtml(name)}" loading="lazy" />`
      : `<div class="product-card__media-empty">${EMPTY_IMAGE_ICON}</div>`
    }
        ${!isOutOfStock
      ? `<button type="button" class="product-card__quick-add" data-quick-add="${escapeHtml(id)}" title="Thêm vào giỏ hàng" aria-label="Thêm vào giỏ hàng">
                <span class="product-card__quick-add-icon product-card__quick-add-icon--cart">${CART_ICON}</span>
                <span class="product-card__quick-add-icon product-card__quick-add-icon--check">${CHECK_ICON}</span>
              </button>`
      : ""
    }
      </div>
      <div class="product-card__body">
        ${categoryName ? `<div class="product-card__category">${escapeHtml(categoryName)}</div>` : ""}
        <div class="product-card__name">${escapeHtml(name)}</div>
        <div class="product-card__price-row">
          <span class="product-card__price ${hasSale ? "product-card__price--danger" : ""}">${formatCurrency(finalPrice)}</span>
          ${hasSale ? `<span class="product-card__price-original">${formatCurrency(price)}</span>` : ""}
        </div>
      </div>
    </div>
  `;
}

/**
 * Render danh sách sản phẩm vào 1 chuỗi HTML lưới
 * @param {Array} products
 */
export function renderProductGrid(products = []) {
  if (!products.length) return "";
  return products.map(renderProductCard).join("");
}