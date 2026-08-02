// ============================================================
// orders.js
// Điều khiển trang Quản lý Đơn hàng:
// - Tải danh sách đơn hàng từ Firestore (collection "orders")
// - Search / Filter theo trạng thái / Sort + phân trang (client-side,
//   dùng chung list-utils.js như Products/Vouchers/Flash Sale)
// - Modal xem chi tiết đơn: người mua, địa chỉ, sản phẩm, voucher,
//   phí ship, tổng tiền, trạng thái + timeline lịch sử
// - Đổi trạng thái đơn (Pending -> Confirmed -> Packing -> Shipping ->
//   Completed, có thể Hủy trước khi giao). Mỗi lần đổi trạng thái:
//     1) Ghi lịch sử vào subcollection orders/{id}/statusHistory
//     2) Ghi log hệ thống vào collection systemLogs
//     3) Gọi Cloud Function "sendEmail" để gửi email thông báo cho khách
//   (2 việc đầu ghi trực tiếp để UI phản hồi tức thì; việc gửi email
//   không được phép làm rớt luồng cập nhật trạng thái nếu lỗi).
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
import { formatCurrency, formatDateTime, escapeHtml, debounce, setButtonLoading } from "../js/helpers.js";
import { showToast } from "../js/toast.js";
import { showConfirmModal } from "../js/modal.js";
import { openFormModal, closeFormModal } from "../js/form-modal.js";
import { filterBySearch, sortItems, paginate, renderPaginationControls } from "../js/list-utils.js";

const PAGE_SIZE = 8;

// ---- Cấu hình trạng thái đơn hàng: nhãn + màu badge + trạng thái kế tiếp ----
// Export để dashboard.js dùng chung (tránh định nghĩa trùng lặp 2 nơi).
export const ORDER_STATUS_MAP = {
    pending: { label: "Chờ xử lý", badge: "badge--warning" },
    confirmed: { label: "Đã xác nhận", badge: "badge--accent" },
    packing: { label: "Đang đóng gói", badge: "badge--accent" },
    shipping: { label: "Đang giao", badge: "badge--accent" },
    completed: { label: "Hoàn tất", badge: "badge--success" },
    cancelled: { label: "Đã hủy", badge: "badge--danger" },
};

// Luồng trạng thái tuyến tính: mỗi trạng thái chỉ được tiến lên trạng thái kế tiếp
const NEXT_STATUS = {
    pending: "confirmed",
    confirmed: "packing",
    packing: "shipping",
    shipping: "completed",
};

// Chỉ cho phép Hủy đơn khi đơn chưa được giao đi
const CANCELLABLE_STATUSES = new Set(["pending", "confirmed", "packing"]);

let allOrders = [];
let viewOrders = [];
let currentPage = 1;
let currentAdmin = null;

// ---- Tham chiếu DOM (lấy lại mỗi lần trang hiển thị vì SPA router thay thế .main) ----
let tbody, searchInput, statusSelect, sortSelect, countShownEl, countTotalEl;
let paginationInfo, paginationControls;

function cacheDom() {
    tbody = document.getElementById("orders-table-body");
    searchInput = document.getElementById("order-search");
    statusSelect = document.getElementById("order-filter-status");
    sortSelect = document.getElementById("order-sort");
    countShownEl = document.getElementById("order-count-shown");
    countTotalEl = document.getElementById("order-count-total");
    paginationInfo = document.getElementById("pagination-info");
    paginationControls = document.getElementById("pagination-controls");
}

function bindStaticEvents() {
    searchInput?.addEventListener("input", debounce(() => applyFiltersAndRender(), 300));
    statusSelect?.addEventListener("change", () => applyFiltersAndRender());
    sortSelect?.addEventListener("change", () => applyFiltersAndRender());
}

/**
 * Được spa-router.js gọi mỗi khi trang Đơn hàng được hiển thị.
 */
export function initPage(userData) {
    currentAdmin = userData
        ? { uid: userData.uid, email: userData.email || "", fullName: userData.fullName || "" }
        : null;

    cacheDom();
    bindStaticEvents();
    loadOrders();
}

/**
 * Tải toàn bộ đơn hàng từ Firestore (dữ liệu quy mô admin panel nên xử lý
 * search/filter/sort/phân trang hoàn toàn trong bộ nhớ, giống Products/Vouchers).
 */
async function loadOrders() {
    try {
        const q = query(collection(db, "orders"), orderBy("createdAt", "desc"));
        const snap = await getDocs(q);
        allOrders = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        applyFiltersAndRender();
    } catch (err) {
        console.error("Lỗi tải danh sách đơn hàng:", err);
        showToast("Không thể tải danh sách đơn hàng.", "error");
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--color-danger);">Không thể tải dữ liệu.</td></tr>`;
        }
    }
}

