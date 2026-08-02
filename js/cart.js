// ============================================================
// cart.js
// Controller cho cart.html (Giỏ hàng):
// - Hiển thị giỏ hàng THẬT từ cart-store.js (LocalStorage/Firestore).
// - Checkbox chọn từng sản phẩm / chọn tất cả, tăng giảm số lượng, xoá.
// - Chọn/nhập mã Voucher (xác thực qua Cloud Function validateVoucher).
// - Chuyển sang checkout.html (yêu cầu đăng nhập vì firestore.rules chỉ
//   cho phép tạo đơn khi đã xác thực).
// Loading / Toast / Empty state / Error state / Responsive theo yêu cầu.
// ============================================================

import { auth } from "../firebase/firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { refreshLayoutEffects } from "./layout.js";
import { escapeHtml, formatCurrency, debounce } from "./shop-helpers.js";
import { showToast } from "./toast.js";
import { showConfirmModal } from "./modal.js";
import {
    subscribeCart,
    setItemSelected,
    setAllSelected,
    updateCartQuantity,
    removeFromCart,
    removeManyFromCart,
} from "./cart-store.js";
import { translateFunctionsError } from "./cloud-functions.js";
import { fetchMyVouchersDirect, validateVoucherClient } from "../js/vouchers.js";

export const CHECKOUT_VOUCHER_KEY = "shopviet_checkout_voucher";

let currentUid = null;
let latestState = { items: [], subtotal: 0, totalCount: 0, selectedItems: [] };
let appliedVoucher = null; // { code, discount, voucher }
let myVouchers = [];
let vouchersLoaded = false;
let qtyDebounceMap = new Map();

// Hàm huỷ theo dõi Auth + Giỏ hàng realtime — được gán trong initPage()
// và gọi lại trong disposePage() khi rời trang, tránh listener chồng
// chéo mỗi lần điều hướng SPA quay lại trang Giỏ hàng.
let unsubAuthState = null;
let unsubCartState = null;

const FLASH_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h7l-1 8 11-14h-8l1-6z"/></svg>`;
const TRASH_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0l-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6h16z"/></svg>`;

function cacheDom() {
    return {
        loading: document.getElementById("cart-loading"),
        empty: document.getElementById("cart-empty"),
        error: document.getElementById("cart-error"),
        retryBtn: document.getElementById("cart-retry-btn"),
        content: document.getElementById("cart-content"),
        itemsWrap: document.getElementById("cart-items"),
        selectAll: document.getElementById("cart-select-all"),
        selectAllLabel: document.getElementById("cart-select-all-label"),
        deleteSelectedBtn: document.getElementById("cart-delete-selected"),

        voucherBlock: document.getElementById("cart-voucher-block"),
        voucherToggle: document.getElementById("cart-voucher-toggle"),
        voucherPanel: document.getElementById("cart-voucher-panel"),
        voucherCodeInput: document.getElementById("cart-voucher-code"),
        voucherApplyBtn: document.getElementById("cart-voucher-apply-btn"),
        voucherList: document.getElementById("cart-voucher-list"),
        voucherApplied: document.getElementById("cart-voucher-applied"),
        voucherAppliedCode: document.getElementById("cart-voucher-applied-code"),
        voucherAppliedDesc: document.getElementById("cart-voucher-applied-desc"),
        voucherRemoveBtn: document.getElementById("cart-voucher-remove-btn"),

        summary: document.getElementById("cart-summary"),
        summarySubtotal: document.getElementById("cart-summary-subtotal"),
        summaryDiscount: document.getElementById("cart-summary-discount"),
        summaryTotal: document.getElementById("cart-summary-total"),
        checkoutBtn: document.getElementById("cart-checkout-btn"),
    };
}

let dom;

/* ============================================================
   Render danh sách sản phẩm
   ============================================================ */
