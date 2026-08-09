# TIẾN ĐỘ DỰ ÁN — QuetpH (đo pH bằng ảnh)

> Cập nhật mới nhất: rà soát lại cả 4 trang xem có bị lỗi hiển thị trên mobile giống trang Quét mẫu không. Kết quả: **So sánh màu** (`compare.js`) cũng dính đúng lỗi này (canvas hard-code `maxW = 460`, kính ngắm của cả 3 khung A/B/C định vị theo pixel nội bộ) — đã sửa theo đúng cách như trang Quét mẫu: thêm `getMaxDisplayWidth()` dựa trên `stageEl.clientWidth` thật (riêng cho từng khung A/B/C), tách `renderDisplay()`/`reflowForResize()` dùng chung, và resize listener debounce 150ms gọi lại cả 3 khung. **Hiệu chỉnh thang đo** (`calib.js`) cũng hard-code `maxW = 640` nhưng KHÔNG bị lỗi che hình vì trang này không có phần tử nổi (như kính ngắm) định vị theo pixel nội bộ — chưa sửa, không bắt buộc (chỉ là độ nét hiển thị chưa tối ưu trên màn rộng). **Quét trực tiếp** (`live.html`/`live.js`) đã dùng đúng cách từ trước (video/canvas theo % + đọc `clientWidth/clientHeight` thật mỗi frame) nên KHÔNG dính lỗi này. Tất cả sửa đều CHƯA test trên thiết bị thật.

> Cập nhật trước đó: (1) Sửa lỗi trang **Quét mẫu** (`index.html`/`script.js`) bị che mất phần bên phải trên điện thoại — nguyên nhân: bề rộng canvas hiển thị hard-code 640px, trên màn hình hẹp bị CSS `max-width:100%` co nhỏ trong khi kính ngắm vẫn định vị theo toạ độ 640px gốc → bị đẩy ra ngoài vùng `overflow:hidden` của `.stage-inner`. Đã sửa: lấy đúng `stage.clientWidth` thật làm mốc tính baseScale (hàm `getMaxDisplayWidth()`/`recomputeBaseScale()`), thêm cả resize listener (debounce 150ms) để tự tính lại khi xoay màn hình/đổi cỡ cửa sổ. (2) Thêm điều kiện thứ 5 vào checklist **Chế độ Quét trực tiếp** (`live.js`): phát hiện vật lạ (không phải mẫu) nằm trong vùng nền quanh khung bằng DeltaE đầy đủ (Lab) giữa 4 dải nền — khác với kiểm tra bóng đổ cũ (chỉ so kênh độ sáng L) nên bắt được cả vật lạ có màu; nếu phát hiện thì block tự động chụp (nút chụp thủ công vẫn không bị chặn, giống cách 4 điều kiện cũ).
> File này để theo dõi đã làm gì, đang ở đâu, còn thiếu gì. Cập nhật mỗi khi có thay đổi lớn.

---

## 1. Cấu trúc project

```
QuetpH/
├── index.html      — trang chính: upload ảnh + 3 chế độ đo (TEST) + toggle dùng thang đo Calibration
├── script.js        — logic UI trang chính (upload, zoom, 3 chế độ, log, so khớp bằng chart mặc định hoặc Calibration)
├── live.html / live.js — Chế độ Quét trực tiếp: camera live (getUserMedia), khung vuông hướng dẫn, checklist điều kiện ánh sáng/nền/bóng đổ, tự động chụp, toggle Calibration
├── phcore.js         — lõi dùng chung: bảng pH, Lab/DeltaE, matchPh, sampleCircleAverage
├── phvision.js        — pipeline "click mẫu" tự động (object/inner/background mask, white balance) — dùng chung cho cả TEST và Calibration
├── phcalib.js         — domain logic Calibration Mode: CRUD localStorage, correctedRgbOf/matchAgainstCalibration (tái dùng von Kries của phvision.js), assessQuality, exportAsJson/exportAsJavaScript, clearAllCalibration
├── calibration.html / calib.js — MỚI: trang UI Calibration Mode — quét mẫu chuẩn, nhập pH thật, bảng calibration sửa/xóa được, copy JSON/JavaScript
├── compare.html / compare.js — trang so sánh 2 ảnh hoặc so với pH mong muốn
├── style.css          — style dùng chung toàn bộ site
└── testing/
    ├── inside.jpg      — ảnh mốc chuẩn (trong phòng), REFERENCE_WHITE lấy từ đây
    └── outside.jpg     — ảnh test ngoài trời (dùng để kiểm chứng correction)
```

---

## 2. Đã làm xong ✅

