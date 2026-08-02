// ============================================================
// form-modal.js
// Modal Form dùng chung cho các thao tác Thêm/Sửa (Products, Vouchers,
// Flash Sale, Shipping, Categories...).
// Khác với modal.js (chỉ dùng để xác nhận Yes/No), module này cho phép
// nhúng 1 form tùy ý (HTML) + gắn sự kiện qua callback onMount.
// Sử dụng:
//   const modal = openFormModal({ title, bodyHtml, wide: true, onMount(root) {...} });
//   modal.close();
// ============================================================

let activeOverlay = null;

/**
 * Mở modal form.
 * @param {Object} options
 * @param {string} options.title - Tiêu đề modal
 * @param {string} options.bodyHtml - HTML nội dung form (đặt trong .modal-form__body)
 * @param {boolean} [options.wide=false] - true để dùng biến thể rộng hơn (780px)
 * @param {(root: HTMLElement) => void} [options.onMount] - gọi ngay sau khi modal được chèn vào DOM,
 *        dùng để lấy tham chiếu input, gắn sự kiện submit...
 * @param {() => boolean|void} [options.onBeforeClose] - gọi trước khi đóng do bấm ra ngoài/ESC,
 *        trả về false để chặn đóng (ví dụ khi đang tải lên ảnh dở dang).
 * @returns {{ close: () => void, root: HTMLElement }}
 */
export function openFormModal({ title, bodyHtml, wide = false, onMount, onBeforeClose } = {}) {
    closeFormModal(); // đảm bảo chỉ có 1 modal form tại 1 thời điểm

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.id = "form-modal-overlay";
    overlay.innerHTML = `
    <div class="modal-box modal-box--form ${wide ? "modal-box--wide" : ""}" role="dialog" aria-modal="true">
      <div class="modal-form__header">
        <div class="modal-form__title">${title}</div>
        <button type="button" class="modal-form__close" aria-label="Đóng" data-form-modal-close>
          <svg viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="modal-form__body">${bodyHtml}</div>
    </div>
  `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("modal-overlay--visible"));
    activeOverlay = overlay;

    const tryClose = () => {
        if (typeof onBeforeClose === "function" && onBeforeClose() === false) return;
        closeFormModal();
    };

    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) tryClose();
    });
    overlay.querySelector("[data-form-modal-close]").addEventListener("click", tryClose);

    const onKeydown = (e) => {
        if (e.key === "Escape") tryClose();
    };
    document.addEventListener("keydown", onKeydown);
    overlay.dataset.hasKeydown = "1";
    overlay.__onKeydown = onKeydown;

    if (typeof onMount === "function") onMount(overlay);

    return {
        root: overlay,
        close: closeFormModal,
    };
}

/**
 * Đóng modal form đang mở (nếu có)
 */
export function closeFormModal() {
    if (!activeOverlay) return;
    const overlay = activeOverlay;
    activeOverlay = null;

    overlay.classList.remove("modal-overlay--visible");
    if (overlay.__onKeydown) document.removeEventListener("keydown", overlay.__onKeydown);
    setTimeout(() => overlay.remove(), 200);
}