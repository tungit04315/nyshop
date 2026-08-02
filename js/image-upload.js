// ============================================================
// image-upload.js
// Module dùng chung: nén ảnh -> lưu TRỰC TIẾP vào Firestore (base64)
// + preview + sắp xếp thứ tự ảnh bằng kéo-thả (HTML5 Drag & Drop).
//
// KIẾN TRÚC LƯU ẢNH SẢN PHẨM (album riêng, KHÔNG dùng Firebase Storage):
// - Mỗi ảnh sau khi nén được lưu thành 1 document riêng trong collection
//   Firestore "productImages" (KHÔNG nhúng trực tiếp vào document sản phẩm,
//   và KHÔNG upload lên Firebase Storage). Document ảnh:
//     { productId, url, size, width, height, createdAt }
//   trong đó "url" là chuỗi base64 dạng data URI
//   (vd: "data:image/webp;base64,...."), dùng thẳng làm src="" cho <img>.
// - Document sản phẩm ("products") chỉ lưu mảng "imageIds": string[]
//   (id của các document trong "productImages", đúng thứ tự hiển thị) để
//   gọi/join vào khi cần, thay vì lưu nguyên dữ liệu ảnh của từng ảnh.
// - Ảnh đầu tiên (imageIds[0]) được nhân bản base64 sang field
//   "thumbnailUrl" ngay trên document sản phẩm để Trang Danh sách Sản
//   phẩm (admin) và Storefront (product-card, search, giỏ hàng...) hiển
//   thị ảnh đại diện NGAY khi tải danh sách sản phẩm, không phải đọc
//   thêm document trong "productImages" cho từng sản phẩm chỉ để lấy
//   ảnh bìa.
//
// GIỚI HẠN QUAN TRỌNG — 1 DOCUMENT FIRESTORE TỐI ĐA 1 MiB (1.048.576 byte):
// - Ảnh được nén xuống .webp rồi encode base64 để lưu dạng text trong
//   document. Base64 luôn làm dữ liệu phình to thêm ~33% (4 ký tự text
//   cho mỗi 3 byte nhị phân gốc).
// - Vì vậy KHÔNG thể nén ảnh nhị phân xuống đúng 1MB rồi base64 hóa (sẽ
//   ra ~1.33MB, vượt giới hạn document và Firestore sẽ từ chối ghi).
// - Ngưỡng nén ảnh nhị phân ở đây được đặt ở MAX_OUTPUT_BYTES = 700KB:
//     700KB nhị phân -> base64 ~= 700 * 4/3 =~ 933KB
//   cộng thêm vài trăm byte cho các field khác (productId, size, width,
//   height, createdAt) vẫn còn dư khoảng ~110KB so với giới hạn 1MiB —
//   đủ an toàn. Chiến lược resize-trước-rồi-giảm-chất-lượng vẫn áp dụng
//   y như cũ nên hầu hết mọi ảnh đầu vào vẫn nén đạt dưới ngưỡng này.
//
// Sử dụng: import { createImageUploader } from "./image-upload.js";
// ============================================================