function applyFiltersAndRender() {
    const keyword = searchInput?.value || "";
    const statusFilter = statusSelect?.value || "all";
    const sortValue = sortSelect?.value || "createdAt_desc";

    let result = filterBySearch(allOrders, keyword, ["orderCode", "customerName", "customerPhone"]);
    if (statusFilter !== "all") result = result.filter((o) => o.status === statusFilter);

    const [sortField, sortDir] = sortValue.split("_");
    const type = sortField === "total" ? "number" : "date";
    result = sortItems(result, sortField, sortDir, type);

    viewOrders = result;
    currentPage = 1;
    renderPage();
}

function renderPage() {
    const { pageItems, totalPages, currentPage: page } = paginate(viewOrders, currentPage, PAGE_SIZE);
    currentPage = page;

    renderTable(pageItems);
    if (countShownEl) countShownEl.textContent = pageItems.length.toLocaleString("vi-VN");
    if (countTotalEl) countTotalEl.textContent = viewOrders.length.toLocaleString("vi-VN");
    if (paginationInfo) paginationInfo.textContent = `Trang ${currentPage} / ${totalPages}`;
    renderPaginationControls(paginationControls, currentPage, totalPages, (p) => {
        currentPage = p;
        renderPage();
    });
}

function renderTable(items) {
    if (!tbody) return;

    if (items.length === 0) {
        tbody.innerHTML = `
      <tr>
        <td colspan="6">
          <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
              <path d="M3 6h18M16 10a4 4 0 01-8 0" stroke="currentColor" stroke-width="2"/>
            </svg>
            <div class="empty-state__title">Không tìm thấy đơn hàng</div>
            <div class="empty-state__desc">Thử thay đổi từ khóa tìm kiếm hoặc bộ lọc, hoặc chờ khách đặt hàng mới.</div>
          </div>
        </td>
      </tr>`;
        return;
    }

    tbody.innerHTML = items.map((o) => renderRow(o)).join("");

    items.forEach((o) => {
        document.getElementById(`order-view-${o.id}`)?.addEventListener("click", () => openOrderDetail(o.id));
        document.getElementById(`order-code-${o.id}`)?.addEventListener("click", () => openOrderDetail(o.id));
    });
}

function renderRow(o) {
    const status = ORDER_STATUS_MAP[o.status] || { label: o.status || "—", badge: "badge--neutral" };
    return `
    <tr>
      <td><span class="order-code-link" id="order-code-${o.id}">#${escapeHtml(o.orderCode || o.id.slice(0, 6).toUpperCase())}</span></td>
      <td>
        <div class="table-avatar__name">${escapeHtml(o.customerName || "Khách vãng lai")}</div>
        <div class="table-avatar__meta">${escapeHtml(o.customerPhone || "—")}</div>
      </td>
      <td>${formatDateTime(o.createdAt)}</td>
      <td><strong>${formatCurrency(Number(o.total) || 0)}</strong></td>
      <td><span class="badge ${status.badge}">${status.label}</span></td>
      <td>
        <div class="table-actions">
          <button class="icon-action-btn" id="order-view-${o.id}" title="Xem chi tiết" aria-label="Xem chi tiết">
            <svg viewBox="0 0 24 24" fill="none"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
}

// ============================================================
// MODAL CHI TIẾT ĐƠN HÀNG
// ============================================================

let historyCache = new Map(); // orderId -> [{...}] (tránh tải lại khi mở lại cùng 1 đơn trong phiên)

function openOrderDetail(orderId) {
    const order = allOrders.find((o) => o.id === orderId);
    if (!order) return;

    const modal = openFormModal({
        title: `Đơn hàng #${escapeHtml(order.orderCode || order.id.slice(0, 6).toUpperCase())}`,
        wide: true,
        bodyHtml: renderOrderDetailBody(order),
        onMount: (root) => {
            bindOrderDetailEvents(root, order);
            loadStatusHistory(order.id, root);
        },
    });

    return modal;
}

