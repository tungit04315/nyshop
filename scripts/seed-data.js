// ============================================================
// scripts/seed-data.js
// Script sinh DỮ LIỆU MẪU cho môi trường Demo/Dev — KHÔNG chạy trong
// trình duyệt, chạy 1 lần từ máy local bằng Node.js + firebase-admin
// (Admin SDK bỏ qua Firestore Rules nên có thể ghi trực tiếp).
//
// Tạo ra:
//   - 25 sản phẩm  (collection "products", nhiều danh mục)
//   - 6  danh mục   (collection "categories", nếu chưa có)
//   - 8  khách hàng (Firebase Auth + collection "customers")
//   - 15 voucher    (collection "vouchers")
//   - 20 đơn hàng   (collection "orders" + statusHistory, đủ 6 trạng thái)
//   - 2  Flash Sale (collection "flashSales")
//
// ---- CÁCH CHẠY ----
// 1) cd vào thư mục gốc project (nơi có "functions/")
// 2) npm install firebase-admin --no-save   (nếu chưa có sẵn)
// 3) Tải Service Account Key: Firebase Console -> Project Settings ->
//    Service accounts -> Generate new private key -> lưu thành
//    "serviceAccountKey.json" ở thư mục gốc (đã có trong .gitignore,
//    TUYỆT ĐỐI không commit file này).
// 4) node scripts/seed-data.js
//
// Script AN TOÀN để chạy lại nhiều lần: các bước tạo dữ liệu mới đều
// dùng ID ngẫu nhiên mới (trừ categories, dùng slug cố định để không bị
// tạo trùng danh mục nếu chạy lại).
// ============================================================

const admin = require("firebase-admin");
const path = require("path");

const serviceAccountPath = path.join(__dirname, "..", "serviceAccountKey.json");
try {
  admin.initializeApp({ credential: admin.credential.cert(require(serviceAccountPath)) });
} catch (err) {
  console.error(
    "\n❌ Không tìm thấy 'serviceAccountKey.json' ở thư mục gốc project.\n" +
      "   Tải file này tại: Firebase Console -> Project Settings -> Service accounts -> Generate new private key.\n"
  );
  process.exit(1);
}

const db = admin.firestore();
const auth = admin.auth();
const FieldValue = admin.firestore.FieldValue;

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const roundPrice = (n) => Math.round(n / 1000) * 1000;

function placeholderImage(seed, w = 600, h = 600) {
  // Ảnh demo ổn định theo seed (không cần Firebase Storage/base64 thật
  // cho dữ liệu mẫu — admin có thể thay ảnh thật sau qua trang quản trị).
  return `https://picsum.photos/seed/${encodeURIComponent(seed)}/${w}/${h}`;
}

// ---------------------------------------------------------------
// 1) DANH MỤC
// ---------------------------------------------------------------
const CATEGORY_DEFS = [
  { slug: "dien-thoai", name: "Điện thoại" },
  { slug: "am-thanh", name: "Âm thanh" },
  { slug: "phu-kien", name: "Phụ kiện" },
  { slug: "dong-ho", name: "Đồng hồ thông minh" },
  { slug: "laptop", name: "Laptop & Máy tính" },
  { slug: "gia-dung", name: "Đồ gia dụng thông minh" },
];

async function seedCategories() {
  console.log("→ Tạo danh mục...");
  const categories = [];
  for (const c of CATEGORY_DEFS) {
    const ref = db.collection("categories").doc(c.slug);
    await ref.set({ name: c.name, slug: c.slug, createdAt: FieldValue.serverTimestamp() }, { merge: true });
    categories.push({ id: c.slug, name: c.name });
  }
  console.log(`  ✔ ${categories.length} danh mục.`);
  return categories;
}

