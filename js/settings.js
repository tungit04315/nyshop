// ============================================================
// settings.js
// Điều khiển trang Cài đặt hệ thống:
// - Đọc / ghi 1 document duy nhất: settings/general
// - Logo + Banner: upload ảnh đơn lên Firebase Storage (đường dẫn cố
//   định settings/logo, settings/banner — ảnh cũ luôn bị xóa trước khi
//   thay ảnh mới để tránh rác trên Storage)
// - SEO: Meta Title / Meta Description / Keywords (đếm ký tự trực tiếp)
// - Nút "Hoàn tác thay đổi" nạp lại dữ liệu đã lưu gần nhất từ Firestore
// ============================================================

import { db } from "../firebase/firebase-config.js";
import {
    doc,
    getDoc,
    setDoc,
    addDoc,
    collection,
    serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { escapeHtml, setButtonLoading } from "./helpers.js";
import { showToast } from "./toast.js";
import { uploadImageFile, deleteImageFile, validateImageFile } from "./image-upload.js";

const SETTINGS_DOC_PATH = ["settings", "general"];

let currentAdmin = null;
let savedSettings = null; // dữ liệu đã lưu gần nhất trên Firestore (dùng cho nút "Hoàn tác")
let logoImage = null; // { url, path } | null
let bannerImage = null; // { url, path } | null

// ---- Tham chiếu DOM ----
let form, saveBtn, resetBtn, saveStatusEl;
let siteNameInput, hotlineInput, emailInput, addressInput, facebookInput, zaloInput, youtubeInput;
let metaTitleInput, metaDescInput, keywordsInput, metaTitleCount, metaDescCount;
let logoPreview, logoInput, logoSelectBtn, logoRemoveBtn;
let bannerPreview, bannerInput, bannerSelectBtn, bannerRemoveBtn;

function cacheDom() {
    form = document.getElementById("settings-form");
    saveBtn = document.getElementById("settings-save-btn");
    resetBtn = document.getElementById("settings-reset-btn");
    saveStatusEl = document.getElementById("settings-save-status");

    siteNameInput = document.getElementById("st-site-name");
    hotlineInput = document.getElementById("st-hotline");
    emailInput = document.getElementById("st-email");
    addressInput = document.getElementById("st-address");
    facebookInput = document.getElementById("st-facebook");
    zaloInput = document.getElementById("st-zalo");
    youtubeInput = document.getElementById("st-youtube");

    metaTitleInput = document.getElementById("st-meta-title");
    metaDescInput = document.getElementById("st-meta-desc");
    keywordsInput = document.getElementById("st-keywords");
    metaTitleCount = document.getElementById("st-meta-title-count");
    metaDescCount = document.getElementById("st-meta-desc-count");

    logoPreview = document.getElementById("logo-preview");
    logoInput = document.getElementById("logo-input");
    logoSelectBtn = document.getElementById("logo-select-btn");
    logoRemoveBtn = document.getElementById("logo-remove-btn");

    bannerPreview = document.getElementById("banner-preview");
    bannerInput = document.getElementById("banner-input");
    bannerSelectBtn = document.getElementById("banner-select-btn");
    bannerRemoveBtn = document.getElementById("banner-remove-btn");
}

function bindStaticEvents() {
    form?.addEventListener("submit", (e) => {
        e.preventDefault();
        handleSave();
    });
    resetBtn?.addEventListener("click", () => {
        if (savedSettings) applyToForm(savedSettings);
        showToast("Đã hoàn tác về dữ liệu đã lưu gần nhất.", "info");
    });

    metaTitleInput?.addEventListener("input", () => {
        metaTitleCount.textContent = metaTitleInput.value.length;
    });
    metaDescInput?.addEventListener("input", () => {
        metaDescCount.textContent = metaDescInput.value.length;
    });

    logoSelectBtn?.addEventListener("click", () => logoInput.click());
    logoInput?.addEventListener("change", (e) => handleImageSelect(e, "logo"));
    logoRemoveBtn?.addEventListener("click", () => handleImageRemove("logo"));

    bannerSelectBtn?.addEventListener("click", () => bannerInput.click());
    bannerInput?.addEventListener("change", (e) => handleImageSelect(e, "banner"));
    bannerRemoveBtn?.addEventListener("click", () => handleImageRemove("banner"));
}

/**
 * Được spa-router.js gọi mỗi khi trang Cài đặt được hiển thị.
 */
export function initPage(userData) {
    currentAdmin = userData
        ? { uid: userData.uid, email: userData.email || "", fullName: userData.fullName || "" }
        : null;

    cacheDom();
    bindStaticEvents();
    loadSettings();
}

async function loadSettings() {
    try {
        const snap = await getDoc(doc(db, ...SETTINGS_DOC_PATH));
        savedSettings = snap.exists() ? snap.data() : {};
        applyToForm(savedSettings);
    } catch (err) {
        console.error("Lỗi tải cài đặt hệ thống:", err);
        showToast("Không thể tải cài đặt hệ thống.", "error");
    }
}

/**
 * Đổ dữ liệu (từ Firestore hoặc bản sao lưu cục bộ) vào toàn bộ form.
 */
function applyToForm(data) {
    siteNameInput.value = data.siteName || "";
    hotlineInput.value = data.hotline || "";
    emailInput.value = data.email || "";
    addressInput.value = data.address || "";
    facebookInput.value = data.facebook || "";
    zaloInput.value = data.zalo || "";
    youtubeInput.value = data.youtube || "";

    metaTitleInput.value = data.seo?.metaTitle || "";
    metaDescInput.value = data.seo?.metaDescription || "";
    keywordsInput.value = data.seo?.keywords || "";
    metaTitleCount.textContent = metaTitleInput.value.length;
    metaDescCount.textContent = metaDescInput.value.length;

    logoImage = data.logoUrl ? { url: data.logoUrl, path: data.logoPath || "" } : null;
    bannerImage = data.bannerUrl ? { url: data.bannerUrl, path: data.bannerPath || "" } : null;
    renderImagePreview("logo");
    renderImagePreview("banner");

    setErr("st-site-name-error", "");
    setErr("st-email-error", "");
    saveStatusEl.textContent = "";
}

// ============================================================
// LOGO / BANNER — UPLOAD ẢNH ĐƠN
// ============================================================

const PLACEHOLDER_ICON = `<svg viewBox="0 0 24 24" fill="none"><path d="M20.59 13.41L11 3.83A2 2 0 009.59 3.24H4a1 1 0 00-1 1v5.59a2 2 0 00.59 1.41l9.58 9.59a2 2 0 002.83 0l5.59-5.59a2 2 0 000-2.83z" stroke="currentColor" stroke-width="1.6"/></svg>`;

function renderImagePreview(kind) {
    const image = kind === "logo" ? logoImage : bannerImage;
    const previewEl = kind === "logo" ? logoPreview : bannerPreview;
    const removeBtn = kind === "logo" ? logoRemoveBtn : bannerRemoveBtn;

    previewEl.innerHTML = image ? `<img src="${escapeHtml(image.url)}" alt="" />` : PLACEHOLDER_ICON;
    removeBtn.style.display = image ? "" : "none";
}

async function handleImageSelect(e, kind) {
    const file = e.target.files?.[0];
    e.target.value = ""; // cho phép chọn lại cùng 1 file sau này
    if (!file) return;

    const error = validateImageFile(file);
    if (error) {
        showToast(error, "error");
        return;
    }

    const previewEl = kind === "logo" ? logoPreview : bannerPreview;
    const oldImage = kind === "logo" ? logoImage : bannerImage;

    previewEl.innerHTML = `<span class="btn-spinner"></span>`;

    try {
        const uploaded = await uploadImageFile(file, `settings/${kind}`);
        if (kind === "logo") logoImage = uploaded;
        else bannerImage = uploaded;

        renderImagePreview(kind);

        // Xóa ảnh cũ sau khi ảnh mới đã upload thành công (tránh mất ảnh nếu upload lỗi giữa chừng)
        if (oldImage?.path) await deleteImageFile(oldImage.path);
    } catch (err) {
        console.error(`Lỗi upload ${kind}:`, err);
        showToast(`Tải lên ${kind === "logo" ? "logo" : "banner"} thất bại. Vui lòng thử lại.`, "error");
        renderImagePreview(kind);
    }
}

async function handleImageRemove(kind) {
    const image = kind === "logo" ? logoImage : bannerImage;
    if (!image) return;

    if (kind === "logo") logoImage = null;
    else bannerImage = null;
    renderImagePreview(kind);

    await deleteImageFile(image.path);
}

// ============================================================
// LƯU CÀI ĐẶT
// ============================================================

function setErr(id, msg) {
    const el = document.getElementById(id);
    if (el) {
        el.textContent = msg;
        el.classList.toggle("is-visible", !!msg);
    }
}

function validateForm() {
    let isValid = true;

    if (!siteNameInput.value.trim()) {
        setErr("st-site-name-error", "Vui lòng nhập tên website.");
        isValid = false;
    } else {
        setErr("st-site-name-error", "");
    }

    const email = emailInput.value.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setErr("st-email-error", "Email không hợp lệ.");
        isValid = false;
    } else {
        setErr("st-email-error", "");
    }

    return isValid;
}

