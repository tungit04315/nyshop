// ============================================================
// order-lookup.js
// Controller trang "Tra cứu đơn hàng" — khách vãng lai (không cần đăng
// nhập) nhập SĐT hoặc Email đã dùng lúc đặt hàng để xem: mã đơn, ngày đặt,
// danh sách sản phẩm, và Timeline trạng thái (Pending → Confirmed →
// Packing → Shipping → Completed, hoặc Đã hủy).
//
// Dữ liệu lấy TRỰC TIẾP từ Firestore Client SDK qua
// firebase/firestore-service.js: lookupOrdersDirect() — không qua Cloud
// Function nữa (xem giải thích cơ chế + đánh đổi bảo mật trong
// firebase/firestore.rules, collection "orderLookup").
// ============================================================


import { escapeHtml, formatCurrency, setButtonLoading } from "./shop-helpers.js";
import { showToast } from "./toast.js";
import { lookupOrdersDirect } from "../firebase/firestore-service.js";

const STEP_DEFS = [
  { key: "pending", label: "Chờ xử lý" },
  { key: "confirmed", label: "Đã xác nhận" },
  { key: "packing", label: "Đang đóng gói" },
  { key: "shipping", label: "Đang giao" },
  { key: "completed", label: "Hoàn tất" },
];

const ICON_SEARCH_EMPTY = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="26" height="26">
    <circle cx="11" cy="11" r="8" />
    <path d="M21 21l-4.35-4.35" />
  </svg>`;

function formatDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Tìm thời điểm chuyển sang 1 trạng thái cụ thể trong statusHistory */
function findStepTime(order, stepKey) {
  const entry = (order.statusHistory || []).find((h) => h.toStatus === stepKey);
  if (entry) return entry.createdAt;
  if (stepKey === "pending") return order.createdAt; // bước đầu tiên = lúc tạo đơn
  return null;
}

function renderTimeline(order) {
  const isCancelled = order.status === "cancelled";
  const currentIndex = STEP_DEFS.findIndex((s) => s.key === order.status);

  const stepsHtml = STEP_DEFS.map((step, i) => {
    let stateClass = "";
    if (!isCancelled) {
      if (i < currentIndex) stateClass = "order-timeline__step--done";
      else if (i === currentIndex) stateClass = "order-timeline__step--current";
    } else if (currentIndex === -1) {
      // Đơn bị hủy: dùng lịch sử để biết đã đi tới đâu trước khi hủy.
      const reached = (order.statusHistory || []).some((h) => h.toStatus === step.key);
      if (reached) stateClass = "order-timeline__step--done";
    }
    const time = findStepTime(order, step.key);
    return `
      <div class="order-timeline__step ${stateClass}">
        <div class="order-timeline__dot">${i + 1}</div>
        <div class="order-timeline__label">${step.label}</div>
        <div class="order-timeline__time">${time ? formatDateTime(time) : ""}</div>
      </div>`;
  }).join("");

  return `
    <div class="order-timeline">
      <div class="order-timeline__title">Trạng thái đơn hàng</div>
      <div class="order-timeline__steps">${stepsHtml}</div>
    </div>
    ${isCancelled
      ? `<div class="order-cancelled-banner">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>
           Đơn hàng này đã bị hủy${findStepTime(order, "cancelled") ? " · " + formatDateTime(findStepTime(order, "cancelled")) : ""}
         </div>`
      : ""}
  `;
}

function renderOrderCard(order) {
  const itemsHtml = (order.items || [])
    .map(
      (it) => `
      <div class="order-lookup-item">
        <div class="order-lookup-item__media">
          ${it.thumbnail ? `<img src="${escapeHtml(it.thumbnail)}" alt="${escapeHtml(it.productName)}" loading="lazy" />` : ""}
        </div>
        <div class="order-lookup-item__info">
          <div class="order-lookup-item__name">${escapeHtml(it.productName || "")}</div>
          <div class="order-lookup-item__meta">SL: ${it.quantity} × ${formatCurrency(it.price)}</div>
        </div>
        <div class="order-lookup-item__price">${formatCurrency(it.price * it.quantity)}</div>
      </div>`
    )
    .join("");

  return `
    <div class="order-card ${order.status === "cancelled" ? "order-card--cancelled" : ""}">
      <div class="order-card__head">
        <div>
          <div class="order-card__code">Đơn #${escapeHtml(order.orderCode)}</div>
          <div class="order-card__date">Ngày đặt: ${formatDateTime(order.createdAt)}</div>
        </div>
      </div>
      <div class="order-card__items">${itemsHtml}</div>
      <div class="order-card__totals">
        <strong>Tổng tiền: ${formatCurrency(order.total)}</strong>
      </div>
      ${renderTimeline(order)}
    </div>`;
}

function renderSkeleton() {
  return Array.from({ length: 2 })
    .map(
      () => `
    <div class="lookup-skeleton-card">
      <div class="skeleton skeleton--text" style="width:30%;margin-bottom:10px;"></div>
      <div class="skeleton skeleton--text" style="width:50%;margin-bottom:18px;"></div>
      <div class="skeleton" style="height:48px;margin-bottom:10px;border-radius:10px;"></div>
      <div class="skeleton" style="height:48px;border-radius:10px;"></div>
    </div>`
    )
    .join("");
}

function renderEmpty(message) {
  return `
    <div class="lookup-empty">
      <div class="lookup-empty__icon">${ICON_SEARCH_EMPTY}</div>
      <div class="lookup-empty__title">${escapeHtml(message)}</div>
      <p>Kiểm tra lại số điện thoại/email đã dùng khi đặt hàng, hoặc liên hệ CSKH nếu cần hỗ trợ thêm.</p>
    </div>`;
}

function initLookupForm() {
  const form = document.getElementById("lookup-form");
  const input = document.getElementById("lk-keyword");
  const errorEl = document.getElementById("lk-keyword-error");
  const submitBtn = document.getElementById("lk-submit-btn");
  const resultsEl = document.getElementById("lookup-results");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.textContent = "";

    const keyword = input.value.trim();
    if (!keyword) {
      errorEl.textContent = "Vui lòng nhập số điện thoại hoặc email.";
      input.focus();
      return;
    }

    const isEmail = keyword.includes("@");
    const payload = isEmail ? { email: keyword.toLowerCase() } : { phone: keyword.replace(/\s+/g, "") };

    setButtonLoading(submitBtn, true, "Đang tra cứu...");
    resultsEl.innerHTML = renderSkeleton();

    try {
      const orders = await lookupOrdersDirect(payload);
      if (!orders.length) {
        resultsEl.innerHTML = renderEmpty("Không tìm thấy đơn hàng nào khớp với thông tin bạn nhập.");
        return;
      }
      resultsEl.innerHTML =
        `<div class="lookup-results__count">Tìm thấy ${orders.length} đơn hàng</div>` +
        orders.map(renderOrderCard).join("");
    } catch (err) {
      console.error("[order-lookup] Lỗi tra cứu:", err);
      resultsEl.innerHTML = "";
      showToast(err?.message || "Đã xảy ra lỗi khi tra cứu. Vui lòng thử lại.", "error");
    } finally {
      setButtonLoading(submitBtn, false);
    }
  });
}

/**
 * Điểm khởi động trang — được gọi bởi site-router.js mỗi khi trang
 * Tra cứu đơn hàng được hiển thị.
 */
export async function initPage() {
  initLookupForm();
}
