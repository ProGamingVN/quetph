/* ============================================================
   phcalib.js — Domain logic cho "Calibration Mode" (thang đo pH tự tạo)
   ============================================================
   Bổ sung THÊM vào QuetpH, KHÔNG sửa phcore.js / phvision.js / script.js
   cũ. Dùng chung PHCore (rgbToLab, deltaE, matchPh) và PHVision
   (whiteBalanceCorrect, phRangeFromConfidence) — KHÔNG viết lại công
   thức màu ở đây, chỉ tái sử dụng.

   Ý TƯỞNG CỐT LÕI:
   Mỗi calibration point lưu RGB THÔ của lõi mẫu (sampleRgb) VÀ RGB THÔ
   của nền trắng xung quanh MẪU ĐÓ (whiteRgb) tại đúng thời điểm chụp —
   các điểm KHÔNG bắt buộc phải cùng 1 whiteRgb (ánh sáng lúc chụp mỗi
   mẫu có thể khác nhau). Khi cần so màu (test, hiển thị, export...),
   MỌI điểm — kể cả mẫu test — được quy về CHUNG một nền trắng chuẩn duy
   nhất (CAMERA_PROFILES.<cam>.referenceWhite trong phvision.js) bằng
   đúng công thức von Kries đã có sẵn. Nhờ vậy dù các điểm được chụp dưới
   ánh sáng khác nhau, sau khi quy đổi chúng vẫn nằm trong cùng 1 "không
   gian màu" và so sánh trực tiếp bằng Lab/DeltaE được (đã kiểm chứng
   bằng thử nghiệm: ΔE giữa 2 lần chụp cùng mẫu khác sáng giảm từ ~16 còn
   ~2 sau khi quy đổi).

   correctedRgb KHÔNG được lưu vào localStorage — đây là DERIVED STATE,
   tính được 100% từ sampleRgb + whiteRgb + referenceWhite đang active,
   nên luôn tính lại khi cần thay vì cache, để tránh dữ liệu cũ bị lệch
   nếu referenceWhite của camera sau này được hiệu chỉnh lại. Raw
   sampleRgb/whiteRgb luôn được lưu nguyên vẹn, không bao giờ bị suy ra
   hay ghi đè ngầm.
   ============================================================ */