import { db } from "../firebase/firebase-config.js";
import {
    collection,
    addDoc,
    doc,
    deleteDoc,
    getDocs,
    query,
    where,
    documentId,
    serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ---- Cấu hình nén ảnh ----
const OUTPUT_MIME = "image/webp";
// Đích nén ảnh NHỊ PHÂN (trước khi base64 hóa để lưu vào Firestore).
// Xem giải thích chi tiết ở đầu file: 700KB nhị phân -> ~933KB sau khi
// base64 -> vẫn nằm an toàn dưới giới hạn 1MiB/document của Firestore.
const MAX_OUTPUT_BYTES = 700 * 1024; // 700KB nhị phân (KHÔNG phải 1MB)
// Đề xuất dung lượng ảnh GỐC tối đa cho người dùng (trước khi nén):
// Ảnh chụp điện thoại thông thường (JPG/PNG) ~2-8MB vẫn nén xuống dưới
// ngưỡng trên rất nhanh và giữ chất lượng tốt vì hệ thống tự resize cạnh
// dài về tối đa 1920px trước khi nén. 10MB là ngưỡng đủ rộng cho ảnh
// chụp gốc mà vẫn tránh việc trình duyệt xử lý (resize + encode) quá lâu
// với các file ảnh cực lớn (ảnh scan, ảnh in ấn 20-30MB).
const MAX_ORIGINAL_BYTES = 10 * 1024 * 1024; // 10MB — giới hạn ảnh gốc đề xuất
const ACCEPTED_INPUT_TYPES = ["image/jpeg", "image/png", "image/webp"];

// Các mốc thử nén: giảm dần kích thước cạnh dài, ở mỗi mốc thử giảm dần
// chất lượng cho tới khi đạt dưới MAX_OUTPUT_BYTES hoặc hết mốc để thử.
const DIMENSION_STEPS = [1920, 1600, 1280, 1024, 800, 640];
const QUALITY_STEPS = [0.85, 0.75, 0.65, 0.55, 0.45, 0.35];

/**
 * Validate file ảnh GỐC trước khi nén: đúng định dạng + không vượt quá
 * dung lượng gốc đề xuất (10MB). Ảnh hợp lệ sau đó luôn được nén xuống
 * dưới MAX_OUTPUT_BYTES và chuyển sang .webp trước khi lưu nên không cần
 * giới hạn dung lượng đầu ra ở đây.
 * @returns {string|null} - thông báo lỗi, hoặc null nếu hợp lệ
 */
export function validateImageFile(file) {
    if (!ACCEPTED_INPUT_TYPES.includes(file.type)) {
        return `"${file.name}" không phải định dạng ảnh hợp lệ (chỉ nhận JPG, PNG hoặc WEBP).`;
    }
    if (file.size > MAX_ORIGINAL_BYTES) {
        return `"${file.name}" vượt quá dung lượng ảnh gốc cho phép (tối đa 10MB trước khi nén).`;
    }
    return null;
}

/**
 * Đọc file thành ImageBitmap (nhanh, ít tốn bộ nhớ) hoặc HTMLImageElement
 * (trình duyệt cũ không hỗ trợ createImageBitmap).
 */
async function loadImageSource(file) {
    if (typeof createImageBitmap === "function") {
        try {
            return await createImageBitmap(file);
        } catch (err) {
            // rơi xuống phương án dự phòng bên dưới
        }
    }
    const objectUrl = URL.createObjectURL(file);
    return await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Không thể đọc file ảnh."));
        img.src = objectUrl;
    });
}

function drawToCanvas(source, maxDimension) {
    const srcWidth = source.width || source.naturalWidth;
    const srcHeight = source.height || source.naturalHeight;
    let width = srcWidth;
    let height = srcHeight;

    if (Math.max(width, height) > maxDimension) {
        const ratio = maxDimension / Math.max(width, height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(source, 0, 0, width, height);
    return canvas;
}

function canvasToWebpBlob(canvas, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, OUTPUT_MIME, quality));
}

/**
 * Chuyển 1 Blob thành chuỗi base64 dạng data URI (vd: "data:image/webp;base64,...")
 * để lưu thẳng vào field text của document Firestore.
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
function blobToDataUri(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Không thể đọc dữ liệu ảnh đã nén."));
        reader.readAsDataURL(blob);
    });
}

/**
 * Nén + chuyển đổi 1 file ảnh (JPG/PNG/WEBP) sang .webp, tối đa
 * MAX_OUTPUT_BYTES (700KB nhị phân — xem giải thích ở đầu file về giới
 * hạn 1MiB/document của Firestore sau khi base64 hóa).
 * Chiến lược: giảm dần kích thước cạnh dài (1920 -> 640px), ở mỗi mốc thử
 * giảm dần chất lượng (0.85 -> 0.35). Dừng ngay khi đạt dưới ngưỡng; nếu
 * thử hết các mốc mà vẫn chưa đạt (ảnh gốc quá phức tạp/chi tiết), trả về
 * bản nén nhỏ nhất tìm được để không chặn người dùng thêm ảnh.
 * @param {File} file
 * @returns {Promise<{blob: Blob, width: number, height: number}>}
 */
export async function compressImageToWebp(file) {
    const source = await loadImageSource(file);
    let best = null;

    outer: for (const dimension of DIMENSION_STEPS) {
        const canvas = drawToCanvas(source, dimension);
        for (const quality of QUALITY_STEPS) {
            const blob = await canvasToWebpBlob(canvas, quality);
            if (!blob) continue;
            if (!best || blob.size < best.blob.size) {
                best = { blob, width: canvas.width, height: canvas.height };
            }
            if (blob.size <= MAX_OUTPUT_BYTES) {
                break outer;
            }
        }
    }

    if (source.close) source.close(); // giải phóng ImageBitmap

    if (!best) throw new Error("Không thể nén ảnh này.");
    return best;
}

