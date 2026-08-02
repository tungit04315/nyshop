// ============================================================
// profile.js
// Controller cho profile.html (Trang cá nhân khách hàng):
// - Route guard: chỉ cho phép truy cập khi đã đăng nhập.
// - Đổ dữ liệu hồ sơ Firestore "customers/{uid}" theo thời gian thực.
// - 5 tab: Thông tin, Đơn hàng, Voucher, Địa chỉ, Đổi mật khẩu.
// - Đổi ảnh đại diện (Firebase Storage).
// Toàn bộ dữ liệu lấy từ Firestore, không hardcode.
// ============================================================

import { auth, db } from "../firebase/firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
    doc,
    onSnapshot,
    collection,
    query,
    where,
    orderBy,
    getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { showToast } from "./toast.js";
import { setButtonLoading, getInitials, escapeHtml, formatCurrency } from "./shop-helpers.js";
import {
    updateCustomerProfile,
    changeCustomerPassword,
    translateCustomerAuthError,
} from "./customer-auth.js";
import {
    validateFullName,
    validatePhone,
    validateAddress,
    validatePassword,
    validateConfirmPassword,
    validateRequired,
    setFieldError,
    runValidation,
} from "./validators.js";
import { uploadImageFile, validateImageFile } from "./image-upload.js";
import { ORDER_STATUS_MAP } from "./orders.js";

let currentCustomer = null;
let unsubCustomerDoc = null;
// Huỷ theo dõi onAuthStateChanged — được gán trong watchProfile() và
// gọi lại trong disposePage() khi rời trang.
let unsubAuthState = null;
const loadedTabs = new Set();

const STATUS_LABEL = {
    pending: { label: "Chờ duyệt", badge: "badge--warning" },
    approved: { label: "Đã duyệt", badge: "badge--success" },
    locked: { label: "Đã khóa", badge: "badge--danger" },
    rejected: { label: "Bị từ chối", badge: "badge--danger" },
};

