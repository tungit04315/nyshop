// ============================================================
// customers.js
// Điều khiển trang Quản lý Khách hàng:
// - Bảo vệ route (chỉ admin đã duyệt mới xem được)
// - Tải danh sách khách hàng từ Firestore (collection "customers")
// - Search / Filter theo trạng thái / Sort + phân trang (xử lý client-side)
// - Drawer xem chi tiết khách hàng
// - Thao tác: Approve / Reject / Lock / Unlock (có modal xác nhận)
// ============================================================

import { db } from "../firebase/firebase-config.js";
import {
    collection,
    query,
    orderBy,
    getDocs,
    doc,
    updateDoc,
    serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { formatDate, escapeHtml, getInitials, debounce } from "./helpers.js";
import { showToast } from "./toast.js";
import { showConfirmModal } from "./modal.js";

// ---- Cấu hình trạng thái khách hàng: nhãn hiển thị + class badge ----
const STATUS_MAP = {
    pending: { label: "Chờ duyệt", badge: "badge--warning" },
    approved: { label: "Đã duyệt", badge: "badge--success" },
    locked: { label: "Đã khóa", badge: "badge--neutral" },
    rejected: { label: "Đã từ chối", badge: "badge--danger" },
};

const PAGE_SIZE = 8;

// ---- State giữ trong bộ nhớ (tránh query lại Firestore mỗi lần lọc/sắp xếp) ----
let allCustomers = [];   // Toàn bộ khách hàng lấy từ Firestore
let viewCustomers = [];  // Danh sách sau khi search/filter/sort
let currentPage = 1;
let activeDrawerId = null;

// ---- Tham chiếu DOM ----
// Khai báo "let" (không gán ngay) vì các phần tử này nằm trong ".main" —
// bị thay thế mỗi khi router SPA điều hướng sang trang khác rồi quay lại.
// cacheDom() sẽ được gọi lại mỗi lần trang này hiển thị để lấy tham chiếu mới.
let tbody, searchInput, statusSelect, sortSelect, countShownEl, countTotalEl;
let paginationInfo, paginationControls;
let drawerOverlay, drawer, drawerBody, drawerFooter, drawerClose;

function cacheDom() {
    tbody = document.getElementById("customers-table-body");
    searchInput = document.getElementById("customer-search");
    statusSelect = document.getElementById("customer-filter-status");
    sortSelect = document.getElementById("customer-sort");
    countShownEl = document.getElementById("customer-count-shown");
    countTotalEl = document.getElementById("customer-count-total");
    paginationInfo = document.getElementById("pagination-info");
    paginationControls = document.getElementById("pagination-controls");

    drawerOverlay = document.getElementById("drawer-overlay");
    drawer = document.getElementById("customer-drawer");
    drawerBody = document.getElementById("drawer-body");
    drawerFooter = document.getElementById("drawer-footer");
    drawerClose = document.getElementById("drawer-close");
}

/**
 * Gắn sự kiện cho các phần tử tĩnh của trang (search/filter/sort/drawer).
 * Phải gọi lại mỗi lần trang hiển thị vì các phần tử DOM là bản mới (SPA swap).
 */
function bindStaticEvents() {
    searchInput?.addEventListener("input", debounce(() => applyFiltersAndRender(), 300));
    statusSelect?.addEventListener("change", () => applyFiltersAndRender());
    sortSelect?.addEventListener("change", () => applyFiltersAndRender());

    drawerClose?.addEventListener("click", closeDrawer);
    drawerOverlay?.addEventListener("click", closeDrawer);
}

/**
 * Được spa-router.js gọi mỗi khi trang Khách hàng được hiển thị.
 */
export function initPage() {
    cacheDom();
    bindStaticEvents();
    loadCustomers();
}

/**
 * Tải toàn bộ khách hàng từ Firestore (sắp xếp mặc định theo ngày đăng ký mới nhất)
 */
async function loadCustomers() {
    try {
        const q = query(collection(db, "customers"), orderBy("createdAt", "desc"));
        const snap = await getDocs(q);
        allCustomers = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        applyFiltersAndRender();
    } catch (err) {
        console.error("Lỗi tải danh sách khách hàng:", err);
        showToast("Không thể tải danh sách khách hàng.", "error");
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color: var(--color-danger);">Không thể tải dữ liệu.</td></tr>`;
    }
}

/**
 * Áp dụng search + filter trạng thái + sort lên allCustomers -> viewCustomers,
 * sau đó reset về trang 1 và render lại.
 */
function applyFiltersAndRender() {
    const keyword = (searchInput?.value || "").trim().toLowerCase();
    const statusFilter = statusSelect?.value || "all";
    const sortValue = sortSelect?.value || "createdAt_desc";

    let result = allCustomers.filter((c) => {
        const matchStatus = statusFilter === "all" || c.status === statusFilter;
        if (!matchStatus) return false;

        if (!keyword) return true;
        const haystack = `${c.fullName || ""} ${c.email || ""} ${c.phone || ""}`.toLowerCase();
        return haystack.includes(keyword);
    });

    const [sortField, sortDir] = sortValue.split("_");
    result = result.sort((a, b) => {
        let valA, valB;
        if (sortField === "fullName") {
            valA = (a.fullName || "").toLowerCase();
            valB = (b.fullName || "").toLowerCase();
        } else {
            valA = toMillis(a.createdAt);
            valB = toMillis(b.createdAt);
        }
        if (valA < valB) return sortDir === "asc" ? -1 : 1;
        if (valA > valB) return sortDir === "asc" ? 1 : -1;
        return 0;
    });

    viewCustomers = result;
    currentPage = 1;
    renderPage();
}

/**
 * Quy đổi Firestore Timestamp / Date / null về mốc thời gian (ms) để so sánh khi sắp xếp
 */
function toMillis(timestamp) {
    if (!timestamp) return 0;
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return isNaN(date.getTime()) ? 0 : date.getTime();
}

/**
 * Render bảng + phân trang + bộ đếm cho trang hiện tại
 */
function renderPage() {
    const total = viewCustomers.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    currentPage = Math.min(currentPage, totalPages);

    const start = (currentPage - 1) * PAGE_SIZE;
    const pageItems = viewCustomers.slice(start, start + PAGE_SIZE);

    renderTable(pageItems);
    renderCounters(pageItems.length, total);
    renderPagination(totalPages);
}

/**
 * Render nội dung bảng khách hàng
 */
function renderTable(items) {
    if (items.length === 0) {
        tbody.innerHTML = `
      <tr>
        <td colspan="5">
          <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              <circle cx="9" cy="7" r="4" stroke="currentColor" stroke-width="2"/>
            </svg>
            <div class="empty-state__title">Không tìm thấy khách hàng</div>
            <div class="empty-state__desc">Thử thay đổi từ khóa tìm kiếm hoặc bộ lọc.</div>
          </div>
        </td>
      </tr>`;
        return;
    }

    tbody.innerHTML = items.map((c) => renderRow(c)).join("");

    // Gắn sự kiện cho từng hàng (xem chi tiết + thao tác nhanh)
    items.forEach((c) => {
        document.getElementById(`row-view-${c.id}`)?.addEventListener("click", () => openDrawer(c.id));

        const nameCell = document.getElementById(`row-name-${c.id}`);
        nameCell?.addEventListener("click", () => openDrawer(c.id));

        document.getElementById(`row-approve-${c.id}`)?.addEventListener("click", () =>
            handleStatusChange(c, "approved", {
                title: "Duyệt khách hàng",
                message: `Duyệt tài khoản của "${c.fullName || c.email}"? Khách hàng sẽ có thể đăng nhập và mua hàng.`,
                confirmText: "Duyệt",
            })
        );

        document.getElementById(`row-reject-${c.id}`)?.addEventListener("click", () =>
            handleStatusChange(c, "rejected", {
                title: "Từ chối khách hàng",
                message: `Từ chối tài khoản của "${c.fullName || c.email}"?`,
                confirmText: "Từ chối",
                danger: true,
            })
        );

        document.getElementById(`row-lock-${c.id}`)?.addEventListener("click", () =>
            handleStatusChange(c, "locked", {
                title: "Khóa tài khoản",
                message: `Khóa tài khoản của "${c.fullName || c.email}"? Khách hàng sẽ không thể đăng nhập.`,
                confirmText: "Khóa",
                danger: true,
            })
        );

        document.getElementById(`row-unlock-${c.id}`)?.addEventListener("click", () =>
            handleStatusChange(c, "approved", {
                title: "Mở khóa tài khoản",
                message: `Mở khóa tài khoản của "${c.fullName || c.email}"?`,
                confirmText: "Mở khóa",
            })
        );
    });
}

/**
 * Render 1 hàng trong bảng khách hàng
 */
function renderRow(c) {
    const status = STATUS_MAP[c.status] || { label: c.status || "—", badge: "badge--neutral" };
    const initials = getInitials(c.fullName || c.email || "?");

    return `
    <tr>
      <td>
        <div class="table-avatar" id="row-name-${c.id}" style="cursor: pointer;">
          <div class="table-avatar__img">
            ${c.avatar ? `<img src="${escapeHtml(c.avatar)}" alt="" />` : escapeHtml(initials)}
          </div>
          <div>
            <div class="table-avatar__name">${escapeHtml(c.fullName || "Chưa cập nhật")}</div>
            <div class="table-avatar__meta">${escapeHtml(c.email || "—")}</div>
          </div>
        </div>
      </td>
      <td>${escapeHtml(c.phone || "—")}</td>
      <td>${formatDate(c.createdAt)}</td>
      <td><span class="badge ${status.badge}">${status.label}</span></td>
      <td>
        <div class="table-actions">
          <button class="icon-action-btn" id="row-view-${c.id}" title="Xem chi tiết" aria-label="Xem chi tiết">
            <svg viewBox="0 0 24 24" fill="none"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/></svg>
          </button>
          ${renderQuickActions(c)}
        </div>
      </td>
    </tr>`;
}

/**
 * Render các nút thao tác nhanh trong bảng, tùy theo trạng thái hiện tại
 */
function renderQuickActions(c) {
    if (c.status === "pending") {
        return `
      <button class="icon-action-btn success" id="row-approve-${c.id}" title="Duyệt" aria-label="Duyệt">
        <svg viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button class="icon-action-btn danger" id="row-reject-${c.id}" title="Từ chối" aria-label="Từ chối">
        <svg viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
      </button>`;
    }
    if (c.status === "approved") {
        return `
      <button class="icon-action-btn danger" id="row-lock-${c.id}" title="Khóa tài khoản" aria-label="Khóa tài khoản">
        <svg viewBox="0 0 24 24" fill="none"><rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" stroke-width="2"/><path d="M8 11V7a4 4 0 118 0v4" stroke="currentColor" stroke-width="2"/></svg>
      </button>`;
    }
    if (c.status === "locked") {
        return `
      <button class="icon-action-btn success" id="row-unlock-${c.id}" title="Mở khóa" aria-label="Mở khóa">
        <svg viewBox="0 0 24 24" fill="none"><rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" stroke-width="2"/><path d="M8 11V7a4 4 0 017.75-1.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>`;
    }
    // rejected -> cho phép duyệt lại
    return `
    <button class="icon-action-btn success" id="row-approve-${c.id}" title="Duyệt lại" aria-label="Duyệt lại">
      <svg viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>`;
}

/**
 * Cập nhật bộ đếm "Hiển thị X / Y khách hàng"
 */
function renderCounters(shown, total) {
    if (countShownEl) countShownEl.textContent = shown.toLocaleString("vi-VN");
    if (countTotalEl) countTotalEl.textContent = total.toLocaleString("vi-VN");
}

/**
 * Render các nút phân trang (prev / số trang / next)
 */
function renderPagination(totalPages) {
    if (paginationInfo) paginationInfo.textContent = `Trang ${currentPage} / ${totalPages}`;
    if (!paginationControls) return;

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
        buttons.push(`
      <button class="pagination__btn ${p === currentPage ? "is-active" : ""}" data-page="${p}">${p}</button>`);
    }

    buttons.push(`
    <button class="pagination__btn" data-page="next" ${currentPage === totalPages ? "disabled" : ""} aria-label="Trang sau">
      <svg viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>`);

    paginationControls.innerHTML = buttons.join("");

    paginationControls.querySelectorAll(".pagination__btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            const target = btn.dataset.page;
            if (target === "prev") currentPage -= 1;
            else if (target === "next") currentPage += 1;
            else currentPage = Number(target);
            renderPage();
        });
    });
}

