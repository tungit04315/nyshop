// ============================================================
// select-picker.js
// Component dùng chung: ô tìm kiếm + danh sách checkbox chọn nhiều mục
// (áp dụng Voucher theo sản phẩm/khách hàng, chọn sản phẩm cho Flash Sale).
// Toàn bộ items được tải sẵn (client-side), lọc theo từ khóa khi gõ.
// ============================================================

import { debounce } from "./helpers.js";

/**
 * Khởi tạo bộ chọn nhiều có tìm kiếm.
 * @param {Object} options
 * @param {HTMLElement} options.container - phần tử `.searchable-picker` (chứa ô search + list)
 * @param {HTMLElement} [options.chipListEl] - nơi hiển thị chip các mục đã chọn (tùy chọn)
 * @param {Array<Object>} options.items - danh sách toàn bộ mục để chọn
 * @param {(item:Object) => string} options.getId
 * @param {(item:Object) => string} options.getLabel
 * @param {(item:Object) => string} [options.getSub] - dòng phụ (vd email)
 * @param {string[]} [options.initialSelectedIds]
 * @param {(selectedIds: string[]) => void} [options.onChange]
 * @returns {{ getSelectedIds: () => string[] }}
 */
export function createSearchablePicker({
    container,
    chipListEl,
    items,
    getId,
    getLabel,
    getSub = () => "",
    initialSelectedIds = [],
    onChange = () => { },
}) {
    const selected = new Map(); // id -> item
    initialSelectedIds.forEach((id) => {
        const found = items.find((it) => getId(it) === id);
        if (found) selected.set(id, found);
    });

    const searchInput = container.querySelector("[data-picker-search]");
    const listEl = container.querySelector("[data-picker-list]");

    function renderList(keyword = "") {
        const kw = keyword.trim().toLowerCase();
        const filtered = kw
            ? items.filter((it) => getLabel(it).toLowerCase().includes(kw) || getSub(it).toLowerCase().includes(kw))
            : items;

        if (filtered.length === 0) {
            listEl.innerHTML = `<div class="searchable-picker__empty">Không tìm thấy kết quả phù hợp.</div>`;
            return;
        }

        listEl.innerHTML = filtered
            .slice(0, 100) // giới hạn hiển thị để tránh render quá nặng
            .map((it) => {
                const id = getId(it);
                const checked = selected.has(id);
                const sub = getSub(it);
                return `
        <label class="searchable-picker__row">
          <input type="checkbox" data-picker-id="${id}" ${checked ? "checked" : ""} />
          <div class="searchable-picker__row-label">
            <div class="searchable-picker__row-name">${escapeHtmlLocal(getLabel(it))}</div>
            ${sub ? `<div class="searchable-picker__row-sub">${escapeHtmlLocal(sub)}</div>` : ""}
          </div>
        </label>`;
            })
            .join("");

        listEl.querySelectorAll("[data-picker-id]").forEach((checkbox) => {
            checkbox.addEventListener("change", () => {
                const id = checkbox.dataset.pickerId;
                const item = items.find((it) => getId(it) === id);
                if (checkbox.checked) selected.set(id, item);
                else selected.delete(id);
                renderChips();
                onChange(Array.from(selected.keys()));
            });
        });
    }

    function renderChips() {
        if (!chipListEl) return;
        if (selected.size === 0) {
            chipListEl.innerHTML = "";
            return;
        }
        chipListEl.innerHTML = Array.from(selected.entries())
            .map(
                ([id, item]) => `
      <span class="chip" data-chip-id="${id}">
        ${escapeHtmlLocal(getLabel(item))}
        <button type="button" data-chip-remove="${id}" aria-label="Bỏ chọn">&times;</button>
      </span>`
            )
            .join("");

        chipListEl.querySelectorAll("[data-chip-remove]").forEach((btn) => {
            btn.addEventListener("click", () => {
                const id = btn.dataset.chipRemove;
                selected.delete(id);
                renderChips();
                renderList(searchInput?.value || "");
                onChange(Array.from(selected.keys()));
            });
        });
    }

    searchInput?.addEventListener("input", debounce(() => renderList(searchInput.value), 200));

    renderList();
    renderChips();

    return {
        getSelectedIds: () => Array.from(selected.keys()),
    };
}

function escapeHtmlLocal(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}