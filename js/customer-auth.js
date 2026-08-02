// ============================================================
// customer-auth.js
// Lớp xử lý xác thực KHÁCH HÀNG (khác với js/auth.js — dành cho Admin):
// - Đăng ký: tạo Firebase Auth user + lưu hồ sơ Firestore "customers"
//   với status = "pending" (chờ quản trị viên phê duyệt).
// - Đăng nhập: xác thực Firebase Auth, sau đó đọc Firestore để kiểm tra
//   trạng thái (pending / approved / rejected / locked).
// - Theo dõi trạng thái đăng nhập theo thời gian thực (onSnapshot) để
//   Header/Trang cá nhân tự cập nhật ngay khi Admin duyệt tài khoản mà
//   không cần tải lại trang.
// ============================================================

import { auth, db } from "../firebase/firebase-config.js";
import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    sendPasswordResetEmail,
    onAuthStateChanged,
    signOut,
    reauthenticateWithCredential,
    EmailAuthProvider,
    updatePassword,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
    doc,
    setDoc,
    getDoc,
    updateDoc,
    onSnapshot,
    serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Các trạng thái tài khoản không được phép tiếp tục phiên đăng nhập
const BLOCKED_STATUSES = new Set(["rejected", "locked"]);

/**
 * Đăng ký tài khoản khách hàng mới.
 * 1) Tạo user trên Firebase Authentication (email/password)
 * 2) Lưu hồ sơ vào Firestore "customers/{uid}" với status "pending"
 * @param {{fullName:string, email:string, phone:string, password:string}} data
 * @returns {Promise<{uid:string}>}
 */
export async function registerCustomer({ fullName, email, phone, password }) {
    const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
    const uid = credential.user.uid;

    try {
        await setDoc(doc(db, "customers", uid), {
            fullName: fullName.trim(),
            email: email.trim(),
            phone: phone.trim(),
            address: "",
            avatar: "",
            status: "pending",
            createdAt: serverTimestamp(),
            statusUpdatedAt: serverTimestamp(),
        });
    } catch (err) {
        // Nếu lưu hồ sơ Firestore thất bại, không để lại tài khoản Auth "mồ côi"
        // (không có hồ sơ) — cố gắng dọn dẹp để người dùng có thể đăng ký lại.
        console.error("[customer-auth] Lỗi lưu hồ sơ Firestore, thử dọn dẹp:", err);
        try {
            await credential.user.delete();
        } catch (cleanupErr) {
            console.error("[customer-auth] Không thể dọn dẹp tài khoản Auth:", cleanupErr);
        }
        throw err;
    }

    // Đăng ký xong thì đăng xuất ngay — bắt buộc người dùng chủ động đăng
    // nhập lại để tránh nhầm lẫn trạng thái phiên (đặc biệt khi tài khoản
    // đang "pending" và có thể vào các trang yêu cầu quyền cao hơn).
    await signOut(auth);

    return { uid };
}

/**
 * Đăng nhập khách hàng: xác thực Firebase Auth rồi kiểm tra hồ sơ Firestore.
 * - Không có hồ sơ "customers" (vd: tài khoản Admin) -> báo lỗi, đăng xuất.
 * - status = rejected/locked -> đăng xuất, báo lỗi cụ thể.
 * - status = pending -> vẫn đăng nhập được (needApproval = true), nhưng
 *   chưa được phép mua hàng (kiểm soát ở tầng UI: nút Đặt hàng/Thanh toán).
 * - status = approved -> đăng nhập thành công bình thường.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<Object>} hồ sơ khách hàng (kèm needApproval)
 */
export async function loginCustomer(email, password) {
    const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
    const uid = credential.user.uid;

    const customerRef = doc(db, "customers", uid);
    const snap = await getDoc(customerRef);

    if (!snap.exists()) {
        await signOut(auth);
        const err = new Error("Tài khoản không tồn tại trong hệ thống khách hàng.");
        err.code = "customer/not-found";
        throw err;
    }

    const data = snap.data();

    if (BLOCKED_STATUSES.has(data.status)) {
        await signOut(auth);
        const err = new Error(
            data.status === "locked"
                ? "Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên để biết thêm chi tiết."
                : "Tài khoản của bạn đã bị từ chối phê duyệt. Vui lòng liên hệ quản trị viên."
        );
        err.code = `customer/${data.status}`;
        throw err;
    }

    return {
        uid,
        ...data,
        needApproval: data.status === "pending",
    };
}