### Nền tảng (có từ trước)
- [x] Upload ảnh, canvas nguồn giữ full-res (không mất dữ liệu khi hiển thị bị thu nhỏ)
- [x] Chế độ **Điểm** (kính ngắm tròn, bán kính chỉnh được)
- [x] Chế độ **Vẽ vùng** (khoanh polygon tự do, tính trung bình trong vùng)
- [x] Bảng màu pH `DEFAULT_PH_CHART` (13 mốc), hiệu chỉnh tay được, lưu localStorage
- [x] So khớp màu bằng **Lab + DeltaE** (không phải RGB Euclidean thô), nội suy mịn 0.01 pH
- [x] Trang so sánh 2 ảnh / so với pH mong muốn (`compare.html`)
- [x] Log các điểm đã đo

### Mới thêm — Pipeline "Tự động (click mẫu)" (`phvision.js`)
- [x] Kiến trúc `CAMERA_PROFILES` — sẵn sàng thêm camera 2, 3... sau này (chỉ cần thêm entry, không sửa thuật toán)
- [x] Object detection: flood-fill từ điểm click, giới hạn trong vùng không-phải-nền (ngưỡng **tương đối** theo độ sáng lớn nhất của chính ảnh, không hard-code)
- [x] Inner mask: distance-transform (chamfer 2-pass) → giữ ~70% diện tích lõi theo **tỉ lệ**, không hard-code số pixel erode
- [x] Background ring mask: vòng quanh object, có margin an toàn tránh viền/bóng/AA
- [x] Robust color: median → loại 15% outlier (Lab distance) → trimmed mean
- [x] White balance: **von Kries trong linear-RGB** (không phải cộng/trừ hay gain trên sRGB thô), có clamp gain [0.5–2.0] để tránh over-correction
- [x] Confidence ánh sáng: HIGH / MEDIUM / LOW (dựa trên độ lệch gain, độ trung tính & độ đồng đều của nền đo được)
- [x] pH range hiển thị theo confidence tổng hợp (± 0.05 đến ± 0.5 tuỳ độ tin cậy)
- [x] Debug overlay: toggle bật/tắt 3 lớp mask (vùng mẫu / vùng đo màu lõi / nền tham chiếu)
- [x] UI: thêm nút chế độ thứ 3, panel hiển thị RGB thô / nền / sau hiệu chỉnh, không đụng 2 chế độ cũ

### Mới thêm — Calibration Mode (`phcalib.js` + `calibration.html` + `calib.js`)
- [x] `phcalib.js` (backend, đã có sẵn từ trước nhưng chưa được dùng ở đâu) — giờ đã được nối vào UI thật
- [x] Trang `calibration.html` + `calib.js`: quét mẫu chuẩn bằng đúng pipeline `PHVision.analyzeClick()` (không viết lại thuật toán), lấy CORE SAMPLE RGB + WHITE BACKGROUND RGB thô
- [x] Form nhập pH thật + nút "Thêm vào thang đo" — cảnh báo chất lượng (GOOD/WARNING, liệt kê từng vấn đề cụ thể) trước khi lưu, không tự động lưu dữ liệu xấu
- [x] Bảng Calibration Chart: hiển thị pH / Sample RGB / White RGB / Trạng thái, sửa từng điểm tại chỗ (không bắt tạo lại cả chart), xóa từng điểm, xóa toàn bộ
- [x] Nút Copy JSON / Copy JavaScript (dán thẳng vào code) — dùng Clipboard API, có fallback nếu trình duyệt chặn
- [x] TEST mode (`index.html`): thêm toggle "Dùng thang đo Calibration tự tạo" — khi bật và có ≥ 2 mốc pH khác nhau, so khớp qua `PHCalib.matchAgainstCalibration()` thay vì `DEFAULT_PH_CHART`; đúng pipeline yêu cầu: sample test được hiệu chỉnh về reference white của camera trước, mỗi điểm calibration cũng được quy về đúng reference white đó trước khi so — không so RGB thô trực tiếp
- [x] Panel kết quả TEST hiển thị đúng đang dùng nguồn thang đo nào (Mặc định / Calibration (N mốc))
- [ ] **CHƯA TEST bằng ảnh thật** — cần mở `calibration.html`, thử quét vài mẫu pH đã biết, rồi sang `index.html` bật toggle Calibration để xem kết quả có hợp lý không

---

