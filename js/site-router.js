// ============================================================
// site-router.js
// Router điều hướng nội bộ kiểu SPA cho khu vực Storefront (Users):
// index.html, products.html, cart.html, checkout.html, login.html,
// register.html, profile.html, order-lookup.html.
//
// Mục tiêu: khi bấm 1 link nội bộ tới các trang trên, KHÔNG tải lại
// toàn bộ trang (Header/Footer không bị dựng lại / không nháy trắng).
// Chỉ phần <main> của trang đích được fetch về và thay thế — giống
// cơ chế đã áp dụng cho khu vực Admin (xem js/spa-router.js).
//
// Cách hoạt động:
//   - mount Header/Footer đúng 1 lần duy nhất (initLayout trong layout.js)
//   - Chặn (preventDefault) click vào các link nội bộ trỏ tới 1 trong các
//     trang Storefront ở trên
//   - fetch() HTML của trang đích -> parse bằng DOMParser
//   - Đảm bảo đã có đủ <link rel="stylesheet"> mà trang đích cần
//   - Thay thế toàn bộ <main> hiện tại bằng <main> của trang đích
//   - Cập nhật <title>, data-page, URL (history.pushState)
//   - import() động file js/<tên-trang>.js tương ứng và gọi initPage()
//     (mỗi trang PHẢI export hàm initPage() thay vì tự chạy khi tải
//     module, vì module chỉ được import 1 lần/URL — initPage() cho
//     phép chạy lại logic (query DOM, load dữ liệu...) mỗi lần điều
//     hướng tới).
//   - Nếu trang trước đó export disposePage() (vd. để clearInterval,
//     huỷ theo dõi Firestore realtime...), hàm này được gọi trước khi
//     rời trang để dọn dẹp, tránh rò rỉ bộ nhớ / listener chồng chéo.
//   - Nếu URL đích trỏ tới CHÍNH trang đang xem, chỉ cuộn tới #hash
//     (nếu có) thay vì điều hướng lại.
//   - Nếu có lỗi bất kỳ trong lúc điều hướng SPA (vd. mất mạng), tự
//     động fallback sang tải lại toàn trang để đảm bảo an toàn.
// ============================================================

import { initLayout, refreshLayoutEffects } from "./layout.js";

// Trang -> module JS tương ứng (khớp với data-page trên <body> của từng trang)
const PAGE_MODULES = {
    home: "./home.js",
    products: "./shop-products.js",
    cart: "./cart.js",
    checkout: "./checkout.js",
    login: "./shop-login.js",
    register: "./register.js",
    profile: "./profile.js",
    "order-lookup": "./order-lookup.js",
};

// Tên file (không gồm .html) của mọi trang thuộc khu vực Storefront mà
// router này quản lý. Lưu ý: đây là tên FILE trên URL (vd. "index"),
// khác với "data-page" trên <body> dùng để chọn module JS ở trên (vd.
// "home") — 2 giá trị này không phải lúc nào cũng trùng nhau (index.html
// có data-page="home"). Dùng danh sách riêng này để quyết định có nên
// chặn (preventDefault) 1 link hay không, TRƯỚC KHI biết data-page của
// trang đích (chỉ biết được sau khi fetch xong HTML).
const ROUTABLE_FILES = new Set([
    "index",
    "products",
    "cart",
    "checkout",
    "login",
    "register",
    "profile",
    "order-lookup",
]);

let currentPageModule = null; // module JS của trang đang hiển thị (để gọi disposePage khi rời đi)

/**
 * Khởi tạo router: gọi 1 lần duy nhất từ mỗi trang Storefront (js/site-entry.js).
 */
export async function initSiteRouter() {
    await initLayout(); // mount Header + Footer đúng 1 lần

    document.addEventListener("click", handleLinkClick);
    window.addEventListener("popstate", () => {
        navigate(location.pathname + location.search + location.hash, { push: false });
    });

    // Render logic cho trang đang hiển thị sẵn trên trình duyệt (tải lần đầu)
    await loadPageScript(document.body.dataset.page || "");
}

/**
 * Xử lý click uỷ quyền (event delegation) trên toàn document.
 * Chỉ can thiệp vào các link nội bộ trỏ tới trang Storefront hợp lệ,
 * còn lại (link admin, link ngoài, mailto:, tel:, v.v.) để trình duyệt
 * xử lý bình thường.
 */
