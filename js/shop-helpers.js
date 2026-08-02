// ============================================================
// helpers.js
// Các hàm tiện ích dùng chung cho Storefront: format tiền tệ, debounce,
// escape HTML, lazy-load ảnh... (giữ cùng convention với helpers.js
// bên hệ thống Admin để đồng bộ codebase).
// ============================================================

/**
 * Định dạng số thành tiền tệ VNĐ
 * @param {number} value
 * @returns {string}
 */
export function formatCurrency(value) {
  const num = Number(value);
  if (isNaN(num)) return "0 ₫";
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(num);
}

/**
 * Debounce function - trì hoãn thực thi hàm cho đến khi ngừng gọi trong `delay` ms
 * Dùng cho ô Search để tránh gọi Firestore liên tục khi người dùng đang gõ.
 */
export function debounce(fn, delay = 350) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Escape HTML để tránh XSS khi render dữ liệu (tên sản phẩm, danh mục...) vào DOM
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Lazy-load ảnh: gán src thật khi ảnh vào viewport, thêm class "is-loaded"
 * khi tải xong để CSS chạy hiệu ứng fade-in.
 * @param {string} root - CSS selector chứa các <img data-src="...">
 */
export function lazyLoadImages(root = document) {
  const imgs = root.querySelectorAll("img[data-src]");
  if (!("IntersectionObserver" in window)) {
    imgs.forEach((img) => {
      img.src = img.dataset.src;
      img.addEventListener("load", () => img.classList.add("is-loaded"));
    });
    return;
  }
  const observer = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const img = entry.target;
        img.src = img.dataset.src;
        img.addEventListener("load", () => img.classList.add("is-loaded"));
        obs.unobserve(img);
      });
    },
    { rootMargin: "120px" }
  );
  imgs.forEach((img) => observer.observe(img));
}

/**
 * Kích hoạt hiệu ứng scroll-reveal cho các phần tử có class "reveal"
 */
export function initScrollReveal(root = document) {
  const els = root.querySelectorAll(".reveal");
  if (!("IntersectionObserver" in window)) {
    els.forEach((el) => el.classList.add("is-visible"));
    return;
  }
  const observer = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          obs.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 }
  );
  els.forEach((el) => observer.observe(el));
}

/**
 * Lấy chữ cái viết tắt từ họ tên / email để hiển thị avatar mặc định.
 * @param {string} fullName
 * @returns {string}
 */
export function getInitials(fullName = "") {
  const parts = String(fullName).trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

/**
 * Toggle trạng thái loading cho 1 nút bấm (disable + hiện spinner + đổi nhãn tạm thời)
 * @param {HTMLButtonElement} button
 * @param {boolean} isLoading
 * @param {string} loadingText
 */
export function setButtonLoading(button, isLoading, loadingText = "Đang xử lý...") {
  if (!button) return;
  if (isLoading) {
    button.dataset.originalText = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="btn-spinner"></span> ${loadingText}`;
  } else {
    button.disabled = false;
    if (button.dataset.originalText) button.innerHTML = button.dataset.originalText;
  }
}

/**
 * Sinh mã đơn hàng dễ đọc (hiển thị cho khách + dùng để Tra cứu đơn),
 * dạng: DH + ngày (YYMMDD) + 4 ký tự ngẫu nhiên. Được gọi 1 lần duy nhất
 * lúc tạo đơn ở checkout.js và lưu cố định vào field "orderCode".
 * @returns {string}
 */
export function generateOrderCode() {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `DH${yy}${mm}${dd}${rand}`;
}

/**
 * Hiển thị 1 toast thông báo ngắn (dùng cho placeholder UI: giỏ hàng,
 * đăng nhập... ở Giai đoạn 1 — chưa có logic nghiệp vụ thật).
 * @param {string} message
 */
export function showToast(message) {
  let container = document.querySelector(".toast-container");
  if (!container) {
    container = document.createElement("div");
    container.className = "toast-container";
    document.body.appendChild(container);
  }
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("is-visible"));
  setTimeout(() => {
    toast.classList.remove("is-visible");
    setTimeout(() => toast.remove(), 300);
  }, 2600);
}