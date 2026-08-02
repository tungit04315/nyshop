// ============================================================
// checkout.js
// Controller cho checkout.html (Thanh toán):
// - Đọc các sản phẩm ĐÃ ĐƯỢC CHỌN từ cart-store.js (không phải toàn bộ giỏ).
// - Form thông tin người nhận + địa chỉ giao hàng (Tỉnh/Thành - Quận/Huyện
//   lấy từ collection "shippingFees", KHÔNG hardcode).
// - Áp / gỡ voucher (dùng lại logic ở js/vouchers.js, đồng bộ với Giỏ hàng
//   qua sessionStorage "shopviet_checkout_voucher").
// - Khi bấm "Đặt hàng":
//     1) Kiểm tra khách đã đăng nhập + tài khoản đã được duyệt.
//     2) Kiểm tra tồn kho trước khi tạo đơn — đọc TRỰC TIẾP Firestore
//        (firestore-service.js: checkStockDirect), không qua Cloud Function.
//     3) Tạo document "orders" (client tạo trực tiếp theo firestore.rules:
//        allow create nếu customerId == uid hiện tại).
//     4) Tăng lượt dùng voucher (nếu có áp dụng).
//     5) Xoá các sản phẩm vừa đặt khỏi giỏ hàng.
//     6) Hiển thị trạng thái Thành công.
// Loading / Empty / Success state theo đúng cấu trúc có sẵn trong checkout.html.
// ============================================================

