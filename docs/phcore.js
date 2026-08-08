/* ============================================================
   phcore.js — Lõi xử lý màu & nội suy pH dùng chung cho toàn bộ
   ứng dụng QuetpH (index.html + compare.html)
   ============================================================ */

/* ---------- 1. Bảng màu chuẩn pH (universal indicator) ----------
   Mỗi mốc là 1 điểm neo (anchor). Có thể hiệu chỉnh lại trong
   phần "Hiệu chỉnh bảng màu" trên trang chính — giá trị hiệu
   chỉnh được lưu vào localStorage nên sẽ áp dụng cho mọi phép đo
   sau đó (kể cả trang so sánh). */

   //Đây là bảng màu chụp trong phòng của 1 dòng máy, màu được pick ở 1 vùng hình vuông nằm bên trong.
   //
   // MỖI mốc lưu CẢ sampleRGB (lõi mẫu) VÀ whiteRGB (nền trắng xung quanh, đo
   // cùng lúc với mẫu đó) — vì ánh sáng lúc chụp từng mốc KHÔNG giống nhau
   // (whiteRGB lệch nhau giữa các dòng dưới đây). rgb cuối cùng dùng để so
   // khớp KHÔNG phải sampleRGB thô, mà được suy ra bằng cách hiệu chỉnh
   // (white-balance, von Kries) sampleRGB CỦA CHÍNH mốc đó theo whiteRGB CỦA
   // CHÍNH mốc đó — quy về REFERENCE_WHITE chung. KHÔNG lấy trung bình
   // whiteRGB của cả bảng; mỗi mốc tự đứng trên white riêng của nó. Xem
   // buildDefaultCorrectedChart() bên dưới.
const DEFAULT_PH_CHART = [
  { ph: 1.11,  sampleRgb: [187, 68, 86],   whiteRgb: [194, 190, 181] },
  { ph: 2.17,  sampleRgb: [185, 73, 97],   whiteRgb: [193, 185, 176] },
  { ph: 3.15,  sampleRgb: [168, 108, 128], whiteRgb: [189, 181, 173] },
  { ph: 4.0,   sampleRgb: [160, 105, 125], whiteRgb: [185, 178, 170] },
  { ph: 5.06,  sampleRgb: [150, 101, 123], whiteRgb: [182, 176, 170] },
  { ph: 6.0,   sampleRgb: [142, 110, 127], whiteRgb: [178, 175, 169] },
  { ph: 7.08,  sampleRgb: [123, 109, 127], whiteRgb: [176, 175, 170] },
  { ph: 8.0,   sampleRgb: [131, 127, 140], whiteRgb: [175, 176, 171] },
  { ph: 9.12,  sampleRgb: [126, 120, 129], whiteRgb: [186, 184, 172] },
  { ph: 10.0,  sampleRgb: [102, 109, 114], whiteRgb: [185, 179, 167] },
  { ph: 11.0,  sampleRgb: [118, 114, 85],  whiteRgb: [184, 175, 164] },
  { ph: 12.0,  sampleRgb: [164, 129, 61],  whiteRgb: [183, 173, 163] },
  { ph: 13.0,  sampleRgb: [157, 98, 5],    whiteRgb: [175, 167, 157] },
];

// Nền trắng chuẩn dùng làm điểm quy chiếu chung (von Kries target) cho MỌI
// phép hiệu chỉnh ánh sáng trong app — cả khi dựng bảng màu mặc định bên
// dưới LẪN khi hiệu chỉnh mẫu test lúc quét (xem phvision.js). 1 nguồn sự
// thật duy nhất, không định nghĩa lại ở nơi khác.
const REFERENCE_WHITE = [186, 178, 169];

const STORAGE_KEY = 'quetph_chart_v1';

/* ---------- 1b. Dựng bảng màu mặc định ĐÃ hiệu chỉnh ánh sáng ----------
   Với MỖI mốc: nếu có sampleRgb + whiteRgb riêng, hiệu chỉnh (von Kries)
   sampleRgb đó theo ĐÚNG whiteRgb của chính nó về referenceWhite — KHÔNG
   dùng whiteRgb trung bình của cả bảng. Mốc nào thiếu dữ liệu gốc (xem ghi
   chú mốc 3.15 ở trên) thì fallback dùng rgb tĩnh có sẵn (chưa hiệu chỉnh). */
