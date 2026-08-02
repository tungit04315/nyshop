// ============================================================
// components/header.js
// Component Header dùng chung cho mọi trang: Logo, Menu + Mega Menu,
// Search Box, Đăng nhập/Tài khoản, Giỏ hàng, Mobile Drawer.
// Dữ liệu Logo/Tên site lấy từ Firestore "settings/general"; Danh mục
// (Mega Menu) lấy từ "categories". Đăng nhập/Giỏ hàng ở Giai đoạn 1
// CHỈ là UI placeholder (chưa có Auth/Cart logic — thuộc Giai đoạn sau).
// ============================================================

import { getSiteSettings, getCategories } from "../firebase/firestore-service.js";
import { renderMegaMenuLinks } from "./category-card.js";
import { skeletonMegaMenuColumns } from "./skeleton.js";
import { initSearchBox } from "./search-box.js";
import { escapeHtml, showToast, getInitials, formatCurrency } from "../js/shop-helpers.js";
import { watchCustomerAuth, logoutCustomer } from "../js/customer-auth.js";
import { showConfirmModal } from "../js/modal.js";
import { subscribeCart, addToCart, removeFromCart } from "../js/cart-store.js";
import { showToast as showRichToast } from "../js/toast.js";

const ICONS = {
  chevron: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>`,
  search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg>`,
  close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>`,
  user: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg>`,
  cart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1.5"/><circle cx="19" cy="21" r="1.5"/><path d="M2.5 3h2l2.4 12.4a2 2 0 002 1.6h8.7a2 2 0 002-1.6L21 8H6"/></svg>`,
  menu: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M3 12h18M3 18h18"/></svg>`,
  emptyCart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="9" cy="21" r="1.5"/><circle cx="19" cy="21" r="1.5"/><path d="M2.5 3h2l2.4 12.4a2 2 0 002 1.6h8.7a2 2 0 002-1.6L21 8H6"/></svg>`,
};

const NAV_ITEMS = [
  { label: "Trang chủ", href: "index.html" },
  { label: "Sản phẩm", href: "products.html", mega: true },
  { label: "Flash Sale", href: "index.html#flash-sale" },
  { label: "Thương hiệu", href: "index.html#brands" },
  { label: "Tra cứu đơn hàng", href: "order-lookup.html" },
];

function headerShellHtml() {
  return `
    <div class="header__inner">
      <a href="index.html" class="header__logo" data-header-logo>
        <div class="header__logo-mark" data-logo-mark>S</div>
        <span class="header__logo-text" data-logo-text>ShopViet</span>
      </a>

      <nav class="header__nav">
        ${NAV_ITEMS.map(
    (item) => `
          <div class="header__nav-item" ${item.mega ? 'data-mega-item' : ""}>
            <a href="${item.href}" class="header__nav-link">
              ${escapeHtml(item.label)} ${item.mega ? ICONS.chevron : ""}
            </a>
            ${item.mega
        ? `<div class="mega-menu mega-menu--loading" data-mega-menu>
                     <div class="mega-menu__grid" data-mega-menu-grid>${skeletonMegaMenuColumns(3, 4)}</div>
                   </div>`
        : ""
      }
          </div>`
  ).join("")}
      </nav>

      <div class="header__search-wrap" data-search-wrap>
        <div class="header__search">
          ${ICONS.search}
          <input type="text" placeholder="Tìm kiếm sản phẩm…" data-search-input autocomplete="off" />
          <button class="header__search-clear" data-search-clear aria-label="Xoá tìm kiếm">${ICONS.close}</button>
        </div>
        <div class="search-dropdown" data-search-dropdown></div>
      </div>

      <div class="header__actions">
        <div class="header__action-item" data-account-item>
          <button class="header__login-btn" data-account-toggle>
            <span class="header__avatar-mark" data-account-avatar>${ICONS.user}</span>
            <span data-account-label>Đăng nhập</span>
          </button>
          <div class="action-dropdown" data-account-dropdown>
            <div class="action-dropdown__title">Chào bạn 👋</div>
            <div class="action-dropdown__desc">Đăng nhập để theo dõi đơn hàng và nhận ưu đãi dành riêng cho bạn.</div>
            <a class="btn btn--accent btn--sm" style="width:100%;display:flex;" href="login.html">Đăng nhập / Đăng ký</a>
          </div>
        </div>

        <div class="header__action-item" data-cart-item>
          <button class="header__action-btn" data-cart-toggle aria-label="Giỏ hàng">
            ${ICONS.cart}
            <span class="header__cart-count" data-cart-count>0</span>
          </button>
          <div class="action-dropdown action-dropdown--cart" data-cart-dropdown>
            <div class="action-dropdown__title">Giỏ hàng của bạn</div>
            <div class="action-dropdown__empty">
              ${ICONS.emptyCart}
              <p>Giỏ hàng đang trống.<br>Hãy khám phá sản phẩm nhé!</p>
            </div>
          </div>
        </div>

        <button class="header__burger" data-drawer-toggle aria-label="Mở menu">${ICONS.menu}</button>
      </div>
    </div>
  `;
}

function drawerHtml() {
  return `
    <div class="mobile-drawer" data-drawer>
      <div class="mobile-drawer__overlay" data-drawer-close></div>
      <div class="mobile-drawer__panel">
        <button class="mobile-drawer__close" data-drawer-close>${ICONS.close}</button>
        <div class="mobile-drawer__search header__search-wrap" data-mobile-search-wrap>
          <div class="header__search">
            ${ICONS.search}
            <input type="text" placeholder="Tìm kiếm sản phẩm…" data-search-input autocomplete="off" />
            <button class="header__search-clear" data-search-clear aria-label="Xoá tìm kiếm">${ICONS.close}</button>
          </div>
          <div class="search-dropdown" data-search-dropdown style="position:static;box-shadow:none;border:none;opacity:1;visibility:visible;transform:none;display:none;"></div>
        </div>
        <nav data-mobile-nav>
          ${NAV_ITEMS.map(
    (item) => `<a href="${item.href}" class="mobile-drawer__link">${escapeHtml(item.label)} ${ICONS.chevron}</a>`
  ).join("")}
        </nav>
      </div>
    </div>
  `;
}

/**
 * Gắn hiệu ứng header co lại + đổ bóng khi cuộn trang
 */
function bindStickyScroll(headerEl) {
  const onScroll = () => headerEl.classList.toggle("is-scrolled", window.scrollY > 12);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
}

/**
 * Gắn tương tác mở/đóng cho Mega Menu, Account dropdown, Cart dropdown
 */
function bindDropdowns(headerEl) {
  const megaItem = headerEl.querySelector("[data-mega-item]");
  const accountItem = headerEl.querySelector("[data-account-item]");
  const cartItem = headerEl.querySelector("[data-cart-item]");

  const closeAll = () => {
    megaItem?.classList.remove("is-open");
    accountItem?.classList.remove("is-open");
    cartItem?.classList.remove("is-open");
  };

  megaItem?.addEventListener("mouseenter", () => megaItem.classList.add("is-open"));
  megaItem?.addEventListener("mouseleave", () => megaItem.classList.remove("is-open"));

  headerEl.querySelector("[data-account-toggle]")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const wasOpen = accountItem.classList.contains("is-open");
    closeAll();
    accountItem.classList.toggle("is-open", !wasOpen);
  });

  headerEl.querySelector("[data-cart-toggle]")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const wasOpen = cartItem.classList.contains("is-open");
    closeAll();
    cartItem.classList.toggle("is-open", !wasOpen);
  });

  // Nút "Đăng xuất" chỉ xuất hiện trong dropdown sau khi đăng nhập (nội dung
  // được thay thế động bởi updateAccountUI) nên phải dùng event delegation.
  headerEl.addEventListener("click", (e) => {
    const logoutBtn = e.target.closest("[data-account-logout]");
    if (logoutBtn) handleLogoutClick(e);
  });

  document.addEventListener("click", (e) => {
    if (!headerEl.contains(e.target)) closeAll();
  });
}

/**
 * Gắn tương tác Mobile Drawer (menu trượt trên di động)
 */
function bindMobileDrawer(headerEl, drawerEl) {
  const open = () => drawerEl.classList.add("is-open");
  const close = () => drawerEl.classList.remove("is-open");

  headerEl.querySelector("[data-drawer-toggle]")?.addEventListener("click", open);
  drawerEl.querySelectorAll("[data-drawer-close]").forEach((el) => el.addEventListener("click", close));

  // Toggle hiển thị dropdown kết quả search trong drawer (vì luôn "is-active")
  const mobileSearchWrap = drawerEl.querySelector("[data-mobile-search-wrap]");
  const mobileDropdown = mobileSearchWrap?.querySelector("[data-search-dropdown]");
  const mobileInput = mobileSearchWrap?.querySelector("[data-search-input]");
  mobileInput?.addEventListener("focus", () => {
    if (mobileDropdown) mobileDropdown.style.display = "block";
  });
}

/**
 * Cập nhật Logo + Tên site từ settings/general (nếu Admin đã cấu hình)
 */
async function hydrateBranding(headerEl) {
  const settings = await getSiteSettings();
  if (!settings) return;
  const logoMark = headerEl.querySelector("[data-logo-mark]");
  const logoText = headerEl.querySelector("[data-logo-text]");
  if (settings.siteName) {
    if (logoText) logoText.textContent = settings.siteName;
    if (logoMark && !settings.logoUrl) logoMark.textContent = settings.siteName.charAt(0).toUpperCase();
  }
  if (settings.logoUrl && logoMark) {
    logoMark.innerHTML = `<img src="${escapeHtml(settings.logoUrl)}" alt="${escapeHtml(settings.siteName || "Logo")}" />`;
  }
  document.querySelectorAll("[data-footer-site-name]").forEach((el) => {
    if (settings.siteName) el.textContent = settings.siteName;
  });
}

/**
 * Tải danh mục và đổ vào Mega Menu (desktop) + Mobile Drawer nav
 */
async function hydrateCategories(headerEl, drawerEl) {
  const categories = await getCategories(9);
  const megaMenu = headerEl.querySelector("[data-mega-menu]");
  const megaGrid = headerEl.querySelector("[data-mega-menu-grid]");
  if (!megaGrid) return;

  megaMenu?.classList.remove("mega-menu--loading");

  if (!categories.length) {
    megaGrid.innerHTML = `<div style="grid-column:1/-1;color:var(--color-text-secondary);font-size:13px;">Chưa có danh mục nào.</div>`;
    return;
  }

  // Chia đều danh mục vào 3 cột cho Mega Menu
  const columns = [[], [], []];
  categories.forEach((c, i) => columns[i % 3].push(c));
  const colTitles = ["Danh mục nổi bật", "Được quan tâm", "Khám phá thêm"];

  megaGrid.innerHTML = columns
    .map(
      (col, i) => `
      <div>
        <div class="mega-menu__col-title">${colTitles[i]}</div>
        ${renderMegaMenuLinks(col)}
      </div>`
    )
    .join("");

  // Đổ danh mục vào menu mobile (thêm sau mục "Sản phẩm")
  const mobileNav = drawerEl.querySelector("[data-mobile-nav]");
  if (mobileNav) {
    const catLinks = categories
      .slice(0, 6)
      .map((c) => `<a href="products.html?category=${encodeURIComponent(c.id)}" class="mobile-drawer__link" style="padding-left:16px;font-weight:500;font-size:13.5px;">${escapeHtml(c.name)}</a>`)
      .join("");
    mobileNav.insertAdjacentHTML("beforeend", `<div style="margin-top:8px;">${catLinks}</div>`);
  }
}

/**
 * Xử lý click nút "Đăng xuất" trong dropdown tài khoản
 */
async function handleLogoutClick(e) {
  e.preventDefault();
  const confirmed = await showConfirmModal({
    title: "Đăng xuất",
    message: "Bạn có chắc chắn muốn đăng xuất khỏi tài khoản này?",
    confirmText: "Đăng xuất",
    cancelText: "Ở lại",
    danger: true,
  });
  if (!confirmed) return;

  try {
    await logoutCustomer();
    showToast("Bạn đã đăng xuất.");
    // Nếu đang ở trang riêng tư (Trang cá nhân) thì quay về Trang chủ
    if (document.body.dataset.page === "profile") {
      window.location.href = "index.html";
    }
  } catch (err) {
    console.error("[header] Lỗi đăng xuất:", err);
    showToast("Không thể đăng xuất. Vui lòng thử lại.");
  }
}

const STATUS_BADGE_LABEL = {
  pending: { label: "Chờ duyệt", badge: "badge--warning" },
  approved: { label: "Đã duyệt", badge: "badge--success" },
  locked: { label: "Đã khóa", badge: "badge--danger" },
  rejected: { label: "Bị từ chối", badge: "badge--danger" },
};

/**
 * Cập nhật nút + dropdown Tài khoản theo trạng thái đăng nhập thật
 * (customer = null nếu chưa đăng nhập/đăng xuất/tài khoản bị khóa)
 */
function updateAccountUI(headerEl, customer) {
  const labelEl = headerEl.querySelector("[data-account-label]");
  const avatarEl = headerEl.querySelector("[data-account-avatar]");
  const dropdownEl = headerEl.querySelector("[data-account-dropdown]");
  if (!labelEl || !avatarEl || !dropdownEl) return;

  if (!customer) {
    labelEl.textContent = "Đăng nhập";
    avatarEl.innerHTML = ICONS.user;
    dropdownEl.innerHTML = `
      <div class="action-dropdown__title">Chào bạn 👋</div>
      <div class="action-dropdown__desc">Đăng nhập để theo dõi đơn hàng và nhận ưu đãi dành riêng cho bạn.</div>
      <a class="btn btn--accent btn--sm" style="width:100%;display:flex;" href="login.html">Đăng nhập / Đăng ký</a>
    `;
    return;
  }

  const displayName = customer.fullName || customer.email || "Khách hàng";
  const statusInfo = STATUS_BADGE_LABEL[customer.status] || null;

  labelEl.textContent = displayName.split(" ")[0] || "Tài khoản";
  avatarEl.innerHTML = customer.avatar
    ? `<img src="${escapeHtml(customer.avatar)}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" />`
    : escapeHtml(getInitials(displayName));

  dropdownEl.innerHTML = `
    <div class="action-dropdown__title" style="display:flex;align-items:center;gap:8px;justify-content:space-between;">
      ${escapeHtml(displayName)}
      ${statusInfo ? `<span class="badge ${statusInfo.badge}" style="font-size:10.5px;">${statusInfo.label}</span>` : ""}
    </div>
    <div class="action-dropdown__desc" style="margin-bottom:10px;">${escapeHtml(customer.email || "")}</div>
    ${customer.status === "pending"
      ? `<div class="form-hint" style="margin:-4px 0 12px;">Tài khoản đang chờ quản trị viên phê duyệt. Bạn có thể xem thông tin nhưng chưa thể đặt hàng.</div>`
      : ""
    }
    <a class="btn btn--ghost btn--sm" style="width:100%;display:flex;margin-bottom:8px;" href="profile.html">Trang cá nhân</a>
    <button type="button" class="btn btn--ghost btn--sm" style="width:100%;color:var(--color-danger);" data-account-logout>Đăng xuất</button>
  `;
}

/**
 * Theo dõi trạng thái đăng nhập (Firebase Auth + Firestore "customers")
 * và cập nhật giao diện Header tương ứng — chạy song song, không chặn UI.
 */
function hydrateAccount(headerEl) {
  watchCustomerAuth((customer) => updateAccountUI(headerEl, customer));
  // Cho phép các trang khác (vd: profile.html sau khi lưu thay đổi) báo
  // cho Header cập nhật ngay tên/avatar mà không cần tải lại trang.
  window.addEventListener("shopviet:account-updated", (e) => {
    if (e.detail) updateAccountUI(headerEl, e.detail);
  });
}

/**
 * Render nội dung dropdown Giỏ hàng (mini-cart) + badge số lượng, theo dữ
 * liệu THẬT từ cart-store (LocalStorage khi chưa đăng nhập, Firestore khi
 * đã đăng nhập — cart-store.js tự đồng bộ 2 nguồn này).
 */
function renderCartDropdown(dropdownEl, state) {
  const { items, subtotal, totalCount } = state;

  if (!items.length) {
    dropdownEl.innerHTML = `
      <div class="action-dropdown__title">Giỏ hàng của bạn</div>
      <div class="action-dropdown__empty">
        ${ICONS.emptyCart}
        <p>Giỏ hàng đang trống.<br>Hãy khám phá sản phẩm nhé!</p>
      </div>
    `;
    return;
  }

  const shownItems = items.slice(0, 4);
  const moreCount = items.length - shownItems.length;

  dropdownEl.innerHTML = `
    <div class="action-dropdown__title">Giỏ hàng của bạn (${totalCount})</div>
    <div class="cart-mini-list">
      ${shownItems
      .map(
        (it) => `
        <div class="cart-mini-item" data-cart-mini-item="${escapeHtml(it.productId)}">
          <div class="cart-mini-item__thumb">
            ${it.thumbnail ? `<img src="${escapeHtml(it.thumbnail)}" alt="" />` : ""}
          </div>
          <div class="cart-mini-item__info">
            <div class="cart-mini-item__name">${escapeHtml(it.name)}</div>
            <div class="cart-mini-item__meta">${formatCurrency(it.price)} × ${it.quantity}</div>
          </div>
          <button type="button" class="cart-mini-item__remove" data-cart-mini-remove="${escapeHtml(it.productId)}" aria-label="Xoá khỏi giỏ">${ICONS.close}</button>
        </div>`
      )
      .join("")}
      ${moreCount > 0 ? `<div class="cart-mini-more">+ ${moreCount} sản phẩm khác</div>` : ""}
    </div>
    <div class="cart-mini-subtotal">
      <span>Tạm tính (${state.selectedItems.length} đã chọn)</span>
      <strong>${formatCurrency(subtotal)}</strong>
    </div>
    <a class="btn btn--ghost btn--sm" style="width:100%;display:flex;margin-bottom:8px;" href="cart.html">Xem giỏ hàng</a>
    <a class="btn btn--accent btn--sm" style="width:100%;display:flex;" href="checkout.html">Thanh toán ngay</a>
  `;
}

/**
 * Theo dõi cart-store realtime, cập nhật badge số lượng + nội dung dropdown.
 */
function hydrateCart(headerEl) {
  const countEl = headerEl.querySelector("[data-cart-count]");
  const dropdownEl = headerEl.querySelector("[data-cart-dropdown]");
  if (!countEl || !dropdownEl) return;

  subscribeCart((state) => {
    countEl.textContent = state.totalCount > 99 ? "99+" : String(state.totalCount);
    countEl.style.display = state.totalCount > 0 ? "flex" : "none";
    renderCartDropdown(dropdownEl, state);
  });

  dropdownEl.addEventListener("click", async (e) => {
    const removeBtn = e.target.closest("[data-cart-mini-remove]");
    if (!removeBtn) return;
    e.preventDefault();
    const productId = removeBtn.dataset.cartMiniRemove;
    await removeFromCart(productId);
    showRichToast("Đã xoá sản phẩm khỏi giỏ hàng.", "success");
  });
}

/**
 * Gắn xử lý "Thêm vào giỏ hàng" DÙNG CHUNG cho mọi trang: bất kỳ nút nào
 * có [data-quick-add="{productId}"] (vd: Product Card ở Trang chủ,
 * Danh sách sản phẩm...) đều tự động hoạt động, không cần từng trang tự
 * import/gắn lại logic giỏ hàng.
 */
function bindGlobalQuickAdd() {
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-quick-add]");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    if (btn.disabled) return;

    const productId = btn.dataset.quickAdd;
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="btn-spinner" style="width:14px;height:14px;border-width:2px;"></span>`;

    try {
      const result = await addToCart(productId, 1);
      if (result.ok) {
        showRichToast("Đã thêm vào giỏ hàng.", "success");
        btn.classList.add("is-added");
        setTimeout(() => btn.classList.remove("is-added"), 900);
      } else {
        showRichToast(result.message || "Không thể thêm vào giỏ hàng.", "error");
      }
    } catch (err) {
      console.error("[header] Lỗi thêm vào giỏ hàng:", err);
      showRichToast("Đã xảy ra lỗi. Vui lòng thử lại.", "error");
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  });
}