import { auth, db } from "../firebase/firebase-config.js";
import {
    collection,
    doc,
    addDoc,
    setDoc,
    getDoc,
    serverTimestamp,
    arrayUnion,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { refreshLayoutEffects } from "./layout.js";
import { escapeHtml, formatCurrency, setButtonLoading, generateOrderCode } from "./shop-helpers.js";
import { showToast } from "./toast.js";
import {
    subscribeCart,
    removeManyFromCart,
} from "./cart-store.js";
import { watchCustomerAuth } from "./customer-auth.js";
import { getShippingProvinces, getShippingDistricts, checkStockDirect } from "../firebase/firestore-service.js";
import { translateFunctionsError } from "./cloud-functions.js";
import { validateVoucherClient, incrementVoucherUsage } from "./vouchers.js";
import {
    validateFullName,
    validatePhone,
    validateAddress,
    setFieldError,
    runValidation,
} from "./validators.js";

const CHECKOUT_VOUCHER_KEY = "shopviet_checkout_voucher";

let dom;
let currentCustomer = null; // { uid, fullName, phone, email, status, ... } | null
let latestCartState = { items: [], subtotal: 0, totalCount: 0, selectedItems: [] };
let selectedItems = [];
let appliedVoucher = null; // { code, discount, voucher }
let selectedShippingFee = null; // number | null (null = chưa chọn Quận/Huyện)
let districtsCache = [];
let isPlacingOrder = false;

// Hàm huỷ theo dõi Auth khách hàng + Giỏ hàng realtime — được gán trong
// initPage() và gọi lại trong disposePage() khi rời trang.
let unsubCustomerAuth = null;
let unsubCartState = null;

/* ============================================================
   DOM
   ============================================================ */
function cacheDom() {
    return {
        loading: document.getElementById("checkout-loading"),
        empty: document.getElementById("checkout-empty"),
        success: document.getElementById("checkout-success"),
        content: document.getElementById("checkout-content"),

        fullname: document.getElementById("co-fullname"),
        phone: document.getElementById("co-phone"),

        shippingLoading: document.getElementById("checkout-shipping-loading"),
        shippingEmpty: document.getElementById("checkout-shipping-empty"),
        shippingFields: document.getElementById("checkout-shipping-fields"),
        province: document.getElementById("co-province"),
        district: document.getElementById("co-district"),
        address: document.getElementById("co-address"),
        note: document.getElementById("co-note"),

        itemsCount: document.getElementById("checkout-items-count"),
        itemsList: document.getElementById("checkout-items-list"),

        voucherApplied: document.getElementById("checkout-voucher-applied"),
        voucherCode: document.getElementById("checkout-voucher-code"),
        voucherDesc: document.getElementById("checkout-voucher-desc"),
        voucherRemoveBtn: document.getElementById("checkout-voucher-remove-btn"),
        voucherEmpty: document.getElementById("checkout-voucher-empty"),
        voucherCodeInput: document.getElementById("checkout-voucher-code-input"),
        voucherApplyBtn: document.getElementById("checkout-voucher-apply-btn"),
        voucherCodeError: document.getElementById("checkout-voucher-code-error"),

        summarySubtotal: document.getElementById("checkout-summary-subtotal"),
        summaryShipping: document.getElementById("checkout-summary-shipping"),
        summaryDiscount: document.getElementById("checkout-summary-discount"),
        summaryTotal: document.getElementById("checkout-summary-total"),

        placeOrderBtn: document.getElementById("checkout-place-order-btn"),
    };
}

/* ============================================================
   Trạng thái trang: loading / empty / content / success
   ============================================================ */
function showState(state) {
    dom.loading.style.display = state === "loading" ? "block" : "none";
    dom.empty.style.display = state === "empty" ? "flex" : "none";
    dom.success.style.display = state === "success" ? "flex" : "none";
    dom.content.style.display = state === "content" ? "grid" : "none";
}

/* ============================================================
   Render danh sách sản phẩm (chỉ xem)
   ============================================================ */
function renderItemRow(item) {
    return `
    <div class="checkout-item-row">
      <div class="checkout-item-row__thumb">${item.thumbnail ? `<img src="${escapeHtml(item.thumbnail)}" alt="" />` : ""}</div>
      <div class="checkout-item-row__info">
        <div class="checkout-item-row__name">${escapeHtml(item.name)}</div>
        <div class="checkout-item-row__meta">${formatCurrency(item.price)} × ${item.quantity}</div>
      </div>
      <div class="checkout-item-row__subtotal">${formatCurrency(Number(item.price) * Number(item.quantity))}</div>
    </div>`;
}

function renderItems() {
    dom.itemsCount.textContent = selectedItems.length;
    dom.itemsList.innerHTML = selectedItems.map(renderItemRow).join("");
    refreshLayoutEffects(dom.itemsList);
}

/* ============================================================
   Tóm tắt đơn hàng
   ============================================================ */
function getSubtotal() {
    return selectedItems.reduce((sum, i) => sum + Number(i.price || 0) * Number(i.quantity || 0), 0);
}

function getDiscount(subtotal) {
    if (!appliedVoucher) return 0;
    return Math.min(Number(appliedVoucher.discount) || 0, subtotal);
}

function renderSummary() {
    const subtotal = getSubtotal();
    const discount = getDiscount(subtotal);
    const hasShipping = selectedShippingFee !== null;
    const shippingFee = hasShipping ? selectedShippingFee : 0;
    const total = Math.max(0, subtotal + shippingFee - discount);

    dom.summarySubtotal.textContent = formatCurrency(subtotal);
    dom.summaryShipping.textContent = hasShipping ? formatCurrency(shippingFee) : "— ₫";
    dom.summaryDiscount.textContent = discount > 0 ? `−${formatCurrency(discount)}` : formatCurrency(0);
    dom.summaryTotal.textContent = formatCurrency(total);
}

/* ============================================================
   Voucher
   ============================================================ */
function persistVoucher() {
    if (appliedVoucher) {
        sessionStorage.setItem(CHECKOUT_VOUCHER_KEY, JSON.stringify(appliedVoucher));
    } else {
        sessionStorage.removeItem(CHECKOUT_VOUCHER_KEY);
    }
}

function renderVoucherBlock() {
    if (appliedVoucher) {
        dom.voucherApplied.style.display = "block";
        dom.voucherEmpty.style.display = "none";
        dom.voucherCode.textContent = `Đã áp dụng: ${appliedVoucher.code}`;
        const v = appliedVoucher.voucher || {};
        dom.voucherDesc.textContent =
            v.discountType === "percent"
                ? `Giảm ${v.value}% — tiết kiệm ${formatCurrency(appliedVoucher.discount)}`
                : `Giảm trực tiếp ${formatCurrency(appliedVoucher.discount)}`;
    } else {
        dom.voucherApplied.style.display = "none";
        dom.voucherEmpty.style.display = "block";
    }
}

async function applyVoucherCode(rawCode) {
    const trimmed = (rawCode || "").trim().toUpperCase();
    dom.voucherCodeError.textContent = "";
    dom.voucherCodeError.classList.remove("is-visible");

    if (!trimmed) {
        dom.voucherCodeError.textContent = "Vui lòng nhập mã giảm giá.";
        dom.voucherCodeError.classList.add("is-visible");
        return;
    }
    if (!selectedItems.length) {
        showToast("Không có sản phẩm để áp dụng voucher.", "error");
        return;
    }

    setButtonLoading(dom.voucherApplyBtn, true, "Đang kiểm tra...");
    try {
        const productIds = selectedItems.map((i) => i.productId);
        const res = await validateVoucherClient({
            code: trimmed,
            orderTotal: getSubtotal(),
            productIds,
            customerId: currentCustomer ? currentCustomer.uid : null,
        });
        appliedVoucher = { code: trimmed, discount: res.discount, voucher: res.voucher };
        persistVoucher();
        renderVoucherBlock();
        renderSummary();
        showToast(`Áp dụng mã "${trimmed}" thành công.`, "success");
    } catch (err) {
        console.error("[checkout] Lỗi áp dụng voucher:", err);
        dom.voucherCodeError.textContent = translateFunctionsError(err);
        dom.voucherCodeError.classList.add("is-visible");
    } finally {
        setButtonLoading(dom.voucherApplyBtn, false);
    }
}

function bindVoucher() {
    dom.voucherApplyBtn.addEventListener("click", () => applyVoucherCode(dom.voucherCodeInput.value));
    dom.voucherCodeInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            applyVoucherCode(dom.voucherCodeInput.value);
        }
    });
    dom.voucherCodeInput.addEventListener("input", () => {
        dom.voucherCodeError.classList.remove("is-visible");
    });
    dom.voucherRemoveBtn.addEventListener("click", () => {
        appliedVoucher = null;
        persistVoucher();
        renderVoucherBlock();
        renderSummary();
        showToast("Đã bỏ áp dụng voucher.", "info");
    });
}

