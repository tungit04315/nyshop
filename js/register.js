// ============================================================
// register.js
// Controller cho register.html: đăng ký tài khoản khách hàng qua
// Firebase Authentication + lưu hồ sơ Firestore "customers" (status:
// "pending"). Toàn bộ validate ở client trước khi gọi Firebase.
// ============================================================


import { setButtonLoading, bindPasswordToggle } from "../js/helpers.js";
import { showToast } from "./toast.js";
import { registerCustomer, translateCustomerAuthError } from "./customer-auth.js";
import {
    validateFullName,
    validateEmail,
    validatePhone,
    validatePassword,
    validateConfirmPassword,
    setFieldError,
    runValidation,
} from "./validators.js";

function cacheDom() {
    return {
        form: document.getElementById("register-form"),
        submitBtn: document.getElementById("rf-submit-btn"),
        fullName: document.getElementById("rf-fullname"),
        email: document.getElementById("rf-email"),
        phone: document.getElementById("rf-phone"),
        password: document.getElementById("rf-password"),
        confirm: document.getElementById("rf-confirm"),
        terms: document.getElementById("rf-terms"),
        formView: document.getElementById("register-form-view"),
        successView: document.getElementById("register-success-view"),
    };
}

function validateForm(dom) {
    const okFields = runValidation([
        { fieldId: "rf-fullname", value: dom.fullName.value, validator: validateFullName },
        { fieldId: "rf-email", value: dom.email.value, validator: validateEmail },
        { fieldId: "rf-phone", value: dom.phone.value, validator: validatePhone },
        { fieldId: "rf-password", value: dom.password.value, validator: validatePassword },
        {
            fieldId: "rf-confirm",
            value: dom.confirm.value,
            validator: (v) => validateConfirmPassword(dom.password.value, v),
        },
    ]);

    const termsOk = dom.terms.checked;
    setFieldError("rf-terms", termsOk ? null : "Bạn cần đồng ý với điều khoản để tiếp tục.");

    return okFields && termsOk;
}

async function handleSubmit(e, dom) {
    e.preventDefault();
    if (!validateForm(dom)) return;

    setButtonLoading(dom.submitBtn, true, "Đang đăng ký...");
    try {
        await registerCustomer({
            fullName: dom.fullName.value,
            email: dom.email.value,
            phone: dom.phone.value,
            password: dom.password.value,
        });
        dom.formView.style.display = "none";
        dom.successView.style.display = "block";
    } catch (err) {
        console.error("[register] Lỗi đăng ký:", err);
        if (err.code === "auth/email-already-in-use") {
            setFieldError("rf-email", translateCustomerAuthError(err));
        } else {
            showToast(translateCustomerAuthError(err), "error");
        }
    } finally {
        setButtonLoading(dom.submitBtn, false);
    }
}

/**
 * Xoá lỗi field ngay khi người dùng gõ lại (trải nghiệm mượt hơn)
 */
function bindLiveClearErrors(dom) {
    [dom.fullName, dom.email, dom.phone, dom.password, dom.confirm].forEach((input) => {
        input.addEventListener("input", () => setFieldError(input.id, null));
    });
    dom.terms.addEventListener("change", () => setFieldError("rf-terms", null));
}

/**
 * Điểm khởi động trang — được gọi bởi site-router.js mỗi khi trang
 * Đăng ký được hiển thị.
 */
export async function initPage() {
    const dom = cacheDom();
    bindPasswordToggle("rf-password");
    bindPasswordToggle("rf-confirm");
    bindLiveClearErrors(dom);
    dom.form.addEventListener("submit", (e) => handleSubmit(e, dom));
}