function buildDefaultCorrectedChart(referenceWhite = REFERENCE_WHITE) {
  return DEFAULT_PH_CHART.map(a => {
    if (Array.isArray(a.sampleRgb) && Array.isArray(a.whiteRgb)) {
      return { ph: a.ph, rgb: whiteBalanceCorrect(a.sampleRgb, referenceWhite, a.whiteRgb).correctedRgb };
    }
    return { ph: a.ph, rgb: [...a.rgb] };
  }).sort((x, y) => x.ph - y.ph);
}

function loadChart() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length >= 2) return parsed;
    }
  } catch (e) { /* ignore, fall back */ }
  return buildDefaultCorrectedChart();
}

function saveChart(chart) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(chart));
}

function resetChart() {
  localStorage.removeItem(STORAGE_KEY);
}

/* ---------- 2. Chuyển đổi màu: sRGB -> CIE Lab ---------- */
function srgbToLinear(c) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c) {
  c = Math.max(0, Math.min(1, c));
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(s * 255)));
}

/* ---------- 2b. Hiệu chỉnh ánh sáng (von Kries, domain linear-RGB) ----------
   NGUỒN SỰ THẬT DUY NHẤT cho phép hiệu chỉnh trắng trong toàn bộ app —
   phvision.js và phcalib.js đều gọi hàm này (qua PHCore.whiteBalanceCorrect)
   thay vì viết lại công thức ở nơi khác. sampleRgb được quy đổi từ đúng
   curWhite (nền trắng đo được CÙNG LÚC với sampleRgb đó) về refWhite. */
function whiteBalanceCorrect(sampleRgb, refWhite, curWhite) {
  const GAIN_MIN = 0.5, GAIN_MAX = 2.0; // giới hạn correction, tránh khuếch đại quá mức khi nền đo được quá tối/quá sáng

  const refLin = refWhite.map(srgbToLinear);
  const curLin = curWhite.map(srgbToLinear);
  const rawGain = refLin.map((rl, c) => (curLin[c] > 1e-4 ? rl / curLin[c] : 1));
  const clampedGain = rawGain.map(g => Math.max(GAIN_MIN, Math.min(GAIN_MAX, g)));

  const sampleLin = sampleRgb.map(srgbToLinear);
  const correctedLin = sampleLin.map((v, c) => v * clampedGain[c]);
  const correctedRgb = correctedLin.map(linearToSrgb);

  const maxRawDev = Math.max(...rawGain.map(g => Math.abs(g - 1)));
  return { correctedRgb, gain: clampedGain, rawGain, maxRawDev };
}

function rgbToXyz([r, g, b]) {
  r = srgbToLinear(r); g = srgbToLinear(g); b = srgbToLinear(b);
  return [
    r * 0.4124564 + g * 0.3575761 + b * 0.1804375,
    r * 0.2126729 + g * 0.7151522 + b * 0.0721750,
    r * 0.0193339 + g * 0.1191920 + b * 0.9503041,
  ];
}

const D65 = [0.95047, 1.00000, 1.08883];

function fxyz(t) {
  return t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16 / 116);
}

function rgbToLab(rgb) {
  const [x, y, z] = rgbToXyz(rgb);
  const fx = fxyz(x / D65[0]);
  const fy = fxyz(y / D65[1]);
  const fz = fxyz(z / D65[2]);
  return [
    116 * fy - 16,      // L
    500 * (fx - fy),    // a
    200 * (fy - fz),    // b
  ];
}

/* CIE76 Delta E — đủ nhạy để phân biệt các mốc pH cách nhau nhỏ,
   và nhẹ tính toán hơn CIE2000 (đủ dùng cho ứng dụng trực tiếp trên trình duyệt) */
function deltaE(lab1, lab2) {
  const dl = lab1[0] - lab2[0];
  const da = lab1[1] - lab2[1];
  const db = lab1[2] - lab2[2];
  return Math.sqrt(dl * dl + da * da + db * db);
}

function lerp(a, b, t) { return a + (b - a) * t; }

function lerpRgb(rgbA, rgbB, t) {
  return [
    lerp(rgbA[0], rgbB[0], t),
    lerp(rgbA[1], rgbB[1], t),
    lerp(rgbA[2], rgbB[2], t),
  ];
}