// ---------------------------------------------------------------
// 2) SẢN PHẨM (20–30)
// ---------------------------------------------------------------
const PRODUCT_NAMES = [
  "Tai nghe không dây Pro", "Loa Bluetooth Mini", "Đồng hồ thông minh Fit", "Bàn phím cơ Compact",
  "Balo Laptop Basic", "Chuột không dây Silent", "Sạc dự phòng 20000mAh", "Ốp lưng chống sốc",
  "Cáp sạc nhanh Type-C", "Kính cường lực full màn", "Điện thoại Xphone 12", "Điện thoại Xphone 12 Pro",
  "Laptop UltraSlim 14''", "Laptop Gaming G5", "Webcam Full HD", "Micro thu âm Studio",
  "Loa Soundbar Home", "Đồng hồ thể thao Active", "Vòng đeo tay theo dõi sức khỏe", "Máy lọc không khí Mini",
  "Đèn LED thông minh", "Ổ cắm điện thông minh WiFi", "Camera an ninh trong nhà", "Robot hút bụi Auto",
  "Bàn ủi hơi nước cầm tay", "Máy xay sinh tố đa năng", "Nồi chiên không dầu 5L", "Bình giữ nhiệt inox",
  "Túi chống nước đa năng", "Giá đỡ điện thoại xe hơi",
];

function makeProduct(name, categories, i) {
  const category = rand(categories);
  const price = roundPrice(randInt(150, 25000) * 1000);
  const hasSale = Math.random() < 0.6;
  const salePrice = hasSale ? roundPrice(price * (randInt(55, 85) / 100)) : null;
  return {
    name,
    sku: `SKU${String(i + 1).padStart(4, "0")}`,
    categoryId: category.id,
    categoryName: category.name,
    price,
    salePrice,
    stock: randInt(0, 200),
    status: "active",
    description: `${name} — sản phẩm demo dùng cho mục đích kiểm thử giao diện Storefront/Admin.`,
    imageIds: [],
    thumbnailUrl: placeholderImage(name + i),
    createdAt: FieldValue.serverTimestamp(),
  };
}

async function seedProducts(categories) {
  console.log("→ Tạo sản phẩm...");
  const batch = db.batch();
  const productRefs = [];
  PRODUCT_NAMES.forEach((name, i) => {
    const ref = db.collection("products").doc();
    batch.set(ref, makeProduct(name, categories, i));
    productRefs.push(ref);
  });
  await batch.commit();
  console.log(`  ✔ ${productRefs.length} sản phẩm.`);
  return productRefs;
}

// ---------------------------------------------------------------
// 3) KHÁCH HÀNG (5–10, kèm tài khoản Firebase Auth thật)
// ---------------------------------------------------------------
const CUSTOMER_DEFS = [
  { fullName: "Nguyễn Văn An", email: "an.nguyen.demo@example.com", phone: "0901111111" },
  { fullName: "Trần Thị Bình", email: "binh.tran.demo@example.com", phone: "0902222222" },
  { fullName: "Lê Hoàng Cường", email: "cuong.le.demo@example.com", phone: "0903333333" },
  { fullName: "Phạm Thị Dung", email: "dung.pham.demo@example.com", phone: "0904444444" },
  { fullName: "Hoàng Văn Em", email: "em.hoang.demo@example.com", phone: "0905555555" },
  { fullName: "Vũ Thị Giang", email: "giang.vu.demo@example.com", phone: "0906666666" },
  { fullName: "Đặng Văn Hải", email: "hai.dang.demo@example.com", phone: "0907777777" },
  { fullName: "Bùi Thị Kim", email: "kim.bui.demo@example.com", phone: "0908888888" },
];
const DEMO_PASSWORD = "Demo@123456"; // Chỉ dùng cho tài khoản demo, đổi lại nếu deploy thật.