/**
 * Nén 1 file ảnh rồi lưu TRỰC TIẾP (base64) thành 1 document riêng trong
 * album ảnh sản phẩm (collection "productImages") — KHÔNG upload lên
 * Firebase Storage.
 * @param {File} file
 * @param {string} productId
 * @returns {Promise<{id: string, url: string}>}
 */
export async function uploadImageFile(file, productId) {
    const { blob, width, height } = await compressImageToWebp(file);
    const dataUri = await blobToDataUri(blob);

    // Tạo document riêng cho ảnh này trong album (KHÔNG nhúng vào doc sản phẩm)
    const imageDoc = await addDoc(collection(db, "productImages"), {
        productId,
        url: dataUri, // base64 data URI — dùng thẳng làm src="" cho <img>
        size: blob.size, // dung lượng nhị phân TRƯỚC khi base64 hóa
        width,
        height,
        createdAt: serverTimestamp(),
    });

    return { id: imageDoc.id, url: dataUri };
}

/**
 * Xóa 1 ảnh: chỉ cần xóa document trong album "productImages" (không còn
 * file nào trên Storage vì ảnh đã được lưu trực tiếp trong Firestore).
 * Bỏ qua lỗi nếu document không còn tồn tại (đã bị xóa trước đó).
 * @param {{id?: string}} image
 */
export async function deleteImageRecord(image) {
    if (!image || !image.id) return;
    try {
        await deleteDoc(doc(db, "productImages", image.id));
    } catch (err) {
        console.warn("Không thể xóa document ảnh trên Firestore (có thể đã bị xóa trước đó):", err);
    }
}

/**
 * Lấy nhiều document ảnh trong album theo danh sách id (dùng khi mở form
 * Sửa sản phẩm để tải lại gallery ảnh hiện có từ "imageIds").
 * Firestore giới hạn 10 giá trị / mệnh đề "in" nên tự động chia lô.
 * Kết quả trả về ĐÚNG THỨ TỰ theo mảng ids truyền vào.
 *
 * Lưu ý: vì ảnh lưu trực tiếp (base64, tối đa ~933KB/ảnh) trong document,
 * việc tải gallery nhiều ảnh sẽ nặng hơn đáng kể so với chỉ tải URL trỏ
 * tới Storage — đây là đánh đổi tất yếu khi chọn lưu ảnh trong Firestore
 * thay vì Storage.
 * @param {string[]} ids
 * @returns {Promise<Array<{id:string, url:string}>>}
 */
export async function fetchImagesByIds(ids) {
    const validIds = Array.from(new Set((ids || []).filter(Boolean)));
    if (validIds.length === 0) return [];

    const chunks = [];
    for (let i = 0; i < validIds.length; i += 10) {
        chunks.push(validIds.slice(i, i + 10));
    }

    const found = new Map();
    await Promise.all(
        chunks.map(async (chunk) => {
            const q = query(collection(db, "productImages"), where(documentId(), "in", chunk));
            const snap = await getDocs(q);
            snap.docs.forEach((d) => found.set(d.id, { id: d.id, ...d.data() }));
        })
    );

    // Giữ đúng thứ tự đã lưu trong imageIds; bỏ qua id không còn tồn tại
    // (ảnh đã bị xóa thủ công/lỗi đồng bộ) thay vì làm vỡ giao diện.
    return validIds.map((id) => found.get(id)).filter(Boolean);
}

/**
 * Khởi tạo bộ quản lý ảnh cho 1 form (dropzone + lưới ảnh kéo-thả sắp xếp).
 * Component tự quản lý state ảnh nội bộ (mảng {id, url}), cho phép:
 * - Chọn / kéo thả file -> tự động nén sang .webp (≤~700KB nhị phân) rồi
 *   lưu base64 thẳng vào Firestore (album "productImages")
 * - Xóa ảnh (xóa document khỏi album "productImages" + khỏi danh sách)
 * - Kéo-thả để đổi thứ tự hiển thị (ảnh đầu tiên = ảnh chính/thumbnail)
 *
 * @param {Object} options
 * @param {HTMLElement} options.dropzoneEl - phần tử dropzone (click/kéo thả file vào)
 * @param {HTMLInputElement} options.fileInputEl - input[type=file] ẩn liên kết với dropzone
 * @param {HTMLElement} options.gridEl - container hiển thị lưới ảnh
 * @param {string} options.productId - id sản phẩm, gắn vào từng document ảnh trong album
 * @param {Array<{id:string,url:string}>} [options.initialImages]
 * @param {(message:string) => void} [options.onError] - callback khi có lỗi validate/upload
 * @returns {{ getImages: () => Array, isUploading: () => boolean }}
 */
