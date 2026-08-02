// ============================================================
// dashboard.js
// Điều khiển trang Tổng quan (Dashboard):
// - Bảo vệ route (chỉ admin đã duyệt mới xem được)
// - Lấy số liệu thống kê từ Firestore (sản phẩm, khách hàng, đơn hàng, doanh thu)
// - Vẽ biểu đồ doanh thu 12 tháng bằng Canvas thuần (không dùng thư viện ngoài)
// - Hiển thị 5 đơn hàng mới nhất, top sản phẩm bán chạy, voucher/flash sale đang chạy
// ============================================================

import { db } from "../firebase/firebase-config.js";
import {
    collection,
    query,
    where,
    orderBy,
    limit,
    getDocs,
    getCountFromServer,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { formatCurrency, formatDate, escapeHtml } from "../js/helpers.js";
import { showToast } from "./toast.js";
import { ORDER_STATUS_MAP } from "./orders.js";

/**
 * Được spa-router.js gọi mỗi khi trang Dashboard được hiển thị
 * (lần tải đầu tiên hoặc sau khi điều hướng nội bộ từ trang khác).
 */
export function initPage() {
    loadDashboard();
}

/**
 * Tải toàn bộ dữ liệu cho trang Dashboard.
 * Mỗi phần được try/catch riêng để 1 phần lỗi không làm sập cả trang.
 */
async function loadDashboard() {
    await Promise.allSettled([
        loadStatCounts(),
        loadRevenueChart(),
        loadActivityList(),
        loadRecentOrders(),
        loadTopProducts(),
    ]);
}

/**
 * Đếm tổng số sản phẩm / khách hàng / đơn hàng và tổng doanh thu (đơn hoàn tất)
 */
async function loadStatCounts() {
    try {
        const [productsSnap, customersSnap, ordersSnap] = await Promise.all([
            getCountFromServer(collection(db, "products")),
            getCountFromServer(collection(db, "customers")),
            getCountFromServer(collection(db, "orders")),
        ]);

        setText("stat-products", productsSnap.data().count.toLocaleString("vi-VN"));
        setText("stat-customers", customersSnap.data().count.toLocaleString("vi-VN"));
        setText("stat-orders", ordersSnap.data().count.toLocaleString("vi-VN"));

        // Doanh thu = tổng "total" của các đơn có status = completed
        const completedQuery = query(collection(db, "orders"), where("status", "==", "completed"));
        const completedSnap = await getDocs(completedQuery);
        let revenue = 0;
        completedSnap.forEach((docSnap) => {
            revenue += Number(docSnap.data().total) || 0;
        });
        setText("stat-revenue", formatCurrency(revenue));
    } catch (err) {
        console.error("Lỗi tải số liệu thống kê:", err);
        showToast("Không thể tải số liệu thống kê tổng quan.", "error");
    }
}

/**
 * Vẽ biểu đồ doanh thu 12 tháng gần nhất bằng Canvas API thuần
 */
async function loadRevenueChart() {
    const canvas = document.getElementById("revenue-chart");
    if (!canvas) return;

    try {
        const completedQuery = query(collection(db, "orders"), where("status", "==", "completed"));
        const snap = await getDocs(completedQuery);

        // Khởi tạo 12 tháng gần nhất = 0
        const now = new Date();
        const months = [];
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            months.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: `T${d.getMonth() + 1}`, total: 0 });
        }
        const monthIndex = new Map(months.map((m, idx) => [m.key, idx]));

        snap.forEach((docSnap) => {
            const data = docSnap.data();
            const ts = data.createdAt;
            const date = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null;
            if (!date) return;
            const key = `${date.getFullYear()}-${date.getMonth()}`;
            if (monthIndex.has(key)) {
                months[monthIndex.get(key)].total += Number(data.total) || 0;
            }
        });

        drawLineChart(canvas, months);
    } catch (err) {
        console.error("Lỗi tải biểu đồ doanh thu:", err);
    }
}

/**
 * Vẽ line chart đơn giản lên canvas, tự scale theo kích thước container
 */