function handleLinkClick(event) {
    const link = event.target.closest("a[href]");
    if (!link) return;

    // Bỏ qua: click chuột phải/giữa, giữ Ctrl/Cmd/Shift/Alt (mở tab mới),
    // link mở tab mới, link tải file, link disabled
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (link.target && link.target !== "_self") return;
    if (link.hasAttribute("download")) return;
    if (link.classList.contains("is-disabled")) return;

    const href = link.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) return;

    const targetUrl = new URL(href, location.href);
    if (targetUrl.origin !== location.origin) return; // link ngoài domain -> không can thiệp
    if (!isRoutablePath(targetUrl.pathname)) return; // vd. link sang khu vực Admin -> không can thiệp

    // Cùng 1 trang, chỉ khác #hash -> để trình duyệt tự cuộn, không fetch lại
    if (targetUrl.pathname === location.pathname && targetUrl.hash) {
        return;
    }
    if (targetUrl.pathname === location.pathname && !targetUrl.hash) {
        event.preventDefault();
        return; // đang ở trang này rồi, không làm gì
    }

    event.preventDefault();
    navigate(href, { push: true });
}

/**
 * Trang có nằm trong danh sách router Storefront quản lý hay không
 * (vd. loại trừ /admin/*.html, vốn có router SPA riêng — xem
 * js/spa-router.js).
 */
function isRoutablePath(pathname) {
    if (/(^|\/)admin\//.test(pathname)) return false;
    const file = pathname.split("/").pop() || "index.html";
    const fileName = file.replace(/\.html$/, "");
    return fileName === "" || ROUTABLE_FILES.has(fileName);
}

/**
 * Điều hướng sang 1 trang Storefront khác mà không tải lại toàn bộ
 * trình duyệt.
 * @param {string} url - đường dẫn tới trang đích (tương đối hoặc tuyệt đối)
 * @param {{push?: boolean}} options - push=true -> đẩy vào history (click thường); false -> khi back/forward
 */
async function navigate(url, { push = true } = {}) {
    const mainEl = document.querySelector("main");
    mainEl?.classList.add("is-navigating");

    try {
        const [fetchUrl, hash] = url.split("#");
        const res = await fetch(fetchUrl || url, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status} khi tải ${url}`);
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, "text/html");

        const newMain = doc.querySelector("main");
        if (!newMain) throw new Error(`Không tìm thấy phần tử <main> trong "${url}"`);

        // Dọn dẹp trang cũ trước khi rời đi (vd. huỷ subscribeCart, clearInterval...)
        if (currentPageModule && typeof currentPageModule.disposePage === "function") {
            try {
                currentPageModule.disposePage();
            } catch (err) {
                console.error("Lỗi khi dọn dẹp trang trước đó:", err);
            }
        }

        ensureStylesheets(doc);

        document.querySelector("main").replaceWith(newMain);
        document.title = doc.title;
        document.body.dataset.page = doc.body.dataset.page || "";

        if (push) history.pushState({}, "", url);

        if (hash) {
            document.getElementById(hash)?.scrollIntoView({ behavior: "instant", block: "start" });
        } else {
            window.scrollTo({ top: 0, behavior: "instant" });
        }

        refreshLayoutEffects(document);
        await loadPageScript(document.body.dataset.page);
    } catch (err) {
        console.error("Lỗi điều hướng SPA, tải lại toàn trang để đảm bảo an toàn:", err);
        window.location.href = url;
    } finally {
        mainEl?.classList.remove("is-navigating");
    }
}

/**
 * Đảm bảo mọi <link rel="stylesheet"> mà trang đích cần đã có mặt trong
 * <head>. Không xóa bớt CSS cũ (an toàn, tránh giật layout khi điều
 * hướng qua lại).
 */
function ensureStylesheets(doc) {
    const currentHrefs = new Set(
        Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map((l) => l.getAttribute("href"))
    );
    doc.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
        const href = link.getAttribute("href");
        if (href && !currentHrefs.has(href)) {
            const newLink = document.createElement("link");
            newLink.rel = "stylesheet";
            newLink.href = href;
            document.head.appendChild(newLink);
        }
    });
}

/**
 * import() động file js/<pageName>.js tương ứng và gọi initPage() của nó.
 * An toàn khi thiếu file / lỗi -> chỉ log lỗi, không sập trang.
 */
async function loadPageScript(pageName) {
    const path = PAGE_MODULES[pageName];
    if (!path) {
        currentPageModule = null;
        return;
    }
    try {
        const mod = await import(path);
        currentPageModule = mod;
        if (typeof mod.initPage === "function") {
            await mod.initPage();
        } else {
            console.warn(`Module cho trang "${pageName}" chưa export hàm initPage().`);
        }
    } catch (err) {
        currentPageModule = null;
        console.error(`Không thể tải logic cho trang "${pageName}":`, err);
    }
}
