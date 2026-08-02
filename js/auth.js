// ============================================================
// auth.js
// Xử lý đăng nhập, kiểm tra phân quyền admin, bảo vệ route (route guard)
// ============================================================

import { auth, db } from "../firebase/firebase-config.js";
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/**
 * Đăng nhập bằng email/password, sau đó kiểm tra quyền admin trong Firestore.
 * Nếu không đủ điều kiện (role != admin hoặc status != approved) -> tự động signOut và throw lỗi.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<Object>} thông tin user (kèm dữ liệu Firestore)
 */
export async function loginAdmin(email, password) {
  // 1. Xác thực với Firebase Authentication
  const credential = await signInWithEmailAndPassword(auth, email, password);
  const uid = credential.user.uid;

  // 2. Kiểm tra hồ sơ quyền hạn trong Firestore
  const userRef = doc(db, "users", uid);
  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) {
    await signOut(auth);
    throw new Error("PERMISSION_DENIED");
  }

  const userData = userSnap.data();

  if (userData.role !== "admin" || userData.status !== "approved") {
    await signOut(auth);
    throw new Error("PERMISSION_DENIED");
  }

  // 3. Cập nhật thời gian đăng nhập gần nhất
  await updateDoc(userRef, { lastLoginAt: serverTimestamp() });

  return { uid, ...userData };
}

/**
 * Gửi email đặt lại mật khẩu
 * @param {string} email
 */
export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email);
}

/**
 * Đăng xuất
 */
export async function logoutAdmin() {
  await signOut(auth);
  window.location.href = "login.html";
}

/**
 * Route Guard - dùng ở đầu mỗi trang admin (dashboard, customers...)
 * Kiểm tra: đã đăng nhập? role=admin? status=approved?
 * Nếu hợp lệ -> gọi callback(userData); nếu không -> redirect về login.html
 * @param {(userData: Object) => void} onAuthorized
 */
export function guardAdminRoute(onAuthorized) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "login.html";
      return;
    }

    try {
      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        await signOut(auth);
        window.location.href = "login.html";
        return;
      }

      const userData = userSnap.data();

      if (userData.role !== "admin" || userData.status !== "approved") {
        await signOut(auth);
        window.location.href = "login.html";
        return;
      }

      onAuthorized({ uid: user.uid, ...userData });
    } catch (err) {
      console.error("Lỗi kiểm tra phân quyền:", err);
      window.location.href = "login.html";
    }
  });
}

/**
 * Diễn giải mã lỗi Firebase Auth sang tiếng Việt dễ hiểu
 */
export function translateAuthError(error) {
  const code = error?.code || error?.message || "";
  const map = {
    "auth/invalid-email": "Địa chỉ email không hợp lệ.",
    "auth/user-disabled": "Tài khoản này đã bị vô hiệu hóa.",
    "auth/user-not-found": "Email hoặc mật khẩu không chính xác.",
    "auth/wrong-password": "Email hoặc mật khẩu không chính xác.",
    "auth/invalid-credential": "Email hoặc mật khẩu không chính xác.",
    "auth/too-many-requests": "Bạn đã thử quá nhiều lần. Vui lòng thử lại sau.",
    "auth/network-request-failed": "Lỗi kết nối mạng. Vui lòng kiểm tra lại đường truyền.",
    PERMISSION_DENIED: "Bạn không có quyền truy cập.",
  };
  return map[code] || "Đã xảy ra lỗi. Vui lòng thử lại.";
}