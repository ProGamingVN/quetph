/* ============================================================
   phvision.js — Pipeline "click vào mẫu → tự động đo pH"
   ============================================================
   Bổ sung THÊM vào QuetpH, KHÔNG sửa phcore.js / script.js cũ.
   Dùng chung PHCore (rgbToLab, deltaE, matchPh, buildFineTable, ...)

   PIPELINE:
   click → object mask (flood-fill) → inner mask (distance transform,
   loại viền theo tỉ lệ) → background mask (vòng quanh object) →
   robust color (median + trimmed mean) → white-balance (von Kries,
   linear-RGB, có clamp) → matchPh (Lab/DeltaE có sẵn) → pH + range
   + confidence tổng hợp (màu-match × ánh-sáng) → debug masks.

   Mọi bước resize/toạ độ đều theo tỉ lệ (%), không hard-code pixel,
   để hoạt động ổn với ảnh có độ phân giải khác nhau.

   [CẬP NHẬT — chế độ Calibration] analyzeClick() giữ NGUYÊN chữ ký và
   toàn bộ field trả về cũ. Chỉ thêm CỘNG THÊM (additive):
     - result.diagnostics: số liệu thô (số pixel, stdL, chroma...) để nơi
       khác (phcalib.js) tự đánh giá chất lượng lần quét theo tiêu chí
       riêng, không phải suy ngược từ các field tổng hợp.
     - window.PHVision.whiteBalanceCorrect / phRangeFromConfidence: xuất
       thêm 2 hàm thuần tuý vốn đã có sẵn, để phcalib.js TÁI SỬ DỤNG đúng
       công thức hiệu chỉnh ánh sáng này (1 nguồn sự thật duy nhất cho
       phép tính màu), thay vì viết lại thuật toán ở nơi khác.
   ============================================================ */

