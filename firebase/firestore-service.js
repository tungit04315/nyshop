// ============================================================
// firestore-service.js
// Lớp truy cập dữ liệu (data-access layer) CHỈ ĐỌC cho Storefront.
// Toàn bộ hàm ở đây thuần tuý lấy dữ liệu công khai từ Firestore
// (theo đúng firestore.rules: categories/products/settings đã mở
// "allow read: if true"). KHÔNG chứa logic nghiệp vụ (giỏ hàng, đơn
// hàng, voucher, thanh toán...) — những phần đó thuộc Giai đoạn sau.
// ============================================================

import { db } from "./firebase-config.js";
import {
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    where,
    orderBy,
    limit,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/**
 * Lấy cấu hình chung của website (logo, banner, tên site, liên hệ...)
 * Doc: settings/general — do Admin quản lý (js/settings.js bên web-shops-2).
 * @returns {Promise<Object|null>}
 */
export async function getSiteSettings() {
    try {
        const snap = await getDoc(doc(db, "settings", "general"));
        return snap.exists() ? snap.data() : null;
    } catch (err) {
        console.error("[firestore-service] getSiteSettings:", err);
        return null;
    }
}

/**
 * Lấy toàn bộ danh mục sản phẩm, sắp xếp theo tên.
 * @param {number} max - giới hạn số lượng (mặc định không giới hạn)
 * @returns {Promise<Array<{id:string,name:string}>>}
 */
export async function getCategories(max = 20) {
    try {
        const q = query(collection(db, "categories"), orderBy("name", "asc"), limit(max));
        const snap = await getDocs(q);
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (err) {
        console.error("[firestore-service] getCategories:", err);
        return [];
    }
}

/**
 * Lấy danh sách sản phẩm đang bán (status = "active"), mới nhất trước.
 * Dùng cho các khối "Hàng mới", "Best Seller" (Giai đoạn 1 hiển thị theo
 * thời gian tạo do chưa có số liệu bán hàng thật — việc tính best-seller
 * thực sự sẽ thuộc Giai đoạn sau).
 * @param {number} max
 */
export async function getLatestProducts(max = 8) {
    try {
        const q = query(
            collection(db, "products"),
            where("status", "==", "active"),
            orderBy("createdAt", "desc"),
            limit(max)
        );
        const snap = await getDocs(q);
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (err) {
        console.error("[firestore-service] getLatestProducts:", err);
        return [];
    }
}

/**
 * Lấy danh sách sản phẩm đang có giá khuyến mãi (salePrice > 0), dùng cho
 * khối "Deal trong ngày". Việc tính deal theo thời gian thực sẽ thuộc
 * Giai đoạn sau; ở đây chỉ hiển thị sản phẩm có salePrice để lên UI.
 * @param {number} max
 */
export async function getDealProducts(max = 6) {
    try {
        const q = query(
            collection(db, "products"),
            where("status", "==", "active"),
            orderBy("createdAt", "desc"),
            limit(30)
        );
        const snap = await getDocs(q);
        const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        return all.filter((p) => Number(p.salePrice) > 0).slice(0, max);
    } catch (err) {
        console.error("[firestore-service] getDealProducts:", err);
        return [];
    }
}

/**
 * Lấy toàn bộ sản phẩm đang bán, dùng cho trang danh sách sản phẩm
 * (products.html). Giai đoạn 1 chỉ hiển thị danh sách — lọc/sắp xếp
 * theo tiêu chí người dùng chọn sẽ được lập trình ở Giai đoạn sau.
 * @param {number} max
 */
export async function getAllActiveProducts(max = 40) {
    try {
        const q = query(
            collection(db, "products"),
            where("status", "==", "active"),
            orderBy("createdAt", "desc"),
            limit(max)
        );
        const snap = await getDocs(q);
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (err) {
        console.error("[firestore-service] getAllActiveProducts:", err);
        return [];
    }
}

/**
 * Lấy 1 sản phẩm theo id (dùng cho Giỏ hàng/Checkout để lấy giá & tồn kho
 * MỚI NHẤT tại thời điểm thêm vào giỏ / đặt hàng — không dùng dữ liệu cũ
 * đã cache trên Client).
 * @param {string} productId
 * @returns {Promise<Object|null>}
 */
export async function getProductById(productId) {
    if (!productId) return null;
    try {
        const snap = await getDoc(doc(db, "products", productId));
        return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    } catch (err) {
        console.error("[firestore-service] getProductById:", err);
        return null;
    }
}

/**
 * Lấy toàn bộ chương trình Flash Sale đang bật (isActive = true). Việc lọc
 * theo khung giờ (startTime/endTime) do phía gọi tự xử lý (Cart/Checkout
 * cần biết cả các Flash Sale sắp diễn ra hay không tuỳ ngữ cảnh).
 * @returns {Promise<Array>}
 */
export async function getActiveFlashSales() {
    try {
        const q = query(collection(db, "flashSales"), where("isActive", "==", true));
        const snap = await getDocs(q);
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (err) {
        console.error("[firestore-service] getActiveFlashSales:", err);
        return [];
    }
}

/**
 * Lấy danh sách Tỉnh/Thành đã được cấu hình phí ship (collection
 * "shippingFees", do Admin quản lý ở trang Phí Ship). Dùng làm dữ liệu
 * cho dropdown "Tỉnh/Thành" ở Checkout — KHÔNG hardcode danh sách tỉnh.
 * @returns {Promise<string[]>}
 */
export async function getShippingProvinces() {
    try {
        const snap = await getDocs(collection(db, "shippingFees"));
        const set = new Set();
        snap.docs.forEach((d) => {
            const p = d.data().province;
            if (p) set.add(p);
        });
        return Array.from(set).sort((a, b) => a.localeCompare(b, "vi"));
    } catch (err) {
        console.error("[firestore-service] getShippingProvinces:", err);
        return [];
    }
}

/**
 * Lấy danh sách Quận/Huyện (+ phí ship tương ứng) của 1 Tỉnh/Thành, đọc từ
 * collection "shippingFees".
 * @param {string} province
 * @returns {Promise<Array<{id:string, district:string, fee:number}>>}
 */
export async function getShippingDistricts(province) {
    if (!province) return [];
    try {
        const q = query(collection(db, "shippingFees"), where("province", "==", province));
        const snap = await getDocs(q);
        return snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (a.district || "").localeCompare(b.district || "", "vi"));
    } catch (err) {
        console.error("[firestore-service] getShippingDistricts:", err);
        return [];
    }
}

/**
 * Tìm sản phẩm theo tên (dùng cho ô Search ở Header).
 * Firestore không hỗ trợ full-text search nên dùng kỹ thuật range query
 * theo tiền tố tên (name >= keyword và name < keyword + '\uf8ff').
 * Lưu ý: đây chỉ là truy vấn đọc dữ liệu phục vụ hiển thị gợi ý, không
 * phải logic nghiệp vụ.
 * @param {string} keyword
 * @param {number} max
 */
export async function searchProductsByName(keyword, max = 6) {
    const trimmed = (keyword || "").trim();
    if (!trimmed) return [];
    try {
        const q = query(
            collection(db, "products"),
            where("status", "==", "active"),
            orderBy("name"),
            where("name", ">=", trimmed),
            where("name", "<=", trimmed + "\uf8ff"),
            limit(max)
        );
        const snap = await getDocs(q);
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (err) {
        console.error("[firestore-service] searchProductsByName:", err);
        return [];
    }
}

/**
 * Kiểm tra tồn kho TRỰC TIẾP bằng Firestore Client SDK — thay thế cho Cloud
 * Function "checkStock" (đã bỏ để tránh phụ thuộc CORS/IAM của Cloud Run).
 * Đọc được vì collection "products" đã "allow read: if true" trong rules.
 *
 * LƯU Ý: đây chỉ là bước kiểm tra CẢNH BÁO cho UX trước khi đặt hàng
 * (client đọc rồi so sánh, không có transaction -> có thể có race condition
 * nếu 2 khách cùng đặt sản phẩm sắp hết hàng cùng lúc). Việc TRỪ KHO thật sự
 * vẫn nằm ở Cloud Function "updateStock" (Firestore trigger khi đơn chuyển
 * "confirmed", chạy transaction + Math.max(0, ...)) — nên vẫn an toàn tuyệt
 * đối dù bước kiểm tra ở đây không atomic. Nếu cần chặn race condition ngay
 * lúc đặt hàng (không chỉ lúc admin xác nhận), hãy đưa lại về Cloud Function.
 *
 * @param {Array<{productId:string, quantity:number}>} items
 * @returns {Promise<{ok:boolean, shortages:Array}>}
 */
export async function checkStockDirect(items) {
    if (!Array.isArray(items) || items.length === 0) {
        return { ok: false, shortages: [] };
    }

    const shortages = [];
    await Promise.all(
        items.map(async (item) => {
            try {
                const snap = await getDoc(doc(db, "products", item.productId));
                const stock = snap.exists() ? Number(snap.data().stock) || 0 : 0;
                if (!snap.exists() || stock < Number(item.quantity || 0)) {
                    shortages.push({
                        productId: item.productId,
                        productName: snap.exists() ? snap.data().name : "Không tìm thấy sản phẩm",
                        available: stock,
                        requested: item.quantity,
                    });
                }
            } catch (err) {
                console.error("[firestore-service] checkStockDirect:", item.productId, err);
                shortages.push({
                    productId: item.productId,
                    productName: "Không thể kiểm tra tồn kho",
                    available: 0,
                    requested: item.quantity,
                });
            }
        })
    );

    return { ok: shortages.length === 0, shortages };
}

/**
 * Tra cứu đơn hàng công khai (khách vãng lai) bằng SĐT/Email — ĐỌC TRỰC TIẾP
 * Firestore Client SDK (KHÔNG qua Cloud Function).
 *
 * Cách hoạt động (xem thêm giải thích trong firebase/firestore.rules,
 * collection "orderLookup"):
 *   1) Chuẩn hoá SĐT/Email thành "key", get() document orderLookup/{key}
 *      (chỉ get theo đúng key, KHÔNG list) để lấy danh sách orderIds.
 *   2) get() từng orders/{orderId} + statusHistory tương ứng.
 * An toàn tương đương Cloud Function cũ: phải biết ĐÚNG SĐT/Email mới lấy
 * được orderIds; không thể liệt kê/dò toàn bộ đơn hàng của người khác.
 *
 * @param {{phone?: string, email?: string}} payload
 * @returns {Promise<Array>}
 */
export async function lookupOrdersDirect({ phone, email } = {}) {
    const keys = [];
    if (phone) keys.push(String(phone).trim());
    if (email) keys.push(String(email).trim().toLowerCase());

    if (!keys.length) {
        throw new Error("Vui lòng nhập số điện thoại hoặc email để tra cứu.");
    }

    // ---- 1) Lấy danh sách orderIds từ chỉ mục orderLookup ----
    const orderIds = new Set();
    await Promise.all(
        keys.map(async (key) => {
            try {
                const snap = await getDoc(doc(db, "orderLookup", key));
                if (snap.exists()) {
                    (snap.data().orderIds || []).forEach((id) => orderIds.add(id));
                }
            } catch (err) {
                // Không tìm thấy / không có quyền get -> coi như không khớp key này.
                console.warn("[firestore-service] lookupOrdersDirect key miss:", key, err?.code || err);
            }
        })
    );

    if (orderIds.size === 0) return [];

    // ---- 2) Lấy chi tiết từng đơn hàng + lịch sử trạng thái ----
    const orders = await Promise.all(
        Array.from(orderIds).map(async (id) => {
            try {
                const orderSnap = await getDoc(doc(db, "orders", id));
                if (!orderSnap.exists()) return null;
                const o = orderSnap.data();

                const historySnap = await getDocs(
                    query(collection(db, "orders", id, "statusHistory"), orderBy("createdAt", "asc"))
                );

                return {
                    id: orderSnap.id,
                    orderCode: o.orderCode || orderSnap.id.slice(0, 8).toUpperCase(),
                    createdAt: o.createdAt?.toDate ? o.createdAt.toDate().toISOString() : null,
                    status: o.status || "pending",
                    items: (o.items || []).map((it) => ({
                        productId: it.productId || null,
                        productName: it.productName || "",
                        thumbnail: it.thumbnail || "",
                        quantity: Number(it.quantity) || 0,
                        price: Number(it.price) || 0,
                    })),
                    subtotal: Number(o.subtotal) || 0,
                    shippingFee: Number(o.shippingFee) || 0,
                    voucherCode: o.voucherCode || null,
                    voucherDiscount: Number(o.voucherDiscount) || 0,
                    total: Number(o.total) || 0,
                    shippingAddress: o.shippingAddress || "",
                    statusHistory: historySnap.docs.map((h) => {
                        const hd = h.data();
                        return {
                            fromStatus: hd.fromStatus || null,
                            toStatus: hd.toStatus,
                            createdAt: hd.createdAt?.toDate ? hd.createdAt.toDate().toISOString() : null,
                        };
                    }),
                };
            } catch (err) {
                console.error("[firestore-service] lookupOrdersDirect order:", id, err);
                return null;
            }
        })
    );

    return orders
        .filter(Boolean)
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}