function drawLineChart(canvas, months) {
    const wrap = canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const width = wrap.clientWidth;
    const height = wrap.clientHeight;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const paddingLeft = 12;
    const paddingRight = 12;
    const paddingTop = 16;
    const paddingBottom = 28;
    const plotW = width - paddingLeft - paddingRight;
    const plotH = height - paddingTop - paddingBottom;

    const maxValue = Math.max(...months.map((m) => m.total), 1);
    const stepX = plotW / (months.length - 1);

    const points = months.map((m, i) => ({
        x: paddingLeft + i * stepX,
        y: paddingTop + plotH - (m.total / maxValue) * plotH,
    }));

    // Vùng tô gradient dưới đường line
    const gradient = ctx.createLinearGradient(0, paddingTop, 0, paddingTop + plotH);
    gradient.addColorStop(0, "rgba(37, 99, 235, 0.22)");
    gradient.addColorStop(1, "rgba(37, 99, 235, 0)");

    ctx.beginPath();
    ctx.moveTo(points[0].x, paddingTop + plotH);
    points.forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.lineTo(points[points.length - 1].x, paddingTop + plotH);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Đường line chính
    ctx.beginPath();
    points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.strokeStyle = "#2563EB";
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.stroke();

    // Chấm tròn tại mỗi điểm
    points.forEach((p) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.strokeStyle = "#2563EB";
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();
    });

    // Nhãn tháng
    ctx.fillStyle = "#94A3B8";
    ctx.font = "11px Inter, sans-serif";
    ctx.textAlign = "center";
    months.forEach((m, i) => {
        if (i % 2 === 0) ctx.fillText(m.label, points[i].x, height - 8);
    });
}

/**
 * Voucher có thực sự CÒN HIỆU LỰC hay không (không chỉ dựa vào cờ
 * isActive) — cùng logic với trang Voucher (js/vouchers.js -> computeStatus()),
 * để Dashboard và trang Voucher luôn đồng bộ trạng thái hiển thị.
 */
function isVoucherRunning(v) {
    if (!v.isActive) return false;
    if (v.startDate && new Date(v.startDate) > new Date()) return false; // chưa tới ngày áp dụng
    if (v.endDate) {
        // Hết hạn vào CUỐI ngày endDate theo giờ địa phương (23:59:59),
        // không phải đầu ngày UTC — xem giải thích chi tiết trong
        // js/vouchers.js -> computeStatus().
        const endOfDay = new Date(`${v.endDate}T23:59:59`);
        if (endOfDay < new Date()) return false;
    }
    return true;
}

/**
 * Flash Sale có thực sự ĐANG CHẠY hay không (không chỉ dựa vào cờ
 * isActive) — cùng logic với trang Flash Sale (js/flashsale.js -> computeStatus()).
 */
function isFlashSaleRunning(fs) {
    if (!fs.isActive) return false;
    const now = new Date();
    if (fs.startTime && now < new Date(fs.startTime)) return false; // chưa bắt đầu
    if (fs.endTime && now > new Date(fs.endTime)) return false; // đã kết thúc
    return true;
}

/**
 * Danh sách voucher + flash sale đang hoạt động (mini-list bên phải biểu đồ)
 */
async function loadActivityList() {
    const container = document.getElementById("activity-list");
    if (!container) return;

    try {
        // Lấy dư ra (limit 20) thay vì 5: sau khi lọc thêm theo thời gian
        // thực (isVoucherRunning / isFlashSaleRunning), một số bản ghi có
        // isActive=true nhưng đã hết hạn / chưa tới ngày sẽ bị loại khỏi
        // danh sách hiển thị — cần đủ ứng viên để bù lại.
        const [voucherSnap, flashSnap] = await Promise.all([
            getDocs(query(collection(db, "vouchers"), where("isActive", "==", true), limit(20))),
            getDocs(query(collection(db, "flashSales"), where("isActive", "==", true), limit(20))),
        ]);

        const items = [];

        voucherSnap.forEach((docSnap) => {
            const v = docSnap.data();
            if (!isVoucherRunning(v)) return; // đã hết hạn / chưa tới ngày -> không hiển thị
            items.push({
                icon: "voucher",
                title: `Voucher ${escapeHtml(v.code || "")}`,
                meta: v.type === "percent" ? `Giảm ${v.value}%` : `Giảm ${formatCurrency(v.value)}`,
            });
        });

        flashSnap.forEach((docSnap) => {
            const f = docSnap.data();
            if (!isFlashSaleRunning(f)) return; // chưa bắt đầu / đã kết thúc -> không hiển thị
            items.push({
                icon: "flash",
                title: escapeHtml(f.name || "Flash Sale"),
                meta: `${(f.products || []).length} sản phẩm`,
            });
        });

        if (items.length === 0) {
            container.innerHTML = `
        <div class="empty-state" style="padding: 24px 8px;">
          <div class="empty-state__title">Chưa có chương trình nào</div>
          <div class="empty-state__desc">Voucher và Flash Sale đang hoạt động sẽ hiện ở đây.</div>
        </div>`;
            return;
        }

        container.innerHTML = items
            .map(
                (item) => `
      <div class="mini-item">
        <div class="mini-item__left">
          <div class="mini-item__icon">${item.icon === "voucher"
                        ? '<svg viewBox="0 0 24 24" fill="none"><path d="M20.59 13.41L11 3.83A2 2 0 009.59 3.24H4a1 1 0 00-1 1v5.59a2 2 0 00.59 1.41l9.58 9.59a2 2 0 002.83 0l5.59-5.59a2 2 0 000-2.83z" stroke="currentColor" stroke-width="2"/></svg>'
                        : '<svg viewBox="0 0 24 24" fill="none"><path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>'
                    }</div>
          <div>
            <div class="mini-item__title">${item.title}</div>
            <div class="mini-item__meta">${item.meta}</div>
          </div>
        </div>
        <span class="badge badge--success">Đang chạy</span>
      </div>`
            )
            .join("");
    } catch (err) {
        console.error("Lỗi tải danh sách hoạt động:", err);
        container.innerHTML = `<div class="empty-state__desc">Không thể tải dữ liệu.</div>`;
    }
}

