// ============================================================
// layout-common.js
// Khởi tạo phần layout dùng chung cho mọi trang Admin:
// - Đánh dấu link sidebar đang active theo tên trang hiện tại
// - Gắn thông tin user (tên, vai trò, chữ cái đầu avatar) sau khi xác thực
// - Gắn sự kiện nút Đăng xuất
// ============================================================

import { logoutAdmin } from "./auth.js";
import { getInitials } from "./helpers.js";
import { showConfirmModal } from "./modal.js";
import { injectSidebar } from "./sidebar.js";

/**
 * Khởi tạo phần khung layout (sidebar + header) dùng chung.
 * Sidebar được render động từ sidebar.js (nguồn dữ liệu menu duy nhất)
 * để tất cả các trang admin luôn đồng bộ với nhau.
 * @param {Object} userData - dữ liệu admin đã đăng nhập (từ guardAdminRoute)
 */
export function initLayout(userData) {
    injectSidebar();
    markActiveSidebarLink();
    bindUserInfo(userData);
    bindLogout();
}

/**
 * Tô sáng link sidebar tương ứng với trang hiện tại (dựa vào data-page).
 * Export để spa-router.js gọi lại mỗi khi điều hướng sang trang khác
 * (sidebar không bị dựng lại, chỉ cần cập nhật class is-active).
 */
export function markActiveSidebarLink() {
    const currentPage = document.body.dataset.page;
    document.querySelectorAll(".sidebar__link[data-page]").forEach((link) => {
        link.classList.toggle("is-active", link.dataset.page === currentPage);
    });
}

/**
 * Đổ thông tin admin đang đăng nhập vào khu vực footer sidebar
 */
function bindUserInfo(userData) {
    const nameEl = document.getElementById("sidebar-user-name");
    const roleEl = document.getElementById("sidebar-user-role");
    const avatarEl = document.getElementById("sidebar-user-avatar");

    if (!userData) return;

    const displayName = userData.fullName || userData.email || "Admin";

    if (nameEl) nameEl.textContent = displayName;
    if (roleEl) roleEl.textContent = userData.role === "admin" ? "Quản trị viên" : userData.role;
    if (avatarEl) avatarEl.textContent = getInitials(displayName);
}

/**
 * Gắn sự kiện cho nút đăng xuất (có xác nhận trước khi thoát)
 */
function bindLogout() {
    const btn = document.getElementById("btn-logout");
    if (!btn) return;

    btn.addEventListener("click", async () => {
        const confirmed = await showConfirmModal({
            title: "Đăng xuất",
            message: "Bạn có chắc chắn muốn đăng xuất khỏi hệ thống quản trị?",
            confirmText: "Đăng xuất",
            cancelText: "Ở lại",
            danger: true,
        });

        if (confirmed) {
            await logoutAdmin();
        }
    });
}