// ============================================================
// shipping.js
// Điều khiển trang Quản lý Phí Ship (admin/shipping.html):
// - Load / Search / Filter theo Tỉnh-Thành / Phân trang (client-side)
// - CRUD khu vực (Tỉnh/Thành + Quận/Huyện + Phí ship) qua Modal Form
// - Import hàng loạt từ file Excel (.xlsx/.xls) bằng SheetJS (window.XLSX,
//   nạp qua thẻ <script> CDN trong shipping.html)
// - Dữ liệu ghi vào collection Firestore "shippingFees", cùng collection
//   mà js/checkout.js (Frontend Shop) đọc để hiển thị phí ship khi đặt hàng
//   (xem firebase/firestore-service.js: getShippingProvinces/getShippingDistricts).
// ============================================================

import { db } from "../firebase/firebase-config.js";
import {
    collection,
    getDocs,
    doc,
    addDoc,
    updateDoc,
    deleteDoc,
    writeBatch,
    serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { formatCurrency, escapeHtml, debounce, setButtonLoading } from "./helpers.js";
import { showToast } from "./toast.js";
import { showConfirmModal } from "./modal.js";
import { filterBySearch, filterByField, sortItems, paginate, renderPaginationControls } from "./list-utils.js";
import { openFormModal, closeFormModal } from "./form-modal.js";

const PAGE_SIZE = 10;

let allShippingFees = [];
let currentPage = 1;
let lastFilteredResult = [];

// "let" thay vì "const": các phần tử nằm trong ".main", bị thay thế mỗi khi
// router SPA điều hướng sang trang khác rồi quay lại -> phải query lại (cacheDom()).
let tbody, searchInput, provinceSelect, countShownEl, countTotalEl;
let paginationInfo, paginationControls, btnAddShipping;
let importInput, btnImportExcel;

function cacheDom() {
    tbody = document.getElementById("ship-table-body");
    searchInput = document.getElementById("ship-search");
    provinceSelect = document.getElementById("ship-filter-province");
    countShownEl = document.getElementById("ship-count-shown");
    countTotalEl = document.getElementById("ship-count-total");
    paginationInfo = document.getElementById("pagination-info");
    paginationControls = document.getElementById("pagination-controls");
    btnAddShipping = document.getElementById("btn-add-shipping");
    importInput = document.getElementById("ship-import-file");
    btnImportExcel = document.getElementById("btn-import-excel");
}

/**
 * Gắn sự kiện cho các phần tử tĩnh của trang. Phải gọi lại mỗi lần trang
 * hiển thị vì các phần tử DOM là bản mới (SPA swap).
 */
function bindStaticEvents() {
    searchInput.addEventListener("input", debounce(() => applyFiltersAndRender(), 300));
    provinceSelect.addEventListener("change", () => applyFiltersAndRender());
    btnAddShipping.addEventListener("click", () => openShippingForm(null));
    btnImportExcel.addEventListener("click", () => importInput.click());
    importInput.addEventListener("change", handleImportExcel);
}

/**
 * Được spa-router.js gọi mỗi khi trang Phí Ship được hiển thị.
 */
export function initPage() {
    cacheDom();
    bindStaticEvents();
    bootstrap();
}

async function bootstrap() {
    await loadShippingFees();
}

async function loadShippingFees() {
    try {
        const snap = await getDocs(collection(db, "shippingFees"));
        allShippingFees = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        populateProvinceFilter();
        applyFiltersAndRender();
    } catch (err) {
        console.error("Lỗi tải danh sách phí ship:", err);
        showToast("Không thể tải danh sách phí ship.", "error");
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color: var(--color-danger);">Không thể tải dữ liệu.</td></tr>`;
    }
}

/**
 * Đổ danh sách Tỉnh/Thành (không trùng lặp) vào dropdown filter, giữ lại
 * lựa chọn hiện tại nếu vẫn còn hợp lệ sau khi tải lại dữ liệu.
 */
function populateProvinceFilter() {
    const current = provinceSelect.value || "all";
    const provinces = Array.from(new Set(allShippingFees.map((s) => s.province).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b, "vi")
    );
    provinceSelect.innerHTML =
        `<option value="all">Tất cả Tỉnh/Thành</option>` +
        provinces.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("");
    provinceSelect.value = provinces.includes(current) ? current : "all";
}

function applyFiltersAndRender() {
    let result = filterBySearch(allShippingFees, searchInput.value, ["province", "district"]);
    result = filterByField(result, "province", provinceSelect.value);
    result = sortItems(result, "province", "asc", "string");
    result = groupSortByDistrict(result);

    currentPage = 1;
    lastFilteredResult = result;
    renderCurrentPage();
}

/**
 * sortItems() chỉ sắp theo 1 field; sau khi đã sắp theo "province", sắp
 * tiếp theo "district" trong phạm vi từng tỉnh để danh sách dễ nhìn hơn.
 */
function groupSortByDistrict(items) {
    return [...items].sort((a, b) => {
        const p = String(a.province || "").localeCompare(String(b.province || ""), "vi");
        if (p !== 0) return p;
        return String(a.district || "").localeCompare(String(b.district || ""), "vi");
    });
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
      <tr><td colspan="4">
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none"><path d="M20.59 13.41L11 3.83A2 2 0 009.59 3.24H4a1 1 0 00-1 1v5.59a2 2 0 00.59 1.41l9.58 9.59a2 2 0 002.83 0l5.59-5.59a2 2 0 000-2.83z" stroke="currentColor" stroke-width="2"/></svg>
          <div class="empty-state__title">Chưa có khu vực nào</div>
          <div class="empty-state__desc">Thêm khu vực mới hoặc import từ Excel.</div>
        </div>
      </td></tr>`;
        return;
    }

    tbody.innerHTML = items.map(renderRow).join("");

    items.forEach((s) => {
        document.getElementById(`s-edit-${s.id}`)?.addEventListener("click", () => openShippingForm(s));
        document.getElementById(`s-delete-${s.id}`)?.addEventListener("click", () => handleDeleteShipping(s));
    });
}

function renderRow(s) {
    return `
    <tr>
      <td>${escapeHtml(s.province || "")}</td>
      <td>${escapeHtml(s.district || "")}</td>
      <td>${formatCurrency(Number(s.fee) || 0)}</td>
      <td>
        <div class="table-actions">
          <button class="icon-action-btn" id="s-edit-${s.id}" title="Sửa" aria-label="Sửa">
            <svg viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
          </button>
          <button class="icon-action-btn danger" id="s-delete-${s.id}" title="Xóa" aria-label="Xóa">
            <svg viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
}

// ============================================================
// FORM THÊM / SỬA KHU VỰC
// ============================================================

function openShippingForm(item) {
    const isEdit = !!item;

    const bodyHtml = `
    <form id="shipping-form" novalidate>
      <div class="form-grid">
        <div class="form-group">
          <label class="form-label" for="sf-province">Tỉnh / Thành phố *</label>
          <div class="form-input-wrap">
            <input type="text" id="sf-province" class="form-input" placeholder="VD: TP. Hồ Chí Minh" value="${escapeHtml(item?.province || "")}" />
          </div>
          <div class="form-error" id="sf-province-error"></div>
        </div>

        <div class="form-group">
          <label class="form-label" for="sf-district">Quận / Huyện *</label>
          <div class="form-input-wrap">
            <input type="text" id="sf-district" class="form-input" placeholder="VD: Quận 1" value="${escapeHtml(item?.district || "")}" />
          </div>
          <div class="form-error" id="sf-district-error"></div>
        </div>

        <div class="form-group form-group--full">
          <label class="form-label" for="sf-fee">Phí ship (₫) *</label>
          <div class="form-input-wrap">
            <input type="number" min="0" step="1000" id="sf-fee" class="form-input" value="${item?.fee ?? ""}" />
          </div>
          <div class="form-error" id="sf-fee-error"></div>
        </div>
      </div>
    </form>
  `;

    const modal = openFormModal({
        title: isEdit ? "Sửa khu vực" : "Thêm khu vực",
        bodyHtml,
        onMount: (root) => {
            const footer = document.createElement("div");
            footer.className = "modal-form__footer";
            footer.innerHTML = `
        <button type="button" class="btn btn--ghost" id="sf-cancel">Hủy</button>
        <button type="button" class="btn btn--primary" id="sf-submit">${isEdit ? "Lưu thay đổi" : "Thêm khu vực"}</button>
      `;
            root.querySelector(".modal-box--form").appendChild(footer);

            footer.querySelector("#sf-cancel").addEventListener("click", () => closeFormModal());
            footer.querySelector("#sf-submit").addEventListener("click", () => submitShippingForm({ root, item, isEdit }));
        },
    });

    return modal;
}

async function submitShippingForm({ root, item, isEdit }) {
    const province = root.querySelector("#sf-province").value.trim();
    const district = root.querySelector("#sf-district").value.trim();
    const fee = Number(root.querySelector("#sf-fee").value);

    if (!validateShippingForm({ province, district, fee, itemId: isEdit ? item.id : null })) {
        return;
    }

    const submitBtn = root.querySelector("#sf-submit");
    setButtonLoading(submitBtn, true, "Đang lưu...");

    const data = {
        province,
        district,
        fee,
        updatedAt: serverTimestamp(),
    };

    try {
        if (isEdit) {
            await updateDoc(doc(db, "shippingFees", item.id), data);
        } else {
            await addDoc(collection(db, "shippingFees"), { ...data, createdAt: serverTimestamp() });
        }
        showToast(isEdit ? "Đã cập nhật khu vực." : "Đã thêm khu vực mới.", "success");
        closeFormModal();
        await loadShippingFees();
    } catch (err) {
        console.error("Lỗi lưu phí ship:", err);
        showToast("Không thể lưu khu vực. Vui lòng thử lại.", "error");
    } finally {
        setButtonLoading(submitBtn, false);
    }
}

function validateShippingForm({ province, district, fee, itemId }) {
    let isValid = true;
    const setErr = (id, msg) => {
        const el = document.getElementById(id);
        if (el) {
            el.textContent = msg;
            el.classList.toggle("is-visible", !!msg);
        }
    };

    if (!province) {
        setErr("sf-province-error", "Vui lòng nhập Tỉnh/Thành.");
        isValid = false;
    } else setErr("sf-province-error", "");

    if (!district) {
        setErr("sf-district-error", "Vui lòng nhập Quận/Huyện.");
        isValid = false;
    } else if (
        allShippingFees.some(
            (s) => s.id !== itemId && s.province === province && s.district === district
        )
    ) {
        setErr("sf-district-error", "Khu vực này đã tồn tại.");
        isValid = false;
    } else setErr("sf-district-error", "");

    if (!Number.isFinite(fee) || fee < 0) {
        setErr("sf-fee-error", "Phí ship phải là số và không âm.");
        isValid = false;
    } else setErr("sf-fee-error", "");

    return isValid;
}

// ============================================================
// XÓA KHU VỰC
// ============================================================

async function handleDeleteShipping(item) {
    const confirmed = await showConfirmModal({
        title: "Xóa khu vực",
        message: `Xóa vĩnh viễn "${item.district}, ${item.province}"? Hành động này không thể hoàn tác.`,
        confirmText: "Xóa",
        danger: true,
    });
    if (!confirmed) return;

    try {
        await deleteDoc(doc(db, "shippingFees", item.id));
        showToast("Đã xóa khu vực.", "success");
        await loadShippingFees();
    } catch (err) {
        console.error("Lỗi xóa phí ship:", err);
        showToast("Không thể xóa khu vực. Vui lòng thử lại.", "error");
    }
}

// ============================================================
// IMPORT EXCEL (SheetJS - window.XLSX nạp qua CDN trong shipping.html)
// ============================================================

const HEADER_ALIASES = {
    province: ["tỉnh/thành", "tỉnh / thành phố", "tỉnh thành", "tỉnh", "province"],
    district: ["quận/huyện", "quận / huyện", "quận huyện", "huyện", "district"],
    fee: ["phí ship", "phí vận chuyển", "fee", "shippingfee"],
};

function normalizeHeader(h) {
    return String(h || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, ""); // bỏ dấu tiếng Việt để so khớp linh hoạt
}

function detectColumnIndex(headerRow, key) {
    const aliases = HEADER_ALIASES[key].map(normalizeHeader);
    return headerRow.findIndex((h) => aliases.includes(normalizeHeader(h)));
}

async function handleImportExcel(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (typeof window.XLSX === "undefined") {
        showToast("Thư viện đọc Excel chưa sẵn sàng, vui lòng thử lại.", "error");
        event.target.value = "";
        return;
    }

    setButtonLoading(btnImportExcel, true, "Đang import...");

    try {
        const buffer = await file.arrayBuffer();
        const workbook = window.XLSX.read(buffer, { type: "array" });
        const firstSheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[firstSheetName];
        const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

        if (!rows.length) throw new Error("File Excel không có dữ liệu.");

        const headerRow = rows[0];
        const provinceIdx = detectColumnIndex(headerRow, "province");
        const districtIdx = detectColumnIndex(headerRow, "district");
        const feeIdx = detectColumnIndex(headerRow, "fee");

        if (provinceIdx === -1 || districtIdx === -1 || feeIdx === -1) {
            throw new Error('File Excel cần có 3 cột: "Tỉnh/Thành", "Quận/Huyện", "Phí ship".');
        }

        const parsedRows = rows
            .slice(1)
            .map((r) => ({
                province: String(r[provinceIdx] ?? "").trim(),
                district: String(r[districtIdx] ?? "").trim(),
                fee: Number(r[feeIdx]),
            }))
            .filter((r) => r.province && r.district && Number.isFinite(r.fee) && r.fee >= 0);

        if (!parsedRows.length) {
            throw new Error("Không tìm thấy dòng dữ liệu hợp lệ nào trong file.");
        }

        await bulkUpsertShippingFees(parsedRows);

        showToast(`Đã import ${parsedRows.length} khu vực từ Excel.`, "success");
        await loadShippingFees();
    } catch (err) {
        console.error("Lỗi import Excel:", err);
        showToast(err.message || "Không thể đọc file Excel. Vui lòng kiểm tra định dạng.", "error");
    } finally {
        setButtonLoading(btnImportExcel, false);
        event.target.value = ""; // reset để có thể chọn lại cùng 1 file lần sau
    }
}

/**
 * Ghi hàng loạt bằng writeBatch (giới hạn 500 ghi/batch của Firestore).
 * Khu vực (province + district) đã tồn tại -> cập nhật phí ship (upsert).
 * Khu vực mới -> thêm document mới.
 */
async function bulkUpsertShippingFees(rows) {
    const existingMap = new Map(allShippingFees.map((s) => [`${s.province}|||${s.district}`, s]));
    const BATCH_LIMIT = 450; // chừa dư so với giới hạn 500 thao tác/batch của Firestore

    for (let i = 0; i < rows.length; i += BATCH_LIMIT) {
        const chunk = rows.slice(i, i + BATCH_LIMIT);
        const batch = writeBatch(db);

        chunk.forEach((row) => {
            const key = `${row.province}|||${row.district}`;
            const existing = existingMap.get(key);
            if (existing) {
                batch.update(doc(db, "shippingFees", existing.id), {
                    fee: row.fee,
                    updatedAt: serverTimestamp(),
                });
            } else {
                const newRef = doc(collection(db, "shippingFees"));
                batch.set(newRef, {
                    province: row.province,
                    district: row.district,
                    fee: row.fee,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                });
            }
        });

        await batch.commit();
    }
}
