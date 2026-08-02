// ============================================================
// products.js
// Điều khiển trang Quản lý Sản phẩm:
// - Bảo vệ route + load danh mục + load danh sách sản phẩm
// - Search / Filter (danh mục, trạng thái) / Sort / Phân trang (client-side)
// - CRUD sản phẩm qua Modal Form (form-modal.js)
// - Upload nhiều ảnh lên Firebase Storage + kéo-thả sắp xếp (image-upload.js)
// - Quản lý danh mục (thêm/xóa nhanh) qua modal riêng
// ============================================================

import { db } from "../firebase/firebase-config.js";
import {
    collection,
    query,
    orderBy,
    getDocs,
    doc,
    setDoc,
    updateDoc,
    deleteDoc,
    serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { formatCurrency, formatDate, escapeHtml, debounce, setButtonLoading } from "./helpers.js";
import { showToast } from "./toast.js";
import { showConfirmModal } from "./modal.js";
import { filterBySearch, filterByField, sortItems, paginate, renderPaginationControls } from "./list-utils.js";
import { openFormModal, closeFormModal } from "./form-modal.js";
import { createImageUploader, deleteImageRecord, fetchImagesByIds } from "./image-upload.js";
import { fetchCategories, addCategory, deleteCategory } from "./categories.js";

const PAGE_SIZE = 8;

const STATUS_MAP = {
    active: { label: "Đang bán", badge: "badge--success" },
    inactive: { label: "Ngừng bán", badge: "badge--neutral" },
    out_of_stock: { label: "Hết hàng", badge: "badge--danger" },
};

let allProducts = [];
let allCategories = [];
let currentPage = 1;

// ---- DOM ----
// "let" thay vì "const": các phần tử nằm trong ".main", bị thay thế mỗi khi
// router SPA điều hướng sang trang khác rồi quay lại -> phải query lại (cacheDom()).
let tbody, searchInput, categorySelect, statusSelect, sortSelect;
let countShownEl, countTotalEl, paginationInfo, paginationControls;
let btnAddProduct, btnManageCategories;

function cacheDom() {
    tbody = document.getElementById("products-table-body");
    searchInput = document.getElementById("product-search");
    categorySelect = document.getElementById("product-filter-category");
    statusSelect = document.getElementById("product-filter-status");
    sortSelect = document.getElementById("product-sort");
    countShownEl = document.getElementById("product-count-shown");
    countTotalEl = document.getElementById("product-count-total");
    paginationInfo = document.getElementById("pagination-info");
    paginationControls = document.getElementById("pagination-controls");
    btnAddProduct = document.getElementById("btn-add-product");
    btnManageCategories = document.getElementById("btn-manage-categories");
}

/**
 * Gắn sự kiện cho các phần tử tĩnh của trang. Phải gọi lại mỗi lần trang
 * hiển thị vì các phần tử DOM là bản mới (SPA swap).
 */
function bindStaticEvents() {
    searchInput.addEventListener("input", debounce(() => applyFiltersAndRender(), 300));
    categorySelect.addEventListener("change", () => applyFiltersAndRender());
    statusSelect.addEventListener("change", () => applyFiltersAndRender());
    sortSelect.addEventListener("change", () => applyFiltersAndRender());
    btnAddProduct.addEventListener("click", () => openProductForm(null));
    btnManageCategories.addEventListener("click", openCategoryManager);
}

/**
 * Được spa-router.js gọi mỗi khi trang Sản phẩm được hiển thị.
 */
export function initPage() {
    cacheDom();
    bindStaticEvents();
    bootstrap();
}

async function bootstrap() {
    await Promise.all([loadCategories(), loadProducts()]);
}

/**
 * Tải danh mục sản phẩm, đổ vào dropdown filter
 */
async function loadCategories() {
    try {
        allCategories = await fetchCategories();
        renderCategoryFilterOptions();
    } catch (err) {
        console.error("Lỗi tải danh mục:", err);
        showToast("Không thể tải danh mục sản phẩm.", "error");
    }
}

function renderCategoryFilterOptions() {
    const current = categorySelect.value;
    categorySelect.innerHTML =
        `<option value="all">Tất cả danh mục</option>` +
        allCategories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
    categorySelect.value = current || "all";
}

/**
 * Tải toàn bộ sản phẩm từ Firestore
 */
async function loadProducts() {
    try {
        const q = query(collection(db, "products"), orderBy("createdAt", "desc"));
        const snap = await getDocs(q);
        allProducts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        applyFiltersAndRender();
    } catch (err) {
        console.error("Lỗi tải danh sách sản phẩm:", err);
        showToast("Không thể tải danh sách sản phẩm.", "error");
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--color-danger);">Không thể tải dữ liệu.</td></tr>`;
    }
}