// ============================================================
// DRAWER CHI TIẾT KHÁCH HÀNG
// ============================================================

/**
 * Mở drawer hiển thị chi tiết 1 khách hàng theo id
 */
function openDrawer(customerId) {
    const customer = allCustomers.find((c) => c.id === customerId);
    if (!customer) return;

    activeDrawerId = customerId;
    renderDrawerContent(customer);

    drawerOverlay?.classList.add("is-visible");
    drawer?.classList.add("is-visible");
}

/**
 * Đóng drawer
 */
function closeDrawer() {
    drawerOverlay?.classList.remove("is-visible");
    drawer?.classList.remove("is-visible");
    activeDrawerId = null;
}

// Lắng nghe phím Escape ở cấp document — an toàn khi đặt top-level vì
// bản thân document không bị thay thế khi router SPA điều hướng trang.
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && activeDrawerId) closeDrawer();
});

/**
 * Render nội dung + footer của drawer theo dữ liệu khách hàng
 */
function renderDrawerContent(c) {
    const status = STATUS_MAP[c.status] || { label: c.status || "—", badge: "badge--neutral" };
    const initials = getInitials(c.fullName || c.email || "?");

    drawerBody.innerHTML = `
    <div class="drawer__profile">
      <div class="drawer__avatar">
        ${c.avatar ? `<img src="${escapeHtml(c.avatar)}" alt="" />` : escapeHtml(initials)}
      </div>
      <div>
        <div class="drawer__profile-name">${escapeHtml(c.fullName || "Chưa cập nhật")}</div>
        <div class="drawer__profile-email">${escapeHtml(c.email || "—")}</div>
      </div>
    </div>

    <div class="drawer__field">
      <div class="drawer__field-label">Trạng thái</div>
      <div class="drawer__field-value"><span class="badge ${status.badge}">${status.label}</span></div>
    </div>
    <div class="drawer__field">
      <div class="drawer__field-label">Số điện thoại</div>
      <div class="drawer__field-value">${escapeHtml(c.phone || "—")}</div>
    </div>
    <div class="drawer__field">
      <div class="drawer__field-label">Địa chỉ</div>
      <div class="drawer__field-value">${escapeHtml(c.address || "—")}</div>
    </div>
    <div class="drawer__field">
      <div class="drawer__field-label">Ngày đăng ký</div>
      <div class="drawer__field-value">${formatDate(c.createdAt)}</div>
    </div>
    <div class="drawer__field">
      <div class="drawer__field-label">Tổng đơn hàng</div>
      <div class="drawer__field-value">${(c.totalOrders ?? 0).toLocaleString("vi-VN")}</div>
    </div>
    <div class="drawer__field">
      <div class="drawer__field-label">Tổng chi tiêu</div>
      <div class="drawer__field-value">${(c.totalSpent ?? 0).toLocaleString("vi-VN")} ₫</div>
    </div>
  `;

    drawerFooter.innerHTML = renderDrawerActions(c);
    bindDrawerActionEvents(c);
}

