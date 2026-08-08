# QuetpH — Đo pH bằng ảnh / camera

Công cụ web đo pH tham khảo bằng cách phân tích màu mẫu thử (giấy quỳ / test kit màu),
chạy hoàn toàn trên trình duyệt (client-side), không cần backend/server.

⚠️ Chỉ mang tính tham khảo, không thay thế thiết bị đo pH điện tử đã hiệu chuẩn.

## Các trang

| Trang | Chức năng |
|---|---|
| `index.html` | Quét mẫu từ ảnh upload — 3 chế độ: Điểm (kính ngắm), Vẽ vùng, Tự động (click mẫu) |
| `live.html` | **Quét trực tiếp bằng camera** — hiện khung vuông hướng dẫn, tự kiểm tra ánh sáng/nền/bóng đổ, tự động chụp khi đủ điều kiện |
| `compare.html` | So sánh màu giữa 2 ảnh, hoặc so với 1 giá trị pH mong muốn |
| `calibration.html` | Tự tạo thang đo pH riêng từ mẫu chuẩn đã biết pH (thay cho bảng màu mặc định) |

## Chạy thử trên máy (local)

Vì `live.html` cần quyền camera (`getUserMedia`), trình duyệt **bắt buộc** trang phải chạy qua
`https://` hoặc `http://localhost` — mở trực tiếp bằng `file://` sẽ **không** xin được quyền camera
(các trang khác thì mở `file://` vẫn dùng được bình thường).

Cách đơn giản nhất để có `localhost`, chọn 1 trong các cách sau tại thư mục project:

```bash
# Python 3 (có sẵn trên hầu hết máy)
python -m http.server 8080

# hoặc Node.js
npx serve .
```

Rồi mở `http://localhost:8080` trên trình duyệt.

## Đăng lên GitHub Pages (để dùng camera trên điện thoại)

GitHub Pages phục vụ qua HTTPS mặc định — đáp ứng đúng yêu cầu của `getUserMedia`, không cần
cấu hình gì thêm.

1. Tạo repo mới trên GitHub (public hoặc private đều được, Pages free hoạt động với cả 2 nếu
   tài khoản hỗ trợ; repo public thì chắc chắn dùng được Pages miễn phí).
2. Từ thư mục project này (đúng thư mục chứa `index.html`), chạy:

   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<username>/<ten-repo>.git
   git push -u origin main
   ```

3. Vào repo trên GitHub → **Settings** → **Pages** (menu bên trái) → mục **Build and deployment**
   → **Source**: chọn **Deploy from a branch** → **Branch**: chọn `main`, thư mục `/ (root)` →
   **Save**.
4. Đợi khoảng 1 phút, GitHub sẽ cho địa chỉ dạng:
   `https://<username>.github.io/<ten-repo>/`
   Mở địa chỉ đó (kể cả trên điện thoại) — camera sẽ xin quyền truy cập bình thường.

Sau lần push đầu, mỗi khi sửa code chỉ cần:
```bash
git add .
git commit -m "mô tả thay đổi"
git push
```
GitHub Pages tự build lại sau vài chục giây.

## Yêu cầu trình duyệt

- Trình duyệt hiện đại có hỗ trợ `getUserMedia` (Chrome, Safari, Edge, Firefox bản mới — kể cả
  trên điện thoại).
- Trên iPhone: Safari yêu cầu HTTPS mới cấp quyền camera cho web app — GitHub Pages đáp ứng sẵn.
- Dữ liệu hiệu chỉnh (bảng màu, thang đo Calibration, log đo) được lưu trong `localStorage` của
  trình duyệt — chỉ tồn tại trên thiết bị/trình duyệt đó, không đồng bộ qua thiết bị khác.

## Cấu trúc code

Xem chi tiết kiến trúc, thuật toán, và tiến độ ở [`tiendo.md`](./tiendo.md).