function renderItemRow(item) {
    const isUnavailable = item.status && item.status !== "active";
    const hasSale = Number(item.originalPrice) > Number(item.price);

    return `
    <div class="cart-item ${isUnavailable ? "is-unavailable" : ""}" data-cart-row="${escapeHtml(item.productId)}">
      <label class="cart-checkbox">
        <input type="checkbox" class="cart-item__select-input" data-select-item="${escapeHtml(item.productId)}" ${item.selected ? "checked" : ""} />
        <span class="cart-checkbox__box"></span>
      </label>

      <div class="cart-item__product">
        <div class="cart-item__thumb">${item.thumbnail ? `<img src="${escapeHtml(item.thumbnail)}" alt="" />` : ""}</div>
        <div class="cart-item__info">
          <div class="cart-item__name">${escapeHtml(item.name)}</div>
          <div class="cart-item__flags">
            ${item.isFlashSale ? `<span class="badge badge--danger">${FLASH_ICON} Flash Sale</span>` : ""}
            ${isUnavailable ? `<span class="cart-item__unavailable-tag">Sản phẩm ngừng kinh doanh</span>` : ""}
          </div>
        </div>
      </div>

      <div class="cart-item__price">
        <span class="cart-item__price-current">${formatCurrency(item.price)}</span>
        ${hasSale ? `<span class="cart-item__price-original">${formatCurrency(item.originalPrice)}</span>` : ""}
      </div>

      <div class="cart-qty">
        <button type="button" class="cart-qty-btn" data-qty-action="dec" data-qty-id="${escapeHtml(item.productId)}" ${item.quantity <= 1 ? "disabled" : ""}>−</button>
        <input type="number" class="cart-qty-input" data-qty-input="${escapeHtml(item.productId)}" value="${item.quantity}" min="1" max="${item.stock || 999}" />
        <button type="button" class="cart-qty-btn" data-qty-action="inc" data-qty-id="${escapeHtml(item.productId)}" ${item.quantity >= (item.stock || 999) ? "disabled" : ""}>+</button>
      </div>

      <div class="cart-item__subtotal">${formatCurrency(Number(item.price) * Number(item.quantity))}</div>

      <button type="button" class="cart-item__remove" data-remove-item="${escapeHtml(item.productId)}" aria-label="Xoá sản phẩm">${TRASH_ICON}</button>
    </div>
  `;
}

function renderCart(state) {
    latestState = state;
    dom.loading.style.display = "none";
    dom.error.style.display = "none";

    if (!state.items.length) {
        dom.content.style.display = "none";
        dom.summary.style.display = "none";
        dom.voucherBlock.style.display = "none";
        dom.empty.style.display = "flex";
        return;
    }

    dom.empty.style.display = "none";
    dom.content.style.display = "block";
    dom.summary.style.display = "block";
    dom.voucherBlock.style.display = "block";

    dom.itemsWrap.innerHTML = state.items.map(renderItemRow).join("");
    refreshLayoutEffects(dom.itemsWrap);

    const allSelected = state.items.length > 0 && state.items.every((i) => i.selected);
    dom.selectAll.checked = allSelected;
    dom.selectAllLabel.textContent = `Chọn tất cả (${state.items.length})`;
    dom.deleteSelectedBtn.disabled = state.selectedItems.length === 0;

    renderSummary(state);
}

function renderSummary(state) {
    const subtotal = state.subtotal;
    let discount = 0;

    if (appliedVoucher) {
        // Nếu voucher theo sản phẩm cụ thể mà sản phẩm đó không còn được
        // chọn nữa -> vô hiệu áp dụng (nhưng giữ để người dùng dễ chọn lại).
        discount = Math.min(appliedVoucher.discount, subtotal);
    }

    const total = Math.max(0, subtotal - discount);

    dom.summarySubtotal.textContent = formatCurrency(subtotal);
    dom.summaryDiscount.textContent = discount > 0 ? `−${formatCurrency(discount)}` : formatCurrency(0);
    dom.summaryTotal.textContent = formatCurrency(total);
    dom.checkoutBtn.disabled = state.selectedItems.length === 0;
    dom.checkoutBtn.textContent = state.selectedItems.length > 0 ? `Mua hàng (${state.selectedItems.length})` : "Mua hàng";
}