/**
 * Sinh HTML các nút thao tác ở footer drawer theo trạng thái
 */
function renderDrawerActions(c) {
    if (c.status === "pending") {
        return `
      <button type="button" class="btn btn--ghost" style="flex:1;" data-drawer-action="reject">Từ chối</button>
      <button type="button" class="btn btn--primary" style="flex:1;" data-drawer-action="approve">Duyệt</button>`;
    }
    if (c.status === "approved") {
        return `<button type="button" class="btn btn--danger" style="flex:1;" data-drawer-action="lock">Khóa tài khoản</button>`;
    }
    if (c.status === "locked") {
        return `<button type="button" class="btn btn--primary" style="flex:1;" data-drawer-action="unlock">Mở khóa tài khoản</button>`;
    }
    return `<button type="button" class="btn btn--primary" style="flex:1;" data-drawer-action="approve">Duyệt lại</button>`;
}

/**
 * Gắn sự kiện cho các nút trong footer drawer
 */
function bindDrawerActionEvents(c) {
    const actionConfig = {
        approve: {
            newStatus: "approved",
            title: "Duyệt khách hàng",
            message: `Duyệt tài khoản của "${c.fullName || c.email}"?`,
            confirmText: "Duyệt",
        },
        reject: {
            newStatus: "rejected",
            title: "Từ chối khách hàng",
            message: `Từ chối tài khoản của "${c.fullName || c.email}"?`,
            confirmText: "Từ chối",
            danger: true,
        },
        lock: {
            newStatus: "locked",
            title: "Khóa tài khoản",
            message: `Khóa tài khoản của "${c.fullName || c.email}"? Khách hàng sẽ không thể đăng nhập.`,
            confirmText: "Khóa",
            danger: true,
        },
        unlock: {
            newStatus: "approved",
            title: "Mở khóa tài khoản",
            message: `Mở khóa tài khoản của "${c.fullName || c.email}"?`,
            confirmText: "Mở khóa",
        },
    };

    drawerFooter.querySelectorAll("[data-drawer-action]").forEach((btn) => {
        const action = actionConfig[btn.dataset.drawerAction];
        if (!action) return;
        btn.addEventListener("click", () => handleStatusChange(c, action.newStatus, action));
    });
}

