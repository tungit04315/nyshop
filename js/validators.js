// ============================================================
// validators.js
// Bộ hàm validate dùng chung cho các form phía Storefront (Đăng ký,
// Đăng nhập, Trang cá nhân...). Mỗi hàm validate nhận vào giá trị và
// trả về:
//   - null           -> hợp lệ
//   - string (lỗi)   -> không hợp lệ, nội dung là thông báo hiển thị
// Quy ước hiển thị lỗi: mỗi input có id "xx-field" đi kèm 1 thẻ
// <div class="form-error" id="xx-field-error"></div> ngay bên dưới
// (đã có sẵn trong register.html / login.html / profile.html).
// ============================================================

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Số điện thoại VN: 10 số bắt đầu bằng 0, hoặc dạng +84 theo sau 9 số
const PHONE_REGEX = /^(0\d{9}|\+84\d{9})$/;

/**
 * Validate 1 trường bắt buộc (không được để trống)
 * @param {string} value
 * @param {string} message - thông báo lỗi tùy biến khi trống
 * @returns {string|null}
 */
export function validateRequired(value, message = "Trường này không được để trống.") {
    if (value === null || value === undefined || String(value).trim() === "") return message;
    return null;
}

/**
 * Validate họ và tên: bắt buộc, tối thiểu 2 ký tự, tối đa 60, không chứa số/ký tự đặc biệt
 * @param {string} value
 */
export function validateFullName(value) {
    const v = (value || "").trim();
    if (!v) return "Vui lòng nhập họ và tên.";
    if (v.length < 2) return "Họ và tên phải có ít nhất 2 ký tự.";
    if (v.length > 60) return "Họ và tên không được vượt quá 60 ký tự.";
    // Cho phép chữ cái (kể cả có dấu tiếng Việt) và khoảng trắng
    if (!/^[\p{L}\s.'-]+$/u.test(v)) return "Họ và tên không được chứa số hoặc ký tự đặc biệt.";
    return null;
}

/**
 * Validate email: bắt buộc + đúng định dạng
 * @param {string} value
 */
export function validateEmail(value) {
    const v = (value || "").trim();
    if (!v) return "Vui lòng nhập email.";
    if (!EMAIL_REGEX.test(v)) return "Email không đúng định dạng.";
    return null;
}

/**
 * Validate số điện thoại Việt Nam: bắt buộc + đúng định dạng
 * @param {string} value
 */
export function validatePhone(value) {
    const v = (value || "").trim().replace(/[\s.-]/g, "");
    if (!v) return "Vui lòng nhập số điện thoại.";
    if (!PHONE_REGEX.test(v)) return "Số điện thoại không hợp lệ (VD: 0912345678).";
    return null;
}

/**
 * Validate mật khẩu: bắt buộc, tối thiểu 6 ký tự (theo yêu cầu tối thiểu của Firebase Auth)
 * @param {string} value
 */
export function validatePassword(value) {
    const v = value || "";
    if (!v) return "Vui lòng nhập mật khẩu.";
    if (v.length < 6) return "Mật khẩu phải có ít nhất 6 ký tự.";
    if (v.length > 4096) return "Mật khẩu quá dài.";
    return null;
}

/**
 * Validate xác nhận mật khẩu: bắt buộc + phải trùng khớp với mật khẩu gốc
 * @param {string} password
 * @param {string} confirm
 */
export function validateConfirmPassword(password, confirm) {
    if (!confirm) return "Vui lòng nhập lại mật khẩu.";
    if (confirm !== password) return "Mật khẩu xác nhận không khớp.";
    return null;
}

/**
 * Validate địa chỉ giao hàng: bắt buộc, tối thiểu 8 ký tự
 * @param {string} value
 */
export function validateAddress(value) {
    const v = (value || "").trim();
    if (!v) return "Vui lòng nhập địa chỉ.";
    if (v.length < 8) return "Địa chỉ quá ngắn, vui lòng nhập đầy đủ hơn.";
    if (v.length > 240) return "Địa chỉ không được vượt quá 240 ký tự.";
    return null;
}

/**
 * Hiển thị / xoá lỗi cho 1 field theo quy ước id:
 *   input:      #{fieldId}
 *   error div:  #{fieldId}-error
 * @param {string} fieldId
 * @param {string|null} message - null/"" để xoá lỗi
 */
export function setFieldError(fieldId, message) {
    const inputEl = document.getElementById(fieldId);
    const errorEl = document.getElementById(`${fieldId}-error`);
    const hasError = !!message;

    if (errorEl) {
        errorEl.textContent = message || "";
        errorEl.classList.toggle("is-visible", hasError);
    }
    if (inputEl) {
        inputEl.classList.toggle("is-invalid", hasError);
    }
}

/**
 * Chạy nhiều validator cùng lúc, tự động hiển thị lỗi cho từng field.
 * @param {Array<{fieldId:string, value:*, validator:(value:*)=>string|null}>} fields
 * @returns {boolean} true nếu TẤT CẢ field đều hợp lệ
 */
export function runValidation(fields) {
    let allOk = true;
    for (const { fieldId, value, validator } of fields) {
        const error = validator(value);
        setFieldError(fieldId, error);
        if (error) allOk = false;
    }
    return allOk;
}