async function seedCustomers() {
  console.log("→ Tạo khách hàng (Firebase Auth + Firestore)...");
  const customers = [];
  for (const c of CUSTOMER_DEFS) {
    let userRecord;
    try {
      userRecord = await auth.createUser({ email: c.email, password: DEMO_PASSWORD, displayName: c.fullName });
    } catch (err) {
      if (err.code === "auth/email-already-exists") {
        userRecord = await auth.getUserByEmail(c.email);
      } else {
        throw err;
      }
    }
    await db.collection("customers").doc(userRecord.uid).set(
      {
        fullName: c.fullName,
        email: c.email,
        phone: c.phone,
        address: `${randInt(1, 200)} Đường ${rand(["Lê Lợi", "Nguyễn Huệ", "Trần Hưng Đạo", "Hai Bà Trưng"])}, Quận ${randInt(1, 12)}`,
        avatar: "",
        status: "approved",
        createdAt: FieldValue.serverTimestamp(),
        statusUpdatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    customers.push({ uid: userRecord.uid, ...c });
  }
  console.log(`  ✔ ${customers.length} khách hàng (mật khẩu demo: ${DEMO_PASSWORD}).`);
  return customers;
}

// ---------------------------------------------------------------
// 4) VOUCHER (10–20)
// ---------------------------------------------------------------
async function seedVouchers() {
  console.log("→ Tạo voucher...");
  const batch = db.batch();
  const codes = [];
  const now = new Date();
  const in30d = new Date(now.getTime() + 30 * 86400000);
  const past10d = new Date(now.getTime() - 10 * 86400000);

  for (let i = 1; i <= 16; i++) {
    const code = `DEMO${String(i).padStart(2, "0")}`;
    const discountType = Math.random() < 0.6 ? "percent" : "fixed";
    const ref = db.collection("vouchers").doc();
    batch.set(ref, {
      code,
      discountType,
      value: discountType === "percent" ? randInt(5, 40) : roundPrice(randInt(20, 200) * 1000),
      maxDiscount: discountType === "percent" ? roundPrice(randInt(50, 300) * 1000) : null,
      minOrderValue: roundPrice(randInt(0, 500) * 1000),
      usageLimit: randInt(20, 200),
      usedCount: randInt(0, 15),
      startDate: past10d.toISOString().slice(0, 10),
      endDate: in30d.toISOString().slice(0, 10),
      isActive: i <= 14, // 2 mã hết hạn/tắt để có dữ liệu đa dạng khi test
      applyScope: "all",
      applyTargets: [],
      createdAt: FieldValue.serverTimestamp(),
    });
    codes.push(code);
  }
  await batch.commit();
  console.log(`  ✔ ${codes.length} voucher: ${codes.join(", ")}`);
}

// ---------------------------------------------------------------
// 5) FLASH SALE (2)
// ---------------------------------------------------------------
async function seedFlashSales(productRefs) {
  console.log("→ Tạo Flash Sale...");
  const productSnaps = await Promise.all(productRefs.slice(0, 10).map((r) => r.get()));
  const pick = (n, offset) =>
    productSnaps.slice(offset, offset + n).map((snap) => {
      const p = snap.data();
      const quantity = randInt(30, 100);
      return {
        productId: snap.id,
        productName: p.name,
        originalPrice: p.price,
        flashPrice: roundPrice(p.price * (randInt(40, 70) / 100)),
        quantity,
        sold: randInt(0, quantity),
      };
    });

  const now = Date.now();
  await db.collection("flashSales").add({
    name: "Flash Sale Cuối Tuần",
    startTime: new Date(now - 2 * 3600000).toISOString(),
    endTime: new Date(now + 5 * 3600000).toISOString(),
    isActive: true,
    products: pick(5, 0),
    createdAt: FieldValue.serverTimestamp(),
  });
  await db.collection("flashSales").add({
    name: "Flash Sale Giữa Tháng",
    startTime: new Date(now + 3 * 86400000).toISOString(),
    endTime: new Date(now + 4 * 86400000).toISOString(),
    isActive: true,
    products: pick(5, 5),
    createdAt: FieldValue.serverTimestamp(),
  });
  console.log("  ✔ 2 Flash Sale (1 đang chạy, 1 sắp diễn ra).");
}

// ---------------------------------------------------------------
// 6) ĐƠN HÀNG (20, đủ 6 trạng thái, kèm statusHistory)
// ---------------------------------------------------------------
const STATUS_FLOW = ["pending", "confirmed", "packing", "shipping", "completed"];

function genOrderCode(d) {
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `DH${yy}${mm}${dd}${rnd}`;
}

async function seedOrders(customers, productRefs) {
  console.log("→ Tạo đơn hàng...");
  const productSnaps = await Promise.all(productRefs.map((r) => r.get()));
  const products = productSnaps.map((s) => ({ id: s.id, ...s.data() }));

  // Phân bổ trạng thái để có đủ dữ liệu demo cho mọi cột Timeline.
  const statuses = [
    ...Array(5).fill("pending"),
    ...Array(4).fill("confirmed"),
    ...Array(3).fill("packing"),
    ...Array(3).fill("shipping"),
    ...Array(3).fill("completed"),
    ...Array(2).fill("cancelled"),
  ];

  let created = 0;
  for (let i = 0; i < 20; i++) {
    const customer = rand(customers);
    const status = statuses[i] || "pending";
    const orderItems = Array.from({ length: randInt(1, 3) }, () => {
      const p = rand(products);
      const price = p.salePrice || p.price;
      return {
        productId: p.id,
        productName: p.name,
        thumbnail: p.thumbnailUrl,
        price,
        quantity: randInt(1, 3),
      };
    });
    const subtotal = orderItems.reduce((s, it) => s + it.price * it.quantity, 0);
    const shippingFee = subtotal >= 500000 ? 0 : 30000;
    const voucherDiscount = Math.random() < 0.4 ? roundPrice(subtotal * 0.1) : 0;
    const total = Math.max(0, subtotal + shippingFee - voucherDiscount);

    const daysAgo = randInt(0, 25);
    const createdAt = admin.firestore.Timestamp.fromDate(new Date(Date.now() - daysAgo * 86400000));

    const orderRef = db.collection("orders").doc();
    await orderRef.set({
      orderCode: genOrderCode(createdAt.toDate()),
      customerId: customer.uid,
      customerName: customer.fullName,
      customerPhone: customer.phone,
      customerEmail: customer.email,
      shippingAddress: `${randInt(1, 200)} Đường ${rand(["Lê Lợi", "Nguyễn Huệ", "Trần Hưng Đạo"])}, TP.HCM`,
      province: "TP. Hồ Chí Minh",
      district: `Quận ${randInt(1, 12)}`,
      note: "",
      items: orderItems,
      subtotal,
      shippingFee,
      voucherCode: voucherDiscount ? "DEMO01" : null,
      voucherDiscount,
      total,
      paymentMethod: "cod",
      status,
      createdAt,
    });

    // ---- statusHistory: dựng lịch sử tuần tự khớp với trạng thái hiện tại ----
    const stepsReached = status === "cancelled" ? STATUS_FLOW.slice(0, randInt(1, 3)) : STATUS_FLOW.slice(0, STATUS_FLOW.indexOf(status) + 1);
    let cursor = createdAt.toMillis();
    for (let s = 0; s < stepsReached.length; s++) {
      cursor += randInt(2, 10) * 3600000; // vài giờ giữa mỗi bước
      await orderRef.collection("statusHistory").add({
        fromStatus: s === 0 ? null : stepsReached[s - 1],
        toStatus: stepsReached[s],
        changedByUid: null,
        changedByEmail: "admin-demo@shopviet.vn",
        createdAt: admin.firestore.Timestamp.fromMillis(cursor),
      });
    }
    if (status === "cancelled") {
      cursor += randInt(1, 5) * 3600000;
      await orderRef.collection("statusHistory").add({
        fromStatus: stepsReached[stepsReached.length - 1] || null,
        toStatus: "cancelled",
        changedByUid: null,
        changedByEmail: "admin-demo@shopviet.vn",
        createdAt: admin.firestore.Timestamp.fromMillis(cursor),
      });
    }

    created++;
  }
  console.log(`  ✔ ${created} đơn hàng (đủ 6 trạng thái).`);
}

// ---------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------
(async () => {
  console.log("\n=== SEED DỮ LIỆU MẪU — ShopViet ===\n");
  const categories = await seedCategories();
  const productRefs = await seedProducts(categories);
  const customers = await seedCustomers();
  await seedVouchers();
  await seedFlashSales(productRefs);
  await seedOrders(customers, productRefs);
  console.log("\n✅ Hoàn tất seed dữ liệu mẫu.\n");
  process.exit(0);
})().catch((err) => {
  console.error("\n❌ Lỗi khi seed dữ liệu:", err);
  process.exit(1);
});