/* ============================================================
   Địa chỉ giao hàng: Tỉnh/Thành -> Quận/Huyện (+ phí ship)
   ============================================================ */
async function loadProvinces() {
    dom.shippingLoading.style.display = "block";
    dom.shippingEmpty.style.display = "none";
    dom.shippingFields.style.display = "none";

    try {
        const provinces = await getShippingProvinces();
        dom.shippingLoading.style.display = "none";

        if (!provinces.length) {
            dom.shippingEmpty.style.display = "block";
            return;
        }

        dom.province.innerHTML =
            `<option value="">— Chọn Tỉnh/Thành —</option>` +
            provinces.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("");
        dom.shippingFields.style.display = "block";
    } catch (err) {
        console.error("[checkout] Lỗi tải danh sách Tỉnh/Thành:", err);
        dom.shippingLoading.style.display = "none";
        dom.shippingEmpty.style.display = "block";
    }
}

async function handleProvinceChange() {
    const province = dom.province.value;
    selectedShippingFee = null;
    dom.district.innerHTML = `<option value="">— Chọn Quận/Huyện —</option>`;
    dom.district.disabled = true;
    setFieldError("co-district", "");
    renderSummary();

    if (!province) return;

    dom.district.disabled = true;
    try {
        districtsCache = await getShippingDistricts(province);
        if (!districtsCache.length) {
            dom.district.innerHTML = `<option value="">Khu vực này chưa có phí ship</option>`;
            return;
        }
        dom.district.innerHTML =
            `<option value="">— Chọn Quận/Huyện —</option>` +
            districtsCache
                .map((d) => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.district)} (+${formatCurrency(Number(d.fee) || 0)})</option>`)
                .join("");
        dom.district.disabled = false;
    } catch (err) {
        console.error("[checkout] Lỗi tải danh sách Quận/Huyện:", err);
        showToast("Không thể tải danh sách Quận/Huyện. Vui lòng thử lại.", "error");
    }
}

function handleDistrictChange() {
    const districtId = dom.district.value;
    const found = districtsCache.find((d) => d.id === districtId);
    selectedShippingFee = found ? Number(found.fee) || 0 : null;
    setFieldError("co-district", "");
    renderSummary();
}

function bindShippingFields() {
    dom.province.addEventListener("change", handleProvinceChange);
    dom.district.addEventListener("change", handleDistrictChange);
}

/* ============================================================
   Đăng nhập & hồ sơ khách hàng (prefill Họ tên / SĐT)
   ============================================================ */
let hasPrefilled = false;

function handleCustomerChange(customer) {
    currentCustomer = customer;

    if (!customer) {
        showToast("Vui lòng đăng nhập để tiến hành thanh toán.", "info");
        window.location.href = "login.html?redirect=checkout.html";
        return;
    }

    if (!hasPrefilled) {
        hasPrefilled = true;
        if (!dom.fullname.value) dom.fullname.value = customer.fullName || "";
        if (!dom.phone.value) dom.phone.value = customer.phone || "";
    }
}

/* ============================================================
   Validate form
   ============================================================ */
function validateCheckoutForm() {
    const ok1 = runValidation([
        { fieldId: "co-fullname", value: dom.fullname.value, validator: validateFullName },
        { fieldId: "co-phone", value: dom.phone.value, validator: validatePhone },
        { fieldId: "co-address", value: dom.address.value, validator: validateAddress },
    ]);

    let ok2 = true;
    if (!dom.province.value) {
        setFieldError("co-province", "Vui lòng chọn Tỉnh/Thành.");
        ok2 = false;
    } else {
        setFieldError("co-province", "");
    }

    let ok3 = true;
    if (!dom.district.value || selectedShippingFee === null) {
        setFieldError("co-district", "Vui lòng chọn Quận/Huyện.");
        ok3 = false;
    } else {
        setFieldError("co-district", "");
    }

    return ok1 && ok2 && ok3;
}

/* ============================================================
   Đặt hàng
   ============================================================ */
async function placeOrder() {
    if (isPlacingOrder) return;

    if (!currentCustomer) {
        window.location.href = "login.html?redirect=checkout.html";
        return;
    }
    if (currentCustomer.status === "pending") {
        showToast("Tài khoản của bạn đang chờ duyệt nên chưa thể đặt hàng.", "warning", 4500);
        return;
    }
    if (!selectedItems.length) {
        showToast("Không có sản phẩm nào để đặt hàng.", "error");
        return;
    }
    if (!validateCheckoutForm()) {
        showToast("Vui lòng kiểm tra lại thông tin bên trên.", "error");
        return;
    }

    isPlacingOrder = true;
    setButtonLoading(dom.placeOrderBtn, true, "Đang xử lý...");

    try {
        // ---- 1) Kiểm tra tồn kho trước khi tạo đơn ----
        const stockCheck = await checkStockDirect(
            selectedItems.map((i) => ({ productId: i.productId, quantity: i.quantity }))
        );
        if (!stockCheck.ok) {
            const names = (stockCheck.shortages || []).map((s) => s.productName).join(", ");
            showToast(
                names
                    ? `Một số sản phẩm không đủ tồn kho: ${names}. Vui lòng quay lại giỏ hàng để điều chỉnh.`
                    : "Một số sản phẩm không còn đủ tồn kho. Vui lòng quay lại giỏ hàng để điều chỉnh.",
                "error",
                5000
            );
            return;
        }

        // ---- 2) Chuẩn bị dữ liệu đơn hàng ----
        const subtotal = getSubtotal();
        const shippingFee = selectedShippingFee || 0;
        const discount = getDiscount(subtotal);
        const total = Math.max(0, subtotal + shippingFee - discount);

        const districtOption = districtsCache.find((d) => d.id === dom.district.value);
        const fullAddress = [
            dom.address.value.trim(),
            districtOption ? districtOption.district : "",
            dom.province.value,
        ]
            .filter(Boolean)
            .join(", ");

        const orderItems = selectedItems.map((i) => ({
            productId: i.productId,
            productName: i.name,
            thumbnail: i.thumbnail || "",
            price: Number(i.price) || 0,
            quantity: Number(i.quantity) || 0,
            subtotal: (Number(i.price) || 0) * (Number(i.quantity) || 0),
        }));

        const orderData = {
            customerId: currentCustomer.uid,
            customerName: dom.fullname.value.trim(),
            customerPhone: dom.phone.value.trim(),
            customerEmail: currentCustomer.email || "",
            shippingAddress: fullAddress,
            province: dom.province.value,
            district: districtOption ? districtOption.district : "",
            note: dom.note.value.trim(),
            items: orderItems,
            subtotal,
            shippingFee,
            voucherCode: appliedVoucher ? appliedVoucher.code : null,
            voucherId: appliedVoucher && appliedVoucher.voucher ? appliedVoucher.voucher.id : null,
            voucherDiscount: discount,
            total,
            paymentMethod: "cod",
            status: "pending",
            createdAt: serverTimestamp(),
        };

        // ---- 3) Tạo đơn hàng ----
        const orderRef = await addDoc(collection(db, "orders"), orderData);

        // ---- 3b) Ghi chỉ mục tra cứu công khai (orderLookup) theo SĐT/Email ----
        // Phục vụ trang order-lookup.html (khách vãng lai) đọc TRỰC TIẾP
        // Firestore, không qua Cloud Function — xem firebase/firestore-service.js:
        // lookupOrdersDirect() và firestore.rules: collection "orderLookup".
        // Không chặn luồng đặt hàng nếu bước này lỗi.
        try {
            const lookupKeys = [];
            if (orderData.customerPhone) lookupKeys.push(orderData.customerPhone);
            if (orderData.customerEmail) lookupKeys.push(orderData.customerEmail.toLowerCase());
            await Promise.all(
                lookupKeys.map((key) =>
                    setDoc(doc(db, "orderLookup", key), { orderIds: arrayUnion(orderRef.id) }, { merge: true })
                )
            );
        } catch (err) {
            console.error("[checkout] Lỗi ghi orderLookup:", err);
        }

        // ---- 4) Tăng lượt dùng voucher (không chặn luồng nếu lỗi) ----
        if (orderData.voucherId) {
            try {
                await incrementVoucherUsage(orderData.voucherId);
            } catch (err) {
                console.error("[checkout] Lỗi cập nhật lượt dùng voucher:", err);
            }
        }

        // ---- 5) Xoá sản phẩm vừa đặt khỏi giỏ hàng ----
        await removeManyFromCart(selectedItems.map((i) => i.productId));

        // ---- 6) Dọn dẹp & hiển thị thành công ----
        appliedVoucher = null;
        sessionStorage.removeItem(CHECKOUT_VOUCHER_KEY);

        document.getElementById("checkout-success-desc").textContent =
            `Cảm ơn bạn đã mua sắm tại ShopViet. Mã đơn hàng của bạn là #${orderRef.id.slice(0, 6).toUpperCase()}.`;
        showState("success");
    } catch (err) {
        console.error("[checkout] Lỗi đặt hàng:", err);
        showToast(translateFunctionsError(err), "error");
    } finally {
        isPlacingOrder = false;
        setButtonLoading(dom.placeOrderBtn, false);
    }
}

