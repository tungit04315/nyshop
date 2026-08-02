// ============================================================
// cart-store.js
// "Nguồn sự thật" (single source of truth) cho Giỏ hàng của Storefront:
// - Khách vãng lai (chưa đăng nhập): lưu ở LocalStorage.
// - Sau khi đăng nhập: gộp giỏ hàng Local vào Firestore "carts/{uid}"
//   (cộng dồn số lượng, giới hạn theo tồn kho), rồi dùng Firestore làm
//   nguồn dữ liệu chính (đồng bộ realtime qua onSnapshot giữa các thiết
//   bị/tab), đồng thời xoá dữ liệu Local để tránh gộp trùng lần sau.
// - Giá của từng sản phẩm được tính TẠI THỜI ĐIỂM thêm vào giỏ (và có
//   thể tính lại ở Checkout để đảm bảo luôn mới nhất): salePrice nếu có,
//   ưu tiên giá Flash Sale nếu sản phẩm đang nằm trong 1 chương trình
//   Flash Sale đang chạy (isActive + trong khung giờ) và còn suất.
// Mọi trang dùng chung module này (Header, cart.html, checkout.html) để
// tránh trạng thái giỏ hàng bị lệch nhau.
// ============================================================

import { auth, db } from "../firebase/firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
    doc,
    getDoc,
    setDoc,
    onSnapshot,
    serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getProductById, getActiveFlashSales } from "../firebase/firestore-service.js";

const STORAGE_KEY = "shopviet_cart_v1";

let items = [];
let currentUid = null;
let unsubCartDoc = null;
let initialized = false;
const listeners = new Set();

/* ============================================================
   LocalStorage (khách vãng lai)
   ============================================================ */
function loadLocal() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function saveLocal(nextItems) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextItems));
    } catch (err) {
        console.error("[cart-store] Không thể lưu giỏ hàng vào LocalStorage:", err);
    }
}

/* ============================================================
   Pub-sub: các trang subscribe để nhận state mới nhất
   ============================================================ */
function getState() {
    const selectedItems = items.filter((i) => i.selected);
    const subtotal = selectedItems.reduce((sum, i) => sum + Number(i.price || 0) * Number(i.quantity || 0), 0);
    const totalCount = items.reduce((sum, i) => sum + Number(i.quantity || 0), 0);
    return { items: [...items], subtotal, totalCount, selectedItems: [...selectedItems] };
}

function notify() {
    const state = getState();
    listeners.forEach((fn) => {
        try {
            fn(state);
        } catch (err) {
            console.error("[cart-store] Lỗi trong listener:", err);
        }
    });
}

/**
 * Đăng ký lắng nghe thay đổi giỏ hàng. Gọi ngay 1 lần với state hiện tại.
 * @param {(state:{items:Array, subtotal:number, totalCount:number, selectedItems:Array})=>void} fn
 * @returns {() => void} hàm hủy đăng ký
 */
export function subscribeCart(fn) {
    listeners.add(fn);
    fn(getState());
    return () => listeners.delete(fn);
}

export function getCartState() {
    return getState();
}

/* ============================================================
   Ghi dữ liệu: LocalStorage (khách) hoặc Firestore (đã đăng nhập)
   ============================================================ */
async function persist() {
    if (currentUid) {
        try {
            await setDoc(doc(db, "carts", currentUid), { items, updatedAt: serverTimestamp() });
        } catch (err) {
            console.error("[cart-store] Lỗi lưu giỏ hàng lên Firestore:", err);
        }
    } else {
        saveLocal(items);
    }
    notify();
}

/* ============================================================
   Tính giá hiệu lực của 1 sản phẩm (có xét Flash Sale đang chạy)
   ============================================================ */
/**
 * @param {string} productId
 * @returns {Promise<Object|null>} thông tin sản phẩm + giá hiệu lực, null nếu không tìm thấy/ngừng bán
 */
export async function resolveProductPricing(productId) {
    const product = await getProductById(productId);
    if (!product || product.status !== "active") return null;

    let flashItem = null;
    try {
        const flashSales = await getActiveFlashSales();
        const now = new Date();
        for (const fs of flashSales) {
            const start = fs.startTime ? new Date(fs.startTime) : null;
            const end = fs.endTime ? new Date(fs.endTime) : null;
            if (start && now < start) continue;
            if (end && now > end) continue;
            const found = (fs.items || []).find((it) => it.productId === productId);
            if (found) {
                const remaining = (Number(found.quantity) || 0) - (Number(found.sold) || 0);
                if (remaining > 0) {
                    flashItem = { ...found, remaining };
                    break;
                }
            }
        }
    } catch (err) {
        console.error("[cart-store] Lỗi kiểm tra Flash Sale:", err);
    }

    const basePrice = Number(product.salePrice) > 0 ? Number(product.salePrice) : Number(product.price) || 0;
    const price = flashItem ? Number(flashItem.flashPrice) || basePrice : basePrice;

    return {
        productId,
        name: product.name || "Sản phẩm",
        // Ưu tiên thumbnailUrl (denormalized từ album ảnh riêng "productImages");
        // fallback images[0].url cho sản phẩm cũ tạo trước khi có album ảnh.
        thumbnail: product.thumbnailUrl || (product.images && product.images[0] ? product.images[0].url : ""),
        price,
        originalPrice: Number(product.price) || 0,
        isFlashSale: !!flashItem,
        flashRemaining: flashItem ? flashItem.remaining : null,
        stock: Number(product.stock) || 0,
        status: product.status,
    };
}

