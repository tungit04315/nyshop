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
 * Lấy chữ cái đầu của họ tên để hiển thị avatar mặc định (vd: "Nguyễn Văn A" -> "NA")
 * @param {string} fullName
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
 * Gắn nút "hiện/ẩn mật khẩu" cho 1 input password, dựa trên thuộc tính
 * `data-toggle-password="{inputId}"` đã có sẵn trong HTML (login.html,
 * register.html). Bấm sẽ đổi type input giữa "password" <-> "text".
 * @param {string} inputId
 */
export function bindPasswordToggle(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const btn = document.querySelector(`[data-toggle-password="${inputId}"]`);
  if (!btn) return;
  btn.addEventListener("click", () => {
    const isHidden = input.type === "password";
    input.type = isHidden ? "text" : "password";
    btn.classList.toggle("is-active", isHidden);
  });
}

/**
 * Bôi đậm (highlight) đoạn khớp với từ khoá tìm kiếm trong 1 chuỗi văn bản.
 * Dùng cho gợi ý Autocomplete của ô Search (tên sản phẩm).
 * Đã escape HTML trước khi chèn <mark> để tránh XSS.
 * @param {string} text
 * @param {string} keyword
 * @returns {string} HTML an toàn, đoạn khớp được bọc trong <mark>
 */
export function highlightKeyword(text, keyword) {
  const safeText = escapeHtml(text || "");
  const safeKeyword = (keyword || "").trim();
  if (!safeKeyword) return safeText;
  try {
    const escapedForRegex = safeKeyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(${escapedForRegex})`, "ig");
    return safeText.replace(regex, "<mark>$1</mark>");
  } catch {
    return safeText;
  }
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

/**
 * Định dạng ngày giờ theo chuẩn Việt Nam.
 * Hỗ trợ:
 * - Firestore Timestamp
 * - JavaScript Date
 * - Unix timestamp (milliseconds)
 * - Chuỗi ISO
 *
 * @param {any} value
 * @returns {string}
 */
export function formatDateTime(value) {
  if (!value) return "—";

  let date;

  // Firestore Timestamp
  if (typeof value?.toDate === "function") {
    date = value.toDate();
  }
  // Date object
  else if (value instanceof Date) {
    date = value;
  }
  // number hoặc string
  else {
    date = new Date(value);
  }

  if (!(date instanceof Date) || isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/**
 * Định dạng ngày theo chuẩn Việt Nam (dd/MM/yyyy).
 * Hỗ trợ:
 * - Firestore Timestamp
 * - Date
 * - milliseconds
 * - ISO string
 */
export function formatDate(value) {
  if (!value) return "—";

  let date;

  if (typeof value?.toDate === "function") {
    date = value.toDate();
  } else if (value instanceof Date) {
    date = value;
  } else {
    date = new Date(value);
  }

  if (isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}