function formatDate(timestamp) {
    if (!timestamp) return "—";
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    if (isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function cacheDom() {
    return {
        loading: document.getElementById("profile-loading"),
        shell: document.getElementById("profile-shell"),

        avatarWrap: document.getElementById("profile-avatar-wrap"),
        avatarImg: document.getElementById("profile-avatar-img"),
        avatarEditBtn: document.getElementById("profile-avatar-edit"),
        avatarInput: document.getElementById("profile-avatar-input"),
        identityName: document.getElementById("profile-identity-name"),
        identityEmail: document.getElementById("profile-identity-email"),
        statusBadge: document.getElementById("profile-status-badge"),

        nav: document.getElementById("profile-nav"),
        navItems: Array.from(document.querySelectorAll(".profile-nav__item")),
        panels: Array.from(document.querySelectorAll(".profile-panel")),
        pendingBanner: document.getElementById("profile-pending-banner"),

        infoForm: document.getElementById("info-form"),
        infoSubmitBtn: document.getElementById("pf-submit-btn"),
        fullNameInput: document.getElementById("pf-fullname"),
        emailInput: document.getElementById("pf-email"),
        phoneInput: document.getElementById("pf-phone"),

        addressForm: document.getElementById("address-form"),
        addressSubmitBtn: document.getElementById("af-submit-btn"),
        addressInput: document.getElementById("pf-address"),

        passwordForm: document.getElementById("password-form"),
        passwordSubmitBtn: document.getElementById("pw-submit-btn"),
        pwCurrent: document.getElementById("pw-current"),
        pwNew: document.getElementById("pw-new"),
        pwConfirm: document.getElementById("pw-confirm"),

        ordersList: document.getElementById("orders-list"),
        vouchersList: document.getElementById("vouchers-list"),
    };
}

/* ============================================================
   Hiển thị hồ sơ (sidebar identity + form thông tin)
   ============================================================ */
function renderIdentity(dom, customer) {
    dom.identityName.textContent = customer.fullName || "Chưa cập nhật";
    dom.identityEmail.textContent = customer.email || "—";

    const statusInfo = STATUS_LABEL[customer.status] || { label: customer.status || "—", badge: "badge--neutral" };
    dom.statusBadge.textContent = statusInfo.label;
    dom.statusBadge.className = `badge ${statusInfo.badge}`;

    dom.avatarImg.innerHTML = customer.avatar
        ? `<img src="${escapeHtml(customer.avatar)}" alt="" />`
        : escapeHtml(getInitials(customer.fullName || customer.email || "?"));

    dom.pendingBanner.style.display = customer.status === "pending" ? "flex" : "none";
}

function fillForms(dom, customer) {
    // Không ghi đè nếu người dùng đang gõ dở (form đang có focus)
    if (document.activeElement !== dom.fullNameInput) dom.fullNameInput.value = customer.fullName || "";
    dom.emailInput.value = customer.email || "";
    if (document.activeElement !== dom.phoneInput) dom.phoneInput.value = customer.phone || "";
    if (document.activeElement !== dom.addressInput) dom.addressInput.value = customer.address || "";
}

/* ============================================================
   Tab: Thông tin
   ============================================================ */
async function handleInfoSubmit(e, dom) {
    e.preventDefault();
    const ok = runValidation([
        { fieldId: "pf-fullname", value: dom.fullNameInput.value, validator: validateFullName },
        { fieldId: "pf-phone", value: dom.phoneInput.value, validator: validatePhone },
    ]);
    if (!ok) return;

    setButtonLoading(dom.infoSubmitBtn, true, "Đang lưu...");
    try {
        const patch = { fullName: dom.fullNameInput.value.trim(), phone: dom.phoneInput.value.trim() };
        await updateCustomerProfile(currentCustomer.uid, patch);
        showToast("Đã cập nhật thông tin tài khoản.", "success");
        window.dispatchEvent(
            new CustomEvent("shopviet:account-updated", { detail: { ...currentCustomer, ...patch } })
        );
    } catch (err) {
        console.error("[profile] Lỗi lưu thông tin:", err);
        showToast(translateCustomerAuthError(err), "error");
    } finally {
        setButtonLoading(dom.infoSubmitBtn, false);
    }
}

/* ============================================================
   Tab: Địa chỉ
   ============================================================ */
async function handleAddressSubmit(e, dom) {
    e.preventDefault();
    const ok = runValidation([
        { fieldId: "pf-address", value: dom.addressInput.value, validator: validateAddress },
    ]);
    if (!ok) return;

    setButtonLoading(dom.addressSubmitBtn, true, "Đang lưu...");
    try {
        await updateCustomerProfile(currentCustomer.uid, { address: dom.addressInput.value.trim() });
        showToast("Đã lưu địa chỉ giao hàng.", "success");
    } catch (err) {
        console.error("[profile] Lỗi lưu địa chỉ:", err);
        showToast(translateCustomerAuthError(err), "error");
    } finally {
        setButtonLoading(dom.addressSubmitBtn, false);
    }
}

/* ============================================================
   Tab: Đổi mật khẩu
   ============================================================ */
async function handlePasswordSubmit(e, dom) {
    e.preventDefault();
    const ok = runValidation([
        { fieldId: "pw-current", value: dom.pwCurrent.value, validator: (v) => validateRequired(v, "Vui lòng nhập mật khẩu hiện tại.") },
        { fieldId: "pw-new", value: dom.pwNew.value, validator: validatePassword },
        { fieldId: "pw-confirm", value: dom.pwConfirm.value, validator: (v) => validateConfirmPassword(dom.pwNew.value, v) },
    ]);
    if (!ok) return;

    setButtonLoading(dom.passwordSubmitBtn, true, "Đang đổi mật khẩu...");
    try {
        await changeCustomerPassword(dom.pwCurrent.value, dom.pwNew.value);
        showToast("Đổi mật khẩu thành công.", "success");
        dom.passwordForm.reset();
    } catch (err) {
        console.error("[profile] Lỗi đổi mật khẩu:", err);
        const message = translateCustomerAuthError(err);
        if (["auth/wrong-password", "auth/invalid-credential"].includes(err.code)) {
            setFieldError("pw-current", "Mật khẩu hiện tại không chính xác.");
        } else {
            showToast(message, "error");
        }
    } finally {
        setButtonLoading(dom.passwordSubmitBtn, false);
    }
}

/* ============================================================
   Đổi ảnh đại diện
   ============================================================ */
async function handleAvatarChange(e, dom) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const error = validateImageFile(file);
    if (error) {
        showToast(error, "error");
        return;
    }

    const originalHtml = dom.avatarImg.innerHTML;
    dom.avatarImg.innerHTML = `<span class="btn-spinner" style="border-color:rgba(255,255,255,0.5);border-top-color:#fff;"></span>`;
    try {
        const { url } = await uploadImageFile(file, `customers/${currentCustomer.uid}/avatar`);
        await updateCustomerProfile(currentCustomer.uid, { avatar: url });
        showToast("Đã cập nhật ảnh đại diện.", "success");
        window.dispatchEvent(
            new CustomEvent("shopviet:account-updated", { detail: { ...currentCustomer, avatar: url } })
        );
    } catch (err) {
        console.error("[profile] Lỗi tải ảnh đại diện:", err);
        showToast("Không thể tải ảnh lên. Vui lòng thử lại.", "error");
        dom.avatarImg.innerHTML = originalHtml;
    }
}

/* ============================================================
   Tab: Đơn hàng
   ============================================================ */
function emptyStateHtml(title, desc, icon) {
    return `
    <div class="profile-empty">
      ${icon}
      <div class="profile-empty__title">${title}</div>
      <p>${desc}</p>
    </div>
  `;
}

async function loadOrders(dom) {
    dom.ordersList.innerHTML = Array.from({ length: 3 })
        .map(() => `<div class="skeleton profile-skeleton-row"></div>`)
        .join("");
    try {
        const q = query(collection(db, "orders"), where("customerId", "==", currentCustomer.uid), orderBy("createdAt", "desc"));
        const snap = await getDocs(q);
        const orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

        if (!orders.length) {
            dom.ordersList.innerHTML = emptyStateHtml(
                "Chưa có đơn hàng nào",
                "Các đơn hàng bạn đặt sẽ hiển thị tại đây.",
                `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 7h18l-1.5 12.5a2 2 0 01-2 1.5H6.5a2 2 0 01-2-1.5z"/><path d="M8 7V5a4 4 0 018 0v2"/></svg>`
            );
            return;
        }

        dom.ordersList.innerHTML = orders
            .map((o) => {
                const info = ORDER_STATUS_MAP[o.status] || { label: o.status || "—", badge: "badge--neutral" };
                const itemsCount = Array.isArray(o.items) ? o.items.reduce((sum, it) => sum + (Number(it.quantity) || 1), 0) : 0;
                return `
        <div class="order-item">
          <div class="order-item__top">
            <div>
              <div class="order-item__code">Đơn #${escapeHtml(o.orderCode || o.id.slice(0, 6).toUpperCase())}</div>
              <div class="order-item__date">${formatDate(o.createdAt)}</div>
            </div>
            <span class="badge ${info.badge}">${escapeHtml(info.label)}</span>
          </div>
          <div class="order-item__bottom">
            <div class="order-item__items-count">${itemsCount} sản phẩm</div>
            <div class="order-item__total">${formatCurrency(Number(o.total) || 0)}</div>
          </div>
        </div>
      `;
            })
            .join("");
    } catch (err) {
        console.error("[profile] Lỗi tải đơn hàng:", err);
        dom.ordersList.innerHTML = emptyStateHtml(
            "Không thể tải đơn hàng",
            "Đã có lỗi xảy ra, vui lòng thử lại sau.",
            `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></svg>`
        );
    }
}

/* ============================================================
   Tab: Voucher
   ============================================================ */
async function loadVouchers(dom) {
    dom.vouchersList.innerHTML = `<div class="voucher-grid">${Array.from({ length: 2 })
        .map(() => `<div class="skeleton profile-skeleton-row"></div>`)
        .join("")}</div>`;
    try {
        const q = query(collection(db, "vouchers"), where("isActive", "==", true));
        const snap = await getDocs(q);
        const now = new Date();
        const vouchers = snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((v) => {
                if (v.endDate && new Date(v.endDate) < now) return false;
                if (v.startDate && new Date(v.startDate) > now) return false;
                if (typeof v.usageLimit === "number" && (v.usedCount || 0) >= v.usageLimit) return false;
                if (v.applyScope === "customers") return (v.applyTargets || []).includes(currentCustomer.uid);
                if (v.applyScope === "products") return true; // áp dụng theo sản phẩm, hiển thị để khách biết
                return true; // applyScope "all"
            });

        if (!vouchers.length) {
            dom.vouchersList.innerHTML = emptyStateHtml(
                "Chưa có voucher khả dụng",
                "Các mã giảm giá dành cho bạn sẽ hiển thị tại đây.",
                `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M20 12V8a2 2 0 00-2-2H6a2 2 0 00-2 2v4a2 2 0 010 4v4a2 2 0 002 2h12a2 2 0 002-2v-4a2 2 0 010-4z"/></svg>`
            );
            return;
        }

        dom.vouchersList.innerHTML = `<div class="voucher-grid">${vouchers
            .map((v) => {
                const valueLabel =
                    v.discountType === "percent"
                        ? `Giảm ${v.value}%${v.maxDiscount ? ` (tối đa ${formatCurrency(Number(v.maxDiscount))})` : ""}`
                        : `Giảm ${formatCurrency(Number(v.value) || 0)}`;
                const descLabel = v.minOrderValue
                    ? `Áp dụng cho đơn từ ${formatCurrency(Number(v.minOrderValue))}`
                    : "Áp dụng cho mọi đơn hàng";
                const expiryLabel = v.endDate ? `HSD: ${formatDate(new Date(v.endDate))}` : "Không giới hạn thời gian";
                return `
          <div class="voucher-item">
            <div class="voucher-item__code">${escapeHtml(v.code || "")}</div>
            <div class="voucher-item__value">${escapeHtml(valueLabel)}</div>
            <div class="voucher-item__desc">${escapeHtml(descLabel)}</div>
            <div class="voucher-item__expiry">${escapeHtml(expiryLabel)}</div>
          </div>
        `;
            })
            .join("")}</div>`;
    } catch (err) {
        console.error("[profile] Lỗi tải voucher:", err);
        dom.vouchersList.innerHTML = emptyStateHtml(
            "Không thể tải voucher",
            "Đã có lỗi xảy ra, vui lòng thử lại sau.",
            `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></svg>`
        );
    }
}

/* ============================================================
   Chuyển tab
   ============================================================ */
function bindTabs(dom) {
    dom.navItems.forEach((btn) => {
        btn.addEventListener("click", () => {
            const tab = btn.dataset.tab;
            dom.navItems.forEach((b) => b.classList.toggle("is-active", b === btn));
            dom.panels.forEach((p) => p.classList.toggle("is-active", p.dataset.panel === tab));

            if (tab === "orders" && !loadedTabs.has("orders")) {
                loadedTabs.add("orders");
                loadOrders(dom);
            }
            if (tab === "vouchers" && !loadedTabs.has("vouchers")) {
                loadedTabs.add("vouchers");
                loadVouchers(dom);
            }
        });
    });
}

function bindForms(dom) {
    dom.infoForm.addEventListener("submit", (e) => handleInfoSubmit(e, dom));
    dom.addressForm.addEventListener("submit", (e) => handleAddressSubmit(e, dom));
    dom.passwordForm.addEventListener("submit", (e) => handlePasswordSubmit(e, dom));
    dom.avatarEditBtn.addEventListener("click", () => dom.avatarInput.click());
    dom.avatarInput.addEventListener("change", (e) => handleAvatarChange(e, dom));

    [dom.fullNameInput, dom.phoneInput].forEach((input) =>
        input.addEventListener("input", () => setFieldError(input.id, null))
    );
    dom.addressInput.addEventListener("input", () => setFieldError("pf-address", null));
    [dom.pwCurrent, dom.pwNew, dom.pwConfirm].forEach((input) =>
        input.addEventListener("input", () => setFieldError(input.id, null))
    );
}

/* ============================================================
   Route guard + theo dõi hồ sơ realtime
   ============================================================ */
function watchProfile(dom) {
    unsubAuthState = onAuthStateChanged(auth, (user) => {
        if (unsubCustomerDoc) {
            unsubCustomerDoc();
            unsubCustomerDoc = null;
        }

        if (!user) {
            window.location.href = "login.html?redirect=profile.html";
            return;
        }

        unsubCustomerDoc = onSnapshot(
            doc(db, "customers", user.uid),
            (snap) => {
                if (!snap.exists()) {
                    showToast("Không tìm thấy hồ sơ khách hàng.", "error");
                    window.location.href = "index.html";
                    return;
                }
                const data = snap.data();
                if (["locked", "rejected"].includes(data.status)) {
                    showToast("Tài khoản của bạn không thể truy cập trang này.", "error");
                    window.location.href = "index.html";
                    return;
                }

                currentCustomer = { uid: user.uid, ...data };
                renderIdentity(dom, currentCustomer);
                fillForms(dom, currentCustomer);

                dom.loading.style.display = "none";
                dom.shell.style.display = "grid";
            },
            (err) => {
                console.error("[profile] Lỗi tải hồ sơ:", err);
                showToast("Không thể tải thông tin tài khoản.", "error");
            }
        );
    });
}

/**
 * Điểm khởi động trang — được gọi bởi site-router.js mỗi khi trang
 * Cá nhân được hiển thị.
 */
export async function initPage() {
    const dom = cacheDom();
    bindTabs(dom);
    bindForms(dom);
    watchProfile(dom);
}

/**
 * Được site-router.js gọi ngay TRƯỚC khi rời khỏi trang Cá nhân —
 * huỷ theo dõi Auth + hồ sơ khách hàng realtime để tránh listener
 * chồng chéo mỗi lần điều hướng SPA quay lại trang này.
 */
export function disposePage() {
    unsubAuthState?.();
    unsubCustomerDoc?.();
    unsubAuthState = null;
    unsubCustomerDoc = null;
}