async function handleSave() {
    if (!validateForm()) return;

    const data = {
        siteName: siteNameInput.value.trim(),
        hotline: hotlineInput.value.trim(),
        email: emailInput.value.trim(),
        address: addressInput.value.trim(),
        facebook: facebookInput.value.trim(),
        zalo: zaloInput.value.trim(),
        youtube: youtubeInput.value.trim(),
        logoUrl: logoImage?.url || "",
        logoPath: logoImage?.path || "",
        bannerUrl: bannerImage?.url || "",
        bannerPath: bannerImage?.path || "",
        seo: {
            metaTitle: metaTitleInput.value.trim(),
            metaDescription: metaDescInput.value.trim(),
            keywords: keywordsInput.value.trim(),
        },
        updatedAt: serverTimestamp(),
    };

    setButtonLoading(saveBtn, true, "Đang lưu...");
    try {
        await setDoc(doc(db, ...SETTINGS_DOC_PATH), data, { merge: true });

        await addDoc(collection(db, "systemLogs"), {
            type: "settings_update",
            targetCollection: "settings",
            targetId: "general",
            message: "Cập nhật cài đặt hệ thống (thông tin website / SEO / thương hiệu)",
            actorUid: currentAdmin?.uid || "unknown",
            actorEmail: currentAdmin?.email || "",
            createdAt: serverTimestamp(),
        });

        savedSettings = { ...data, updatedAt: new Date() };
        showToast("Đã lưu cài đặt hệ thống.", "success");
        saveStatusEl.textContent = "Đã lưu lúc " + new Date().toLocaleTimeString("vi-VN");
    } catch (err) {
        console.error("Lỗi lưu cài đặt hệ thống:", err);
        showToast("Không thể lưu cài đặt. Vui lòng thử lại.", "error");
    } finally {
        setButtonLoading(saveBtn, false);
    }
}