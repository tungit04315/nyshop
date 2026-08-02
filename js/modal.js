// ============================================================
// modal.js
// Module Modal xác nhận (Confirm Modal) dùng chung toàn hệ thống
// Sử dụng: import { showConfirmModal } from '../js/modal.js';
//   const ok = await showConfirmModal({ title, message, confirmText, danger });
// ============================================================

/**
 * Hiển thị modal xác nhận, trả về Promise<boolean>
 * @param {Object} options
 * @param {string} options.title - Tiêu đề modal
 * @param {string} options.message - Nội dung xác nhận
 * @param {string} [options.confirmText='Xác nhận']
 * @param {string} [options.cancelText='Hủy']
 * @param {boolean} [options.danger=false] - true nếu là hành động nguy hiểm (đổi màu nút đỏ)
 * @returns {Promise<boolean>}
 */
export function showConfirmModal({
  title = "Xác nhận",
  message = "Bạn có chắc chắn muốn thực hiện hành động này?",
  confirmText = "Xác nhận",
  cancelText = "Hủy",
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    // Xóa modal cũ nếu còn tồn tại
    const existing = document.getElementById("confirm-modal-overlay");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "confirm-modal-overlay";
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <h3 id="modal-title" class="modal-box__title">${title}</h3>
        <p class="modal-box__message">${message}</p>
        <div class="modal-box__actions">
          <button type="button" class="btn btn--ghost" data-action="cancel">${cancelText}</button>
          <button type="button" class="btn ${danger ? "btn--danger" : "btn--primary"}" data-action="confirm">${confirmText}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("modal-overlay--visible"));

    const close = (result) => {
      overlay.classList.remove("modal-overlay--visible");
      setTimeout(() => overlay.remove(), 200);
      document.removeEventListener("keydown", onKeydown);
      resolve(result);
    };

    const onKeydown = (e) => {
      if (e.key === "Escape") close(false);
    };
    document.addEventListener("keydown", onKeydown);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close(false);
    });
    overlay.querySelector('[data-action="cancel"]').addEventListener("click", () => close(false));
    overlay.querySelector('[data-action="confirm"]').addEventListener("click", () => close(true));
  });
}