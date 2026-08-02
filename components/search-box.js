// ============================================================
// components/search-box.js
// Component Search UI tái sử dụng — theo đúng yêu cầu "chỉ xây dựng
// giao diện Search": Input → Loading → Skeleton → Dropdown kết quả.
// Có gọi đọc dữ liệu gợi ý từ Firestore để tránh hardcode, nhưng KHÔNG
// có logic nghiệp vụ lọc/sắp xếp nâng cao (thuộc trang Products ở
// Giai đoạn sau).
// ============================================================

import { debounce, formatCurrency, escapeHtml, highlightKeyword } from "../js/helpers.js";
import { searchProductsByName } from "../firebase/firestore-service.js";
import { skeletonSearchList } from "./skeleton.js";

const HINT_HTML = `<div class="search-dropdown__hint">Nhập tên sản phẩm bạn muốn tìm…</div>`;
const EMPTY_HTML = `<div class="search-dropdown__empty">Không tìm thấy sản phẩm phù hợp.</div>`;

/**
 * Khởi tạo 1 Search Box trong phạm vi `wrapEl`.
 * Cấu trúc DOM mong đợi bên trong wrapEl:
 *   input[data-search-input], .search-dropdown[data-search-dropdown]
 * @param {HTMLElement} wrapEl
 */
export function initSearchBox(wrapEl) {
  if (!wrapEl) return;
  const input = wrapEl.querySelector("[data-search-input]");
  const dropdown = wrapEl.querySelector("[data-search-dropdown]");
  const clearBtn = wrapEl.querySelector("[data-search-clear]");
  if (!input || !dropdown) return;

  const renderResults = (products, keyword) => {
    if (!products.length) {
      dropdown.innerHTML = EMPTY_HTML;
      return;
    }
    dropdown.innerHTML = products
      .map((p) => {
        // Ưu tiên thumbnailUrl (denormalized từ album ảnh riêng "productImages");
        // fallback images[0].url cho sản phẩm cũ tạo trước khi có album ảnh.
        const thumb = p.thumbnailUrl || (p.images && p.images[0] ? p.images[0].url : "");
        const price = Number(p.salePrice) > 0 ? p.salePrice : p.price;
        const stock = Number(p.stock) || 0;
        const stockHtml =
          stock > 0
            ? `<span class="search-dropdown__stock">Còn ${stock.toLocaleString("vi-VN")}</span>`
            : `<span class="search-dropdown__stock search-dropdown__stock--out">Hết hàng</span>`;
        return `
          <a class="search-dropdown__item" href="products.html?q=${encodeURIComponent(p.name || "")}">
            <div class="search-dropdown__thumb">${thumb ? `<img src="${escapeHtml(thumb)}" alt="${escapeHtml(p.name)}" />` : ""}</div>
            <div class="search-dropdown__info">
              <div class="search-dropdown__name">${highlightKeyword(p.name || "", keyword)}</div>
              <div class="search-dropdown__meta">
                <div class="search-dropdown__price">${formatCurrency(price)}</div>
                ${stockHtml}
              </div>
            </div>
          </a>
        `;
      })
      .join("");
  };

  const runSearch = debounce(async (keyword) => {
    if (!keyword.trim()) {
      dropdown.innerHTML = HINT_HTML;
      return;
    }
    dropdown.innerHTML = skeletonSearchList(4);
    try {
      const results = await searchProductsByName(keyword, 6);
      // Tránh race-condition: chỉ render nếu input vẫn còn giá trị này
      if (input.value.trim() === keyword.trim()) renderResults(results, keyword);
    } catch (err) {
      console.error("[search-box] runSearch:", err);
      dropdown.innerHTML = EMPTY_HTML;
    }
  }, 380);

  input.addEventListener("input", () => {
    const value = input.value;
    wrapEl.classList.toggle("has-value", value.length > 0);
    runSearch(value);
  });

  input.addEventListener("focus", () => {
    wrapEl.classList.add("is-active");
    if (!input.value.trim()) dropdown.innerHTML = HINT_HTML;
  });

  clearBtn?.addEventListener("click", () => {
    input.value = "";
    wrapEl.classList.remove("has-value");
    dropdown.innerHTML = HINT_HTML;
    input.focus();
  });

  document.addEventListener("click", (e) => {
    if (!wrapEl.contains(e.target)) wrapEl.classList.remove("is-active");
  });

  dropdown.innerHTML = HINT_HTML;
}