(() => {
  const PHCore = window.PHCore;
  const PHVision = window.PHVision;

  const STORAGE_KEY = 'quetph_calibration_v1';
  const CALIBRATION_VERSION = 1;

  /* ---------- 1. Load / Save ----------
     Versioned, không bao giờ tự xoá dữ liệu cũ. Lỗi đọc/ghi KHÔNG bị
     nuốt âm thầm — luôn console.warn kèm lý do trước khi fallback về
     mảng rỗng, để lỗi không biến mất không dấu vết. */
  function loadCalibration() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed; // tương thích ngược nếu từng lưu dạng mảng thô
      if (parsed && Array.isArray(parsed.points)) return parsed.points;
      console.warn('[phcalib] Dữ liệu calibration trong localStorage sai định dạng, bỏ qua:', parsed);
      return [];
    } catch (e) {
      console.warn('[phcalib] Không đọc được calibration đã lưu (localStorage hỏng?) — coi như chưa có điểm nào.', e);
      return [];
    }
  }

  function persist(points) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: CALIBRATION_VERSION, points }));
      return true;
    } catch (e) {
      console.warn('[phcalib] Lưu calibration thất bại (localStorage đầy/bị chặn?). Dữ liệu chỉ còn trong bộ nhớ tạm.', e);
      return false;
    }
  }

  function nextId() {
    return 'cal_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  /* ---------- 2. CRUD ----------
     Mỗi thao tác đọc lại TOÀN BỘ mảng từ localStorage trước khi sửa rồi
     ghi lại — không giữ bản sao trong bộ nhớ giữa các lần gọi — để
     KHÔNG BAO GIỜ overwrite mất điểm do 2 thao tác chồng nhau, và không
     cần 1 "cache" phải đồng bộ tay (state management: 1 nguồn sự thật
     duy nhất là localStorage). */
  function addCalibrationPoint(point) {
    const points = loadCalibration();
    points.push({
      id: nextId(),
      ph: point.ph,
      sampleRgb: [...point.sampleRgb],
      whiteRgb: [...point.whiteRgb],
      camera: point.camera || 'camera1',
      quality: point.quality || null,
      createdAt: Date.now(),
    });
    persist(points);
    return points;
  }

  function updateCalibrationPoint(id, patch) {
    const points = loadCalibration();
    const idx = points.findIndex(p => p.id === id);
    if (idx === -1) return points;
    points[idx] = { ...points[idx], ...patch, id: points[idx].id };
    persist(points);
    return points;
  }

  function deleteCalibrationPoint(id) {
    const points = loadCalibration().filter(p => p.id !== id);
    persist(points);
    return points;
  }

  function clearAllCalibration() {
    persist([]);
    return [];
  }

  /* ---------- 3. Hiệu chỉnh ánh sáng ----------
     TÁI SỬ DỤNG đúng công thức von Kries của phvision.js — không viết
     lại công thức màu ở đây (1 nguồn sự thật duy nhất cho phép tính). */
  function correctedRgbOf(point, referenceWhite) {
    return PHVision.whiteBalanceCorrect(point.sampleRgb, referenceWhite, point.whiteRgb).correctedRgb;
  }

  /* ---------- 4. Gộp các điểm trùng pH (trung bình) ----------
     Hỗ trợ "nhiều mẫu / 1 pH" (kiến trúc mở rộng theo yêu cầu) mà không
     cần đổi cấu trúc lưu trữ — vẫn là 1 mảng phẳng từng điểm, việc gộp
     chỉ xảy ra tạm thời lúc build bảng so khớp, KHÔNG lưu lại kết quả
     gộp (derived, tính lại mỗi lần). */
  function averageCorrectedByPh(correctedPoints) {
    const groups = new Map();
    for (const p of correctedPoints) {
      const key = Math.round(p.ph * 100) / 100;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p.rgb);
    }
    const out = [];
    for (const [ph, rgbs] of groups) {
      const n = rgbs.length;
      const rgb = [0, 1, 2].map(c => rgbs.reduce((s, v) => s + v[c], 0) / n);
      out.push({ ph, rgb, sampleCount: n });
    }
    return out.sort((a, b) => a.ph - b.ph);
  }

  function buildCorrectedChart(points, referenceWhite) {
    const usable = points.filter(p => Array.isArray(p.sampleRgb) && Array.isArray(p.whiteRgb) && Number.isFinite(p.ph));
    const correctedPoints = usable.map(p => ({ ph: p.ph, rgb: correctedRgbOf(p, referenceWhite) }));
    return averageCorrectedByPh(correctedPoints);
  }

  /* ---------- 5. So khớp pH bằng chart Calibration tự tạo ----------
     PIPELINE đúng theo yêu cầu: test sample đã được hiệu chỉnh về nền
     trắng chuẩn (testCorrectedRgb, tính bởi analyzeClick() như cũ) rồi
     mới so với các điểm calibration — CŨNG đã được quy về CHÍNH nền
     trắng chuẩn đó (không so trực tiếp RGB thô test với RGB thô
     calibration). */
  function matchAgainstCalibration(testCorrectedRgb, points, referenceWhite) {
    const chart = buildCorrectedChart(points, referenceWhite);
    if (chart.length < 2) {
      return { ok: false, reason: `Cần ít nhất 2 mốc pH khác nhau trong thang đo Calibration (hiện có ${chart.length}).` };
    }
    const match = PHCore.matchPh(testCorrectedRgb, chart);
    return { ok: true, uniquePhCount: chart.length, ...match };
  }

  /* ---------- 6. Đánh giá chất lượng 1 lần quét TRƯỚC khi lưu ----------
     Không tự động lưu dữ liệu xấu mà không báo (error handling: fail
     loud, không im lặng). Trả về danh sách vấn đề CỤ THỂ, không bịa ra
     1 con số % niềm tin — để người dùng tự quyết định có vẫn lưu hay
     không, thay vì hệ thống tự ý chặn. */
  function assessQuality(scanResult) {
    const issues = [];
    const d = scanResult.diagnostics || {};
    const white = scanResult.sample ? scanResult.sample.backgroundRgb : null;

    if (d.innerPixelCount != null && d.innerPixelCount < 60) {
      issues.push({ level: 'warn', message: 'Vùng lõi mẫu hơi nhỏ (ít điểm ảnh) — kết quả màu có thể kém ổn định. Thử chụp gần mẫu hơn.' });
    }
    if (d.backgroundPixelCount != null && d.backgroundPixelCount < 40) {
      issues.push({ level: 'warn', message: 'Vùng nền trắng tham chiếu tìm được hơi ít — nên chụp mẫu có khoảng trắng xung quanh rộng hơn.' });
    }
    if (d.sampleStdL != null && d.sampleStdL > 6) {
      issues.push({ level: 'warn', message: 'Màu lõi mẫu không đồng đều (có thể lẫn viền/bóng, hoặc mẫu bị lốm đốm).' });
    }
    if (d.backgroundStdL != null && d.backgroundStdL > 10) {
      issues.push({ level: 'warn', message: 'Nền trắng xung quanh không đồng đều (có bóng hoặc gradient ánh sáng).' });
    }
    if (white) {
      const meanWhite = (white[0] + white[1] + white[2]) / 3;
      if (meanWhite < 90) {
        issues.push({ level: 'warn', message: 'Nền trắng đo được khá tối — ảnh có thể thiếu sáng, làm sai lệch hiệu chỉnh màu.' });
      } else if (white[0] >= 250 && white[1] >= 250 && white[2] >= 250) {
        issues.push({ level: 'warn', message: 'Nền trắng đo được gần như cháy sáng (bão hoà) — ảnh có thể bị loá, mất thông tin màu thật.' });
      }
    }
    if (scanResult.lighting && scanResult.lighting.level === 'LOW') {
      issues.push({ level: 'warn', message: 'Độ tin cậy ánh sáng tổng thể THẤP: ' + scanResult.lighting.reason });
    }

    return { overall: issues.length ? 'WARNING' : 'GOOD', issues };
  }

  /* ---------- 7. Export ----------
     Field export CỐ Ý viết hoa (sampleRGB/whiteRGB) đúng định dạng cần
     để copy thẳng vào code khác — khác với tên field NỘI BỘ
     (sampleRgb/whiteRgb) app này đang dùng. Đây là 2 mối quan tâm khác
     nhau: quy ước đặt tên nội bộ vs. hợp đồng định dạng dữ liệu xuất ra
     ngoài, nên không cần phải giống nhau. */
  function toExportObject(p) {
    const obj = { ph: p.ph, sampleRGB: [...p.sampleRgb], whiteRGB: [...p.whiteRgb] };
    if (p.camera) obj.camera = p.camera;
    return obj;
  }

  function exportAsJson(points) {
    return JSON.stringify(points.map(toExportObject), null, 2);
  }

  function exportAsJavaScript(points) {
    const lines = points.map(p => {
      const o = toExportObject(p);
      const cam = o.camera ? `, camera: ${JSON.stringify(o.camera)}` : '';
      return `  { ph: ${o.ph}, sampleRGB: [${o.sampleRGB.join(', ')}], whiteRGB: [${o.whiteRGB.join(', ')}]${cam} },`;
    });
    return [
      `// QuetpH — Calibration chart (xuất lúc ${new Date().toLocaleString('vi-VN')})`,
      `const PH_CALIBRATION = [`,
      ...lines,
      `];`,
    ].join('\n');
  }

  window.PHCalib = {
    STORAGE_KEY, CALIBRATION_VERSION,
    loadCalibration, addCalibrationPoint, updateCalibrationPoint, deleteCalibrationPoint, clearAllCalibration,
    correctedRgbOf, buildCorrectedChart, matchAgainstCalibration,
    assessQuality,
    exportAsJson, exportAsJavaScript,
  };
})();