function applyFiltersAndRender() {
    let result = allProducts;
    result = filterBySearch(result, searchInput.value, ["name", "sku"]);
    result = filterByField(result, "categoryId", categorySelect.value);
    result = filterByField(result, "status", statusSelect.value);

    const [field, dir] = sortSelect.value.split("_");
    const type = field === "price" ? "number" : field === "createdAt" ? "date" : "string";
    result = sortItems(result, field, dir, type);

    currentPage = 1;
    renderCurrentPage(result);
    lastFilteredResult = result;
}

let lastFilteredResult = [];

function renderCurrentPage(result = lastFilteredResult) {
    const { pageItems, totalPages, currentPage: page } = paginate(result, currentPage, PAGE_SIZE);
    currentPage = page;

    renderTable(pageItems);
    countShownEl.textContent = pageItems.length.toLocaleString("vi-VN");
    countTotalEl.textContent = result.length.toLocaleString("vi-VN");
    paginationInfo.textContent = `Trang ${currentPage} / ${totalPages}`;
    renderPaginationControls(paginationControls, currentPage, totalPages, (p) => {
        currentPage = p;
        renderCurrentPage();
    });
}

function renderTable(items) {
    if (items.length === 0) {
        tbody.innerHTML = `
      <tr><td colspan="6">
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none"><path d="M20.59 13.41L11 3.83A2 2 0 009.59 3.24H4a1 1 0 00-1 1v5.59a2 2 0 00.59 1.41l9.58 9.59a2 2 0 002.83 0l5.59-5.59a2 2 0 000-2.83z" stroke="currentColor" stroke-width="2"/></svg>
          <div class="empty-state__title">Không tìm thấy sản phẩm</div>
          <div class="empty-state__desc">Thử thay đổi từ khóa hoặc bộ lọc.</div>
        </div>
      </td></tr>`;
        return;
    }

    tbody.innerHTML = items.map(renderRow).join("");

    items.forEach((p) => {
        document.getElementById(`edit-${p.id}`)?.addEventListener("click", () => openProductForm(p));
        document.getElementById(`delete-${p.id}`)?.addEventListener("click", () => handleDeleteProduct(p));
    });
}