function bindPlaceOrder() {
    dom.placeOrderBtn.addEventListener("click", placeOrder);
}

/* ============================================================
   Giỏ hàng: lấy sản phẩm ĐÃ CHỌN
   ============================================================ */
function handleCartState(state) {
    latestCartState = state;
    selectedItems = state.selectedItems;

    if (!selectedItems.length) {
        showState("empty");
        return;
    }

    showState("content");
    renderItems();
    renderSummary();
}

/* ============================================================
   Khởi tạo
   ============================================================ */
/**
 * Điểm khởi động trang — được gọi bởi site-router.js mỗi khi trang
 * Thanh toán được hiển thị.
 */
export async function initPage() {
    dom = cacheDom();
    showState("loading");

    // Khôi phục voucher đã chọn từ Giỏ hàng (nếu có, còn hiệu lực trong phiên)
    try {
        const saved = sessionStorage.getItem(CHECKOUT_VOUCHER_KEY);
        if (saved) appliedVoucher = JSON.parse(saved);
    } catch {
        appliedVoucher = null;
    }
    renderVoucherBlock();

    bindVoucher();
    bindShippingFields();
    bindPlaceOrder();

    loadProvinces();
    unsubCustomerAuth = watchCustomerAuth(handleCustomerChange);

    try {
        unsubCartState = subscribeCart(handleCartState);
    } catch (err) {
        console.error("[checkout] Lỗi tải giỏ hàng:", err);
        showToast("Không thể tải giỏ hàng. Vui lòng thử lại.", "error");
        showState("empty");
    }
}

/**
 * Được site-router.js gọi ngay TRƯỚC khi rời khỏi trang Thanh toán —
 * huỷ theo dõi Auth + Giỏ hàng realtime để tránh listener chồng chéo.
 */
export function disposePage() {
    unsubCustomerAuth?.();
    unsubCartState?.();
    unsubCustomerAuth = null;
    unsubCartState = null;
}