let quickAddBound = false;

/**
 * Điểm khởi động Header — gọi 1 lần duy nhất trên mỗi trang.
 * @param {string} selector - selector của phần tử placeholder <header id="site-header">
 */
export async function mountHeader(selector = "#site-header") {
  const headerEl = document.querySelector(selector);
  if (!headerEl) return;

  headerEl.classList.add("header");
  headerEl.innerHTML = headerShellHtml();
  document.body.insertAdjacentHTML("beforeend", drawerHtml());
  const drawerEl = document.querySelector("[data-drawer]");

  bindStickyScroll(headerEl);
  bindDropdowns(headerEl);
  bindMobileDrawer(headerEl, drawerEl);

  // Khởi tạo Search Box cho cả desktop lẫn mobile drawer
  headerEl.querySelectorAll("[data-search-wrap]").forEach((wrap) => initSearchBox(wrap));
  drawerEl.querySelectorAll("[data-mobile-search-wrap]").forEach((wrap) => initSearchBox(wrap));

  // Tải dữ liệu thật (song song), không chặn hiển thị UI
  hydrateBranding(headerEl);
  hydrateCategories(headerEl, drawerEl);
  hydrateAccount(headerEl);
  hydrateCart(headerEl);

  // Chỉ gắn 1 lần duy nhất (header có thể được mount lại trong 1 số flow)
  if (!quickAddBound) {
    quickAddBound = true;
    bindGlobalQuickAdd();
  }
}