function renderRow(p) {
    const status = STATUS_MAP[p.status] || STATUS_MAP.active;
    const thumb = p.thumbnailUrl || (p.images && p.images[0] ? p.images[0].url : "");
    const stockClass = p.stock === 0 ? "stock-value--out" : p.stock <= 5 ? "stock-value--low" : "";

    return `
    <tr>
      <td>
        <div class="table-cell-with-thumb">
          <div class="table-thumb">${thumb ? `<img src="${escapeHtml(thumb)}" alt="" />` : ""}</div>
          <div>
            <div class="table-avatar__name">${escapeHtml(p.name || "Chưa đặt tên")}</div>
            <div class="table-avatar__meta">SKU: ${escapeHtml(p.sku || "—")}</div>
          </div>
        </div>
      </td>
      <td>${escapeHtml(p.categoryName || "—")}</td>
      <td>
        <div class="product-price__sale">${formatCurrency(Number(p.salePrice) || Number(p.price) || 0)}</div>
        ${p.salePrice ? `<div class="product-price__original">${formatCurrency(Number(p.price) || 0)}</div>` : ""}
      </td>
      <td><span class="${stockClass}">${(p.stock ?? 0).toLocaleString("vi-VN")}</span></td>
      <td><span class="badge ${status.badge}">${status.label}</span></td>
      <td>
        <div class="table-actions">
          <button class="icon-action-btn" id="edit-${p.id}" title="Sửa" aria-label="Sửa">
            <svg viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
          </button>
          <button class="icon-action-btn danger" id="delete-${p.id}" title="Xóa" aria-label="Xóa">
            <svg viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
}

// ============================================================
// FORM THÊM / SỬA SẢN PHẨM
// ============================================================

function categoryOptionsHtml(selectedId) {
    return allCategories
        .map((c) => `<option value="${c.id}" ${c.id === selectedId ? "selected" : ""}>${escapeHtml(c.name)}</option>`)
        .join("");
}

/**
 * Mở modal Thêm/Sửa sản phẩm
 * @param {Object|null} product - null nếu là thêm mới
 */
async function openProductForm(product) {
    const isEdit = !!product;
    // ID sản phẩm cần có TRƯỚC khi upload ảnh (dùng làm thư mục Storage).
    // Với sản phẩm mới, tạo trước 1 doc reference (chưa ghi dữ liệu) để lấy id.
    const productRef = isEdit ? doc(db, "products", product.id) : doc(collection(db, "products"));
    const originalImageIds = new Set(product?.imageIds || []);

    // Ảnh sản phẩm được lưu tách riêng trong album "productImages", document
    // sản phẩm chỉ giữ mảng imageIds -> cần tải lại gallery đầy đủ (url, path)
    // theo đúng thứ tự đã lưu trước khi mở form Sửa.
    const initialImages = isEdit ? await fetchImagesByIds(product.imageIds || []) : [];

    const bodyHtml = `
    <form id="product-form" novalidate>
      <div class="form-grid">
        <div class="form-group form-group--full">
          <label class="form-label" for="pf-name">Tên sản phẩm *</label>
          <div class="form-input-wrap">
            <input type="text" id="pf-name" class="form-input" value="${escapeHtml(product?.name || "")}" />
          </div>
          <div class="form-error" id="pf-name-error"></div>
        </div>

        <div class="form-group">
          <label class="form-label" for="pf-sku">SKU *</label>
          <div class="form-input-wrap">
            <input type="text" id="pf-sku" class="form-input" value="${escapeHtml(product?.sku || "")}" />
          </div>
          <div class="form-error" id="pf-sku-error"></div>
        </div>

        <div class="form-group">
          <label class="form-label" for="pf-category">Danh mục *</label>
          <select id="pf-category" class="filter-select" style="width:100%;">
            <option value="">-- Chọn danh mục --</option>
            ${categoryOptionsHtml(product?.categoryId)}
          </select>
          <div class="form-error" id="pf-category-error"></div>
        </div>

        <div class="form-group">
          <label class="form-label" for="pf-price">Giá gốc (₫) *</label>
          <div class="form-input-wrap">
            <input type="number" min="0" step="1000" id="pf-price" class="form-input" value="${product?.price ?? ""}" />
          </div>
          <div class="form-error" id="pf-price-error"></div>
        </div>

        <div class="form-group">
          <label class="form-label" for="pf-sale-price">Giá khuyến mãi (₫)</label>
          <div class="form-input-wrap">
            <input type="number" min="0" step="1000" id="pf-sale-price" class="form-input" value="${product?.salePrice ?? ""}" />
          </div>
          <div class="form-error" id="pf-sale-price-error"></div>
          <div class="form-hint">Bỏ trống nếu không áp dụng giá khuyến mãi.</div>
        </div>

        <div class="form-group">
          <label class="form-label" for="pf-stock">Tồn kho *</label>
          <div class="form-input-wrap">
            <input type="number" min="0" step="1" id="pf-stock" class="form-input" value="${product?.stock ?? ""}" />
          </div>
          <div class="form-error" id="pf-stock-error"></div>
        </div>

        <div class="form-group">
          <label class="form-label" for="pf-status">Trạng thái</label>
          <select id="pf-status" class="filter-select" style="width:100%;">
            <option value="active" ${(!product || product.status === "active") ? "selected" : ""}>Đang bán</option>
            <option value="inactive" ${product?.status === "inactive" ? "selected" : ""}>Ngừng bán</option>
            <option value="out_of_stock" ${product?.status === "out_of_stock" ? "selected" : ""}>Hết hàng</option>
          </select>
        </div>

        <div class="form-group form-group--full">
          <label class="form-label" for="pf-description">Mô tả</label>
          <textarea id="pf-description" class="form-input">${escapeHtml(product?.description || "")}</textarea>
        </div>

        <div class="form-group form-group--full">
          <label class="form-label">Hình ảnh sản phẩm</label>
          <div class="dropzone" id="pf-dropzone">
            <input type="file" id="pf-file-input" accept="image/jpeg,image/png,image/webp" multiple />
            <svg viewBox="0 0 24 24" fill="none"><path d="M12 16V4m0 0L7 9m5-5l5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 16v3a2 2 0 002 2h12a2 2 0 002-2v-3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            <div class="dropzone__text">Kéo thả hoặc bấm để chọn ảnh</div>
            <div class="dropzone__hint">Nhận JPG, PNG, WEBP · Ảnh gốc tối đa 10MB/ảnh · Hệ thống tự động nén và chuyển sang .webp (~700KB) rồi lưu trực tiếp vào cơ sở dữ liệu · Kéo thả để sắp xếp thứ tự (ảnh đầu tiên là ảnh chính)</div>
          </div>
          <div class="image-grid" id="pf-image-grid"></div>
        </div>
      </div>
    </form>
  `;

    let uploader = null;

    const modal = openFormModal({
        title: isEdit ? "Sửa sản phẩm" : "Thêm sản phẩm",
        bodyHtml,
        wide: true,
        onBeforeClose: () => {
            if (uploader && uploader.isUploading()) {
                showToast("Vui lòng đợi ảnh tải lên hoàn tất.", "warning");
                return false;
            }
            return true;
        },
        onMount: (root) => {
            uploader = createImageUploader({
                dropzoneEl: root.querySelector("#pf-dropzone"),
                fileInputEl: root.querySelector("#pf-file-input"),
                gridEl: root.querySelector("#pf-image-grid"),
                productId: productRef.id,
                initialImages,
                onError: (msg) => showToast(msg, "error"),
            });

            // Nút Lưu / Hủy được đặt trong footer riêng (thêm sau bodyHtml để nằm cố định dưới modal)
            const footer = document.createElement("div");
            footer.className = "modal-form__footer";
            footer.innerHTML = `
        <button type="button" class="btn btn--ghost" id="pf-cancel">Hủy</button>
        <button type="button" class="btn btn--primary" id="pf-submit">${isEdit ? "Lưu thay đổi" : "Thêm sản phẩm"}</button>
      `;
            root.querySelector(".modal-box--form").appendChild(footer);

            footer.querySelector("#pf-cancel").addEventListener("click", async () => {
                await cleanupUnsavedImages(uploader, originalImageIds);
                closeFormModal();
            });

            footer.querySelector("#pf-submit").addEventListener("click", () =>
                submitProductForm({ root, productRef, isEdit, uploader })
            );
        },
    });

    // Xử lý dọn ảnh khi đóng modal bằng nút X / click overlay / ESC
    const originalClose = modal.close;
    modal.root.querySelector("[data-form-modal-close]").addEventListener("click", async () => {
        await cleanupUnsavedImages(uploader, originalImageIds);
    });
}

/**
 * Xóa khỏi Storage + album "productImages" những ảnh đã upload trong phiên
 * chỉnh sửa này nhưng chưa được lưu vào document sản phẩm (imageIds)
 */
async function cleanupUnsavedImages(uploader, originalImageIds) {
    if (!uploader) return;
    const current = uploader.getImages();
    const toDelete = current.filter((img) => !originalImageIds.has(img.id));
    await Promise.all(toDelete.map((img) => deleteImageRecord(img)));
}

/**
 * Validate + lưu sản phẩm vào Firestore
 */
async function submitProductForm({ root, productRef, isEdit, uploader }) {
    const name = root.querySelector("#pf-name").value.trim();
    const sku = root.querySelector("#pf-sku").value.trim();
    const categoryId = root.querySelector("#pf-category").value;
    const categoryName = root.querySelector("#pf-category").selectedOptions[0]?.textContent || "";
    const price = Number(root.querySelector("#pf-price").value);
    const salePriceRaw = root.querySelector("#pf-sale-price").value;
    const salePrice = salePriceRaw === "" ? null : Number(salePriceRaw);
    const stock = Number(root.querySelector("#pf-stock").value);
    const status = root.querySelector("#pf-status").value;
    const description = root.querySelector("#pf-description").value.trim();

    if (!validateProductForm({ name, sku, categoryId, price, salePrice, stock, productId: isEdit ? productRef.id : null })) {
        return;
    }

    if (uploader.isUploading()) {
        showToast("Vui lòng đợi ảnh tải lên hoàn tất trước khi lưu.", "warning");
        return;
    }

    const submitBtn = root.querySelector("#pf-submit");
    setButtonLoading(submitBtn, true, "Đang lưu...");

    // Document sản phẩm chỉ lưu ID của từng ảnh (imageIds) tham chiếu tới
    // album riêng trong collection "productImages" — không nhúng {url, path}
    // đầy đủ của từng ảnh vào đây. "thumbnailUrl" là bản sao URL của ảnh đầu
    // tiên, giúp danh sách sản phẩm (admin) và Storefront hiển thị ảnh đại
    // diện ngay mà không cần đọc thêm album cho từng sản phẩm.
    const currentImages = uploader.getImages();
    const data = {
        name,
        sku,
        categoryId,
        categoryName,
        price,
        salePrice: salePrice ?? null,
        stock,
        status,
        description,
        imageIds: currentImages.map((img) => img.id),
        thumbnailUrl: currentImages[0]?.url || null,
        updatedAt: serverTimestamp(),
    };

    try {
        if (isEdit) {
            await updateDoc(productRef, data);
        } else {
            await setDoc(productRef, { ...data, createdAt: serverTimestamp() });
        }
        showToast(isEdit ? "Đã cập nhật sản phẩm." : "Đã thêm sản phẩm mới.", "success");
        closeFormModal();
        await loadProducts();
    } catch (err) {
        console.error("Lỗi lưu sản phẩm:", err);
        showToast("Không thể lưu sản phẩm. Vui lòng thử lại.", "error");
    } finally {
        setButtonLoading(submitBtn, false);
    }
}

/**
 * Validate dữ liệu form sản phẩm, hiển thị lỗi ngay dưới từng field
 * @returns {boolean} true nếu hợp lệ
 */
function validateProductForm({ name, sku, categoryId, price, salePrice, stock, productId }) {
    let isValid = true;

    const setErr = (id, msg) => {
        const el = document.getElementById(id);
        if (el) {
            el.textContent = msg;
            el.classList.toggle("is-visible", !!msg);
        }
    };

    if (!name) {
        setErr("pf-name-error", "Vui lòng nhập tên sản phẩm.");
        isValid = false;
    } else setErr("pf-name-error", "");

    if (!sku) {
        setErr("pf-sku-error", "Vui lòng nhập SKU.");
        isValid = false;
    } else {
        const duplicate = allProducts.some((p) => p.sku === sku && p.id !== productId);
        if (duplicate) {
            setErr("pf-sku-error", "SKU này đã được sử dụng cho sản phẩm khác.");
            isValid = false;
        } else setErr("pf-sku-error", "");
    }

    if (!categoryId) {
        setErr("pf-category-error", "Vui lòng chọn danh mục.");
        isValid = false;
    } else setErr("pf-category-error", "");

    if (!Number.isFinite(price) || price < 0) {
        setErr("pf-price-error", "Giá gốc phải là số không âm.");
        isValid = false;
    } else setErr("pf-price-error", "");

    if (salePrice !== null) {
        if (!Number.isFinite(salePrice) || salePrice < 0) {
            setErr("pf-sale-price-error", "Giá khuyến mãi phải là số không âm.");
            isValid = false;
        } else if (salePrice >= price) {
            setErr("pf-sale-price-error", "Giá khuyến mãi phải nhỏ hơn giá gốc.");
            isValid = false;
        } else setErr("pf-sale-price-error", "");
    } else {
        setErr("pf-sale-price-error", "");
    }

    if (!Number.isInteger(stock) || stock < 0) {
        setErr("pf-stock-error", "Tồn kho phải là số nguyên không âm.");
        isValid = false;
    } else setErr("pf-stock-error", "");

    return isValid;
}

// ============================================================
// XÓA SẢN PHẨM
// ============================================================

async function handleDeleteProduct(product) {
    const confirmed = await showConfirmModal({
        title: "Xóa sản phẩm",
        message: `Xóa vĩnh viễn sản phẩm "${product.name}"? Toàn bộ hình ảnh liên quan cũng sẽ bị xóa. Hành động này không thể hoàn tác.`,
        confirmText: "Xóa",
        danger: true,
    });
    if (!confirmed) return;

    try {
        await deleteDoc(doc(db, "products", product.id));
        // Sản phẩm chỉ lưu imageIds -> cần tải lại document ảnh (để có path
        // trên Storage) từ album "productImages" rồi mới xóa được từng ảnh.
        const images = await fetchImagesByIds(product.imageIds || []);
        await Promise.all(images.map((img) => deleteImageRecord(img)));
        showToast("Đã xóa sản phẩm.", "success");
        await loadProducts();
    } catch (err) {
        console.error("Lỗi xóa sản phẩm:", err);
        showToast("Không thể xóa sản phẩm. Vui lòng thử lại.", "error");
    }
}

// ============================================================
// QUẢN LÝ DANH MỤC
// ============================================================

function openCategoryManager() {
    const bodyHtml = `
    <div id="cm-list" class="category-manage-list"></div>
    <div class="category-add-row">
      <input type="text" id="cm-new-name" class="form-input" placeholder="Tên danh mục mới..." />
      <button type="button" class="btn btn--primary btn--sm" id="cm-add-btn">Thêm</button>
    </div>
  `;

    openFormModal({
        title: "Quản lý danh mục",
        bodyHtml,
        onMount: (root) => {
            renderCategoryManagerList(root);

            root.querySelector("#cm-add-btn").addEventListener("click", async () => {
                const input = root.querySelector("#cm-new-name");
                const name = input.value.trim();
                if (!name) {
                    showToast("Vui lòng nhập tên danh mục.", "error");
                    return;
                }
                if (allCategories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
                    showToast("Danh mục này đã tồn tại.", "error");
                    return;
                }
                try {
                    await addCategory(name);
                    input.value = "";
                    await loadCategories();
                    renderCategoryManagerList(root);
                    showToast("Đã thêm danh mục.", "success");
                } catch (err) {
                    console.error("Lỗi thêm danh mục:", err);
                    showToast("Không thể thêm danh mục.", "error");
                }
            });
        },
    });
}

function renderCategoryManagerList(root) {
    const listEl = root.querySelector("#cm-list");
    if (allCategories.length === 0) {
        listEl.innerHTML = `<div class="empty-state__desc" style="padding: 12px 0;">Chưa có danh mục nào.</div>`;
        return;
    }

    listEl.innerHTML = allCategories
        .map(
            (c) => `
      <div class="category-manage-row">
        <span>${escapeHtml(c.name)}</span>
        <button type="button" data-delete-category="${c.id}" title="Xóa danh mục" aria-label="Xóa danh mục">
          <svg viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>`
        )
        .join("");

    listEl.querySelectorAll("[data-delete-category]").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const categoryId = btn.dataset.deleteCategory;
            const inUse = allProducts.some((p) => p.categoryId === categoryId);
            const confirmed = await showConfirmModal({
                title: "Xóa danh mục",
                message: inUse
                    ? "Danh mục này đang được sử dụng bởi một số sản phẩm. Xóa sẽ không ảnh hưởng đến sản phẩm hiện có, nhưng sẽ không còn hiển thị trong danh sách chọn. Tiếp tục?"
                    : "Bạn có chắc chắn muốn xóa danh mục này?",
                confirmText: "Xóa",
                danger: true,
            });
            if (!confirmed) return;

            try {
                await deleteCategory(categoryId);
                await loadCategories();
                renderCategoryManagerList(root);
                showToast("Đã xóa danh mục.", "success");
            } catch (err) {
                console.error("Lỗi xóa danh mục:", err);
                showToast("Không thể xóa danh mục.", "error");
            }
        });
    });
}