### Chế độ Quét trực tiếp — `live.html` / `live.js` (đã có sẵn từ trước, giờ rà soát + sửa)
- [x] Camera live qua `getUserMedia` (ưu tiên camera sau trên điện thoại), đổi camera, tắt camera
- [x] Khung vuông hướng dẫn (`computeGuideRects`) — cỡ khẩn đặc chỉnh được bằng slider, hình học tính theo % không hard-code px
- [x] Checklist điều kiện chụp theo thời gian thực (~160ms/lần): khung nằm trọn khung hình, có mẫu, mẫu lấp đầy khung, nền đủ sáng đủ trung tính (KHÔNG bắt buộc trắng tuyệt đối), không bóng đổ lệch 1 phía (so 4 dải nền quanh khung)
- [x] Tự động chụp sau khi giữ đủ điều kiện liên tục 1.1s (có progress bar), hoặc chụp thủ công
- [x] Sau chụp: white balance (von Kries) + matchPh dùng chung `phcore.js`, log kết quả, nút "Quét mẫu khác"
- [x] **Sửa lỗi**: sau khi chụp (tự động hoặc thủ công), vòng kiểm tra không dừng hẳn (`cancelLoop()` chưa được gọi) — camera stream vẫn chạy ngầm dù đang hiện ảnh đã chụp, có thể tự chụp đè kết quả trước khi người dùng bấm "Quét mẫu khác". Đã thêm `cancelLoop()` ở đầu `doCapture()`
- [x] **Thêm mới**: toggle "Dùng thang đo Calibration tự tạo" (đồng bộ với `index.html`) — cần thêm `<script src="phcalib.js">` vào `live.html` (trước đó thiếu, `window.PHCalib` sẽ undefined)

## 3. ĐANG LÀM / CẦN KIỂM CHỨNG ⚠️

- [ ] **Chưa test bằng ảnh thật** — cần mở `index.html`, chạy chế độ Tự động trên `testing/inside.jpg` và `testing/outside.jpg`, xem:
  - Object detection có bắt đúng vùng mẫu không (xem debug mask)
  - Inner mask có loại viền hợp lý không
  - Background ring có tìm đúng nền trắng không
  - **So sánh pH trước/sau correction giữa 2 ảnh** — mục tiêu: cùng 1 mẫu, kết quả gần nhau hơn đáng kể sau khi hiệu chỉnh
- [ ] Nếu ngưỡng `marginL` / `chromaMax` trong `computeBackgroundCandidateMask` (phvision.js) không phù hợp với ảnh chụp ngoài trời gắt sáng → cần tinh chỉnh dựa trên số liệu thực tế
- [ ] Chưa có ảnh nào bị nhiều mẫu vật trong 1 khung hình để test trường hợp "click nhầm mẫu bên cạnh"

---

## 4. CHƯA LÀM ❌ (theo yêu cầu gốc, còn tồn đọng)

- [ ] UI chọn Camera profile (kiến trúc `CAMERA_PROFILES` đã có, nhưng chưa có dropdown chọn máy trong `index.html` — hiện mặc định luôn dùng `camera1`)
- [ ] Chưa thêm camera 2, 3... (đang chờ dữ liệu RGB chart + reference white cho các máy đó)
- [ ] Chưa có test tự động (script so sánh pH before/after correction giữa inside.jpg và outside.jpg, in ra số liệu) — hiện phải tự bấm tay trên UI để kiểm tra
- [ ] Case nhiều mẫu vật trong 1 ảnh — flood-fill hiện chỉ lấy đúng object chứa điểm click, chưa có UI liệt kê "các mẫu phát hiện được" nếu người dùng muốn xem tổng quan

---

## 5. Ghi chú kỹ thuật quan trọng (để nhớ khi quay lại sau)

- Toàn bộ pipeline tự động chạy trên **work canvas đã downscale** (tối đa 560px cạnh dài) để tính nhanh — không dùng full-res gốc cho object/inner/background detection (khác với 2 chế độ cũ vốn luôn lấy màu từ canvas nguồn full-res).
- `phvision.js` **không sửa `phcore.js`** — mọi hàm Lab/DeltaE/matchPh dùng chung qua `window.PHCore`.
- `REFERENCE_WHITE` hiện lấy từ comment cũ trong `phcore.js` (`[186,178,169]`), đã đưa vào `CAMERA_PROFILES.camera1.referenceWhite` để dùng thật (trước đây biến này tồn tại nhưng không được dùng ở đâu cả).
- Nếu sau này phát hiện ngưỡng segmentation sai trên ảnh thực tế → sửa trong `computeBackgroundCandidateMask()` (phvision.js), KHÔNG cần đụng vào UI/script.js.

---

## 6. Việc tiếp theo (đề xuất thứ tự ưu tiên)

1. Test thực tế bằng `inside.jpg` / `outside.jpg`, ghi lại số liệu before/after
2. Tinh chỉnh ngưỡng segmentation nếu cần
3. Thêm dropdown chọn Camera profile trong UI
4. Thêm camera 2 khi có dữ liệu
