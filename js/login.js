// ============================================================
// login.js
// Điều khiển trang đăng nhập Admin: validate, gọi Firebase Auth,
// kiểm tra quyền, quên mật khẩu, loading overlay, toast
// ============================================================

import { loginAdmin, resetPassword, translateAuthError } from "./auth.js";
import { showToast } from "./toast.js";
import { setButtonLoading } from "./helpers.js";

const form = document.getElementById("login-form");
const emailInput = document.getElementById("login-email");
const passwordInput = document.getElementById("login-password");
const emailError = document.getElementById("login-email-error");
const passwordError = document.getElementById("login-password-error");
const submitBtn = document.getElementById("login-submit");
const togglePasswordBtn = document.getElementById("toggle-password");
const forgotBtn = document.getElementById("login-forgot");
const overlay = document.getElementById("auth-loading-overlay");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Nếu người dùng đã đăng nhập từ trước (session còn hạn) -> chuyển thẳng vào dashboard.
 * Dùng onAuthStateChanged một lần, không redirect nếu chưa có auth.
 */
import { auth, db } from "../firebase/firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    try {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (snap.exists()) {
            const data = snap.data();
            if (data.role === "admin" && data.status === "approved") {
                window.location.href = "dashboard.html";
            }
        }
    } catch (err) {
        // Bỏ qua lỗi ở bước kiểm tra ngầm này, để người dùng tự đăng nhập lại
        console.warn("Không thể kiểm tra phiên đăng nhập:", err);
    }
});

/**
 * Hiển thị / ẩn lỗi validate cho 1 field
 */
function setFieldError(input, errorEl, message) {
    if (message) {
        input.classList.add("is-invalid");
        errorEl.textContent = message;
        errorEl.classList.add("is-visible");
    } else {
        input.classList.remove("is-invalid");
        errorEl.classList.remove("is-visible");
        errorEl.textContent = "";
    }
}

/**
 * Validate toàn bộ form, trả về true nếu hợp lệ
 */
function validateForm() {
    let isValid = true;

    const email = emailInput.value.trim();
    if (!email) {
        setFieldError(emailInput, emailError, "Vui lòng nhập email.");
        isValid = false;
    } else if (!EMAIL_REGEX.test(email)) {
        setFieldError(emailInput, emailError, "Email không đúng định dạng.");
        isValid = false;
    } else {
        setFieldError(emailInput, emailError, "");
    }

    const password = passwordInput.value;
    if (!password) {
        setFieldError(passwordInput, passwordError, "Vui lòng nhập mật khẩu.");
        isValid = false;
    } else if (password.length < 6) {
        setFieldError(passwordInput, passwordError, "Mật khẩu phải có ít nhất 6 ký tự.");
        isValid = false;
    } else {
        setFieldError(passwordInput, passwordError, "");
    }

    return isValid;
}

/**
 * Hiện / ẩn overlay loading toàn màn hình
 */
function toggleOverlay(show) {
    if (!overlay) return;
    overlay.classList.toggle("is-visible", show);
}

// Toggle hiện/ẩn mật khẩu
togglePasswordBtn?.addEventListener("click", () => {
    const isPassword = passwordInput.type === "password";
    passwordInput.type = isPassword ? "text" : "password";
    togglePasswordBtn.setAttribute("aria-label", isPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu");
    togglePasswordBtn.classList.toggle("is-active", isPassword);
});

// Xóa lỗi ngay khi người dùng gõ lại
emailInput?.addEventListener("input", () => setFieldError(emailInput, emailError, ""));
passwordInput?.addEventListener("input", () => setFieldError(passwordInput, passwordError, ""));

// Submit form đăng nhập
form?.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!validateForm()) return;

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    setButtonLoading(submitBtn, true, "Đang đăng nhập...");
    toggleOverlay(true);

    try {
        await loginAdmin(email, password);
        showToast("Đăng nhập thành công! Đang chuyển hướng...", "success");
        window.location.href = "dashboard.html";
    } catch (err) {
        console.error("Lỗi đăng nhập:", err);
        const message = translateAuthError(err);
        showToast(message, "error");

        if (err?.message === "PERMISSION_DENIED") {
            setFieldError(emailInput, emailError, "Bạn không có quyền truy cập.");
        } else {
            setFieldError(passwordInput, passwordError, message);
        }
    } finally {
        setButtonLoading(submitBtn, false);
        toggleOverlay(false);
    }
});

// Quên mật khẩu
forgotBtn?.addEventListener("click", async () => {
    const email = emailInput.value.trim();

    if (!email || !EMAIL_REGEX.test(email)) {
        setFieldError(emailInput, emailError, "Nhập email hợp lệ để lấy lại mật khẩu.");
        emailInput.focus();
        return;
    }

    setButtonLoading(forgotBtn, true, "Đang gửi...");

    try {
        await resetPassword(email);
        showToast("Đã gửi email đặt lại mật khẩu. Vui lòng kiểm tra hộp thư.", "success");
    } catch (err) {
        console.error("Lỗi gửi email đặt lại mật khẩu:", err);
        showToast(translateAuthError(err), "error");
    } finally {
        setButtonLoading(forgotBtn, false);
    }
});