/* ============================================================
   Thao tác giỏ hàng
   ============================================================ */
/**
 * Thêm sản phẩm vào giỏ (hoặc tăng số lượng nếu đã có).
 * Luôn lấy giá/tồn kho MỚI NHẤT từ Firestore tại thời điểm thêm.
 * @param {string} productId
 * @param {number} quantity
 * @returns {Promise<{ok:boolean, message?:string}>}
 */
export async function addToCart(productId, quantity = 1) {
    const pricing = await resolveProductPricing(productId);
    if (!pricing) return { ok: false, message: "Sản phẩm không tồn tại hoặc đã ngừng kinh doanh." };
    if (pricing.stock <= 0) return { ok: false, message: "Sản phẩm đã hết hàng." };

    const existing = items.find((i) => i.productId === productId);
    const nextQty = Math.min((existing?.quantity || 0) + quantity, pricing.stock);

    if (existing) {
        existing.price = pricing.price;
        existing.originalPrice = pricing.originalPrice;
        existing.isFlashSale = pricing.isFlashSale;
        existing.name = pricing.name;
        existing.thumbnail = pricing.thumbnail;
        existing.stock = pricing.stock;
        existing.quantity = nextQty;
    } else {
        items.push({
            productId,
            name: pricing.name,
            thumbnail: pricing.thumbnail,
            price: pricing.price,
            originalPrice: pricing.originalPrice,
            isFlashSale: pricing.isFlashSale,
            stock: pricing.stock,
            quantity: Math.min(quantity, pricing.stock),
            selected: true,
        });
    }

    await persist();
    return { ok: true };
}

/**
 * Cập nhật số lượng 1 sản phẩm (giới hạn trong khoảng 1..stock).
 * @param {string} productId
 * @param {number} quantity
 */
export async function updateCartQuantity(productId, quantity) {
    const item = items.find((i) => i.productId === productId);
    if (!item) return;
    item.quantity = Math.max(1, Math.min(Number(quantity) || 1, Number(item.stock) || 1));
    await persist();
}

/**
 * Xoá 1 sản phẩm khỏi giỏ.
 * @param {string} productId
 */
export async function removeFromCart(productId) {
    items = items.filter((i) => i.productId !== productId);
    await persist();
}

/**
 * Xoá nhiều sản phẩm cùng lúc (dùng sau khi đặt hàng thành công).
 * @param {string[]} productIds
 */
export async function removeManyFromCart(productIds) {
    const idSet = new Set(productIds);
    items = items.filter((i) => !idSet.has(i.productId));
    await persist();
}

/**
 * Chọn / bỏ chọn 1 sản phẩm (checkbox trong giỏ hàng).
 * @param {string} productId
 * @param {boolean} selected
 */
export async function setItemSelected(productId, selected) {
    const item = items.find((i) => i.productId === productId);
    if (!item) return;
    item.selected = !!selected;
    await persist();
}

/**
 * Chọn / bỏ chọn tất cả sản phẩm.
 * @param {boolean} selected
 */
export async function setAllSelected(selected) {
    items.forEach((i) => (i.selected = !!selected));
    await persist();
}

/* ============================================================
   Đồng bộ Local -> Firestore khi đăng nhập
   ============================================================ */
function mergeCarts(cloudItems, localItems) {
    const map = new Map();
    (cloudItems || []).forEach((it) => map.set(it.productId, { ...it }));
    (localItems || []).forEach((it) => {
        if (map.has(it.productId)) {
            const existing = map.get(it.productId);
            existing.quantity = Math.min((existing.quantity || 0) + (it.quantity || 0), existing.stock || 999);
        } else {
            map.set(it.productId, { ...it });
        }
    });
    return Array.from(map.values());
}

async function handleAuthChange(user) {
    if (unsubCartDoc) {
        unsubCartDoc();
        unsubCartDoc = null;
    }

    if (user) {
        currentUid = user.uid;
        const localItems = loadLocal();
        const cartRef = doc(db, "carts", user.uid);
        try {
            const snap = await getDoc(cartRef);
            const cloudItems = snap.exists() ? snap.data().items || [] : [];
            const merged = mergeCarts(cloudItems, localItems);
            items = merged;
            await setDoc(cartRef, { items: merged, updatedAt: serverTimestamp() });
            localStorage.removeItem(STORAGE_KEY);
        } catch (err) {
            console.error("[cart-store] Lỗi đồng bộ giỏ hàng khi đăng nhập:", err);
            items = localItems;
        }

        unsubCartDoc = onSnapshot(
            cartRef,
            (snap) => {
                items = snap.exists() ? snap.data().items || [] : [];
                notify();
            },
            (err) => console.error("[cart-store] Lỗi theo dõi giỏ hàng:", err)
        );
    } else {
        currentUid = null;
        items = loadLocal();
    }

    notify();
}

/**
 * Khởi tạo module (chỉ chạy 1 lần, tự gọi khi import lần đầu).
 */
function init() {
    if (initialized) return;
    initialized = true;
    items = loadLocal();
    onAuthStateChanged(auth, handleAuthChange);
}

init();