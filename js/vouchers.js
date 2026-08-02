// ============================================================
// vouchers.js
// Điều khiển trang Quản lý Voucher:
// - Bảo vệ route + load voucher / sản phẩm / khách hàng
// - Search / Filter trạng thái / Phân trang (client-side)
// - CRUD voucher qua Modal Form, chọn phạm vi áp dụng (Toàn bộ /
//   Theo sản phẩm / Theo khách hàng) bằng bộ chọn tìm-kiếm (select-picker.js)
// - Bật/Tắt nhanh ngay trong bảng
// ============================================================

import { db } from "../firebase/firebase-config.js";
import {
    collection,
    query,
    orderBy,
    where,
    getDocs,
    doc,
    addDoc,
    updateDoc,
    deleteDoc,
    serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { formatCurrency, formatDate, escapeHtml, debounce, setButtonLoading } from "./helpers.js";
import { showToast } from "./toast.js";
import { showConfirmModal } from "./modal.js";
import { filterBySearch, sortItems, paginate, renderPaginationControls } from "./list-utils.js";
import { openFormModal, closeFormModal } from "./form-modal.js";
import { createSearchablePicker } from "./select-picker.js";

const PAGE_SIZE = 8;

const SCOPE_LABEL = {
    all: "Toàn bộ đơn hàng",
    products: "Theo sản phẩm",
    customers: "Theo khách hàng",
};

let allVouchers = [];
let allProducts = [];
let allCustomers = [];
let currentPage = 1;
let lastFilteredResult = [];

// "let" thay vì "const": các phần tử nằm trong ".main", bị thay thế mỗi khi
// router SPA điều hướng sang trang khác rồi quay lại -> phải query lại (cacheDom()).
let tbody, searchInput, statusSelect, countShownEl, countTotalEl;
let paginationInfo, paginationControls, btnAddVoucher;

function cacheDom() {
    tbody = document.getElementById("vouchers-table-body");
    searchInput = document.getElementById("voucher-search");
    statusSelect = document.getElementById("voucher-filter-status");
    countShownEl = document.getElementById("voucher-count-shown");
    countTotalEl = document.getElementById("voucher-count-total");
    paginationInfo = document.getElementById("pagination-info");
    paginationControls = document.getElementById("pagination-controls");
    btnAddVoucher = document.getElementById("btn-add-voucher");
}

/**
 * Gắn sự kiện cho các phần tử tĩnh của trang. Phải gọi lại mỗi lần trang
 * hiển thị vì các phần tử DOM là bản mới (SPA swap).
 */
function bindStaticEvents() {
    searchInput.addEventListener("input", debounce(() => applyFiltersAndRender(), 300));
    statusSelect.addEventListener("change", () => applyFiltersAndRender());
    btnAddVoucher.addEventListener("click", () => openVoucherForm(null));
}

/**
 * Được spa-router.js gọi mỗi khi trang Voucher được hiển thị.
 */
export function initPage() {
    cacheDom();
    bindStaticEvents();
    bootstrap();
}

async function bootstrap() {
    await Promise.all([loadVouchers(), loadProductsAndCustomers()]);
}

async function loadProductsAndCustomers() {
    try {
        const [productsSnap, customersSnap] = await Promise.all([
            getDocs(collection(db, "products")),
            getDocs(collection(db, "customers")),
        ]);
        allProducts = productsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        allCustomers = customersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (err) {
        console.error("Lỗi tải sản phẩm/khách hàng:", err);
    }
}

async function loadVouchers() {
    try {
        const q = query(collection(db, "vouchers"), orderBy("createdAt", "desc"));
        const snap = await getDocs(q);
        allVouchers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        applyFiltersAndRender();
    } catch (err) {
        console.error("Lỗi tải danh sách voucher:", err);
        showToast("Không thể tải danh sách voucher.", "error");
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color: var(--color-danger);">Không thể tải dữ liệu.</td></tr>`;
    }
}

/**
 * Tính trạng thái hiển thị của voucher: active / inactive / expired
 */
function computeStatus(v) {
    if (!v.isActive) return "inactive";
    if (v.endDate) {
        // Hết hạn vào CUỐI ngày endDate theo giờ địa phương (23:59:59),
        // KHÔNG phải đầu ngày UTC (00:00:00) như trước đây. Trước đây
        // new Date("2026-08-02") bị hiểu là 00:00 UTC = 07:00 sáng giờ VN
        // ngày 02/08, khiến voucher bị coi "hết hạn" sớm hơn dự kiến gần
        // 7 tiếng ngay trong ngày cuối cùng còn hiệu lực.
        const endOfDay = new Date(`${v.endDate}T23:59:59`);
        if (endOfDay < new Date()) return "expired";
    }
    return "active";
}

const STATUS_BADGE = {
    active: { label: "Đang bật", badge: "badge--success" },
    inactive: { label: "Đang tắt", badge: "badge--neutral" },
    expired: { label: "Đã hết hạn", badge: "badge--danger" },
};

function applyFiltersAndRender() {
    let result = allVouchers.map((v) => ({ ...v, _status: computeStatus(v) }));
    result = filterBySearch(result, searchInput.value, ["code"]);
    if (statusSelect.value !== "all") {
        result = result.filter((v) => v._status === statusSelect.value);
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
      <tr><td colspan="7">
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none"><path d="M20.59 13.41L11 3.83A2 2 0 009.59 3.24H4a1 1 0 00-1 1v5.59a2 2 0 00.59 1.41l9.58 9.59a2 2 0 002.83 0l5.59-5.59a2 2 0 000-2.83z" stroke="currentColor" stroke-width="2"/></svg>
          <div class="empty-state__title">Không tìm thấy voucher</div>
          <div class="empty-state__desc">Thử thay đổi từ khóa hoặc bộ lọc.</div>
        </div>
      </td></tr>`;
        return;
    }

    tbody.innerHTML = items.map(renderRow).join("");

    items.forEach((v) => {
        document.getElementById(`v-edit-${v.id}`)?.addEventListener("click", () => openVoucherForm(v));
        document.getElementById(`v-delete-${v.id}`)?.addEventListener("click", () => handleDeleteVoucher(v));
        document.getElementById(`v-toggle-${v.id}`)?.addEventListener("change", (e) => toggleVoucherActive(v, e.target.checked));
    });
}

function renderRow(v) {
    const status = STATUS_BADGE[v._status];
    const valueLabel =
        v.discountType === "percent"
            ? `${v.value}%${v.maxDiscount ? ` (tối đa ${formatCurrency(Number(v.maxDiscount))})` : ""}`
            : formatCurrency(Number(v.value) || 0);

    const targetCount = (v.applyTargets || []).length;
    const scopeLabel = SCOPE_LABEL[v.applyScope] || "Toàn bộ đơn hàng";

    const usageLabel = v.usageLimit
        ? `${(v.usedCount || 0).toLocaleString("vi-VN")} / ${v.usageLimit.toLocaleString("vi-VN")}`
        : `${(v.usedCount || 0).toLocaleString("vi-VN")} / Không giới hạn`;

    return `
    <tr>
      <td><span class="voucher-code">${escapeHtml(v.code || "")}</span></td>
      <td>${valueLabel}</td>
      <td>
        ${scopeLabel}
        ${v.applyScope !== "all" ? `<div class="voucher-scope-tag">${targetCount} mục</div>` : ""}
      </td>
      <td>${v.startDate ? formatSimpleDate(v.startDate) : "—"} → ${v.endDate ? formatSimpleDate(v.endDate) : "—"}</td>
      <td>${usageLabel}</td>
      <td>
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="badge ${status.badge}">${status.label}</span>
          <label class="toggle-switch" title="Bật/Tắt voucher">
            <input type="checkbox" id="v-toggle-${v.id}" ${v.isActive ? "checked" : ""} />
            <span class="toggle-switch__track"></span>
          </label>
        </div>
      </td>
      <td>
        <div class="table-actions">
          <button class="icon-action-btn" id="v-edit-${v.id}" title="Sửa" aria-label="Sửa">
            <svg viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
          </button>
          <button class="icon-action-btn danger" id="v-delete-${v.id}" title="Xóa" aria-label="Xóa">
            <svg viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
}

function formatSimpleDate(isoDateStr) {
    const d = new Date(isoDateStr);
    if (isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

/**
 * Bật/tắt nhanh voucher từ bảng (toggle switch)
 */
async function toggleVoucherActive(voucher, checked) {
    try {
        await updateDoc(doc(db, "vouchers", voucher.id), { isActive: checked, updatedAt: serverTimestamp() });
        voucher.isActive = checked;
        showToast(checked ? "Đã bật voucher." : "Đã tắt voucher.", "success");
        applyFiltersAndRender();
    } catch (err) {
        console.error("Lỗi cập nhật trạng thái voucher:", err);
        showToast("Không thể cập nhật trạng thái voucher.", "error");
        applyFiltersAndRender(); // revert UI
    }
}

// ============================================================
// FORM THÊM / SỬA VOUCHER
// ============================================================

function openVoucherForm(voucher) {
    const isEdit = !!voucher;

    const bodyHtml = `
    <form id="voucher-form" novalidate>
      <div class="form-grid">
        <div class="form-group">
          <label class="form-label" for="vf-code">Mã voucher *</label>
          <div class="form-input-wrap">
            <input type="text" id="vf-code" class="form-input" style="text-transform:uppercase;" value="${escapeHtml(voucher?.code || "")}" />
          </div>
          <div class="form-error" id="vf-code-error"></div>
        </div>

        <div class="form-group">
          <label class="form-label" for="vf-type">Loại giảm giá *</label>
          <select id="vf-type" class="filter-select" style="width:100%;">
            <option value="percent" ${(!voucher || voucher.discountType === "percent") ? "selected" : ""}>Phần trăm (%)</option>
            <option value="fixed" ${voucher?.discountType === "fixed" ? "selected" : ""}>Số tiền cố định (₫)</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label" for="vf-value">Giá trị giảm *</label>
          <div class="form-input-wrap">
            <input type="number" min="0" step="1" id="vf-value" class="form-input" value="${voucher?.value ?? ""}" />
          </div>
          <div class="form-error" id="vf-value-error"></div>
        </div>

        <div class="form-group" id="vf-max-discount-group">
          <label class="form-label" for="vf-max-discount">Giảm tối đa (₫)</label>
          <div class="form-input-wrap">
            <input type="number" min="0" step="1000" id="vf-max-discount" class="form-input" value="${voucher?.maxDiscount ?? ""}" />
          </div>
          <div class="form-hint">Chỉ áp dụng cho loại % — bỏ trống nếu không giới hạn.</div>
        </div>

        <div class="form-group">
          <label class="form-label" for="vf-min-order">Giá trị đơn tối thiểu (₫)</label>
          <div class="form-input-wrap">
            <input type="number" min="0" step="1000" id="vf-min-order" class="form-input" value="${voucher?.minOrderValue ?? 0}" />
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" for="vf-usage-limit">Giới hạn số lượt dùng</label>
          <div class="form-input-wrap">
            <input type="number" min="0" step="1" id="vf-usage-limit" class="form-input" value="${voucher?.usageLimit ?? ""}" />
          </div>
          <div class="form-hint">Bỏ trống = không giới hạn.</div>
        </div>

        <div class="form-group">
          <label class="form-label" for="vf-start-date">Ngày bắt đầu *</label>
          <div class="form-input-wrap">
            <input type="date" id="vf-start-date" class="form-input" value="${voucher?.startDate || ""}" />
          </div>
          <div class="form-error" id="vf-start-date-error"></div>
        </div>

        <div class="form-group">
          <label class="form-label" for="vf-end-date">Ngày kết thúc *</label>
          <div class="form-input-wrap">
            <input type="date" id="vf-end-date" class="form-input" value="${voucher?.endDate || ""}" />
          </div>
          <div class="form-error" id="vf-end-date-error"></div>
        </div>

        <div class="form-group form-group--full">
          <label class="toggle-switch">
            <input type="checkbox" id="vf-active" ${(!voucher || voucher.isActive) ? "checked" : ""} />
            <span class="toggle-switch__track"></span>
            <span class="toggle-switch__label">Bật voucher này ngay sau khi lưu</span>
          </label>
        </div>

        <div class="form-group form-group--full">
          <label class="form-label" for="vf-scope">Phạm vi áp dụng *</label>
          <select id="vf-scope" class="filter-select" style="width:100%;">
            <option value="all" ${(!voucher || voucher.applyScope === "all") ? "selected" : ""}>Toàn bộ đơn hàng</option>
            <option value="products" ${voucher?.applyScope === "products" ? "selected" : ""}>Theo sản phẩm cụ thể</option>
            <option value="customers" ${voucher?.applyScope === "customers" ? "selected" : ""}>Theo khách hàng cụ thể</option>
          </select>
        </div>

        <div class="form-group form-group--full" id="vf-picker-group" style="display:none;">
          <label class="form-label" id="vf-picker-label">Chọn mục áp dụng</label>
          <div class="searchable-picker">
            <div class="searchable-picker__search">
              <input type="text" data-picker-search placeholder="Tìm kiếm..." />
            </div>
            <div class="searchable-picker__list" data-picker-list></div>
          </div>
          <div class="chip-list" id="vf-picker-chips"></div>
          <div class="form-error" id="vf-targets-error"></div>
        </div>
      </div>
    </form>
  `;

    let picker = null;

    const modal = openFormModal({
        title: isEdit ? "Sửa voucher" : "Thêm voucher",
        bodyHtml,
        wide: true,
        onMount: (root) => {
            const typeSelect = root.querySelector("#vf-type");
            const maxDiscountGroup = root.querySelector("#vf-max-discount-group");
            const scopeSelect = root.querySelector("#vf-scope");
            const pickerGroup = root.querySelector("#vf-picker-group");
            const pickerLabel = root.querySelector("#vf-picker-label");
            const pickerContainer = root.querySelector(".searchable-picker");
            const chipsEl = root.querySelector("#vf-picker-chips");

            const toggleMaxDiscountVisibility = () => {
                maxDiscountGroup.style.display = typeSelect.value === "percent" ? "" : "none";
            };
            typeSelect.addEventListener("change", toggleMaxDiscountVisibility);
            toggleMaxDiscountVisibility();

            const mountPicker = (scope) => {
                if (scope === "all") {
                    pickerGroup.style.display = "none";
                    picker = null;
                    return;
                }
                pickerGroup.style.display = "";
                pickerLabel.textContent = scope === "products" ? "Chọn sản phẩm áp dụng" : "Chọn khách hàng áp dụng";
                const dataset = scope === "products" ? allProducts : allCustomers;
                picker = createSearchablePicker({
                    container: pickerContainer,
                    chipListEl: chipsEl,
                    items: dataset,
                    getId: (it) => it.id,
                    getLabel: (it) => (scope === "products" ? it.name : it.fullName) || "(Không tên)",
                    getSub: (it) => (scope === "products" ? `SKU: ${it.sku || "—"}` : it.email || ""),
                    initialSelectedIds: isEdit && voucher.applyScope === scope ? voucher.applyTargets || [] : [],
                });
            };

            scopeSelect.addEventListener("change", () => mountPicker(scopeSelect.value));
            mountPicker(scopeSelect.value);

            const footer = document.createElement("div");
            footer.className = "modal-form__footer";
            footer.innerHTML = `
        <button type="button" class="btn btn--ghost" id="vf-cancel">Hủy</button>
        <button type="button" class="btn btn--primary" id="vf-submit">${isEdit ? "Lưu thay đổi" : "Thêm voucher"}</button>
      `;
            root.querySelector(".modal-box--form").appendChild(footer);

            footer.querySelector("#vf-cancel").addEventListener("click", () => closeFormModal());
            footer.querySelector("#vf-submit").addEventListener("click", () =>
                submitVoucherForm({ root, voucher, isEdit, getPicker: () => picker })
            );
        },
    });
}

async function submitVoucherForm({ root, voucher, isEdit, getPicker }) {
    const code = root.querySelector("#vf-code").value.trim().toUpperCase();
    const discountType = root.querySelector("#vf-type").value;
    const value = Number(root.querySelector("#vf-value").value);
    const maxDiscountRaw = root.querySelector("#vf-max-discount").value;
    const maxDiscount = maxDiscountRaw === "" ? null : Number(maxDiscountRaw);
    const minOrderValue = Number(root.querySelector("#vf-min-order").value) || 0;
    const usageLimitRaw = root.querySelector("#vf-usage-limit").value;
    const usageLimit = usageLimitRaw === "" ? null : Number(usageLimitRaw);
    const startDate = root.querySelector("#vf-start-date").value;
    const endDate = root.querySelector("#vf-end-date").value;
    const isActive = root.querySelector("#vf-active").checked;
    const applyScope = root.querySelector("#vf-scope").value;
    const picker = getPicker();
    const applyTargets = applyScope === "all" ? [] : (picker ? picker.getSelectedIds() : []);

    if (!validateVoucherForm({ code, value, discountType, startDate, endDate, applyScope, applyTargets, voucherId: isEdit ? voucher.id : null })) {
        return;
    }

    const submitBtn = root.querySelector("#vf-submit");
    setButtonLoading(submitBtn, true, "Đang lưu...");

    const data = {
        code,
        discountType,
        value,
        maxDiscount: discountType === "percent" ? maxDiscount : null,
        minOrderValue,
        usageLimit,
        startDate,
        endDate,
        isActive,
        applyScope,
        applyTargets,
        updatedAt: serverTimestamp(),
    };

    try {
        if (isEdit) {
            await updateDoc(doc(db, "vouchers", voucher.id), data);
        } else {
            await addDoc(collection(db, "vouchers"), { ...data, usedCount: 0, createdAt: serverTimestamp() });
        }
        showToast(isEdit ? "Đã cập nhật voucher." : "Đã thêm voucher mới.", "success");
        closeFormModal();
        await loadVouchers();
    } catch (err) {
        console.error("Lỗi lưu voucher:", err);
        showToast("Không thể lưu voucher. Vui lòng thử lại.", "error");
    } finally {
        setButtonLoading(submitBtn, false);
    }
}

function validateVoucherForm({ code, value, discountType, startDate, endDate, applyScope, applyTargets, voucherId }) {
    let isValid = true;
    const setErr = (id, msg) => {
        const el = document.getElementById(id);
        if (el) {
            el.textContent = msg;
            el.classList.toggle("is-visible", !!msg);
        }
    };

    if (!code) {
        setErr("vf-code-error", "Vui lòng nhập mã voucher.");
        isValid = false;
    } else if (allVouchers.some((v) => v.code === code && v.id !== voucherId)) {
        setErr("vf-code-error", "Mã voucher này đã tồn tại.");
        isValid = false;
    } else setErr("vf-code-error", "");

    if (!Number.isFinite(value) || value <= 0) {
        setErr("vf-value-error", "Giá trị giảm phải lớn hơn 0.");
        isValid = false;
    } else if (discountType === "percent" && value > 100) {
        setErr("vf-value-error", "Phần trăm giảm không được vượt quá 100%.");
        isValid = false;
    } else setErr("vf-value-error", "");

    if (!startDate) {
        setErr("vf-start-date-error", "Vui lòng chọn ngày bắt đầu.");
        isValid = false;
    } else setErr("vf-start-date-error", "");

    if (!endDate) {
        setErr("vf-end-date-error", "Vui lòng chọn ngày kết thúc.");
        isValid = false;
    } else if (startDate && endDate < startDate) {
        setErr("vf-end-date-error", "Ngày kết thúc phải sau ngày bắt đầu.");
        isValid = false;
    } else setErr("vf-end-date-error", "");

    if (applyScope !== "all" && applyTargets.length === 0) {
        setErr("vf-targets-error", `Vui lòng chọn ít nhất 1 ${applyScope === "products" ? "sản phẩm" : "khách hàng"}.`);
        isValid = false;
    } else setErr("vf-targets-error", "");

    return isValid;
}

// ============================================================
// XÓA VOUCHER
// ============================================================

async function handleDeleteVoucher(voucher) {
    const confirmed = await showConfirmModal({
        title: "Xóa voucher",
        message: `Xóa vĩnh viễn voucher "${voucher.code}"? Hành động này không thể hoàn tác.`,
        confirmText: "Xóa",
        danger: true,
    });
    if (!confirmed) return;

    try {
        await deleteDoc(doc(db, "vouchers", voucher.id));
        showToast("Đã xóa voucher.", "success");
        await loadVouchers();
    } catch (err) {
        console.error("Lỗi xóa voucher:", err);
        showToast("Không thể xóa voucher. Vui lòng thử lại.", "error");
    }
}

export async function fetchMyVouchersDirect(customerId = null) {
    const q = query(collection(db, "vouchers"), where("isActive", "==", true));
    const snap = await getDocs(q);
    const now = new Date();

    return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((v) => {
            if (v.startDate && new Date(v.startDate) > now) return false;
            if (v.endDate && new Date(v.endDate) < now) return false;
            if (typeof v.usageLimit === "number" && (v.usedCount || 0) >= v.usageLimit) return false;
            if (v.applyScope === "customers") {
                return !!customerId && (v.applyTargets || []).includes(customerId);
            }
            return true;
        })
        .map((v) => ({
            id: v.id,
            code: v.code,
            discountType: v.discountType,
            value: v.value,
            maxDiscount: v.maxDiscount ?? null,
            minOrderValue: v.minOrderValue || 0,
            applyScope: v.applyScope || "all",
            applyTargets: v.applyScope === "products" ? v.applyTargets || [] : [],
            startDate: v.startDate || null,
            endDate: v.endDate || null,
            usageLimit: v.usageLimit ?? null,
            usedCount: v.usedCount || 0,
        }));
}

export async function validateVoucherClient({ code, orderTotal, productIds = [], customerId }) {
    if (!code || typeof orderTotal !== "number") {
        throw new Error("Thiếu mã voucher hoặc tổng giá trị đơn hàng.");
    }

    // Lưu ý: PHẢI có where("isActive","==",true) ở đây, không chỉ lọc bằng JS
    // sau khi fetch — vì rule Firestore cho "list" chỉ cho qua khi điều kiện
    // resource.data.isActive == true được chính where() của query đảm bảo.
    // Thiếu filter này, Firestore sẽ từ chối toàn bộ query với lỗi
    // "Missing or insufficient permissions" ngay cả khi voucher đang active.
    const q = query(
        collection(db, "vouchers"),
        where("code", "==", String(code).toUpperCase()),
        where("isActive", "==", true)
    );
    const snap = await getDocs(q);
    if (snap.empty) throw new Error("Mã voucher không tồn tại hoặc hiện không còn hoạt động.");

    const voucherDoc = snap.docs[0];
    const v = voucherDoc.data();

    const now = new Date();
    if (v.startDate && now < new Date(v.startDate)) throw new Error("Mã voucher chưa tới ngày áp dụng.");
    if (v.endDate && now > new Date(v.endDate)) throw new Error("Mã voucher đã hết hạn.");
    if (typeof v.usageLimit === "number" && (v.usedCount || 0) >= v.usageLimit) {
        throw new Error("Mã voucher đã hết lượt sử dụng.");
    }
    if (v.minOrderValue && orderTotal < v.minOrderValue) {
        throw new Error(`Đơn hàng cần tối thiểu ${Number(v.minOrderValue).toLocaleString("vi-VN")} ₫ để áp dụng mã này.`);
    }
    if (v.applyScope === "products") {
        const targets = new Set(v.applyTargets || []);
        if (!productIds.some((id) => targets.has(id))) {
            throw new Error("Mã voucher không áp dụng cho sản phẩm trong giỏ hàng.");
        }
    } else if (v.applyScope === "customers") {
        const targets = new Set(v.applyTargets || []);
        if (!customerId || !targets.has(customerId)) {
            throw new Error("Mã voucher không áp dụng cho tài khoản của bạn.");
        }
    }

    let discount = v.discountType === "percent" ? (orderTotal * Number(v.value || 0)) / 100 : Number(v.value || 0);
    if (v.discountType === "percent" && v.maxDiscount) discount = Math.min(discount, Number(v.maxDiscount));
    discount = Math.min(discount, orderTotal);

    return {
        valid: true,
        discount: Math.round(discount),
        voucher: { id: voucherDoc.id, code: v.code, discountType: v.discountType, value: v.value },
    };
}

// Gọi hàm này lúc khách bấm "Đặt hàng" thành công, để tăng usedCount.
export async function incrementVoucherUsage(voucherId) {
    const ref = doc(db, "vouchers", voucherId);
    await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const current = snap.data().usedCount || 0;
        tx.update(ref, { usedCount: current + 1 });
    });
}