/* ============================================================
   Sự kiện: chọn / bỏ chọn
   ============================================================ */
function bindSelection() {
    dom.selectAll.addEventListener("change", () => setAllSelected(dom.selectAll.checked));

    dom.itemsWrap.addEventListener("change", (e) => {
        const checkbox = e.target.closest("[data-select-item]");
        if (!checkbox) return;
        setItemSelected(checkbox.dataset.selectItem, checkbox.checked);
    });
}

/* ============================================================
   Sự kiện: số lượng
   ============================================================ */
function getQtyDebounced(productId) {
    if (!qtyDebounceMap.has(productId)) {
        qtyDebounceMap.set(
            productId,
            debounce((qty) => updateCartQuantity(productId, qty), 400)
        );
    }
    return qtyDebounceMap.get(productId);
}

function bindQuantity() {
    dom.itemsWrap.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-qty-action]");
        if (!btn) return;
        const productId = btn.dataset.qtyId;
        const input = dom.itemsWrap.querySelector(`[data-qty-input="${CSS.escape(productId)}"]`);
        if (!input) return;
        let value = Number(input.value) || 1;
        value = btn.dataset.qtyAction === "inc" ? value + 1 : value - 1;
        input.value = Math.max(1, value);
        updateCartQuantity(productId, Number(input.value));
    });

    dom.itemsWrap.addEventListener("input", (e) => {
        const input = e.target.closest("[data-qty-input]");
        if (!input) return;
        const productId = input.dataset.qtyInput;
        const value = Math.max(1, Number(input.value) || 1);
        getQtyDebounced(productId)(value);
    });
}

/* ============================================================
   Sự kiện: xoá sản phẩm
   ============================================================ */
function bindRemove() {
    dom.itemsWrap.addEventListener("click", async (e) => {
        const btn = e.target.closest("[data-remove-item]");
        if (!btn) return;
        const productId = btn.dataset.removeItem;
        const item = latestState.items.find((i) => i.productId === productId);
        const confirmed = await showConfirmModal({
            title: "Xoá sản phẩm",
            message: `Bạn có chắc muốn xoá "${item ? item.name : "sản phẩm này"}" khỏi giỏ hàng?`,
            confirmText: "Xoá",
            danger: true,
        });
        if (!confirmed) return;
        await removeFromCart(productId);
        showToast("Đã xoá sản phẩm khỏi giỏ hàng.", "success");
    });

    dom.deleteSelectedBtn.addEventListener("click", async () => {
        const ids = latestState.selectedItems.map((i) => i.productId);
        if (!ids.length) return;
        const confirmed = await showConfirmModal({
            title: "Xoá sản phẩm đã chọn",
            message: `Xoá ${ids.length} sản phẩm đã chọn khỏi giỏ hàng?`,
            confirmText: "Xoá",
            danger: true,
        });
        if (!confirmed) return;
        await removeManyFromCart(ids);
        showToast("Đã xoá các sản phẩm đã chọn.", "success");
    });
}

/* ============================================================
   Voucher
   ============================================================ */
function persistVoucherForCheckout() {
    if (appliedVoucher) {
        sessionStorage.setItem(CHECKOUT_VOUCHER_KEY, JSON.stringify(appliedVoucher));
    } else {
        sessionStorage.removeItem(CHECKOUT_VOUCHER_KEY);
    }
}

function renderAppliedVoucher() {
    if (!appliedVoucher) {
        dom.voucherApplied.style.display = "none";
        return;
    }
    dom.voucherApplied.style.display = "flex";
    dom.voucherAppliedCode.textContent = `Đã áp dụng: ${appliedVoucher.code}`;
    const v = appliedVoucher.voucher || {};
    dom.voucherAppliedDesc.textContent =
        v.discountType === "percent"
            ? `Giảm ${v.value}% — tiết kiệm ${formatCurrency(appliedVoucher.discount)}`
            : `Giảm trực tiếp ${formatCurrency(appliedVoucher.discount)}`;
}