/**
 * Gửi email đặt lại mật khẩu
 * @param {string} email
 */
export async function resetCustomerPassword(email) {
    await sendPasswordResetEmail(auth, email.trim());
}

/**
 * Đăng xuất khách hàng hiện tại
 */
export async function logoutCustomer() {
    await signOut(auth);
}

/**
 * Đổi mật khẩu: yêu cầu xác thực lại (re-authenticate) bằng mật khẩu hiện
 * tại trước khi đổi, theo đúng yêu cầu bảo mật của Firebase Auth.
 * @param {string} currentPassword
 * @param {string} newPassword
 */
export async function changeCustomerPassword(currentPassword, newPassword) {
    const user = auth.currentUser;
    if (!user || !user.email) {
        const err = new Error("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
        err.code = "customer/no-session";
        throw err;
    }
    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);
    await updatePassword(user, newPassword);
}

/**
 * Cập nhật hồ sơ Firestore của khách hàng hiện tại (chỉ các field cho phép).
 * @param {string} uid
 * @param {Object} patch
 */
export async function updateCustomerProfile(uid, patch) {
    await updateDoc(doc(db, "customers", uid), {
        ...patch,
        updatedAt: serverTimestamp(),
    });
}

/**
 * Theo dõi trạng thái đăng nhập của khách hàng THEO THỜI GIAN THỰC.
 * Dùng onSnapshot cho hồ sơ Firestore để tự cập nhật UI ngay khi Admin
 * duyệt/khóa tài khoản, không cần khách hàng tải lại trang.
 * @param {(customer: Object|null) => void} callback
 * @returns {() => void} hàm hủy theo dõi (unsubscribe)
 */
export function watchCustomerAuth(callback) {
    let unsubDoc = null;

    const unsubAuth = onAuthStateChanged(auth, (user) => {
        if (unsubDoc) {
            unsubDoc();
            unsubDoc = null;
        }

        if (!user) {
            callback(null);
            return;
        }

        const customerRef = doc(db, "customers", user.uid);
        unsubDoc = onSnapshot(
            customerRef,
            (snap) => {
                if (!snap.exists()) {
                    callback(null);
                    return;
                }
                const data = snap.data();
                // Tài khoản bị khóa/từ chối trong lúc đang có phiên đăng nhập
                // (Admin thao tác) -> tự động đăng xuất phía client.
                if (BLOCKED_STATUSES.has(data.status)) {
                    callback(null);
                    signOut(auth).catch(() => { });
                    return;
                }
                callback({ uid: user.uid, ...data });
            },
            (err) => {
                console.error("[customer-auth] Lỗi theo dõi hồ sơ khách hàng:", err);
                callback(null);
            }
        );
    });

    return () => {
        unsubAuth();
        if (unsubDoc) unsubDoc();
    };
}

/**
 * Diễn giải mã lỗi Firebase Auth sang tiếng Việt dễ hiểu (dành riêng cho
 * luồng khách hàng — thông báo thân thiện hơn ngữ cảnh Admin).
 */
export function translateCustomerAuthError(error) {
    const code = error?.code || "";
    const map = {
        "auth/email-already-in-use": "Email này đã được đăng ký. Vui lòng đăng nhập hoặc dùng email khác.",
        "auth/invalid-email": "Địa chỉ email không hợp lệ.",
        "auth/weak-password": "Mật khẩu quá yếu, vui lòng chọn mật khẩu khác.",
        "auth/user-disabled": "Tài khoản này đã bị vô hiệu hóa.",
        "auth/user-not-found": "Email hoặc mật khẩu không chính xác.",
        "auth/wrong-password": "Email hoặc mật khẩu không chính xác.",
        "auth/invalid-credential": "Email hoặc mật khẩu không chính xác.",
        "auth/too-many-requests": "Bạn đã thử quá nhiều lần. Vui lòng thử lại sau ít phút.",
        "auth/network-request-failed": "Lỗi kết nối mạng. Vui lòng kiểm tra lại đường truyền.",
        "auth/requires-recent-login": "Vui lòng đăng nhập lại để thực hiện thao tác này.",
        "customer/not-found": "Tài khoản không tồn tại trong hệ thống khách hàng.",
        "customer/locked": error?.message || "Tài khoản của bạn đã bị khóa.",
        "customer/rejected": error?.message || "Tài khoản của bạn đã bị từ chối phê duyệt.",
        "customer/no-session": "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
    };
    return map[code] || error?.message || "Đã xảy ra lỗi. Vui lòng thử lại.";
}