function renderOrderDetailBody(order) {
    const status = ORDER_STATUS_MAP[order.status] || { label: order.status || "—", badge: "badge--neutral" };
    const items = Array.isArray(order.items) ? order.items : [];
    const subtotal = Number(order.subtotal) || items.reduce((sum, it) => sum + (Number(it.subtotal) || 0), 0);
    const shippingFee = Number(order.shippingFee) || 0;
    const voucherDiscount = Number(order.voucherDiscount) || 0;
    const total = Number(order.total) || subtotal + shippingFee - voucherDiscount;

    return `
    <div class="order-detail__grid">
      <div class="order-detail__box">
        <div class="order-detail__box-title">Người mua</div>
        <div class="order-detail__box-row"><span>Họ tên</span><strong>${escapeHtml(order.customerName || "Khách vãng lai")}</strong></div>
        <div class="order-detail__box-row"><span>Điện thoại</span><strong>${escapeHtml(order.customerPhone || "—")}</strong></div>
        <div class="order-detail__box-row"><span>Email</span><strong>${escapeHtml(order.customerEmail || "—")}</strong></div>
      </div>
      <div class="order-detail__box">
        <div class="order-detail__box-title">Địa chỉ giao hàng</div>
        <div class="order-detail__box-row"><span>Địa chỉ</span><strong style="text-align:right; max-width: 240px;">${escapeHtml(order.shippingAddress || "—")}</strong></div>
        <div class="order-detail__box-row"><span>Ghi chú</span><strong style="text-align:right; max-width: 240px;">${escapeHtml(order.note || "Không có")}</strong></div>
      </div>
    </div>

    <div class="order-items">
      ${items.length === 0
            ? `<div class="order-item-row"><div class="order-item-row__info">Đơn hàng không có sản phẩm nào.</div></div>`
            : items
                .map(
                    (it) => `
        <div class="order-item-row">
          <div class="order-item-row__thumb">${it.thumbnail ? `<img src="${escapeHtml(it.thumbnail)}" alt="" />` : ""}</div>
          <div class="order-item-row__info">
            <div class="order-item-row__name">${escapeHtml(it.productName || "Sản phẩm")}</div>
            <div class="order-item-row__meta">${formatCurrency(Number(it.price) || 0)} × ${Number(it.quantity) || 0}</div>
          </div>
          <div class="order-item-row__subtotal">${formatCurrency(Number(it.subtotal) || (Number(it.price) || 0) * (Number(it.quantity) || 0))}</div>
        </div>`
                )
                .join("")
        }
    </div>

    <div class="order-totals">
      <div class="order-totals__row"><span>Tạm tính</span><strong>${formatCurrency(subtotal)}</strong></div>
      <div class="order-totals__row"><span>Phí vận chuyển</span><strong>${formatCurrency(shippingFee)}</strong></div>
      <div class="order-totals__row order-totals__row--discount">
        <span>Voucher${order.voucherCode ? ` (${escapeHtml(order.voucherCode)})` : ""}</span>
        <strong>${voucherDiscount > 0 ? "-" + formatCurrency(voucherDiscount) : "Không áp dụng"}</strong>
      </div>
      <div class="order-totals__row order-totals__row--grand"><span>Tổng cộng</span><strong>${formatCurrency(total)}</strong></div>
    </div>

    <div class="order-status-bar" id="order-status-bar">
      <div class="order-status-bar__current">
        Trạng thái hiện tại: <span class="badge ${status.badge}">${status.label}</span>
      </div>
      <div class="order-status-bar__actions" id="order-status-actions">
        ${renderStatusActions(order.status)}
      </div>
    </div>

    <div class="order-timeline-title">Lịch sử đơn hàng</div>
    <div class="timeline" id="order-timeline">
      <div class="timeline__empty">Đang tải lịch sử...</div>
    </div>
  `;
}

function renderStatusActions(status) {
    const buttons = [];
    const next = NEXT_STATUS[status];
    if (next) {
        buttons.push(
            `<button type="button" class="btn btn--primary btn--sm" data-status-action="${next}">Chuyển sang "${ORDER_STATUS_MAP[next].label}"</button>`
        );
    }
    if (CANCELLABLE_STATUSES.has(status)) {
        buttons.push(`<button type="button" class="btn btn--danger btn--sm" data-status-action="cancelled">Hủy đơn</button>`);
    }
    if (buttons.length === 0) {
        return `<span style="font-size:13px; color: var(--color-text-muted);">Đơn hàng đã kết thúc, không thể đổi trạng thái.</span>`;
    }
    return buttons.join("");
}

function bindOrderDetailEvents(root, order) {
    root.querySelectorAll("[data-status-action]").forEach((btn) => {
        btn.addEventListener("click", () => handleStatusChange(order, btn.dataset.statusAction, root));
    });
}

/**
 * Tải lịch sử thay đổi trạng thái (subcollection orders/{id}/statusHistory)
 * và render vào timeline trong modal đang mở.
 */
