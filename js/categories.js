// ============================================================
// categories.js
// CRUD đơn giản cho danh mục sản phẩm (collection "categories").
// Dùng bởi products.js: dropdown chọn danh mục khi thêm/sửa sản phẩm,
// và modal "Quản lý danh mục" (thêm/xóa nhanh).
// ============================================================

import { db } from "../firebase/firebase-config.js";
import {
    collection,
    query,
    orderBy,
    getDocs,
    addDoc,
    deleteDoc,
    doc,
    serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/**
 * Lấy toàn bộ danh mục, sắp xếp theo tên
 * @returns {Promise<Array<{id:string, name:string}>>}
 */
export async function fetchCategories() {
    const q = query(collection(db, "categories"), orderBy("name", "asc"));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Thêm danh mục mới. Trả về id vừa tạo.
 * @param {string} name
 */
export async function addCategory(name) {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Tên danh mục không được để trống.");
    const docRef = await addDoc(collection(db, "categories"), {
        name: trimmed,
        createdAt: serverTimestamp(),
    });
    return docRef.id;
}

/**
 * Xóa danh mục theo id.
 * Lưu ý: không tự động cập nhật lại các sản phẩm đang thuộc danh mục này
 * (sản phẩm sẽ giữ nguyên categoryName cũ đã lưu, tránh mất dữ liệu lịch sử).
 * @param {string} categoryId
 */
export async function deleteCategory(categoryId) {
    await deleteDoc(doc(db, "categories", categoryId));
}