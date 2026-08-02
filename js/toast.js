// ============================================================
// toast.js
// Module hiển thị thông báo Toast (success / error / warning / info)
// Sử dụng: import { showToast } from '../js/toast.js'; showToast('Thành công', 'success');
// ============================================================

/**
 * Đảm bảo container chứa toast tồn tại trong DOM
 */
function getToastContainer() {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.className = "toast-container";
    document.body.appendChild(container);
  }
  return container;
}

const ICONS = {
  success: `<svg viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  error: `<svg viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  warning: `<svg viewBox="0 0 24 24" fill="none"><path d="M12 9v4m0 4h.01M10.29 3.86l-8.18 14.18A1 1 0 003 19.5h18a1 1 0 00.87-1.46L13.7 3.86a1 1 0 00-1.72 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  info: `<svg viewBox="0 0 24 24" fill="none"><path d="M12 16v-4m0-4h.01M22 12a10 10 0 11-20 0 10 10 0 0120 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};

/**
 * Hiển thị toast notification
 * @param {string} message - Nội dung thông báo
 * @param {'success'|'error'|'warning'|'info'} type - Loại thông báo
 * @param {number} duration - Thời gian hiển thị (ms)
 */
export function showToast(message, type = "info", duration = 3500) {
  const container = getToastContainer();

  const toast = document.createElement("div");
  toast.className = `toast toast--${type}`;
  toast.innerHTML = `
    <span class="toast__icon">${ICONS[type] || ICONS.info}</span>
    <span class="toast__message">${message}</span>
    <button class="toast__close" aria-label="Đóng thông báo">&times;</button>
  `;

  container.appendChild(toast);

  // Trigger animation vào
  requestAnimationFrame(() => toast.classList.add("toast--visible"));

  const remove = () => {
    toast.classList.remove("toast--visible");
    toast.classList.add("toast--leaving");
    setTimeout(() => toast.remove(), 250);
  };

  const timer = setTimeout(remove, duration);

  toast.querySelector(".toast__close").addEventListener("click", () => {
    clearTimeout(timer);
    remove();
  });
}