function voucherDescLabel(v) {
    const valueLabel =
        v.discountType === "percent"
            ? `Giảm ${v.value}%${v.maxDiscount ? ` (tối đa ${formatCurrency(Number(v.maxDiscount))})` : ""}`
            : `Giảm ${formatCurrency(Number(v.value) || 0)}`;
    const condLabel = v.minOrderValue ? `Đơn tối thiểu ${formatCurrency(Number(v.minOrderValue))}` : "Áp dụng mọi đơn hàng";
    const scopeLabel = v.applyScope === "products" ? "Áp dụng cho sản phẩm cụ thể" : v.applyScope === "customers" ? "Ưu đãi riêng cho bạn" : "";
    return [valueLabel, condLabel, scopeLabel].filter(Boolean).join(" · ");
}

async function loadMyVouchers() {
    if (!currentUid) {
        dom.voucherList.innerHTML = `<div class="cart-voucher__hint">Đăng nhập để xem voucher dành riêng cho bạn.</div>`;
        return;
    }
    dom.voucherList.innerHTML = `<div class="skeleton" style="height:52px;border-radius:12px;"></div><div class="skeleton" style="height:52px;border-radius:12px;"></div>`;
    try {
        myVouchers = await fetchMyVouchersDirect(currentUid);
        vouchersLoaded = true;
        if (!myVouchers.length) {
            dom.voucherList.innerHTML = `<div class="cart-voucher__hint">Bạn chưa có voucher khả dụng nào.</div>`;
            return;
        }
        dom.voucherList.innerHTML = myVouchers
            .map(
                (v) => `
        <div class="cart-voucher-chip" data-voucher-chip="${escapeHtml(v.code)}">
          <div>
            <div class="cart-voucher-chip__code">${escapeHtml(v.code)}</div>
            <div class="cart-voucher-chip__desc">${escapeHtml(voucherDescLabel(v))}</div>
          </div>
          <span class="cart-voucher-chip__select">Chọn</span>
        </div>`
            )
            .join("");
    } catch (err) {
        console.error("[cart] Lỗi tải voucher:", err);
        dom.voucherList.innerHTML = `<div class="cart-voucher__hint">${escapeHtml(translateFunctionsError(err))}</div>`;
    }
}

async function applyVoucherCode(code) {
    const trimmed = (code || "").trim().toUpperCase();
    const errorEl = document.getElementById("cart-voucher-code-error");
    errorEl.textContent = "";
    errorEl.classList.remove("is-visible");

    if (!trimmed) {
        errorEl.textContent = "Vui lòng nhập mã giảm giá.";
        errorEl.classList.add("is-visible");
        return;
    }
    if (!latestState.selectedItems.length) {
        showToast("Vui lòng chọn sản phẩm trước khi áp dụng voucher.", "error");
        return;
    }

    dom.voucherApplyBtn.disabled = true;
    const originalHtml = dom.voucherApplyBtn.innerHTML;
    dom.voucherApplyBtn.innerHTML = `<span class="btn-spinner"></span> Đang kiểm tra...`;

    try {
        const productIds = latestState.selectedItems.map((i) => i.productId);
        const res = await validateVoucherClient({ code: trimmed, orderTotal: latestState.subtotal, productIds, customerId: currentUid });
        appliedVoucher = { code: trimmed, discount: res.discount, voucher: res.voucher };
        persistVoucherForCheckout();
        renderAppliedVoucher();
        renderSummary(latestState);
        dom.voucherPanel.style.display = "none";
        showToast(`Áp dụng mã "${trimmed}" thành công.`, "success");
    } catch (err) {
        console.error("[cart] Lỗi áp dụng voucher:", err);
        errorEl.textContent = translateFunctionsError(err);
        errorEl.classList.add("is-visible");
    } finally {
        dom.voucherApplyBtn.disabled = false;
        dom.voucherApplyBtn.innerHTML = originalHtml;
    }
}

