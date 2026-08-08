(() => {
  const PHCore = window.PHCore;
  const PHVision = window.PHVision;
  const { loadChart, matchPh, rgbToHex, rgbToLab, deltaE, whiteBalanceCorrect, REFERENCE_WHITE } = PHCore;
  const chart = loadChart();

  /* ---------- DOM ---------- */
  const cameraWrap = document.getElementById('cameraWrap');
  const cameraPlaceholder = document.getElementById('cameraPlaceholder');
  const video = document.getElementById('video');
  const guideCanvas = document.getElementById('guideCanvas');
  const gctx = guideCanvas.getContext('2d');
  const capturedImg = document.getElementById('capturedImg');
  const liveStatusTag = document.getElementById('liveStatusTag');

  const startCamBtn = document.getElementById('startCamBtn');
  const switchCamBtn = document.getElementById('switchCamBtn');
  const stopCamBtn = document.getElementById('stopCamBtn');
  const manualCaptureBtn = document.getElementById('manualCaptureBtn');
  const rescanBtn = document.getElementById('rescanBtn');

  const liveTuning = document.getElementById('liveTuning');
  const squareSizeSlider = document.getElementById('squareSizeSlider');
  const squareSizeVal = document.getElementById('squareSizeVal');
  const autoCaptureToggle = document.getElementById('autoCaptureToggle');
  const useCalibToggle = document.getElementById('useCalibToggle');
  const statusList = document.getElementById('statusList');
  const captureProgressFill = document.getElementById('captureProgressFill');

  const phValueEl = document.getElementById('phValue');
  const confVal = document.getElementById('confVal');
  const deVal = document.getElementById('deVal');
  const rangeVal = document.getElementById('rangeVal');
  const chartSourceVal = document.getElementById('chartSourceVal');
  const confFill = document.getElementById('confFill');
  const sampleSwatch = document.getElementById('sampleSwatch');
  const sampleHex = document.getElementById('sampleHex');
  const bgSwatch = document.getElementById('bgSwatch');
  const bgHex = document.getElementById('bgHex');
  const phStrip = document.getElementById('phStrip');
  const logList = document.getElementById('logList');
  const clearLogBtn = document.getElementById('clearLogBtn');

  /* ---------- state ---------- */
  let stream = null;
  let devices = [];
  let deviceIndex = 0;
  let squareFrac = parseInt(squareSizeSlider.value, 10) / 100;
  let rafId = null;
  let lastCheckTime = 0;
  const CHECK_INTERVAL_MS = 160;
  let stableSince = null;
  const STABLE_MS = 1100; // giữ ổn định đủ điều kiện liên tục (ms) trước khi tự chụp
  let capturing = false;  // đang chụp / đang hiện kết quả -> tạm dừng vòng kiểm tra
  let logs = [];

  const CHECK_MAX_DIM = 320; // downscale khi kiểm tra điều kiện mỗi khung hình, để chạy mượt

  /* ================= pH strip legend (giống trang Quét mẫu) ================= */
  function renderStrip() {
    phStrip.innerHTML = '';
    const sorted = [...chart].sort((a, b) => a.ph - b.ph);
    for (let i = 0; i < sorted.length - 1; i++) {
      const div = document.createElement('div');
      div.style.background = `linear-gradient(90deg, ${rgbToHex(sorted[i].rgb)}, ${rgbToHex(sorted[i + 1].rgb)})`;
      phStrip.appendChild(div);
    }
  }
  renderStrip();

  /* ================= Hình học khung hướng dẫn ================================
     Dùng CHUNG 1 hàm này cho cả (a) khung kiểm tra điều kiện mỗi tick (ảnh
     downscale) và (b) lúc chụp thật (ảnh full-res của camera) — chỉ khác
     w,h truyền vào, tỉ lệ hình học giữ nguyên vì mọi kích thước đều tính
     theo % (không hard-code px).
       square = khung vuông hướng dẫn hiển thị cho người dùng canh mẫu
       core   = vùng lõi (thu vào ~22% mỗi cạnh) — dùng để LẤY MÀU MẪU
       bands  = 4 dải mỏng sát ngay bên ngoài khung (trên/dưới/trái/phải)
                — dùng để lấy màu NỀN + phát hiện bóng đổ lệch 1 phía  */
  function computeGuideRects(w, h, frac) {
    const side = Math.min(w, h) * frac;
    const cx = w / 2, cy = h / 2;
    const half = side / 2;
    const square = { x0: cx - half, y0: cy - half, x1: cx + half, y1: cy + half, side };

    const coreShrink = side * 0.22;
    const core = {
      x0: square.x0 + coreShrink, y0: square.y0 + coreShrink,
      x1: square.x1 - coreShrink, y1: square.y1 - coreShrink,
    };

    const gap = side * 0.05;   // khoảng hở tránh viền/anti-aliasing của mẫu
    const thick = side * 0.22; // độ dày dải lấy mẫu nền

    const bands = {
      top:    { x0: square.x0 - thick, y0: square.y0 - gap - thick, x1: square.x1 + thick, y1: square.y0 - gap },
      bottom: { x0: square.x0 - thick, y0: square.y1 + gap,         x1: square.x1 + thick, y1: square.y1 + gap + thick },
      left:   { x0: square.x0 - gap - thick, y0: square.y0 - thick, x1: square.x0 - gap,   y1: square.y1 + thick },
      right:  { x0: square.x1 + gap,        y0: square.y0 - thick, x1: square.x1 + gap + thick, y1: square.y1 + thick },
    };

    return { square, core, bands };
  }

  function rectFitsFrame(r, w, h) {
    return r.x0 >= 0 && r.y0 >= 0 && r.x1 <= w && r.y1 <= h && r.x1 > r.x0 && r.y1 > r.y0;
  }

  /* ================= Lấy màu robust từ 1 hoặc nhiều vùng chữ nhật =================
     median rồi loại 15% pixel lệch xa nhất theo DeltaE (Lab) — cùng triết
     lý với robustColorFromMask() trong phvision.js, áp dụng cho vùng chữ
     nhật thay vì mặt nạ tuỳ ý (ở đây hình học đã biết trước = khung vuông
     hướng dẫn, không cần flood-fill). stride>1 để lấy mẫu thưa trên vùng
     lớn, tăng tốc mà không ảnh hưởng nhiều tới độ chính xác trung bình. */
  function robustColorFromRects(imageData, w, h, rects, stride = 1) {
    const data = imageData.data;
    const R = [], G = [], B = [];
    for (const rect of rects) {
      const x0 = Math.max(0, Math.floor(rect.x0)), y0 = Math.max(0, Math.floor(rect.y0));
      const x1 = Math.min(w, Math.ceil(rect.x1)), y1 = Math.min(h, Math.ceil(rect.y1));
      for (let y = y0; y < y1; y += stride) {
        for (let x = x0; x < x1; x += stride) {
          const i = (y * w + x) * 4;
          R.push(data[i]); G.push(data[i + 1]); B.push(data[i + 2]);
        }
      }
    }
    if (R.length === 0) return null;

    const median = arr => {
      const s = [...arr].sort((a, b) => a - b);
      const m = s.length;
      return m % 2 ? s[(m - 1) / 2] : (s[m / 2 - 1] + s[m / 2]) / 2;
    };
    const medRgb = [median(R), median(G), median(B)];
    const medLab = rgbToLab(medRgb);

    const withDist = R.map((_, i) => {
      const lab = rgbToLab([R[i], G[i], B[i]]);
      return { i, lab, d: deltaE(lab, medLab) };
    });
    withDist.sort((a, b) => a.d - b.d);
    const keepCount = Math.max(1, Math.ceil(withDist.length * 0.85));
    const kept = withDist.slice(0, keepCount);

    let rSum = 0, gSum = 0, bSum = 0;
    for (const { i } of kept) { rSum += R[i]; gSum += G[i]; bSum += B[i]; }
    const rgb = [rSum / kept.length, gSum / kept.length, bSum / kept.length];

    const meanL = kept.reduce((s, k) => s + k.lab[0], 0) / kept.length;
    const stdL = Math.sqrt(kept.reduce((s, k) => s + (k.lab[0] - meanL) ** 2, 0) / kept.length);

    return { rgb, count: R.length, stdL };
  }

  /* ================= Confidence ánh sáng (heuristic cục bộ trang này) =================
     Cùng tinh thần với lightingConfidence() trong phvision.js — KHÔNG viết
     lại công thức hiệu chỉnh màu (whiteBalanceCorrect đã tái dùng từ
     PHCore), chỉ chấm điểm định tính ánh sáng/nền để suy ra confidence
     hiển thị, cộng thêm tiêu chí "shadowSpread" đặc thù cho việc phát
     hiện bóng đổ lệch giữa 4 dải nền quanh khung (chưa có trong bản gốc
     vì bản gốc chỉ có 1 vùng nền hình vành khuyên, không tách 4 phía). */
  function lightingScore(maxRawDev, bgChroma, bgStdL, shadowSpread) {
    let score = 0;
    if (maxRawDev < 0.15) score += 2; else if (maxRawDev < 0.4) score += 1;
    if (bgChroma < 8) score += 2; else if (bgChroma < 16) score += 1;
    if (bgStdL < 6) score += 2; else if (bgStdL < 12) score += 1;
    if (shadowSpread < 6) score += 2; else if (shadowSpread < 12) score += 1;
    if (score >= 7) return { level: 'HIGH', factor: 1.0, reason: 'Ánh sáng đều, nền ổn định' };
    if (score >= 4) return { level: 'MEDIUM', factor: 0.85, reason: 'Ánh sáng lệch vừa phải' };
    return { level: 'LOW', factor: 0.6, reason: 'Ánh sáng không đều hoặc nền nhiễu' };
  }

  /* ================= Camera: bật / tắt / đổi ================= */
  async function listVideoInputs() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      devices = all.filter(d => d.kind === 'videoinput');
    } catch (e) { devices = []; }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function startCamera(preferDeviceId) {
    stopCamera(); // đảm bảo không mở 2 stream cùng lúc
    const constraints = {
      audio: false,
      video: preferDeviceId
        ? { deviceId: { exact: preferDeviceId } }
        : { facingMode: { ideal: 'environment' } }, // ưu tiên camera sau trên điện thoại
    };
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
      liveStatusTag.textContent = 'Lỗi truy cập camera';
      cameraPlaceholder.style.display = '';
      cameraPlaceholder.innerHTML = '⚠️ Không truy cập được camera.<br>' + escapeHtml(e.message || String(e)) +
        '<br><span style="color:var(--muted);">Kiểm tra đã cấp quyền camera cho trình duyệt, và trang đang chạy qua HTTPS.</span>';
      video.style.display = 'none';
      guideCanvas.style.display = 'none';
      return false;
    }
    video.srcObject = stream;
    await video.play().catch(() => {});
    cameraPlaceholder.style.display = 'none';
    video.style.display = '';
    guideCanvas.style.display = '';
    capturedImg.style.display = 'none';
    liveStatusTag.textContent = 'Đang quét trực tiếp';

    await listVideoInputs();
    switchCamBtn.style.display = devices.length > 1 ? '' : 'none';
    stopCamBtn.style.display = '';
    manualCaptureBtn.style.display = '';
    startCamBtn.style.display = 'none';
    rescanBtn.style.display = 'none';
    liveTuning.style.display = '';

    resetStability();
    capturing = false;
    startLoop();
    return true;
  }

  function stopCamera() {
    cancelLoop();
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
  }

  startCamBtn.addEventListener('click', () => startCamera());
  stopCamBtn.addEventListener('click', () => {
    stopCamera();
    liveStatusTag.textContent = 'Đã tắt camera';
    cameraPlaceholder.style.display = '';
    cameraPlaceholder.innerHTML = '📷 Bấm "Bật camera" để tiếp tục quét trực tiếp.';
    video.style.display = 'none';
    guideCanvas.style.display = 'none';
    capturedImg.style.display = 'none';
    startCamBtn.style.display = '';
    switchCamBtn.style.display = 'none';
    stopCamBtn.style.display = 'none';
    manualCaptureBtn.style.display = 'none';
    rescanBtn.style.display = 'none';
    liveTuning.style.display = 'none';
    statusList.innerHTML = '';
  });
  switchCamBtn.addEventListener('click', () => {
    if (devices.length < 2) return;
    deviceIndex = (deviceIndex + 1) % devices.length;
    startCamera(devices[deviceIndex].deviceId);
  });
  rescanBtn.addEventListener('click', () => {
    capturedImg.style.display = 'none';
    video.style.display = '';
    guideCanvas.style.display = '';
    manualCaptureBtn.style.display = '';
    rescanBtn.style.display = 'none';
    liveTuning.style.display = '';
    liveStatusTag.textContent = 'Đang quét trực tiếp';
    resetStability();
    capturing = false;
    startLoop();
  });
  manualCaptureBtn.addEventListener('click', () => { if (!capturing) doCapture('Thủ công'); });

  squareSizeSlider.addEventListener('input', () => {
    squareFrac = parseInt(squareSizeSlider.value, 10) / 100;
    squareSizeVal.textContent = squareSizeSlider.value + '%';
    resetStability();
  });

  /* ================= Vòng lặp kiểm tra điều kiện (mỗi ~160ms) ================= */
  function startLoop() {
    cancelLoop();
    const tick = (ts) => {
      rafId = requestAnimationFrame(tick);
      if (capturing) return;
      if (!video.videoWidth || !video.videoHeight) return; // chưa có metadata video
      if (ts - lastCheckTime < CHECK_INTERVAL_MS) return;
      lastCheckTime = ts;
      runCheck();
    };
    rafId = requestAnimationFrame(tick);
  }
  function cancelLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }
  function resetStability() {
    stableSince = null;
    captureProgressFill.style.width = '0%';
  }

  const checkCanvas = document.createElement('canvas');
  const checkCtx = checkCanvas.getContext('2d', { willReadFrequently: true });

  function runCheck() {
    const vw = video.videoWidth, vh = video.videoHeight;
    const scale = Math.min(1, CHECK_MAX_DIM / Math.max(vw, vh));
    const w = Math.max(1, Math.round(vw * scale)), h = Math.max(1, Math.round(vh * scale));
    checkCanvas.width = w; checkCanvas.height = h;
    checkCtx.drawImage(video, 0, 0, w, h);

    // Canvas vẽ khung hướng dẫn phủ lên video theo đúng kích thước HIỂN
    // THỊ thực tế trên màn hình (không phải checkCanvas nội bộ).
    guideCanvas.width = video.clientWidth;
    guideCanvas.height = video.clientHeight;
    const geo = computeGuideRects(w, h, squareFrac);
    const geoDisplay = computeGuideRects(guideCanvas.width, guideCanvas.height, squareFrac);

    let imageData;
    try { imageData = checkCtx.getImageData(0, 0, w, h); } catch (e) { return; }

    const conditions = evaluateConditions(imageData, w, h, geo);
    renderStatusList(conditions);
    drawGuideOverlay(geoDisplay, conditions.allOk);

    if (conditions.allOk) {
      if (stableSince == null) stableSince = performance.now();
      const held = performance.now() - stableSince;
      captureProgressFill.style.width = Math.min(100, (held / STABLE_MS) * 100) + '%';
      if (held >= STABLE_MS && autoCaptureToggle.checked) {
        doCapture('Tự động');
      }
    } else {
      resetStability();
    }
  }

  /* ================= Đánh giá các điều kiện chụp =================
     Trả về { items: [{ok,text}], allOk } để hiển thị checklist, và dừng
     sớm (kèm lý do) nếu khung hướng dẫn không nằm trọn trong khung hình —
     lúc đó không có đủ dữ liệu để đánh giá các điều kiện còn lại. */
  function evaluateConditions(imageData, w, h, geo) {
    const items = [];
    let allOk = true;

    const bandRects = [geo.bands.top, geo.bands.bottom, geo.bands.left, geo.bands.right];
    const framingOk = bandRects.every(r => rectFitsFrame(r, w, h)) && rectFitsFrame(geo.square, w, h);

    if (!framingOk) {
      allOk = false;
      items.push({ ok: false, text: 'Lùi camera ra xa hoặc căn giữa khung mẫu — khung đang sát mép ảnh' });
      return { items, allOk };
    }
    items.push({ ok: true, text: 'Khung mẫu nằm trọn trong khung hình' });

    const coreStat = robustColorFromRects(imageData, w, h, [geo.core], 1);
    const fullStat = robustColorFromRects(imageData, w, h, [geo.square], 2);
    const bandStats = {
      top: robustColorFromRects(imageData, w, h, [geo.bands.top], 1),
      bottom: robustColorFromRects(imageData, w, h, [geo.bands.bottom], 1),
      left: robustColorFromRects(imageData, w, h, [geo.bands.left], 1),
      right: robustColorFromRects(imageData, w, h, [geo.bands.right], 1),
    };
    const bgStat = robustColorFromRects(imageData, w, h, bandRects, 1);

    if (!coreStat || !fullStat || !bgStat) {
      allOk = false;
      items.push({ ok: false, text: 'Không đọc được dữ liệu khung hình' });
      return { items, allOk };
    }

    const coreLab = rgbToLab(coreStat.rgb);
    const bgLab = rgbToLab(bgStat.rgb);
    const bgChroma = Math.hypot(bgLab[1], bgLab[2]);

    // (1) có mẫu trong khung không (khác biệt đủ với nền)
    const objectContrast = deltaE(coreLab, bgLab);
    const hasObject = objectContrast > 6;
    items.push({ ok: hasObject, text: hasObject ? 'Đã phát hiện mẫu trong khung' : 'Đặt mẫu vào giữa khung vuông' });
    if (!hasObject) allOk = false;

    // (2) mẫu có lấp gần đầy khung không: so màu lõi vs. trung bình cả
    // khung — nếu còn hở nền ở rìa khung, trung bình cả khung sẽ lệch
    // nhiều so với màu lõi (bị kéo về phía màu nền).
    const fillDelta = deltaE(coreLab, rgbToLab(fullStat.rgb));
    const fillsSquare = fillDelta < 9;
    items.push({ ok: fillsSquare, text: fillsSquare ? 'Mẫu vừa khít khung vuông' : 'Đưa mẫu lại gần / phóng to hơn để lấp đầy khung' });
    if (!fillsSquare) allOk = false;

    // (3) nền đủ sáng & đủ trung tính (KHÔNG bắt buộc trắng tuyệt đối)
    const bgTooDark = bgLab[0] < 55;
    const bgTooBright = bgLab[0] > 97;
    const bgTooColored = bgChroma > 28;
    const bgOk = !bgTooDark && !bgTooBright && !bgTooColored;
    let bgText = 'Nền xung quanh đủ sáng và đủ trung tính';
    if (bgTooDark) bgText = 'Nền đang hơi tối — tăng thêm ánh sáng hoặc dùng nền sáng hơn';
    else if (bgTooBright) bgText = 'Nền đang bị cháy sáng — giảm bớt ánh sáng chiếu trực tiếp';
    else if (bgTooColored) bgText = 'Nền có màu ám rõ — dùng giấy/nền trắng hoặc màu nhạt hơn';
    items.push({ ok: bgOk, text: bgText });
    if (!bgOk) allOk = false;

    // (4) không có bóng đổ lệch 1 phía: so lệch L giữa 4 dải nền quanh khung
    const bandLs = ['top', 'bottom', 'left', 'right']
      .map(k => bandStats[k])
      .filter(Boolean)
      .map(s => rgbToLab(s.rgb)[0]);
    const shadowSpread = bandLs.length ? Math.max(...bandLs) - Math.min(...bandLs) : 0;
    const noShadow = shadowSpread < 14;
    items.push({ ok: noShadow, text: noShadow ? 'Không phát hiện bóng đổ lệch' : 'Có vệt bóng đổ lên nền — chỉnh lại hướng nguồn sáng' });
    if (!noShadow) allOk = false;

    return { items, allOk };
  }

  function renderStatusList(conditions) {
    statusList.innerHTML = conditions.items.map(it => `
      <div class="status-item ${it.ok ? 'ok' : 'bad'}"><span class="dot"></span>${it.ok ? '✓' : '•'} ${it.text}</div>
    `).join('');
  }

  function drawGuideOverlay(geo, allOk) {
    gctx.clearRect(0, 0, guideCanvas.width, guideCanvas.height);
    const color = allOk ? '#4fa393' : '#e8a15b';
    gctx.strokeStyle = color;
    gctx.lineWidth = 3;
    gctx.setLineDash([10, 8]);
    gctx.strokeRect(geo.square.x0, geo.square.y0, geo.square.x1 - geo.square.x0, geo.square.y1 - geo.square.y0);
    gctx.setLineDash([]);
    gctx.strokeStyle = 'rgba(255,255,255,0.55)';
    gctx.lineWidth = 1;
    gctx.strokeRect(geo.core.x0, geo.core.y0, geo.core.x1 - geo.core.x0, geo.core.y1 - geo.core.y0);
  }

  /* ================= Chụp & phân tích (dùng ẢNH GỐC full-res của video) =================
     Lặp lại chính XÁC cùng hình học (computeGuideRects) trên khung hình
     full-res tại thời điểm chụp — không dùng lại số liệu đã tính ở bước
     kiểm tra (vốn tính trên ảnh downscale) để kết quả pH cuối cùng có độ
     phân giải màu cao nhất có thể. */
  const captureCanvas = document.createElement('canvas');
  const captureCtx = captureCanvas.getContext('2d', { willReadFrequently: true });

  function doCapture(label) {
    capturing = true;
    resetStability();
    // Dừng hẳn vòng kiểm tra ngay khi bắt đầu chụp — nếu không, camera
    // stream vẫn đang chạy ngầm (chỉ ẩn hình) và nếu điều kiện vẫn đủ,
    // hệ thống có thể tự chụp ĐÈ lần nữa trong khi người dùng đang xem
    // kết quả vừa chụp, trước khi họ bấm "Quét mẫu khác". rescanBtn sẽ
    // gọi lại startLoop() khi cần chạy tiếp.
    cancelLoop();

    const vw = video.videoWidth, vh = video.videoHeight;
    captureCanvas.width = vw; captureCanvas.height = vh;
    captureCtx.drawImage(video, 0, 0, vw, vh);

    const geo = computeGuideRects(vw, vh, squareFrac);
    let imageData;
    try { imageData = captureCtx.getImageData(0, 0, vw, vh); } catch (e) {
      capturing = false;
      return;
    }

    const coreStat = robustColorFromRects(imageData, vw, vh, [geo.core], 1);
    const bandRects = [geo.bands.top, geo.bands.bottom, geo.bands.left, geo.bands.right];
    const bgStat = robustColorFromRects(imageData, vw, vh, bandRects, 1);

    // Đóng băng khung hình vừa chụp lên màn hình để người dùng xem lại.
    capturedImg.src = captureCanvas.toDataURL('image/jpeg', 0.92);
    capturedImg.style.display = '';
    video.style.display = 'none';
    guideCanvas.style.display = 'none';
    manualCaptureBtn.style.display = 'none';
    rescanBtn.style.display = '';
    liveStatusTag.textContent = 'Đã chụp — xem kết quả bên phải';

    if (!coreStat || !bgStat) {
      capturing = false;
      return;
    }

    // Hiệu chỉnh ánh sáng (von Kries) + so khớp pH — DÙNG CHUNG đúng công
    // thức trong phcore.js (whiteBalanceCorrect, matchPh), không viết lại.
    const wb = whiteBalanceCorrect(coreStat.rgb, REFERENCE_WHITE, bgStat.rgb);
    let match = matchPh(wb.correctedRgb, chart);

    const bgLab = rgbToLab(bgStat.rgb);
    const bgChroma = Math.hypot(bgLab[1], bgLab[2]);
    const bandLs = ['top', 'bottom', 'left', 'right'].map(k => {
      const s = robustColorFromRects(imageData, vw, vh, [geo.bands[k]], 1);
      return s ? rgbToLab(s.rgb)[0] : null;
    }).filter(v => v != null);
    const shadowSpread = bandLs.length ? Math.max(...bandLs) - Math.min(...bandLs) : 0;

    const lighting = lightingScore(wb.maxRawDev, bgChroma, bgStat.stdL, shadowSpread);
    let confidence = Math.max(0, Math.min(100, match.confidence * lighting.factor));
    let chartSourceText = 'Mặc định';

    // Nếu bật "Dùng thang đo Calibration tự tạo": không so trực tiếp RGB
    // thô với calibration — wb.correctedRgb ở đây ĐÃ được hiệu chỉnh về
    // đúng REFERENCE_WHITE (cùng 1 nguồn với CAMERA_PROFILES.camera1), và
    // PHCalib.matchAgainstCalibration() cũng quy mọi điểm calibration về
    // chính reference white đó trước khi so — đúng pipeline dùng chung với
    // trang Quét mẫu (script.js).
    if (useCalibToggle && useCalibToggle.checked && window.PHCalib) {
      const points = window.PHCalib.loadCalibration();
      const calibMatch = window.PHCalib.matchAgainstCalibration(wb.correctedRgb, points, REFERENCE_WHITE);
      if (calibMatch.ok) {
        match = { ph: calibMatch.ph, deltaE: calibMatch.deltaE, matchedRgb: calibMatch.matchedRgb };
        confidence = Math.max(0, Math.min(100, calibMatch.confidence * lighting.factor));
        chartSourceText = `Calibration (${calibMatch.uniquePhCount} mốc)`;
      } else {
        chartSourceText = `Mặc định (${calibMatch.reason})`;
      }
    }

    const range = PHVision.phRangeFromConfidence(match.ph, confidence);

    applyReading({ correctedRgb: wb.correctedRgb, backgroundRgb: bgStat.rgb, match, confidence, range, lighting, label, chartSourceText });
  }

  /* ================= Hiển thị kết quả (bố cục giống trang Quét mẫu) ================= */
  function applyReading({ correctedRgb, backgroundRgb, match, confidence, range, lighting, label, chartSourceText }) {
    phValueEl.classList.remove('stale');
    phValueEl.innerHTML = `${match.ph.toFixed(2)} <span class="unit">pH</span>`;
    confVal.textContent = confidence.toFixed(0) + '%';
    deVal.textContent = match.deltaE.toFixed(2);
    rangeVal.textContent = `${range.lo.toFixed(2)} – ${range.hi.toFixed(2)}`;
    if (chartSourceVal) chartSourceVal.textContent = chartSourceText || 'Mặc định';
    confFill.style.width = confidence + '%';

    sampleSwatch.style.background = rgbToHex(correctedRgb);
    sampleHex.textContent = rgbToHex(correctedRgb).toUpperCase();
    bgSwatch.style.background = rgbToHex(backgroundRgb);
    bgHex.textContent = rgbToHex(backgroundRgb).toUpperCase();

    const time = new Date().toLocaleTimeString('vi-VN');
    logs.unshift({ time, label, rgb: correctedRgb, ph: match.ph, confidence, lightLevel: lighting.level });
    renderLog();

    capturing = false; // sẵn sàng cho lần "Quét mẫu khác" tiếp theo (bấm rescan mới chạy lại loop)
  }

  function resetReadoutToStale() {
    phValueEl.classList.add('stale');
    phValueEl.innerHTML = `— <span class="unit">pH</span>`;
    confVal.textContent = '—';
    deVal.textContent = '—';
    rangeVal.textContent = '—';
    if (chartSourceVal) chartSourceVal.textContent = 'Mặc định';
    confFill.style.width = '0%';
    sampleSwatch.style.background = '#eee';
    sampleHex.textContent = '—';
    bgSwatch.style.background = '#eee';
    bgHex.textContent = '—';
  }
  resetReadoutToStale();

  function renderLog() {
    if (logs.length === 0) {
      logList.textContent = 'Chưa có kết quả nào được tự động chụp.';
      return;
    }
    logList.innerHTML = logs.map((l, i) => `
      <div style="display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid var(--line);">
        <span style="width:14px; height:14px; border-radius:4px; background:${rgbToHex(l.rgb)}; flex:none; border:1px solid var(--line);"></span>
        <span style="flex:1;">#${logs.length - i} · ${l.label} · ${l.time} · ${l.lightLevel}</span>
        <b style="color:var(--teal-deep);">pH ${l.ph.toFixed(2)}</b>
      </div>
    `).join('');
  }
  clearLogBtn.addEventListener('click', () => { logs = []; renderLog(); });

  window.addEventListener('beforeunload', stopCamera);
})();