/**
 * 5 đơn hàng mới nhất
 */
async function loadRecentOrders() {
    const tbody = document.getElementById("recent-orders-body");
    if (!tbody) return;

    try {
        const q = query(collection(db, "orders"), orderBy("createdAt", "desc"), limit(5));
        const snap = await getDocs(q);

        if (snap.empty) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color: var(--color-text-secondary);">Chưa có đơn hàng nào.</td></tr>`;
            return;
        }

        tbody.innerHTML = "";
        snap.forEach((docSnap) => {
            const o = docSnap.data();
            const status = ORDER_STATUS_MAP[o.status] || { label: o.status || "—", badge: "badge--neutral" };
            const tr = document.createElement("tr");
            tr.innerHTML = `
        <td><strong>#${escapeHtml(o.orderCode || docSnap.id.slice(0, 6).toUpperCase())}</strong></td>
        <td>${escapeHtml(o.customerName || "Khách vãng lai")}</td>
        <td>${formatCurrency(Number(o.total) || 0)}</td>
        <td><span class="badge ${status.badge}">${status.label}</span></td>
      `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        console.error("Lỗi tải đơn hàng mới nhất:", err);
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color: var(--color-danger);">Không thể tải đơn hàng.</td></tr>`;
    }
}

/**
 * Top 5 sản phẩm bán chạy (dựa trên field soldCount)
 */
async function loadTopProducts() {
    const container = document.getElementById("top-products-list");
    if (!container) return;

    try {
        const q = query(collection(db, "products"), orderBy("soldCount", "desc"), limit(5));
        const snap = await getDocs(q);

        if (snap.empty) {
            container.innerHTML = `
        <div class="empty-state" style="padding: 24px 8px;">
          <div class="empty-state__title">Chưa có dữ liệu bán hàng</div>
          <div class="empty-state__desc">Sản phẩm bán chạy nhất sẽ hiện ở đây.</div>
        </div>`;
            return;
        }

        let rank = 0;
        container.innerHTML = Array.from(snap.docs)
            .map((docSnap) => {
                rank += 1;
                const p = docSnap.data();
                return `
        <div class="product-rank-item">
          <div class="product-rank-item__index">${rank}</div>
          <div class="product-rank-item__thumb">
            ${p.thumbnail ? `<img src="${escapeHtml(p.thumbnail)}" alt="${escapeHtml(p.name || "")}" />` : ""}
          </div>
          <div>
            <div class="product-rank-item__name">${escapeHtml(p.name || "Sản phẩm")}</div>
            <div class="product-rank-item__sub">${p.soldCount || 0} đã bán</div>
          </div>
          <div class="product-rank-item__value">
            ${formatCurrency(Number(p.price) || 0)}
          </div>
        </div>`;
            })
            .join("");
    } catch (err) {
        console.error("Lỗi tải top sản phẩm:", err);
        container.innerHTML = `<div class="empty-state__desc">Không thể tải dữ liệu.</div>`;
    }
}

/**
 * Set nội dung text cho 1 phần tử theo id (an toàn nếu phần tử không tồn tại)
 */
function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

// Vẽ lại biểu đồ khi resize cửa sổ (debounce nhẹ bằng requestAnimationFrame)
let resizeRaf = null;
window.addEventListener("resize", () => {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => loadRevenueChart());
});