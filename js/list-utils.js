// ============================================================
// list-utils.js
// Các hàm tiện ích xử lý danh sách dùng chung: tìm kiếm, sắp xếp,
// phân trang client-side + render nút phân trang.
// Dùng cho Products, Vouchers, Flash Sale, Shipping (dữ liệu quy mô
// admin panel nên xử lý toàn bộ trong bộ nhớ, giống cách làm ở customers.js).
// ============================================================

/**
 * Lọc mảng theo từ khóa tìm kiếm trên nhiều field (không phân biệt hoa/thường, dấu)
 * @param {Array<Object>} items
 * @param {string} keyword
 * @param {string[]} fields - tên các field cần so khớp
 */
export function filterBySearch(items, keyword, fields) {
    const kw = (keyword || "").trim().toLowerCase();
    if (!kw) return items;
    return items.filter((item) =>
        fields.some((f) => String(item[f] ?? "").toLowerCase().includes(kw))
    );
}

/**
 * Lọc mảng theo 1 field khớp giá trị (bỏ qua nếu value === 'all' hoặc rỗng)
 */
export function filterByField(items, field, value) {
    if (!value || value === "all") return items;
    return items.filter((item) => item[field] === value);
}

/**
 * Sắp xếp mảng theo field, hỗ trợ kiểu string / number / date (Firestore Timestamp)
 * @param {Array<Object>} items
 * @param {string} field
 * @param {'asc'|'desc'} dir
 * @param {'string'|'number'|'date'} type
 */
export function sortItems(items, field, dir = "desc", type = "string") {
    const sorted = [...items].sort((a, b) => {
        let valA = a[field];
        let valB = b[field];

        if (type === "date") {
            valA = toMillis(valA);
            valB = toMillis(valB);
        } else if (type === "number") {
            valA = Number(valA) || 0;
            valB = Number(valB) || 0;
        } else {
            valA = String(valA ?? "").toLowerCase();
            valB = String(valB ?? "").toLowerCase();
        }

        if (valA < valB) return dir === "asc" ? -1 : 1;
        if (valA > valB) return dir === "asc" ? 1 : -1;
        return 0;
    });
    return sorted;
}

function toMillis(timestamp) {
    if (!timestamp) return 0;
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return isNaN(date.getTime()) ? 0 : date.getTime();
}

/**
 * Cắt mảng theo trang
 * @returns {{ pageItems: Array, totalPages: number, currentPage: number }}
 */
export function paginate(items, currentPage, pageSize) {
    const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
    const page = Math.min(Math.max(1, currentPage), totalPages);
    const start = (page - 1) * pageSize;
    return {
        pageItems: items.slice(start, start + pageSize),
        totalPages,
        currentPage: page,
    };
}

/**
 * Render các nút phân trang (prev / số trang / next) vào 1 container.
 * @param {HTMLElement} container
 * @param {number} currentPage
 * @param {number} totalPages
 * @param {(page: number) => void} onChange
 */
export function renderPaginationControls(container, currentPage, totalPages, onChange) {
    if (!container) return;

    const buttons = [];
    buttons.push(`
    <button class="pagination__btn" data-page="prev" ${currentPage === 1 ? "disabled" : ""} aria-label="Trang trước">
      <svg viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>`);

    const maxVisible = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);
    startPage = Math.max(1, endPage - maxVisible + 1);

    for (let p = startPage; p <= endPage; p++) {
        buttons.push(`<button class="pagination__btn ${p === currentPage ? "is-active" : ""}" data-page="${p}">${p}</button>`);
    }

    buttons.push(`
    <button class="pagination__btn" data-page="next" ${currentPage === totalPages ? "disabled" : ""} aria-label="Trang sau">
      <svg viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>`);

    container.innerHTML = buttons.join("");
    container.querySelectorAll(".pagination__btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            const target = btn.dataset.page;
            if (target === "prev") onChange(currentPage - 1);
            else if (target === "next") onChange(currentPage + 1);
            else onChange(Number(target));
        });
    });
}