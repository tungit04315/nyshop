// ============================================================
// flashsale.js
// Điều khiển trang Flash Sale:
// - Bảo vệ route + load flash sale / sản phẩm
// - Search / Filter trạng thái (sắp diễn ra / đang chạy / đã kết thúc) / Phân trang
// - CRUD chương trình Flash Sale: chọn nhiều sản phẩm, đặt giá Flash + số lượng riêng từng sản phẩm
// - Đồng hồ đếm ngược cập nhật theo thời gian thực (setInterval)
// ============================================================

import { db } from "../firebase/firebase-config.js";
import {
    collection,
    query,
    orderBy,
    getDocs,
    doc,
    addDoc,
    updateDoc,
    deleteDoc,
    serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { formatCurrency, escapeHtml, debounce, setButtonLoading } from "./helpers.js";
import { showToast } from "./toast.js";
import { showConfirmModal } from "./modal.js";
import { filterBySearch, sortItems, paginate, renderPaginationControls } from "./list-utils.js";
import { openFormModal, closeFormModal } from "./form-modal.js";
import { createSearchablePicker } from "./select-picker.js";

const PAGE_SIZE = 8;

const STATUS_BADGE = {
    upcoming: { label: "Sắp diễn ra", badge: "badge--accent" },
    running: { label: "Đang chạy", badge: "badge--success" },
    ended: { label: "Đã kết thúc", badge: "badge--neutral" },
    inactive: { label: "Đã tắt", badge: "badge--danger" },
};

let allFlashSales = [];
let allProducts = [];
let currentPage = 1;
let lastFilteredResult = [];
let countdownTimer = null;

// "let" thay vì "const": các phần tử nằm trong ".main", bị thay thế mỗi khi
// router SPA điều hướng sang trang khác rồi quay lại -> phải query lại (cacheDom()).
let tbody, searchInput, statusSelect, countShownEl, countTotalEl;
let paginationInfo, paginationControls, btnAdd;

function cacheDom() {
    tbody = document.getElementById("fs-table-body");
    searchInput = document.getElementById("fs-search");
    statusSelect = document.getElementById("fs-filter-status");
    countShownEl = document.getElementById("fs-count-shown");
    countTotalEl = document.getElementById("fs-count-total");
    paginationInfo = document.getElementById("pagination-info");
    paginationControls = document.getElementById("pagination-controls");
    btnAdd = document.getElementById("btn-add-flashsale");
}

/**
 * Gắn sự kiện cho các phần tử tĩnh của trang. Phải gọi lại mỗi lần trang
 * hiển thị vì các phần tử DOM là bản mới (SPA swap).
 */
function bindStaticEvents() {
    searchInput.addEventListener("input", debounce(() => applyFiltersAndRender(), 300));
    statusSelect.addEventListener("change", () => applyFiltersAndRender());
    btnAdd.addEventListener("click", () => openFlashSaleForm(null));
}

/**
 * Được spa-router.js gọi mỗi khi trang Flash Sale được hiển thị.
 */
export function initPage() {
    cacheDom();
    bindStaticEvents();
    bootstrap();
}

/**
 * Được spa-router.js gọi ngay TRƯỚC khi rời khỏi trang Flash Sale
 * (điều hướng sang trang khác) để dừng setInterval đếm ngược,
 * tránh chạy ngầm vô ích khi trang này không còn hiển thị.
 */
export function disposePage() {
    if (countdownTimer) {
        clearInterval(countdownTimer);
        countdownTimer = null;
    }
}

async function bootstrap() {
    await Promise.all([loadProducts(), loadFlashSales()]);
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = setInterval(updateCountdownBadges, 1000);
}

async function loadProducts() {
    try {
        const snap = await getDocs(collection(db, "products"));
        allProducts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (err) {
        console.error("Lỗi tải sản phẩm:", err);
    }
}

async function loadFlashSales() {
    try {
        const q = query(collection(db, "flashSales"), orderBy("createdAt", "desc"));
        const snap = await getDocs(q);
        allFlashSales = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        applyFiltersAndRender();
    } catch (err) {
        console.error("Lỗi tải danh sách Flash Sale:", err);
        showToast("Không thể tải danh sách Flash Sale.", "error");
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--color-danger);">Không thể tải dữ liệu.</td></tr>`;
    }
}

function computeStatus(fs) {
    if (!fs.isActive) return "inactive";
    const now = new Date();
    const start = new Date(fs.startTime);
    const end = new Date(fs.endTime);
    if (now < start) return "upcoming";
    if (now > end) return "ended";
    return "running";
}

function applyFiltersAndRender() {
    let result = allFlashSales.map((fs) => ({ ...fs, _status: computeStatus(fs) }));
    result = filterBySearch(result, searchInput.value, ["name"]);
    if (statusSelect.value !== "all") {
        result = result.filter((fs) => fs._status === statusSelect.value);
    }
    result = sortItems(result, "createdAt", "desc", "date");

    currentPage = 1;
    lastFilteredResult = result;
    renderCurrentPage();
}

function renderCurrentPage() {
    const { pageItems, totalPages, currentPage: page } = paginate(lastFilteredResult, currentPage, PAGE_SIZE);
    currentPage = page;

    renderTable(pageItems);
    countShownEl.textContent = pageItems.length.toLocaleString("vi-VN");
    countTotalEl.textContent = lastFilteredResult.length.toLocaleString("vi-VN");
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
          <svg viewBox="0 0 24 24" fill="none"><path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
          <div class="empty-state__title">Không tìm thấy chương trình</div>
          <div class="empty-state__desc">Thử thay đổi từ khóa hoặc bộ lọc.</div>
        </div>
      </td></tr>`;
        return;
    }

    tbody.innerHTML = items.map(renderRow).join("");

    items.forEach((fs) => {
        document.getElementById(`fs-edit-${fs.id}`)?.addEventListener("click", () => openFlashSaleForm(fs));
        document.getElementById(`fs-delete-${fs.id}`)?.addEventListener("click", () => handleDeleteFlashSale(fs));
    });

    updateCountdownBadges();
}

function renderRow(fs) {
    const status = STATUS_BADGE[fs._status];
    const products = fs.products || [];

    return `
    <tr>
      <td>
        <div class="fs-name-cell__title">${escapeHtml(fs.name || "Chưa đặt tên")}</div>
        <div class="fs-name-cell__sub">${status.label}</div>
      </td>
      <td><span class="fs-product-count">${products.length} sản phẩm</span></td>
      <td>${formatDateTimeShort(fs.startTime)} → ${formatDateTimeShort(fs.endTime)}</td>
      <td><span class="countdown-badge" data-countdown data-start="${fs.startTime}" data-end="${fs.endTime}" data-active="${fs.isActive}">—</span></td>
      <td><span class="badge ${status.badge}">${status.label}</span></td>
      <td>
        <div class="table-actions">
          <button class="icon-action-btn" id="fs-edit-${fs.id}" title="Sửa" aria-label="Sửa">
            <svg viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
          </button>
          <button class="icon-action-btn danger" id="fs-delete-${fs.id}" title="Xóa" aria-label="Xóa">
            <svg viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
}

function formatDateTimeShort(isoLike) {
    const d = new Date(isoLike);
    if (isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
}

/**
 * Cập nhật tất cả badge đếm ngược đang hiển thị trên trang hiện tại
 */
function updateCountdownBadges() {
    document.querySelectorAll("[data-countdown]").forEach((el) => {
        const isActive = el.dataset.active === "true";
        const start = new Date(el.dataset.start);
        const end = new Date(el.dataset.end);
        const now = new Date();

        if (!isActive) {
            el.textContent = "Đã tắt";
            el.className = "countdown-badge countdown-badge--ended";
            return;
        }
        if (now < start) {
            el.textContent = `Bắt đầu sau ${formatDuration(start - now)}`;
            el.className = "countdown-badge countdown-badge--upcoming";
        } else if (now > end) {
            el.textContent = "Đã kết thúc";
            el.className = "countdown-badge countdown-badge--ended";
        } else {
            el.textContent = `Kết thúc sau ${formatDuration(end - now)}`;
            el.className = "countdown-badge";
        }
    });
}

function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = (n) => String(n).padStart(2, "0");
    if (days > 0) return `${days}n ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

// ============================================================
// FORM THÊM / SỬA FLASH SALE
// ============================================================

function openFlashSaleForm(flashSale) {
    const isEdit = !!flashSale;

    // rowValues: productId -> { flashPrice, quantity, sold, productName, originalPrice }
    const rowValues = {};
    (flashSale?.products || []).forEach((p) => {
        rowValues[p.productId] = { ...p };
    });

    const bodyHtml = `
    <form id="fs-form" novalidate>
      <div class="form-grid">
        <div class="form-group form-group--full">
          <label class="form-label" for="fsf-name">Tên chương trình *</label>
          <div class="form-input-wrap">
            <input type="text" id="fsf-name" class="form-input" value="${escapeHtml(flashSale?.name || "")}" />
          </div>
          <div class="form-error" id="fsf-name-error"></div>
        </div>

        <div class="form-group">
          <label class="form-label" for="fsf-start">Thời gian bắt đầu *</label>
          <div class="form-input-wrap">
            <input type="datetime-local" id="fsf-start" class="form-input" value="${toDatetimeLocal(flashSale?.startTime)}" />
          </div>
          <div class="form-error" id="fsf-start-error"></div>
        </div>

        <div class="form-group">
          <label class="form-label" for="fsf-end">Thời gian kết thúc *</label>
          <div class="form-input-wrap">
            <input type="datetime-local" id="fsf-end" class="form-input" value="${toDatetimeLocal(flashSale?.endTime)}" />
          </div>
          <div class="form-error" id="fsf-end-error"></div>
        </div>

        <div class="form-group form-group--full">
          <label class="toggle-switch">
            <input type="checkbox" id="fsf-active" ${(!flashSale || flashSale.isActive) ? "checked" : ""} />
            <span class="toggle-switch__track"></span>
            <span class="toggle-switch__label">Kích hoạt chương trình</span>
          </label>
        </div>

        <div class="form-group form-group--full">
          <label class="form-label">Chọn sản phẩm áp dụng *</label>
          <div class="searchable-picker">
            <div class="searchable-picker__search">
              <input type="text" data-picker-search placeholder="Tìm sản phẩm..." />
            </div>
            <div class="searchable-picker__list" data-picker-list></div>
          </div>
          <div class="form-error" id="fsf-products-error"></div>
        </div>

        <div class="form-group form-group--full">
          <label class="form-label">Giá Flash &amp; số lượng từng sản phẩm</label>
          <div id="fsf-rows"></div>
          <div class="form-error" id="fsf-rows-error"></div>
        </div>
      </div>
    </form>
  `;

    openFormModal({
        title: isEdit ? "Sửa chương trình Flash Sale" : "Thêm chương trình Flash Sale",
        bodyHtml,
        wide: true,
        onMount: (root) => {
            const rowsEl = root.querySelector("#fsf-rows");

            function renderRows() {
                const ids = Object.keys(rowValues);
                if (ids.length === 0) {
                    rowsEl.innerHTML = `<div class="empty-state__desc" style="padding: 10px 0;">Chưa chọn sản phẩm nào.</div>`;
                    return;
                }
                rowsEl.innerHTML = ids
                    .map((pid) => {
                        const row = rowValues[pid];
                        return `
            <div class="fs-product-row" data-row-id="${pid}">
              <div class="fs-product-row__name">${escapeHtml(row.productName)}</div>
              <input type="number" min="0" step="1000" placeholder="Giá Flash" data-row-field="flashPrice" data-row-id="${pid}" value="${row.flashPrice ?? ""}" />
              <input type="number" min="0" step="1" placeholder="Số lượng" data-row-field="quantity" data-row-id="${pid}" value="${row.quantity ?? ""}" />
              <button type="button" data-row-remove="${pid}" class="icon-action-btn danger" style="width:32px;height:32px;" title="Bỏ chọn">
                <svg viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
              </button>
            </div>`;
                    })
                    .join("");

                rowsEl.querySelectorAll("[data-row-field]").forEach((input) => {
                    input.addEventListener("input", () => {
                        const pid = input.dataset.rowId;
                        rowValues[pid][input.dataset.rowField] = Number(input.value);
                    });
                });

                rowsEl.querySelectorAll("[data-row-remove]").forEach((btn) => {
                    btn.addEventListener("click", () => {
                        const pid = btn.dataset.rowRemove;
                        delete rowValues[pid];
                        const checkbox = root.querySelector(`[data-picker-id="${pid}"]`);
                        if (checkbox) {
                            checkbox.checked = false;
                            checkbox.dispatchEvent(new Event("change"));
                        }
                        renderRows();
                    });
                });
            }

            createSearchablePicker({
                container: root.querySelector(".searchable-picker"),
                items: allProducts,
                getId: (p) => p.id,
                getLabel: (p) => p.name || "(Không tên)",
                getSub: (p) => `SKU: ${p.sku || "—"} · ${formatCurrency(Number(p.price) || 0)}`,
                initialSelectedIds: Object.keys(rowValues),
                onChange: (selectedIds) => {
                    // Thêm dòng mới cho sản phẩm vừa chọn
                    selectedIds.forEach((pid) => {
                        if (!rowValues[pid]) {
                            const product = allProducts.find((p) => p.id === pid);
                            rowValues[pid] = {
                                productId: pid,
                                productName: product?.name || "",
                                originalPrice: Number(product?.price) || 0,
                                flashPrice: Number(product?.salePrice) || Number(product?.price) || 0,
                                quantity: 10,
                                sold: rowValues[pid]?.sold || 0,
                            };
                        }
                    });
                    // Xóa dòng của sản phẩm vừa bỏ chọn
                    Object.keys(rowValues).forEach((pid) => {
                        if (!selectedIds.includes(pid)) delete rowValues[pid];
                    });
                    renderRows();
                },
            });

            renderRows();

            const footer = document.createElement("div");
            footer.className = "modal-form__footer";
            footer.innerHTML = `
        <button type="button" class="btn btn--ghost" id="fsf-cancel">Hủy</button>
        <button type="button" class="btn btn--primary" id="fsf-submit">${isEdit ? "Lưu thay đổi" : "Thêm chương trình"}</button>
      `;
            root.querySelector(".modal-box--form").appendChild(footer);

            footer.querySelector("#fsf-cancel").addEventListener("click", () => closeFormModal());
            footer.querySelector("#fsf-submit").addEventListener("click", () =>
                submitFlashSaleForm({ root, flashSale, isEdit, rowValues })
            );
        },
    });
}

/**
 * Chuyển ISO string / Date đã lưu thành giá trị hợp lệ cho input[type=datetime-local]
 */
function toDatetimeLocal(value) {
    if (!value) return "";
    const d = new Date(value);
    if (isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function submitFlashSaleForm({ root, flashSale, isEdit, rowValues }) {
    const name = root.querySelector("#fsf-name").value.trim();
    const startTime = root.querySelector("#fsf-start").value;
    const endTime = root.querySelector("#fsf-end").value;
    const isActive = root.querySelector("#fsf-active").checked;
    const products = Object.values(rowValues);

    if (!validateFlashSaleForm({ name, startTime, endTime, products })) return;

    const submitBtn = root.querySelector("#fsf-submit");
    setButtonLoading(submitBtn, true, "Đang lưu...");

    const data = {
        name,
        startTime: new Date(startTime).toISOString(),
        endTime: new Date(endTime).toISOString(),
        isActive,
        products,
        updatedAt: serverTimestamp(),
    };

    try {
        if (isEdit) {
            await updateDoc(doc(db, "flashSales", flashSale.id), data);
        } else {
            await addDoc(collection(db, "flashSales"), { ...data, createdAt: serverTimestamp() });
        }
        showToast(isEdit ? "Đã cập nhật chương trình." : "Đã thêm chương trình Flash Sale.", "success");
        closeFormModal();
        await loadFlashSales();
    } catch (err) {
        console.error("Lỗi lưu Flash Sale:", err);
        showToast("Không thể lưu chương trình. Vui lòng thử lại.", "error");
    } finally {
        setButtonLoading(submitBtn, false);
    }
}

function validateFlashSaleForm({ name, startTime, endTime, products }) {
    let isValid = true;
    const setErr = (id, msg) => {
        const el = document.getElementById(id);
        if (el) {
            el.textContent = msg;
            el.classList.toggle("is-visible", !!msg);
        }
    };

    if (!name) {
        setErr("fsf-name-error", "Vui lòng nhập tên chương trình.");
        isValid = false;
    } else setErr("fsf-name-error", "");

    if (!startTime) {
        setErr("fsf-start-error", "Vui lòng chọn thời gian bắt đầu.");
        isValid = false;
    } else setErr("fsf-start-error", "");

    if (!endTime) {
        setErr("fsf-end-error", "Vui lòng chọn thời gian kết thúc.");
        isValid = false;
    } else if (startTime && endTime <= startTime) {
        setErr("fsf-end-error", "Thời gian kết thúc phải sau thời gian bắt đầu.");
        isValid = false;
    } else setErr("fsf-end-error", "");

    if (products.length === 0) {
        setErr("fsf-products-error", "Vui lòng chọn ít nhất 1 sản phẩm.");
        isValid = false;
    } else setErr("fsf-products-error", "");

    const invalidRow = products.some(
        (p) => !Number.isFinite(p.flashPrice) || p.flashPrice <= 0 || !Number.isInteger(p.quantity) || p.quantity <= 0
    );
    if (invalidRow) {
        setErr("fsf-rows-error", "Giá Flash và số lượng của mỗi sản phẩm phải là số dương hợp lệ.");
        isValid = false;
    } else setErr("fsf-rows-error", "");

    return isValid;
}

// ============================================================
// XÓA FLASH SALE
// ============================================================

async function handleDeleteFlashSale(flashSale) {
    const confirmed = await showConfirmModal({
        title: "Xóa chương trình Flash Sale",
        message: `Xóa vĩnh viễn chương trình "${flashSale.name}"? Hành động này không thể hoàn tác.`,
        confirmText: "Xóa",
        danger: true,
    });
    if (!confirmed) return;

    try {
        await deleteDoc(doc(db, "flashSales", flashSale.id));
        showToast("Đã xóa chương trình.", "success");
        await loadFlashSales();
    } catch (err) {
        console.error("Lỗi xóa Flash Sale:", err);
        showToast("Không thể xóa chương trình. Vui lòng thử lại.", "error");
    }
}