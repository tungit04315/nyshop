# ShopViet Storefront — Giai đoạn 1

Website thương mại điện tử (Frontend Shop) — nền tảng giao diện, kết nối Firebase và Homepage. Dùng chung Firebase Project với hệ thống Admin (`web-shops-2`).

## Công nghệ
HTML5 · CSS3 (thuần, không Bootstrap) · JavaScript ES6 Module · Firebase Authentication / Firestore / Storage (SDK v10 modular qua CDN).

## Cấu trúc thư mục
```
storefront/
├── index.html              # Homepage
├── products.html           # Danh sách sản phẩm (catalog shell)
├── assets/                 # Ảnh tĩnh, icon (hiện dùng SVG inline nên thư mục để trống)
├── css/
│   ├── variables.css        # Design tokens (màu, radius, shadow, spacing)
│   ├── base.css              # Reset + layout helpers
│   ├── components.css        # Button, badge, product-card, skeleton...
│   ├── header.css            # Header + Mega Menu + Search
│   ├── home.css               # Hero, banner, flash sale, deal, brands
│   ├── products.css           # Catalog shell (filter + grid + pagination)
│   └── footer.css
├── js/
│   ├── helpers.js            # formatCurrency, debounce, escapeHtml, lazyLoad...
│   ├── layout.js              # Mount Header/Footer dùng chung mọi trang
│   ├── home.js                 # Controller Homepage
│   └── products.js             # Controller trang danh sách sản phẩm
├── components/                # Component tái sử dụng (trả về HTML / tự mount)
│   ├── header.js
│   ├── footer.js
│   ├── product-card.js
│   ├── category-card.js
│   ├── search-box.js
│   └── skeleton.js
└── firebase/
    ├── firebase-config.js
    ├── firestore-service.js               # Toàn bộ hàm đọc dữ liệu (chỉ đọc)
    └── firestore.indexes.suggested.json   # Composite index cần bổ sung
```

## Chạy thử local
Vì dùng ES6 Module (`import`), cần chạy qua HTTP server (không mở trực tiếp file://):
```bash
cd storefront
python3 -m http.server 5500
# rồi mở http://localhost:5500
```

## ⚠️ Cần làm trước khi chạy với dữ liệu thật
Các truy vấn trong `firestore-service.js` kết hợp `where()` + `orderBy()` khác field nên Firestore **yêu cầu composite index**. Hãy hợp nhất `firebase/firestore.indexes.suggested.json` vào `firestore.indexes.json` của project chính rồi deploy:
```bash
firebase deploy --only firestore:indexes
```
Nếu chưa deploy, Console trình duyệt sẽ hiện link tạo index trực tiếp khi query lỗi — bấm vào để tạo nhanh.

## Phạm vi Giai đoạn 1 (đã làm)
- Cấu trúc thư mục chuẩn, kết nối Firebase (Auth/Firestore/Storage).
- Header: Logo (từ `settings/general`), Menu, Mega Menu (từ `categories`), Search UI (input/loading/skeleton/dropdown, đọc gợi ý từ `products`), icon Đăng nhập/Tài khoản/Giỏ hàng (UI placeholder).
- Homepage: Hero Banner, 2 Banner phụ, Danh mục (thật), Flash Sale (**UI Demo** theo đúng yêu cầu đề bài), Best Seller & Hàng mới & Deal trong ngày (đọc thật từ `products`), Thương hiệu (demo UI), Newsletter (UI).
- `products.html`: shell trang danh sách sản phẩm — hiển thị toàn bộ sản phẩm đang bán, bộ lọc/sắp xếp/phân trang đã dựng UI nhưng **chưa gắn logic** (disabled), sẵn sàng cho Giai đoạn 2.
- Responsive, Skeleton Loading, Lazy Load ảnh, Hover Effect, Scroll Reveal.

## Ngoài phạm vi Giai đoạn 1 (để dành Giai đoạn sau)
- Đăng nhập / Đăng ký khách hàng (Firebase Auth thật).
- Giỏ hàng, đặt hàng, thanh toán.
- Trang chi tiết sản phẩm.
- Lọc / sắp xếp / phân trang thật trên `products.html`.
- Flash Sale thật (đọc collection `flashSales`), áp mã Voucher.
- Trang tài khoản khách hàng, lịch sử đơn hàng.