export function createImageUploader({
    dropzoneEl,
    fileInputEl,
    gridEl,
    productId,
    initialImages = [],
    onError = () => { },
}) {
    let images = [...initialImages]; // { id, url }
    let uploadingCount = 0;
    let dragFromIndex = null;

    function render() {
        const items = images
            .map(
                (img, idx) => `
      <div class="image-grid__item" draggable="true" data-index="${idx}">
        <img src="${img.url}" alt="" />
        <span class="image-grid__badge">${idx === 0 ? "Ảnh chính" : idx + 1}</span>
        <button type="button" class="image-grid__remove" data-remove-index="${idx}" aria-label="Xóa ảnh">
          <svg viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>
        </button>
      </div>`
            )
            .join("");

        const uploadingPlaceholders = Array.from({ length: uploadingCount })
            .map(
                () => `
      <div class="image-grid__item image-grid__uploading">
        <span class="btn-spinner" style="border-color: var(--color-border-strong); border-top-color: var(--color-accent);"></span>
      </div>`
            )
            .join("");

        gridEl.innerHTML = items + uploadingPlaceholders;
        bindGridEvents();
    }

    function bindGridEvents() {
        gridEl.querySelectorAll("[data-remove-index]").forEach((btn) => {
            btn.addEventListener("click", async (e) => {
                e.stopPropagation();
                const idx = Number(btn.dataset.removeIndex);
                const [removed] = images.splice(idx, 1);
                render();
                await deleteImageRecord(removed);
            });
        });

        gridEl.querySelectorAll(".image-grid__item[draggable]").forEach((el) => {
            el.addEventListener("dragstart", () => {
                dragFromIndex = Number(el.dataset.index);
                el.classList.add("is-dragging");
            });
            el.addEventListener("dragend", () => {
                el.classList.remove("is-dragging");
                gridEl.querySelectorAll(".is-drop-target").forEach((n) => n.classList.remove("is-drop-target"));
            });
            el.addEventListener("dragover", (e) => {
                e.preventDefault();
                el.classList.add("is-drop-target");
            });
            el.addEventListener("dragleave", () => el.classList.remove("is-drop-target"));
            el.addEventListener("drop", (e) => {
                e.preventDefault();
                el.classList.remove("is-drop-target");
                const dropIndex = Number(el.dataset.index);
                if (dragFromIndex === null || dragFromIndex === dropIndex) return;
                const [moved] = images.splice(dragFromIndex, 1);
                images.splice(dropIndex, 0, moved);
                dragFromIndex = null;
                render();
            });
        });
    }

    async function handleFiles(fileList) {
        const files = Array.from(fileList || []);
        if (files.length === 0) return;

        for (const file of files) {
            const error = validateImageFile(file);
            if (error) {
                onError(error);
                continue;
            }
            uploadingCount += 1;
            render();
            try {
                const uploaded = await uploadImageFile(file, productId);
                images.push(uploaded);
            } catch (err) {
                console.error("Lỗi nén/lưu ảnh:", err);
                onError(`Tải lên "${file.name}" thất bại.`);
            } finally {
                uploadingCount -= 1;
                render();
            }
        }
    }

    dropzoneEl.addEventListener("click", () => fileInputEl.click());
    fileInputEl.addEventListener("change", (e) => {
        handleFiles(e.target.files);
        fileInputEl.value = "";
    });
    dropzoneEl.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropzoneEl.classList.add("is-dragover");
    });
    dropzoneEl.addEventListener("dragleave", () => dropzoneEl.classList.remove("is-dragover"));
    dropzoneEl.addEventListener("drop", (e) => {
        e.preventDefault();
        dropzoneEl.classList.remove("is-dragover");
        handleFiles(e.dataTransfer.files);
    });

    render();

    return {
        getImages: () => images,
        isUploading: () => uploadingCount > 0,
    };
}
