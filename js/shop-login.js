// ============================================================
// shop-login.js
// Controller cho login.html: đăng nhập khách hàng (Firebase Auth +
// kiểm tra trạng thái Firestore "customers"), quên mật khẩu, và điều
// hướng theo query string ?redirect=... (đặt tên riêng để không trùng
// với js/login.js — trang đăng nhập Admin).
// ============================================================

import { auth } from "../firebase/firebase-config.js";
import {
    setPersistence,
    browserLocalPersistence,
    browserSessionPersistence,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import { setButtonLoading, bindPasswordToggle } from "../js/helpers.js";
import { showToast } from "./toast.js";
import { loginCustomer, resetCustomerPassword, translateCustomerAuthError } from "./customer-auth.js";
import { validateEmail, validateRequired, setFieldError, runValidation } from "./validators.js";

function cacheDom() {
    return {
        loginView: document.getElementById("login-form-view"),
        forgotView: document.getElementById("login-forgot-view"),
        loginForm: document.getElementById("login-form"),
        loginSubmitBtn: document.getElementById("lf-submit-btn"),
        email: document.getElementById("lf-email"),
        password: document.getElementById("lf-password"),
        remember: document.getElementById("lf-remember"),
        forgotToggle: document.getElementById("lf-forgot-toggle"),
        forgotForm: document.getElementById("forgot-form"),
        forgotSubmitBtn: document.getElementById("ff-submit-btn"),
        forgotBackBtn: document.getElementById("ff-back-btn"),
        forgotEmail: document.getElementById("ff-email"),
    };
}

function getRedirectTarget() {
    const params = new URLSearchParams(window.location.search);
    const redirect = params.get("redirect");
    // Chỉ chấp nhận tên file .html nội bộ, tránh open-redirect ra domain khác
    if (redirect && /^[a-zA-Z0-9_-]+\.html$/.test(redirect)) return redirect;
    return "index.html";
}

async function handleLoginSubmit(e, dom) {
    e.preventDefault();
    const ok = runValidation([
        { fieldId: "lf-email", value: dom.email.value, validator: validateEmail },
        { fieldId: "lf-password", value: dom.password.value, validator: (v) => validateRequired(v, "Vui lòng nhập mật khẩu.") },
    ]);
    if (!ok) return;

    setButtonLoading(dom.loginSubmitBtn, true, "Đang đăng nhập...");
    try {
        await setPersistence(auth, dom.remember.checked ? browserLocalPersistence : browserSessionPersistence);
        const customer = await loginCustomer(dom.email.value, dom.password.value);

        if (customer.needApproval) {
            showToast("Đăng nhập thành công. Tài khoản đang chờ duyệt nên chưa thể mua hàng.", "warning", 4500);
        } else {
            showToast(`Chào mừng trở lại, ${customer.fullName || "bạn"}!`, "success");
        }
        window.location.href = getRedirectTarget();
    } catch (err) {
        console.error("[shop-login] Lỗi đăng nhập:", err);
        const message = translateCustomerAuthError(err);
        if (["auth/user-not-found", "auth/wrong-password", "auth/invalid-credential"].includes(err.code)) {
            setFieldError("lf-password", message);
        } else {
            showToast(message, "error");
        }
    } finally {
        setButtonLoading(dom.loginSubmitBtn, false);
    }
}

async function handleForgotSubmit(e, dom) {
    e.preventDefault();
    const ok = runValidation([{ fieldId: "ff-email", value: dom.forgotEmail.value, validator: validateEmail }]);
    if (!ok) return;

    setButtonLoading(dom.forgotSubmitBtn, true, "Đang gửi...");
    try {
        await resetCustomerPassword(dom.forgotEmail.value);
        showToast("Đã gửi liên kết đặt lại mật khẩu. Vui lòng kiểm tra hộp thư email.", "success", 5000);
        dom.forgotForm.reset();
        toggleForgotView(dom, false);
    } catch (err) {
        console.error("[shop-login] Lỗi gửi email đặt lại mật khẩu:", err);
        // Không tiết lộ email có tồn tại hay không (tránh dò email) — vẫn báo lỗi mạng/định dạng thật
        if (err.code === "auth/invalid-email") {
            setFieldError("ff-email", "Email không đúng định dạng.");
        } else {
            showToast("Nếu email tồn tại trong hệ thống, liên kết đặt lại mật khẩu đã được gửi.", "info", 5000);
            dom.forgotForm.reset();
            toggleForgotView(dom, false);
        }
    } finally {
        setButtonLoading(dom.forgotSubmitBtn, false);
    }
}

function toggleForgotView(dom, showForgot) {
    dom.loginView.style.display = showForgot ? "none" : "block";
    dom.forgotView.style.display = showForgot ? "block" : "none";
}

function bindLiveClearErrors(dom) {
    dom.email.addEventListener("input", () => setFieldError("lf-email", null));
    dom.password.addEventListener("input", () => setFieldError("lf-password", null));
    dom.forgotEmail.addEventListener("input", () => setFieldError("ff-email", null));
}

/**
 * Điểm khởi động trang — được gọi bởi site-router.js mỗi khi trang
 * Đăng nhập được hiển thị.
 */
export async function initPage() {
    const dom = cacheDom();
    bindPasswordToggle("lf-password");
    bindLiveClearErrors(dom);

    dom.loginForm.addEventListener("submit", (e) => handleLoginSubmit(e, dom));
    dom.forgotForm.addEventListener("submit", (e) => handleForgotSubmit(e, dom));
    dom.forgotToggle.addEventListener("click", () => toggleForgotView(dom, true));
    dom.forgotBackBtn.addEventListener("click", () => toggleForgotView(dom, false));
}