function bindVoucher() {
    dom.voucherToggle.addEventListener("click", () => {
        const isOpen = dom.voucherPanel.style.display !== "none";
        dom.voucherPanel.style.display = isOpen ? "none" : "block";
        if (!isOpen && !vouchersLoaded) loadMyVouchers();
    });

    dom.voucherApplyBtn.addEventListener("click", () => applyVoucherCode(dom.voucherCodeInput.value));
    dom.voucherCodeInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            applyVoucherCode(dom.voucherCodeInput.value);
        }
    });
    dom.voucherCodeInput.addEventListener("input", () => {
        document.getElementById("cart-voucher-code-error").classList.remove("is-visible");
    });

    dom.voucherList.addEventListener("click", (e) => {
        const chip = e.target.closest("[data-voucher-chip]");
        if (!chip) return;
        dom.voucherCodeInput.value = chip.dataset.voucherChip;
        applyVoucherCode(chip.dataset.voucherChip);
    });

    dom.voucherRemoveBtn.addEventListener("click", () => {
        appliedVoucher = null;
        persistVoucherForCheckout();
        renderAppliedVoucher();
        renderSummary(latestState);
        showToast("Đã bỏ áp dụng voucher.", "info");
    });
}

/* ============================================================
   Chuyển sang Checkout
   ============================================================ */
function bindCheckout() {
    dom.checkoutBtn.addEventListener("click", () => {
        if (!latestState.selectedItems.length) {
            showToast("Vui lòng chọn ít nhất 1 sản phẩm để tiếp tục.", "error");
            return;
        }
        if (!currentUid) {
            showToast("Vui lòng đăng nhập để tiến hành thanh toán.", "info");
            window.location.href = "login.html?redirect=cart.html";
            return;
        }
        window.location.href = "checkout.html";
    });
}

/* ============================================================
   Khởi tạo
   ============================================================ */
function bindErrorRetry() {
    dom.retryBtn.addEventListener("click", () => {
        dom.error.style.display = "none";
        dom.loading.style.display = "block";
        // subscribeCart đã tự theo dõi realtime; chỉ cần buộc render lại state hiện có
        renderCart(latestState);
    });
}

/**
 * Điểm khởi động trang — được gọi bởi site-router.js mỗi khi trang
 * Giỏ hàng được hiển thị.
 */
export async function initPage() {
    dom = cacheDom();

    // Khôi phục voucher đã chọn trước đó (nếu có, còn hiệu lực trong phiên)
    try {
        const saved = sessionStorage.getItem(CHECKOUT_VOUCHER_KEY);
        if (saved) appliedVoucher = JSON.parse(saved);
    } catch {
        appliedVoucher = null;
    }

    bindSelection();
    bindQuantity();
    bindRemove();
    bindVoucher();
    bindCheckout();
    bindErrorRetry();

    unsubAuthState = onAuthStateChanged(auth, (user) => {
        currentUid = user ? user.uid : null;
        vouchersLoaded = false;
        if (dom.voucherPanel.style.display !== "none") loadMyVouchers();
    });

    try {
        unsubCartState = subscribeCart((state) => {
            renderCart(state);
            renderAppliedVoucher();
        });
    } catch (err) {
        console.error("[cart] Lỗi tải giỏ hàng:", err);
        dom.loading.style.display = "none";
        dom.error.style.display = "flex";
    }
}

/**
 * Được site-router.js gọi ngay TRƯỚC khi rời khỏi trang Giỏ hàng —
 * huỷ theo dõi Auth + Giỏ hàng realtime để tránh listener chồng chéo.
 */
export function disposePage() {
    unsubAuthState?.();
    unsubCartState?.();
    unsubAuthState = null;
    unsubCartState = null;
}