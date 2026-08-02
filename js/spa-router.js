// ============================================================
// spa-router.js
// Router điều hướng nội bộ kiểu SPA cho khu vực Admin.
//
// Mục tiêu: khi bấm vào menu sidebar, KHÔNG tải lại toàn bộ trang
// (tránh sidebar bị dựng lại / nháy trắng / chậm). Chỉ phần nội dung
// bên trong ".main" của trang đích được fetch về và thay thế.
//
// Cách hoạt động:
//   - Chặn (preventDefault) click vào các link sidebar có [data-page]
//   - fetch() HTML của trang đích -> parse bằng DOMParser
//   - Đảm bảo đã có đủ <link rel="stylesheet"> mà trang đích cần
//   - Thay thế toàn bộ ".main" hiện tại bằng ".main" của trang đích
//   - Cập nhật <title>, data-page, URL (history.pushState)
//   - Tô sáng lại link sidebar đang active
//   - import() động file js/<tên-trang>.js và gọi initPage(userData)
//     (mỗi trang PHẢI export hàm initPage() thay vì tự chạy khi tải module,
//     vì module chỉ được import 1 lần/URL — initPage() cho phép chạy lại
//     logic (query DOM, load dữ liệu...) mỗi lần điều hướng tới).
//   - Nếu trang trước đó export disposePage() (vd. để clearInterval),
//     hàm này được gọi trước khi rời trang để dọn dẹp.
// ============================================================

import { markActiveSidebarLink } from "../js/layout-common.js";

let currentUserData = null;
let currentPageName = null;
let currentPageModule = null; // module JS của trang đang hiển thị (để gọi disposePage khi rời đi)

/**
 * Khởi tạo router: gọi 1 lần duy nhất từ entry.js sau khi xác thực xong.
 * @param {Object} userData
 */
export function initRouter(userData) {
    currentUserData = userData;

    document.addEventListener("click", handleLinkClick);
    window.addEventListener("popstate", () => {
        navigate(location.pathname, { push: false });
    });

    // Render logic cho trang đang hiển thị sẵn trên trình duyệt (tải lần đầu)
    currentPageName = document.body.dataset.page || "";
    loadPageScript(currentPageName);
}

/**
 * Xử lý click ủy quyền (event delegation) trên toàn document.
 * Chỉ can thiệp vào các link sidebar hợp lệ, còn lại để trình duyệt xử lý bình thường.
 */
function handleLinkClick(event) {
    const link = event.target.closest("a.sidebar__link[data-page]");
    if (!link) return;

    // Bỏ qua: click chuột phải/giữa, giữ Ctrl/Cmd/Shift/Alt (mở tab mới), link disabled
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (link.classList.contains("is-disabled")) return;

    const targetUrl = new URL(link.href, location.href);
    if (targetUrl.origin !== location.origin) return; // link ngoài domain -> không can thiệp

    event.preventDefault();

    if (targetUrl.pathname === location.pathname) return; // đang ở trang này rồi, không làm gì

    navigate(link.getAttribute("href"), { push: true });
}

/**
 * Điều hướng sang 1 trang admin khác mà không tải lại toàn bộ trình duyệt.
 * @param {string} url - đường dẫn tới trang đích (tương đối hoặc tuyệt đối)
 * @param {{push?: boolean}} options - push=true -> đẩy vào history (click thường); false -> khi back/forward
 */
async function navigate(url, { push = true } = {}) {
    const currentMain = document.querySelector(".main");
    currentMain?.classList.add("is-navigating");

    try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status} khi tải ${url}`);
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, "text/html");

        const newMain = doc.querySelector(".main");
        if (!newMain) throw new Error(`Không tìm thấy phần tử .main trong "${url}"`);

        // Dọn dẹp trang cũ trước khi rời đi (vd. clearInterval của flashsale.js)
        if (currentPageModule && typeof currentPageModule.disposePage === "function") {
            try {
                currentPageModule.disposePage();
            } catch (err) {
                console.error("Lỗi khi dọn dẹp trang trước đó:", err);
            }
        }

        ensureStylesheets(doc);

        document.querySelector(".main").replaceWith(newMain);
        document.title = doc.title;
        document.body.dataset.page = doc.body.dataset.page || "";

        if (push) history.pushState({}, "", url);

        markActiveSidebarLink();
        window.scrollTo({ top: 0, behavior: "instant" });

        currentPageName = document.body.dataset.page;
        await loadPageScript(currentPageName);
    } catch (err) {
        console.error("Lỗi điều hướng SPA, tải lại toàn trang để đảm bảo an toàn:", err);
        window.location.href = url;
    }
}

/**
 * Đảm bảo mọi <link rel="stylesheet"> mà trang đích cần đã có mặt trong <head>.
 * Không xóa bớt CSS cũ (an toàn, tránh giật layout khi điều hướng qua lại).
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
 * import() động file js/<pageName>.js và gọi initPage(userData) của nó.
 * An toàn khi thiếu file (vd. shipping.js chưa tồn tại) -> chỉ log lỗi, không sập trang.
 */
async function loadPageScript(pageName) {
    if (!pageName) return;
    try {
        const mod = await import(`../js/${pageName}.js`);
        currentPageModule = mod;
        if (typeof mod.initPage === "function") {
            mod.initPage(currentUserData);
        } else {
            console.warn(`Module "${pageName}.js" chưa export hàm initPage().`);
        }
    } catch (err) {
        currentPageModule = null;
        console.error(`Không thể tải logic cho trang "${pageName}":`, err);
    }
}