// ============================================================
// CẬP NHẬT TRẠNG THÁI KHÁCH HÀNG (Approve / Reject / Lock / Unlock)
// ============================================================

/**
 * Xử lý đổi trạng thái khách hàng: hiện modal xác nhận -> cập nhật Firestore
 * -> cập nhật state cục bộ -> render lại bảng + drawer (nếu đang mở)
 */
async function handleStatusChange(customer, newStatus, modalOptions) {
    const confirmed = await showConfirmModal(modalOptions);
    if (!confirmed) return;

    try {
        await updateDoc(doc(db, "customers", customer.id), {
            status: newStatus,
            statusUpdatedAt: serverTimestamp(),
        });

        // Cập nhật dữ liệu trong bộ nhớ để không phải gọi lại Firestore
        const idx = allCustomers.findIndex((c) => c.id === customer.id);
        if (idx !== -1) allCustomers[idx] = { ...allCustomers[idx], status: newStatus };

        showToast("Cập nhật trạng thái khách hàng thành công.", "success");

        applyFiltersAndRender();

        if (activeDrawerId === customer.id) {
            const updated = allCustomers.find((c) => c.id === customer.id);
            renderDrawerContent(updated);
        }
    } catch (err) {
        console.error("Lỗi cập nhật trạng thái khách hàng:", err);
        showToast("Không thể cập nhật trạng thái. Vui lòng thử lại.", "error");
    }
}