/* ---------- 3. Nội suy bảng màu ở độ phân giải mịn (0.01 pH) ----------
   Nội suy tuyến tính RGB giữa 2 điểm neo liền kề rồi chuyển sang Lab
   để so khớp — cho phép "đọc" các giá trị pH nằm giữa các mốc nguyên,
   đạt độ phân giải hiển thị 0.05. */
function buildFineTable(chart, step = 0.01) {
  const sorted = [...chart].sort((a, b) => a.ph - b.ph);
  const table = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1];
    const span = b.ph - a.ph;
    const steps = Math.max(1, Math.round(span / step));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const ph = a.ph + span * t;
      const rgb = lerpRgb(a.rgb, b.rgb, t);
      table.push({ ph, rgb, lab: rgbToLab(rgb) });
    }
  }
  const last = sorted[sorted.length - 1];
  table.push({ ph: last.ph, rgb: last.rgb, lab: rgbToLab(last.rgb) });
  return table;
}

/* ---------- 4. So khớp màu mẫu -> pH gần nhất ---------- */
function matchPh(sampleRgb, chart) {
  const fine = buildFineTable(chart);
  const sampleLab = rgbToLab(sampleRgb);
  let best = null;
  for (const entry of fine) {
    const d = deltaE(sampleLab, entry.lab);
    if (!best || d < best.d) best = { d, ph: entry.ph, rgb: entry.rgb };
  }
  // làm tròn về bước 0.05 theo yêu cầu độ chính xác hiển thị
  const rounded = Math.round(best.ph / 0.05) * 0.05;

  // Ước lượng độ tin cậy: deltaE càng nhỏ càng đáng tin.
  // deltaE ~0   -> khớp gần như tuyệt đối (100%)
  // deltaE ~20+ -> lệch màu lớn, độ tin cậy thấp
  const confidence = Math.max(0, Math.min(100, 100 - (best.d / 20) * 100));

  return {
    ph: Math.max(0, Math.min(14, rounded)),
    rawPh: best.ph,
    deltaE: best.d,
    matchedRgb: best.rgb,
    confidence,
  };
}

/* ---------- 5. Lấy màu trung bình trong vùng tròn của canvas ---------- */
function sampleCircleAverage(ctx, cx, cy, radius) {
  const r = Math.max(1, Math.round(radius));
  const x0 = Math.max(0, Math.round(cx - r));
  const y0 = Math.max(0, Math.round(cy - r));
  const w = Math.min(ctx.canvas.width - x0, r * 2);
  const h = Math.min(ctx.canvas.height - y0, r * 2);
  if (w <= 0 || h <= 0) return [0, 0, 0];
  const data = ctx.getImageData(x0, y0, w, h).data;

  let rSum = 0, gSum = 0, bSum = 0, count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x0 + x, py = y0 + y;
      const dx = px - cx, dy = py - cy;
      if (dx * dx + dy * dy > r * r) continue;
      const idx = (y * w + x) * 4;
      rSum += data[idx];
      gSum += data[idx + 1];
      bSum += data[idx + 2];
      count++;
    }
  }
  if (count === 0) return [0, 0, 0];
  return [Math.round(rSum / count), Math.round(gSum / count), Math.round(bSum / count)];
}

function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
}

/* ---------- 6. So sánh 2 màu — dùng cho trang compare.html ---------- */
function compareColors(rgbA, rgbB) {
  const labA = rgbToLab(rgbA), labB = rgbToLab(rgbB);
  const dE = deltaE(labA, labB);
  // Delta E >= ~25 coi như 2 màu hoàn toàn khác nhau (thang quy đổi %).
  const MAX_DE = 25;
  const deviationPercent = Math.max(0, Math.min(100, (dE / MAX_DE) * 100));
  const accuracyPercent = 100 - deviationPercent;
  return { deltaE: dE, deviationPercent, accuracyPercent };
}

window.PHCore = {
  DEFAULT_PH_CHART, REFERENCE_WHITE, buildDefaultCorrectedChart,
  loadChart, saveChart, resetChart,
  rgbToLab, deltaE, matchPh, buildFineTable,
  sampleCircleAverage, rgbToHex, compareColors,
  whiteBalanceCorrect,
};