async function loadStatusHistory(orderId, root) {
    const timelineEl = root.querySelector("#order-timeline");
    if (!timelineEl) return;

    try {
        const q = query(collection(db, "orders", orderId, "statusHistory"), orderBy("createdAt", "desc"));
        const snap = await getDocs(q);
        const history = snap.docs.map((d) => d.data());
        historyCache.set(orderId, history);
        renderTimeline(timelineEl, history);
    } catch (err) {
        console.error("Lỗi tải lịch sử đơn hàng:", err);
        timelineEl.innerHTML = `<div class="timeline__empty">Không thể tải lịch sử đơn hàng.</div>`;
    }
}

function renderTimeline(timelineEl, history) {
    if (!history || history.length === 0) {
        timelineEl.innerHTML = `<div class="timeline__empty">Chưa có lịch sử thay đổi trạng thái.</div>`;
        return;
    }

    timelineEl.innerHTML = history
        .map((h) => {
            const from = ORDER_STATUS_MAP[h.fromStatus]?.label || h.fromStatus || "Khởi tạo";
            const to = ORDER_STATUS_MAP[h.toStatus]?.label || h.toStatus || "—";
            return `
      <div class="timeline__item">
        <div class="timeline__label">${escapeHtml(from)} → ${escapeHtml(to)}</div>
        <div class="timeline__meta">${formatDateTime(h.createdAt)} · bởi ${escapeHtml(h.changedByEmail || "hệ thống")}</div>
      </div>`;
        })
        .join("");
}

// ============================================================
// ĐỔI TRẠNG THÁI ĐƠN HÀNG
// ============================================================

const CONFIRM_TEXT = {
    confirmed: { title: "Xác nhận đơn hàng", message: "Xác nhận đơn hàng này? Email thông báo sẽ được gửi cho khách.", confirmText: "Xác nhận" },
    packing: { title: "Chuyển sang Đóng gói", message: "Đánh dấu đơn hàng đang được đóng gói?", confirmText: "Xác nhận" },
    shipping: { title: "Chuyển sang Đang giao", message: "Đánh dấu đơn hàng đã được giao cho đơn vị vận chuyển?", confirmText: "Xác nhận" },
    completed: { title: "Hoàn tất đơn hàng", message: "Xác nhận đơn hàng đã giao thành công tới khách?", confirmText: "Hoàn tất" },
    cancelled: { title: "Hủy đơn hàng", message: "Hủy đơn hàng này? Hành động này không thể hoàn tác.", confirmText: "Hủy đơn", danger: true },
};

async function handleStatusChange(order, newStatus, modalRoot) {
    const modalOptions = CONFIRM_TEXT[newStatus] || { title: "Đổi trạng thái", message: "Xác nhận đổi trạng thái đơn hàng?" };
    const confirmed = await showConfirmModal(modalOptions);
    if (!confirmed) return;

    const actionsEl = modalRoot.querySelector("#order-status-actions");
    const buttons = actionsEl ? Array.from(actionsEl.querySelectorAll("button")) : [];
    buttons.forEach((b) => setButtonLoading(b, true, "Đang lưu..."));

    try {
        // Chỉ cập nhật trạng thái — Cloud Function Trigger "onOrderStatusChange"
        // (functions/src/orders.js) sẽ TỰ ĐỘNG: lưu lịch sử vào statusHistory,
        // ghi log hệ thống, và gửi email thông báo cho khách ngay khi Firestore
        // ghi nhận thay đổi này. Cách làm này tránh ghi trùng dữ liệu 2 nơi và
        // đảm bảo lịch sử/log/email luôn đầy đủ dù trạng thái được đổi từ bất kỳ
        // nguồn nào (Admin Dashboard, Cloud Function khác...).
        await updateDoc(doc(db, "orders", order.id), {
            status: newStatus,
            updatedAt: serverTimestamp(),
            lastChangedByUid: currentAdmin?.uid || null,
            lastChangedByEmail: currentAdmin?.email || null,
        });

        const idx = allOrders.findIndex((o) => o.id === order.id);
        if (idx !== -1) allOrders[idx] = { ...allOrders[idx], status: newStatus };
        applyFiltersAndRender();
        showToast("Đã cập nhật trạng thái đơn hàng. Hệ thống sẽ tự gửi email thông báo cho khách.", "success");

        closeFormModal();
    } catch (err) {
        console.error("Lỗi đổi trạng thái đơn hàng:", err);
        showToast("Không thể cập nhật trạng thái đơn hàng. Vui lòng thử lại.", "error");
        buttons.forEach((b) => setButtonLoading(b, false));
    }
}
