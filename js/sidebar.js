// ============================================================
// sidebar.js
// Nguồn dữ liệu DUY NHẤT cho sidebar menu của toàn bộ trang Admin.
// Mọi thêm/sửa/xóa mục menu chỉ cần thực hiện tại đây,
// layout-common.js sẽ tự động inject vào tất cả các trang.
// ============================================================

/**
 * Cấu trúc menu: mỗi nhóm có label + danh sách item.
 * item.page phải khớp với data-page trên <body> của từng trang
 * để markActiveSidebarLink() (trong layout-common.js) tô sáng đúng mục.
 * item.disabled = true -> hiển thị dạng "Sắp ra mắt", không có href thật.
 */
const SIDEBAR_MENU = [
  {
    group: "Tổng quan",
    items: [
      {
        page: "dashboard",
        href: "dashboard.html",
        label: "Dashboard",
        icon: `<rect x="3" y="3" width="7" height="9" rx="1.5" stroke="currentColor" stroke-width="2" />
               <rect x="14" y="3" width="7" height="5" rx="1.5" stroke="currentColor" stroke-width="2" />
               <rect x="14" y="12" width="7" height="9" rx="1.5" stroke="currentColor" stroke-width="2" />
               <rect x="3" y="16" width="7" height="5" rx="1.5" stroke="currentColor" stroke-width="2" />`,
      },
    ],
  },
  {
    group: "Kinh doanh",
    items: [
      {
        page: "customers",
        href: "customers.html",
        label: "Khách hàng",
        icon: `<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
               <circle cx="9" cy="7" r="4" stroke="currentColor" stroke-width="2" />
               <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" stroke="currentColor" stroke-width="2" stroke-linecap="round" />`,
      },
      {
        page: "products",
        href: "products.html",
        label: "Sản phẩm",
        icon: `<path d="M20.59 13.41L11 3.83A2 2 0 009.59 3.24H4a1 1 0 00-1 1v5.59a2 2 0 00.59 1.41l9.58 9.59a2 2 0 002.83 0l5.59-5.59a2 2 0 000-2.83z" stroke="currentColor" stroke-width="2" />
               <circle cx="7.5" cy="7.5" r="1" fill="currentColor" />`,
      },
      {
        page: "orders",
        href: "orders.html",
        label: "Đơn hàng",
        icon: `<path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
               <path d="M3 6h18M16 10a4 4 0 01-8 0" stroke="currentColor" stroke-width="2" />`,
      },
      {
        page: "vouchers",
        href: "vouchers.html",
        label: "Voucher",
        icon: `<path d="M20.59 13.41L11 3.83A2 2 0 009.59 3.24H4a1 1 0 00-1 1v5.59a2 2 0 00.59 1.41l9.58 9.59a2 2 0 002.83 0l5.59-5.59a2 2 0 000-2.83z" stroke="currentColor" stroke-width="2" />`,
      },
      {
        page: "flashsale",
        href: "flashsale.html",
        label: "Flash Sale",
        icon: `<path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />`,
      },
    ],
  },
  {
    group: "Vận chuyển",
    items: [
      {
        page: "shipping",
        href: "shipping.html",
        label: "Phí ship",
        icon: `<rect x="1" y="7" width="15" height="10" rx="1.5" stroke="currentColor" stroke-width="2" />
               <path d="M16 10h4l3 3v4h-7v-7z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
               <circle cx="6" cy="19" r="2" stroke="currentColor" stroke-width="2" />
               <circle cx="17.5" cy="19" r="2" stroke="currentColor" stroke-width="2" />`,
      },
    ],
  },
];

/**
 * Render 1 thẻ <a> menu item
 */
function renderLink(item) {
  const disabledAttrs = item.disabled
    ? ` class="sidebar__link is-disabled" title="Sắp ra mắt"`
    : ` class="sidebar__link" data-page="${item.page}"`;
  return `
    <a href="${item.href}"${disabledAttrs}>
        <svg viewBox="0 0 24 24" fill="none">${item.icon}</svg>
        ${item.label}
    </a>`;
}

/**
 * Render toàn bộ nội dung bên trong <aside class="sidebar">
 * (brand + nav + footer user/logout).
 * @returns {string} HTML
 */
export function renderSidebar() {
  const navHtml = SIDEBAR_MENU.map(
    (group) => `
        <span class="sidebar__group-label">${group.group}</span>
        ${group.items.map(renderLink).join("")}`
  ).join("\n");

  return `
        <div class="sidebar__brand">
            <div class="sidebar__brand-mark">SA</div>
            <div>
                <div class="sidebar__brand-text">ShopAdmin</div>
                <div class="sidebar__brand-sub">Bảng điều khiển</div>
            </div>
        </div>

        <nav class="sidebar__nav">${navHtml}
        </nav>

        <div class="sidebar__footer">
            <div class="sidebar__user">
                <div class="sidebar__user-avatar" id="sidebar-user-avatar">?</div>
                <div class="sidebar__user-info">
                    <div class="sidebar__user-name" id="sidebar-user-name">Đang tải...</div>
                    <div class="sidebar__user-role" id="sidebar-user-role">—</div>
                </div>
            </div>
            <button type="button" class="sidebar__logout" id="btn-logout">
                <svg viewBox="0 0 24 24" fill="none">
                    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                    <path d="M16 17l5-5-5-5M21 12H9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                Đăng xuất
            </button>
        </div>`;
}

/**
 * Tìm phần tử <aside id="sidebar"> trên trang và bơm HTML sidebar vào đó.
 * Nếu không tìm thấy placeholder -> log lỗi (không throw để không sập trang).
 */
export function injectSidebar() {
  const mount = document.getElementById("sidebar");
  if (!mount) {
    console.error('Không tìm thấy phần tử <aside id="sidebar"> để inject menu.');
    return;
  }
  mount.innerHTML = renderSidebar();
}