(() => {
  const PHCore = window.PHCore;

  /* ---------- 1. Camera profiles (kiến trúc mở rộng nhiều máy) ----------
     Hiện tại chỉ có camera1 (dùng REFERENCE_WHITE + DEFAULT_PH_CHART có
     sẵn trong phcore.js). Sau này thêm máy mới chỉ cần thêm 1 entry ở
     đây — không phải sửa thuật toán bên dưới. */
  const CAMERA_PROFILES = {
    camera1: {
      id: 'camera1',
      name: 'Camera 1 (mặc định)',
      // Nền trắng chuẩn dùng làm điểm quy chiếu (von Kries target) — LẤY TỪ
      // PHCore.REFERENCE_WHITE (1 nguồn sự thật duy nhất, dùng chung với bảng
      // màu mặc định trong phcore.js) thay vì khai báo lại 1 hằng số khác ở
      // đây — tránh lệch nhau nếu sau này chỉnh lại.
      referenceWhite: PHCore.REFERENCE_WHITE,
      // Có thể override bảng pH riêng cho từng máy; để trống = dùng
      // bảng đang active (đã hiệu chỉnh nếu có) từ PHCore.loadChart()
      phChartOverride: null,
    },
  };

  const PROFILE_STORAGE_KEY = 'quetph_active_camera_v1';

  function getActiveProfileId() {
    return localStorage.getItem(PROFILE_STORAGE_KEY) || 'camera1';
  }
  function setActiveProfileId(id) {
    if (CAMERA_PROFILES[id]) localStorage.setItem(PROFILE_STORAGE_KEY, id);
  }
  function getActiveProfile() {
    return CAMERA_PROFILES[getActiveProfileId()] || CAMERA_PROFILES.camera1;
  }

  /* ---------- 2. Màu: sRGB <-> linear ----------
     KHÔNG khai báo lại srgbToLinear/linearToSrgb/whiteBalanceCorrect ở đây
     nữa — dùng thẳng PHCore.whiteBalanceCorrect() (mục 11 bên dưới), cùng
     1 công thức với bảng màu mặc định trong phcore.js và với phcalib.js. */

  /* ---------- 3. Xây ảnh làm việc (work canvas) ----------
     Downscale ảnh nguồn về tối đa ~560px cạnh dài để: (a) tính toán
     nhanh (flood-fill / distance-transform trên toàn ảnh), (b) việc
     downscale tự nhiên làm mượt noise cảm biến — tốt cho lấy màu
     trung bình. Toạ độ click (hệ ảnh gốc) được quy đổi sang hệ "work"
     bằng workScale. */
  const WORK_MAX_DIM = 560;

  function buildWorkCanvas(sourceCanvas) {
    const sw = sourceCanvas.width, sh = sourceCanvas.height;
    const scale = Math.min(1, WORK_MAX_DIM / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * scale));
    const h = Math.max(1, Math.round(sh * scale));
    const work = document.createElement('canvas');
    work.width = w; work.height = h;
    const wctx = work.getContext('2d', { willReadFrequently: true });
    wctx.imageSmoothingEnabled = true;
    wctx.drawImage(sourceCanvas, 0, 0, w, h);
    return { canvas: work, ctx: wctx, scale, w, h };
  }

  /* ---------- 4. Tiền xử lý: RGB + Lab cho toàn bộ work canvas ---------- */
  function precomputeLab(imageData, w, h) {
    const n = w * h;
    const L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n);
    const R = new Uint8ClampedArray(n), G = new Uint8ClampedArray(n), Bc = new Uint8ClampedArray(n);
    const d = imageData.data;
    for (let i = 0; i < n; i++) {
      const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
      R[i] = r; G[i] = g; Bc[i] = b;
      const lab = PHCore.rgbToLab([r, g, b]);
      L[i] = lab[0]; A[i] = lab[1]; B[i] = lab[2];
    }
    return { L, A, B, R, G, Bc, w, h, n };
  }

  /* ---------- 5. Mặt nạ nền (background candidate) toàn ảnh ----------
     Ngưỡng TƯƠNG ĐỐI theo chính ảnh đó (không hard-code tuyệt đối):
     nền = pixel có L gần với L lớn nhất trong ảnh (vùng sáng nhất,
     giả định là giấy/nền trắng) VÀ chroma thấp (ít sắc độ). */
  function computeBackgroundCandidateMask(px) {
    const { L, A, B, n } = px;
    let Lmax = -Infinity;
    for (let i = 0; i < n; i++) if (L[i] > Lmax) Lmax = L[i];

    const marginL = 22;      // biên độ chấp nhận dưới Lmax (đơn vị Lab L*)
    const chromaMax = 26;    // ngưỡng sắc độ tối đa coi là "gần trung tính"

    const mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const chroma = Math.hypot(A[i], B[i]);
      if (L[i] >= Lmax - marginL && chroma <= chromaMax) mask[i] = 1;
    }
    return mask;
  }

  /* ---------- 6. Flood-fill lấy object mask từ điểm click ----------
     4-connectivity, BFS (không đệ quy để tránh stack overflow). Object
     = vùng liên thông KHÔNG thuộc backgroundCandidateMask, chứa điểm click. */
  function floodFillObject(bgMask, w, h, seedX, seedY) {
    const n = w * h;
    const seedIdx = seedY * w + seedX;
    if (seedIdx < 0 || seedIdx >= n) return null;
    if (bgMask[seedIdx] === 1) return null; // click ngay trên nền, không phải mẫu

    const mask = new Uint8Array(n);
    const visited = new Uint8Array(n);
    const queue = new Int32Array(n);
    let qHead = 0, qTail = 0;
    queue[qTail++] = seedIdx;
    visited[seedIdx] = 1;

    let minX = seedX, maxX = seedX, minY = seedY, maxY = seedY, count = 0;

    while (qHead < qTail) {
      const idx = queue[qHead++];
      const x = idx % w, y = (idx / w) | 0;
      mask[idx] = 1;
      count++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;

      const neighbors = [
        [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1],
      ];
      for (const [nx, ny] of neighbors) {
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const nIdx = ny * w + nx;
        if (visited[nIdx]) continue;
        visited[nIdx] = 1;
        if (bgMask[nIdx] === 1) continue; // là nền -> không lan vào
        queue[qTail++] = nIdx;
      }
    }

    return { mask, count, bbox: { minX, maxX, minY, maxY } };
  }

  /* ---------- 7. Distance transform 2-pass (chamfer 1/√2) ----------
     Xấp xỉ khoảng cách Euclid từ mỗi pixel trong object mask tới pixel
     KHÔNG thuộc object gần nhất. Đủ tốt cho việc xếp hạng "độ sâu vào
     trong lõi", không cần chính xác tuyệt đối. */
  function chamferDistanceTransform(mask, w, h) {
    const n = w * h;
    const dist = new Float32Array(n);
    const INF = 1e6;
    for (let i = 0; i < n; i++) dist[i] = mask[i] ? INF : 0;

    const D1 = 1, D2 = Math.SQRT2;

    // pass xuôi (trên-xuống, trái-qua-phải)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!mask[i]) continue;
        let d = dist[i];
        if (x > 0) d = Math.min(d, dist[i - 1] + D1);
        if (y > 0) d = Math.min(d, dist[i - w] + D1);
        if (x > 0 && y > 0) d = Math.min(d, dist[i - w - 1] + D2);
        if (x < w - 1 && y > 0) d = Math.min(d, dist[i - w + 1] + D2);
        dist[i] = d;
      }
    }
    // pass ngược (dưới-lên, phải-qua-trái)
    for (let y = h - 1; y >= 0; y--) {
      for (let x = w - 1; x >= 0; x--) {
        const i = y * w + x;
        if (!mask[i]) continue;
        let d = dist[i];
        if (x < w - 1) d = Math.min(d, dist[i + 1] + D1);
        if (y < h - 1) d = Math.min(d, dist[i + w] + D1);
        if (x < w - 1 && y < h - 1) d = Math.min(d, dist[i + w + 1] + D2);
        if (x > 0 && y < h - 1) d = Math.min(d, dist[i + w - 1] + D2);
        dist[i] = d;
      }
    }
    return dist;
  }

  /* ---------- 8. Inner mask theo TỈ LỆ diện tích (không hard-code px) ----------
     Giữ lại các pixel có khoảng cách-tới-biên cao nhất, chiếm khoảng
     targetFraction diện tích object (mặc định 70%, nằm giữa khoảng
     60–80% user yêu cầu). Vật thể quá nhỏ -> nới lỏng để tránh mask rỗng. */
  function buildInnerMask(objectMask, dist, count, targetFraction = 0.7) {
    const n = objectMask.length;
    // an toàn: vật quá nhỏ thì erode ít hơn để không mất hết pixel
    let frac = targetFraction;
    if (count < 150) frac = 0.9;
    else if (count < 400) frac = 0.8;

    const dArr = [];
    for (let i = 0; i < n; i++) if (objectMask[i]) dArr.push(dist[i]);
    dArr.sort((a, b) => a - b);
    const cutIdx = Math.floor(dArr.length * (1 - frac));
    const threshold = dArr[Math.max(0, Math.min(dArr.length - 1, cutIdx))];

    const inner = new Uint8Array(n);
    let innerCount = 0;
    for (let i = 0; i < n; i++) {
      if (objectMask[i] && dist[i] >= threshold) { inner[i] = 1; innerCount++; }
    }
    // fallback an toàn tuyệt đối
    if (innerCount < 8) {
      for (let i = 0; i < n; i++) if (objectMask[i]) { inner[i] = 1; innerCount++; }
    }
    return { inner, innerCount, threshold };
  }

  /* ---------- 9. Vùng nền tham chiếu quanh object ----------
     Vòng nhẫn quanh bbox, margin theo bán kính hiệu dụng của object
     (không hard-code px cố định), tránh sát viền (shadow/AA), và chỉ
     lấy pixel đã được backgroundCandidateMask xác nhận là nền thật. */
  function buildBackgroundRingMask(bgMask, objMask, bbox, w, h) {
    const bw = bbox.maxX - bbox.minX + 1;
    const bh = bbox.maxY - bbox.minY + 1;
    const area = bw * bh;
    const rEff = Math.sqrt(area / Math.PI);

    const skipMargin = Math.max(3, rEff * 0.35);   // vùng sát viền bị bỏ qua
    const outerMargin = Math.max(10, rEff * 1.4);  // vòng ngoài lấy mẫu

    const x0 = Math.max(0, Math.floor(bbox.minX - outerMargin));
    const x1 = Math.min(w - 1, Math.ceil(bbox.maxX + outerMargin));
    const y0 = Math.max(0, Math.floor(bbox.minY - outerMargin));
    const y1 = Math.min(h - 1, Math.ceil(bbox.maxY + outerMargin));

    const ring = new Uint8Array(w * h);
    let count = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * w + x;
        if (objMask[i]) continue;
        if (bgMask[i] !== 1) continue;
        // khoảng cách tới bbox object (0 nếu bên trong bbox theo 1 trục)
        const dx = x < bbox.minX ? bbox.minX - x : (x > bbox.maxX ? x - bbox.maxX : 0);
        const dy = y < bbox.minY ? bbox.minY - y : (y > bbox.maxY ? y - bbox.maxY : 0);
        const d = Math.hypot(dx, dy);
        if (d < skipMargin) continue; // quá sát viền -> bỏ (tránh bóng/AA)
        ring[i] = 1;
        count++;
      }
    }
    return { ring, count };
  }

  /* ---------- 10. Thống kê robust (median rồi trimmed-mean) ---------- */
  function median(arr) {
    const s = [...arr].sort((a, b) => a - b);
    const m = s.length;
    if (m === 0) return 0;
    return m % 2 ? s[(m - 1) / 2] : (s[m / 2 - 1] + s[m / 2]) / 2;
  }

  function robustColorFromMask(px, maskOrIndices, isIndexArray = false) {
    const { R, G, Bc, w, n } = px;
    const idxs = isIndexArray ? maskOrIndices : (() => {
      const arr = [];
      for (let i = 0; i < n; i++) if (maskOrIndices[i]) arr.push(i);
      return arr;
    })();
    if (idxs.length === 0) return null;

    const medR = median(idxs.map(i => R[i]));
    const medG = median(idxs.map(i => G[i]));
    const medB = median(idxs.map(i => Bc[i]));
    const medLab = PHCore.rgbToLab([medR, medG, medB]);

    // loại outlier: bỏ 15% pixel xa median nhất theo Lab DeltaE
    const withDist = idxs.map(i => {
      const lab = PHCore.rgbToLab([R[i], G[i], Bc[i]]);
      return { i, d: PHCore.deltaE(lab, medLab) };
    });
    withDist.sort((a, b) => a.d - b.d);
    const keepCount = Math.max(1, Math.ceil(withDist.length * 0.85));
    const kept = withDist.slice(0, keepCount);

    let rSum = 0, gSum = 0, bSum = 0;
    for (const { i } of kept) { rSum += R[i]; gSum += G[i]; bSum += Bc[i]; }
    const rgb = [rSum / kept.length, gSum / kept.length, bSum / kept.length];

    // độ lệch chuẩn L (đo độ đồng đều) — dùng cho confidence
    const labs = kept.map(({ i }) => PHCore.rgbToLab([R[i], G[i], Bc[i]]));
    const meanL = labs.reduce((s, l) => s + l[0], 0) / labs.length;
    const stdL = Math.sqrt(labs.reduce((s, l) => s + (l[0] - meanL) ** 2, 0) / labs.length);

    return { rgb, count: idxs.length, keptCount: kept.length, stdL, medianRgb: [medR, medG, medB] };
  }

  /* ---------- 11. White balance: von Kries trong domain linear-RGB ----------
     Reuse PHCore.whiteBalanceCorrect — 1 nguồn sự thật duy nhất cho công thức
     này (không viết lại ở đây nữa). Giữ nguyên tên hàm whiteBalanceCorrect
     ở local scope để các chỗ gọi bên dưới (analyzeClick) không phải đổi. */
  function whiteBalanceCorrect(sampleRgb, refWhite, curWhite) {
    return PHCore.whiteBalanceCorrect(sampleRgb, refWhite, curWhite);
  }

  /* ---------- 12. Confidence ánh sáng (HIGH / MEDIUM / LOW) ---------- */
  function lightingConfidence(maxRawDev, bgChroma, bgStdL, bgCount) {
    if (bgCount < 30) return { level: 'LOW', factor: 0.55, reason: 'Không đủ vùng nền để tham chiếu ánh sáng' };

    let score = 0;
    // độ lệch gain càng nhỏ càng tốt
    if (maxRawDev < 0.15) score += 2; else if (maxRawDev < 0.4) score += 1;
    // nền càng trung tính (ít sắc) càng tốt
    if (bgChroma < 8) score += 2; else if (bgChroma < 16) score += 1;
    // nền càng đồng đều (ít gradient/bóng) càng tốt
    if (bgStdL < 6) score += 2; else if (bgStdL < 12) score += 1;

    if (score >= 5) return { level: 'HIGH', factor: 1.0, reason: 'Ánh sáng gần giống ảnh chuẩn, nền đồng đều' };
    if (score >= 3) return { level: 'MEDIUM', factor: 0.85, reason: 'Ánh sáng lệch vừa phải hoặc nền hơi không đều' };
    return { level: 'LOW', factor: 0.6, reason: 'Ánh sáng lệch nhiều so với ảnh chuẩn, hoặc nền không đều/nhiễu màu' };
  }

  /* ---------- 13. pH range hiển thị theo confidence tổng hợp ---------- */
  function phRangeFromConfidence(ph, confidence) {
    let margin;
    if (confidence >= 85) margin = 0.05;
    else if (confidence >= 70) margin = 0.15;
    else if (confidence >= 50) margin = 0.3;
    else margin = 0.5;
    const lo = Math.max(0, ph - margin);
    const hi = Math.min(14, ph + margin);
    return { lo: Math.round(lo * 20) / 20, hi: Math.round(hi * 20) / 20, margin };
  }

  /* ---------- 14. Vẽ mask thành canvas nhỏ để debug ---------- */
  function maskToCanvas(maskArr, w, h, rgba) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const imgData = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      if (maskArr[i]) {
        imgData.data[i * 4] = rgba[0];
        imgData.data[i * 4 + 1] = rgba[1];
        imgData.data[i * 4 + 2] = rgba[2];
        imgData.data[i * 4 + 3] = rgba[3];
      }
    }
    ctx.putImageData(imgData, 0, 0);
    return c;
  }

  /* ============================================================
     HÀM CHÍNH: analyzeClick
     sourceCanvas: canvas nguồn độ phân giải gốc (đã vẽ ảnh)
     srcX, srcY: toạ độ click theo hệ ảnh gốc (không phải hệ hiển thị)
     chart: bảng pH đang active (từ PHCore.loadChart())
     ============================================================ */
  function analyzeClick(sourceCanvas, srcX, srcY, chart) {
    const profile = getActiveProfile();
    const work = buildWorkCanvas(sourceCanvas);
    const wx = Math.round(srcX * work.scale);
    const wy = Math.round(srcY * work.scale);
    if (wx < 0 || wx >= work.w || wy < 0 || wy >= work.h) {
      return { ok: false, reason: 'Điểm click nằm ngoài ảnh.' };
    }

    const imageData = work.ctx.getImageData(0, 0, work.w, work.h);
    const px = precomputeLab(imageData, work.w, work.h);

    const bgCandidateMask = computeBackgroundCandidateMask(px);

    const obj = floodFillObject(bgCandidateMask, work.w, work.h, wx, wy);
    if (!obj || obj.count < 25) {
      return {
        ok: false,
        reason: 'Không xác định được mẫu vật tại vị trí click (có thể đã click vào nền, hoặc mẫu quá nhỏ / màu quá gần nền).',
        debug: { work, bgCandidateMask },
      };
    }

    const dist = chamferDistanceTransform(obj.mask, work.w, work.h);
    const { inner, innerCount, threshold } = buildInnerMask(obj.mask, dist, obj.count);

    const bg = buildBackgroundRingMask(bgCandidateMask, obj.mask, obj.bbox, work.w, work.h);

    const sampleStat = robustColorFromMask(px, inner);
    if (!sampleStat) {
      return { ok: false, reason: 'Không lấy được màu mẫu từ vùng lõi.', debug: { work } };
    }

    let backgroundRgb, bgStdL, bgChroma;
    let bgCount = bg.count;
    if (bg.count >= 20) {
      const bgStat = robustColorFromMask(px, bg.ring);
      backgroundRgb = bgStat.rgb;
      bgStdL = bgStat.stdL;
      const bgLab = PHCore.rgbToLab(backgroundRgb);
      bgChroma = Math.hypot(bgLab[1], bgLab[2]);
    } else {
      // fallback: dùng toàn bộ backgroundCandidateMask của ảnh
      const bgStat = robustColorFromMask(px, bgCandidateMask);
      backgroundRgb = bgStat ? bgStat.rgb : profile.referenceWhite;
      bgStdL = bgStat ? bgStat.stdL : 99;
      const bgLab = PHCore.rgbToLab(backgroundRgb);
      bgChroma = Math.hypot(bgLab[1], bgLab[2]);
      bgCount = bgStat ? bgStat.count : 0;
    }

    const wb = whiteBalanceCorrect(sampleStat.rgb, profile.referenceWhite, backgroundRgb);
    const lightConf = lightingConfidence(wb.maxRawDev, bgChroma, bgStdL, bgCount);

    const activeChart = profile.phChartOverride || chart;
    const matchResult = PHCore.matchPh(wb.correctedRgb, activeChart);

    const combinedConfidence = Math.max(0, Math.min(100, matchResult.confidence * lightConf.factor));
    const range = phRangeFromConfidence(matchResult.ph, combinedConfidence);

    return {
      ok: true,
      profile,
      work,
      seed: { wx, wy },
      object: obj,
      inner, innerCount,
      background: bg,
      sample: {
        rawRgb: sampleStat.rgb.map(Math.round),
        backgroundRgb: backgroundRgb.map(Math.round),
        correctedRgb: wb.correctedRgb,
        gain: wb.gain,
        maxRawGainDev: wb.maxRawDev,
      },
      lighting: lightConf,
      match: matchResult,
      confidence: combinedConfidence,
      range,
      // MỚI — additive, không đổi field nào ở trên. Dùng cho chế độ
      // Calibration để tự đánh giá chất lượng lần quét (mask quá nhỏ,
      // màu lõi không đồng đều, nền không đồng đều...) mà không cần
      // đụng vào thuật toán chính.
      diagnostics: {
        objectPixelCount: obj.count,
        innerPixelCount: innerCount,
        sampleStdL: sampleStat.stdL,
        sampleKeptCount: sampleStat.keptCount,
        backgroundPixelCount: bgCount,
        backgroundStdL: bgStdL,
        backgroundChroma: bgChroma,
      },
      debugMasks: {
        objectCanvas: maskToCanvas(obj.mask, work.w, work.h, [79, 163, 147, 90]),
        innerCanvas: maskToCanvas(inner, work.w, work.h, [232, 161, 91, 140]),
        backgroundCanvas: maskToCanvas(bg.ring, work.w, work.h, [110, 163, 201, 120]),
      },
    };
  }

  window.PHVision = {
    CAMERA_PROFILES,
    getActiveProfile, getActiveProfileId, setActiveProfileId,
    analyzeClick,
    // Xuất thêm 2 hàm thuần tuý đã có sẵn ở trên (không đổi logic), để
    // phcalib.js tái dùng đúng 1 công thức hiệu chỉnh ánh sáng thay vì
    // viết trùng ở nơi khác.
    whiteBalanceCorrect,
    phRangeFromConfidence,
  };
})();
