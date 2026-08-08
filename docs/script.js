(() => {
  const { loadChart, saveChart, resetChart, matchPh, sampleCircleAverage, rgbToHex } = window.PHCore;

  const dropzone    = document.getElementById('dropzone');
  const fileInput   = document.getElementById('fileInput');
  const stage       = document.getElementById('stage');
  const emptyMsg    = document.getElementById('emptyMsg');
  const stageInner  = document.getElementById('stageInner');
  const canvas      = document.getElementById('canvas');
  const ctx         = canvas.getContext('2d', { willReadFrequently: true });
  const overlay     = document.getElementById('overlayCanvas');
  const octx        = overlay.getContext('2d');
  const reticle     = document.getElementById('reticle');
  const reticleHandle = document.getElementById('reticleHandle');
  const radiusBadge = document.getElementById('radiusBadge');
  const radiusSlider = document.getElementById('radiusSlider');
  const radiusVal   = document.getElementById('radiusVal');
  const lockBtn     = document.getElementById('lockBtn');
  const phValueEl   = document.getElementById('phValue');
  const confVal     = document.getElementById('confVal');
  const deVal       = document.getElementById('deVal');
  const confFill    = document.getElementById('confFill');
  const sampleSwatch = document.getElementById('sampleSwatch');
  const sampleHex   = document.getElementById('sampleHex');
  const matchHex    = document.getElementById('matchHex');
  const logList     = document.getElementById('logList');
  const clearLogBtn = document.getElementById('clearLogBtn');
  const zoomInBtn   = document.getElementById('zoomInBtn');
  const zoomOutBtn  = document.getElementById('zoomOutBtn');
  const resetViewBtn = document.getElementById('resetViewBtn');
  const clearDrawBtn = document.getElementById('clearDrawBtn');
  const calibTable  = document.getElementById('calibTable');
  const saveCalibBtn = document.getElementById('saveCalibBtn');
  const resetCalibBtn = document.getElementById('resetCalibBtn');
  const phStrip     = document.getElementById('phStrip');
  const modeTag     = document.getElementById('modeTag');
  const modePointBtn = document.getElementById('modePointBtn');
  const modeDrawBtn  = document.getElementById('modeDrawBtn');
  const modeAutoBtn  = document.getElementById('modeAutoBtn');
  const pointControls = document.getElementById('pointControls');
  const drawControls  = document.getElementById('drawControls');
  const autoControls  = document.getElementById('autoControls');
  const pixelCountEl  = document.getElementById('pixelCount');

  // ---- Chế độ tự động (click mẫu) ----
  const dbgObject     = document.getElementById('dbgObject');
  const dbgInner      = document.getElementById('dbgInner');
  const dbgBackground = document.getElementById('dbgBackground');
  const autoResult    = document.getElementById('autoResult');
  const autoError     = document.getElementById('autoError');
  const autoSwatchRaw = document.getElementById('autoSwatchRaw');
  const autoRawHex    = document.getElementById('autoRawHex');
  const autoSwatchBg  = document.getElementById('autoSwatchBg');
  const autoBgHex     = document.getElementById('autoBgHex');
  const autoSwatchCorrected = document.getElementById('autoSwatchCorrected');
  const autoCorrHex   = document.getElementById('autoCorrHex');
  const autoLightLevel = document.getElementById('autoLightLevel');
  const autoLightReason = document.getElementById('autoLightReason');
  const autoPhRange   = document.getElementById('autoPhRange');
  const autoChartSource = document.getElementById('autoChartSource');
  const useCalibToggle = document.getElementById('useCalibToggle');
  const copyAutoRgbBtn = document.getElementById('copyAutoRgbBtn');
  const copyAutoFeedback = document.getElementById('copyAutoFeedback');
  let lastAutoResult = null;

  let chart = loadChart();
  let img = null;
  let zoomFactor = 1;
  let baseScale = 1;
  let reticlePos = { x: 0, y: 0 };
  let radius = parseInt(radiusSlider.value, 10);
  let logs = [];
  let mode = 'point'; // 'point' | 'draw'
  let lastResult = null;

  /* ================= Canvas NGUỒN (độ phân giải gốc) =================
     Canvas hiển thị (canvas #canvas) có thể bị thu nhỏ để vừa khung xem,
     nhưng MỌI phép lấy màu đều đọc từ canvas nguồn này — giữ nguyên 100%
     điểm ảnh gốc của file ảnh, không bị mất dữ liệu do thu nhỏ/nearest-
     neighbor. Toạ độ kính ngắm / vùng vẽ (theo hệ hiển thị) được quy đổi
     sang hệ toạ độ ảnh gốc bằng factor() trước khi lấy mẫu. */
  const sourceCanvas = document.createElement('canvas');
  const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });

  function factor() { return baseScale * zoomFactor; }
  function toSourcePoint(p) { return { x: p.x / factor(), y: p.y / factor() }; }

  /* ================= pH strip legend ================= */
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

  /* ================= Calibration table ================= */
  function renderCalibTable() {
    calibTable.innerHTML = `<tr><th>pH</th><th>Màu</th><th>R</th><th>G</th><th>B</th></tr>`;
    chart.forEach((entry, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${entry.ph.toFixed(1)}</td>
        <td><input type="color" data-i="${i}" class="colorPick" value="${rgbToHex(entry.rgb)}"></td>
        <td><input type="number" data-i="${i}" data-c="0" class="chVal" min="0" max="255" value="${entry.rgb[0]}"></td>
        <td><input type="number" data-i="${i}" data-c="1" class="chVal" min="0" max="255" value="${entry.rgb[1]}"></td>
        <td><input type="number" data-i="${i}" data-c="2" class="chVal" min="0" max="255" value="${entry.rgb[2]}"></td>
      `;
      calibTable.appendChild(tr);
    });
    calibTable.querySelectorAll('.colorPick').forEach(inp => {
      inp.addEventListener('input', e => {
        const i = +e.target.dataset.i;
        const hex = e.target.value;
        chart[i].rgb = [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
        renderCalibTable();
        renderStrip();
      });
    });
    calibTable.querySelectorAll('.chVal').forEach(inp => {
      inp.addEventListener('input', e => {
        const i = +e.target.dataset.i, c = +e.target.dataset.c;
        chart[i].rgb[c] = Math.max(0, Math.min(255, +e.target.value));
        renderStrip();
      });
    });
  }
  renderCalibTable();

  saveCalibBtn.addEventListener('click', () => {
    saveChart(chart);
    saveCalibBtn.textContent = '✔ Đã lưu';
    setTimeout(() => saveCalibBtn.textContent = '💾 Lưu hiệu chỉnh', 1200);
    if (mode === 'point') updatePointReading();
  });
  resetCalibBtn.addEventListener('click', () => {
    resetChart();
    chart = loadChart();
    renderCalibTable();
    renderStrip();
    if (mode === 'point') updatePointReading();
  });

  /* ================= Upload ảnh ================= */
  ['dragenter', 'dragover'].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.remove('drag'); }));
  dropzone.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) loadImageFile(f); });
  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', e => { if (e.target.files[0]) loadImageFile(e.target.files[0]); });

  function loadImageFile(file) {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = e => {
      const image = new Image();
      image.onload = () => setupImage(image);
      image.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function setupImage(image) {
    img = image;
    emptyMsg.style.display = 'none';
    stageInner.style.display = 'inline-block';
    lockBtn.disabled = false;
    zoomFactor = 1;

    // Canvas nguồn: vẽ ảnh ở đúng 100% độ phân giải gốc (không co giãn) —
    // đây là nơi duy nhất được dùng để lấy màu, đảm bảo không mất dữ liệu.
    sourceCanvas.width = image.width;
    sourceCanvas.height = image.height;
    sourceCtx.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
    sourceCtx.drawImage(image, 0, 0);

    const maxW = 640;
    baseScale = image.width > maxW ? maxW / image.width : 1;
    renderCanvas();

    reticlePos = { x: canvas.width / 2, y: canvas.height / 2 };
    updateReticleVisual();
    clearDrawing();
    if (mode === 'point') updatePointReading();
  }

  function renderCanvas() {
    const s = factor();
    const w = Math.round(img.width * s);
    const h = Math.round(img.height * s);
    canvas.width = w; canvas.height = h;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    overlay.width = w; overlay.height = h;
    overlay.style.width = w + 'px'; overlay.style.height = h + 'px';
    // Canvas này CHỈ để hiển thị (việc lấy màu luôn đọc từ sourceCanvas).
    // Làm mượt khi thu nhỏ để nhìn đẹp hơn; tắt làm mượt khi phóng to để
    // thấy rõ từng điểm ảnh gốc lúc căn kính ngắm.
    ctx.imageSmoothingEnabled = s < 1;
    ctx.drawImage(img, 0, 0, w, h);
  }

  /* ================= Zoom ================= */
  zoomInBtn.addEventListener('click', () => { zoomFactor = Math.min(4, zoomFactor * 1.25); rescale(); });
  zoomOutBtn.addEventListener('click', () => { zoomFactor = Math.max(0.4, zoomFactor / 1.25); rescale(); });
  resetViewBtn.addEventListener('click', () => { zoomFactor = 1; rescale(); });

  function rescale() {
    if (!img) return;
    const relX = reticlePos.x / canvas.width;
    const relY = reticlePos.y / canvas.height;
    const oldFactor = factor();

    renderCanvas();

    reticlePos = { x: relX * canvas.width, y: relY * canvas.height };
    updateReticleVisual();

    // Quy đổi lại vùng đã khoanh (nếu có) sang toạ độ hiển thị mới thay vì
    // xoá đi — vì vùng khoanh được lưu theo toạ độ ảnh gốc nên không đổi,
    // chỉ cần vẽ lại đúng vị trí mới trên canvas hiển thị.
    if (points.length) {
      const newFactor = factor();
      points = points.map(p => {
        const src = { x: p.x / oldFactor, y: p.y / oldFactor };
        return { x: src.x * newFactor, y: src.y * newFactor };
      });
      redrawRegionOverlay();
    }

    if (mode === 'point') updatePointReading();
  }

  /* ================= Chuyển chế độ điểm / vẽ ================= */
  modePointBtn.addEventListener('click', () => setMode('point'));
  modeDrawBtn.addEventListener('click', () => setMode('draw'));
  modeAutoBtn.addEventListener('click', () => setMode('auto'));

  function setMode(next) {
    mode = next;
    const isPoint = mode === 'point';
    const isDraw = mode === 'draw';
    const isAuto = mode === 'auto';
    modePointBtn.classList.toggle('active', isPoint);
    modeDrawBtn.classList.toggle('active', isDraw);
    modeAutoBtn.classList.toggle('active', isAuto);
    modeTag.textContent = isPoint ? 'Chế độ điểm' : isDraw ? 'Chế độ vẽ vùng' : 'Chế độ tự động';
    pointControls.style.display = isPoint ? '' : 'none';
    drawControls.style.display = isDraw ? '' : 'none';
    autoControls.style.display = isAuto ? '' : 'none';
    clearDrawBtn.style.display = isDraw ? '' : 'none';
    reticle.style.display = isPoint ? '' : 'none';
    canvas.classList.toggle('point-cursor', isPoint || isAuto);
    canvas.classList.toggle('draw-cursor', isDraw);
    // Overlay chỉ bắt sự kiện chuột ở chế độ vẽ (khoảnh vùng); ở chế
    // độ tự động overlay chỉ dùng để vẽ debug mask, click vẫn xuyên
    // qua canvas bên dưới.
    overlay.style.pointerEvents = isDraw ? 'auto' : 'none';
    if (isPoint) {
      if (img) updatePointReading();
    } else if (isAuto) {
      octx.clearRect(0, 0, overlay.width, overlay.height);
      autoError.style.display = 'none';
      if (!lastAutoResult) resetReadoutToStale();
    } else {
      // Sang chế độ vẽ: nếu đã có vùng khoanh từ trước thì giữ nguyên
      // kết quả đang hiển thị, không reset về "—".
      if (!points.length) resetReadoutToStale();
    }
  }
  overlay.style.pointerEvents = 'none';

  /* ================= Chế độ điểm: kéo kính ngắm ================= */
  function updateReticleVisual() {
    const d = Math.max(radius * 2, 14);
    reticle.style.width = d + 'px';
    reticle.style.height = d + 'px';
    reticle.style.left = reticlePos.x + 'px';
    reticle.style.top = reticlePos.y + 'px';
    radiusBadge.textContent = 'r = ' + radius + 'px';
  }

  function toCanvasPoint(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    let x = (clientX - rect.left) * scaleX;
    let y = (clientY - rect.top) * scaleY;
    x = Math.max(0, Math.min(canvas.width, x));
    y = Math.max(0, Math.min(canvas.height, y));
    return { x, y };
  }

  let draggingReticle = false;
  reticleHandle.addEventListener('pointerdown', e => {
    if (mode !== 'point') return;
    draggingReticle = true;
    reticle.classList.add('dragging');
    reticleHandle.setPointerCapture(e.pointerId);
  });
  reticleHandle.addEventListener('pointermove', e => {
    if (!draggingReticle) return;
    reticlePos = toCanvasPoint(e.clientX, e.clientY);
    updateReticleVisual();
    updatePointReading();
  });
  ['pointerup', 'pointercancel'].forEach(ev => reticleHandle.addEventListener(ev, () => {
    draggingReticle = false;
    reticle.classList.remove('dragging');
  }));

  canvas.addEventListener('pointerdown', e => {
    if (mode === 'point') {
      if (!img) return;
      reticlePos = toCanvasPoint(e.clientX, e.clientY);
      updateReticleVisual();
      updatePointReading();
    } else if (mode === 'auto') {
      if (!img) return;
      const cp = toCanvasPoint(e.clientX, e.clientY);
      const src = toSourcePoint(cp);
      runAutoAnalysis(Math.round(src.x), Math.round(src.y));
    }
  });

  /* ================= Chế độ tự động: click vào mẫu ================= */
  [dbgObject, dbgInner, dbgBackground].forEach(cb => {
    cb.addEventListener('change', () => { if (lastAutoResult) renderAutoDebugMasks(lastAutoResult); });
  });
  if (useCalibToggle) {
    useCalibToggle.addEventListener('change', () => { if (lastAutoResult) applyAutoReading(lastAutoResult); });
  }

  async function copyTextToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      document.body.removeChild(ta);
      return ok;
    }
  }

  if (copyAutoRgbBtn) {
    copyAutoRgbBtn.addEventListener('click', async () => {
      if (!lastAutoResult || !lastAutoResult.sample) return;
      const { rawRgb, backgroundRgb } = lastAutoResult.sample;
      const text = `sampleRGB: [${rawRgb.join(', ')}], whiteRGB: [${backgroundRgb.join(', ')}]`;
      const ok = await copyTextToClipboard(text);
      copyAutoFeedback.textContent = ok ? `✔ Đã copy: ${text}` : 'Không copy được — trình duyệt chặn Clipboard API.';
      copyAutoFeedback.style.color = ok ? 'var(--teal-deep)' : 'var(--coral)';
      copyAutoFeedback.style.display = '';
      clearTimeout(copyAutoRgbBtn._fbTimer);
      copyAutoRgbBtn._fbTimer = setTimeout(() => { copyAutoFeedback.style.display = 'none'; }, 3000);
    });
  }

  function runAutoAnalysis(srcX, srcY) {
    const result = window.PHVision.analyzeClick(sourceCanvas, srcX, srcY, chart);
    autoError.style.display = 'none';
    autoResult.style.display = 'none';
    octx.clearRect(0, 0, overlay.width, overlay.height);

    if (!result.ok) {
      lastAutoResult = null;
      autoError.textContent = '⚠️ ' + result.reason;
      autoError.style.display = '';
      resetReadoutToStale();
      return;
    }

    lastAutoResult = result;
    renderAutoDebugMasks(result);
    applyAutoReading(result);
  }

  function renderAutoDebugMasks(result) {
    octx.clearRect(0, 0, overlay.width, overlay.height);
    const { work } = result;
    const draw = (c) => octx.drawImage(c, 0, 0, work.w, work.h, 0, 0, overlay.width, overlay.height);
    if (dbgBackground.checked) draw(result.debugMasks.backgroundCanvas);
    if (dbgObject.checked) draw(result.debugMasks.objectCanvas);
    if (dbgInner.checked) draw(result.debugMasks.innerCanvas);
  }

  function applyAutoReading(result) {
    const { sample, lighting } = result;
    let match = result.match;
    let confidence = result.confidence;
    let range = result.range;
    let chartSourceText = 'Mặc định';

    // Nếu người dùng bật "Dùng thang đo Calibration tự tạo": không so trực
    // tiếp RGB thô test với calibration — sample.correctedRgb ở đây ĐÃ được
    // analyzeClick() hiệu chỉnh về đúng reference white của profile đang dùng,
    // và PHCalib.matchAgainstCalibration() cũng quy mọi điểm calibration về
    // chính reference white đó trước khi so — đúng pipeline yêu cầu #7/#9.
    if (useCalibToggle && useCalibToggle.checked && window.PHCalib) {
      const points = window.PHCalib.loadCalibration();
      const calibMatch = window.PHCalib.matchAgainstCalibration(sample.correctedRgb, points, result.profile.referenceWhite);
      if (calibMatch.ok) {
        match = { ph: calibMatch.ph, deltaE: calibMatch.deltaE, matchedRgb: calibMatch.matchedRgb };
        confidence = Math.max(0, Math.min(100, calibMatch.confidence * lighting.factor));
        range = window.PHVision.phRangeFromConfidence(calibMatch.ph, confidence);
        chartSourceText = `Calibration (${calibMatch.uniquePhCount} mốc)`;
      } else {
        chartSourceText = `Mặc định (${calibMatch.reason})`;
      }
    }

    lastResult = {
      rgb: sample.correctedRgb,
      result: { ph: match.ph, confidence, deltaE: match.deltaE, matchedRgb: match.matchedRgb },
    };

    phValueEl.classList.remove('stale');
    phValueEl.innerHTML = `${match.ph.toFixed(2)} <span class="unit">pH</span>`;
    confVal.textContent = confidence.toFixed(0) + '%';
    deVal.textContent = match.deltaE.toFixed(2);
    confFill.style.width = confidence + '%';

    sampleSwatch.style.background = rgbToHex(sample.correctedRgb);
    sampleHex.textContent = rgbToHex(sample.correctedRgb).toUpperCase();
    matchHex.textContent = rgbToHex(match.matchedRgb).toUpperCase();

    autoSwatchRaw.style.background = rgbToHex(sample.rawRgb);
    autoRawHex.textContent = rgbToHex(sample.rawRgb).toUpperCase();
    autoSwatchBg.style.background = rgbToHex(sample.backgroundRgb);
    autoBgHex.textContent = rgbToHex(sample.backgroundRgb).toUpperCase();
    autoSwatchCorrected.style.background = rgbToHex(sample.correctedRgb);
    autoCorrHex.textContent = rgbToHex(sample.correctedRgb).toUpperCase();

    autoLightLevel.textContent = lighting.level;
    autoLightReason.textContent = lighting.reason;
    autoPhRange.textContent = `${range.lo.toFixed(2)} – ${range.hi.toFixed(2)} (±${range.margin})`;
    if (autoChartSource) autoChartSource.textContent = chartSourceText;
    autoResult.style.display = '';
  }

  radiusSlider.addEventListener('input', () => {
    radius = parseInt(radiusSlider.value, 10);
    radiusVal.textContent = radius + 'px';
    updateReticleVisual();
    if (mode === 'point') updatePointReading();
  });
  radiusVal.textContent = radius + 'px';

  function updatePointReading() {
    if (!img) return;
    // Quy đổi tâm + bán kính từ toạ độ hiển thị sang toạ độ ẢNH GỐC rồi mới
    // lấy mẫu — đảm bảo trung bình màu tính trên đầy đủ điểm ảnh gốc.
    const src = toSourcePoint(reticlePos);
    const srcRadius = Math.max(1, radius / factor());
    const rgb = sampleCircleAverage(sourceCtx, src.x, src.y, srcRadius);
    applyReading(rgb);
  }

  /* ================= Chế độ vẽ vùng ================= */
  let drawing = false;
  let points = []; // toạ độ theo hệ hiển thị hiện tại (được quy đổi khi zoom)

  overlay.addEventListener('pointerdown', e => {
    if (mode !== 'draw' || !img) return;
    drawing = true;
    points = [toCanvasPoint(e.clientX, e.clientY)];
    overlay.setPointerCapture(e.pointerId);
    drawPathPreview();
  });
  overlay.addEventListener('pointermove', e => {
    if (!drawing) return;
    const p = toCanvasPoint(e.clientX, e.clientY);
    const last = points[points.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 2) points.push(p);
    drawPathPreview();
  });
  ['pointerup', 'pointercancel'].forEach(ev => overlay.addEventListener(ev, () => {
    if (!drawing) return;
    drawing = false;
    if (points.length >= 3) {
      finalizeRegion();
    } else {
      clearDrawing();
    }
  }));

  function drawPathPreview() {
    octx.clearRect(0, 0, overlay.width, overlay.height);
    if (points.length < 2) return;
    octx.beginPath();
    octx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) octx.lineTo(points[i].x, points[i].y);
    octx.closePath();
    octx.fillStyle = 'rgba(79,163,147,0.22)';
    octx.fill();
    octx.strokeStyle = '#4fa393';
    octx.lineWidth = 2;
    octx.setLineDash([5, 4]);
    octx.stroke();
  }

  // Vẽ lại lớp phủ của vùng ĐÃ CHỐT (dùng khi phóng to/thu nhỏ ảnh, để giữ
  // nguyên vùng đã khoanh thay vì phải xoá và vẽ lại từ đầu).
  function redrawRegionOverlay() {
    drawPathPreview();
    if (!drawing) {
      octx.fillStyle = 'rgba(232,161,91,0.20)';
      octx.fill();
    }
  }

  function clearDrawing() {
    drawing = false;
    points = [];
    octx.clearRect(0, 0, overlay.width, overlay.height);
    pixelCountEl.textContent = '—';
  }
  clearDrawBtn.addEventListener('click', () => { clearDrawing(); resetReadoutToStale(); });

  function finalizeRegion() {
    // Vẽ vùng đã khoanh cố định lên overlay (lớp phủ hiển thị)
    redrawRegionOverlay();

    // Quy đổi các điểm khoanh (đang ở hệ toạ độ hiển thị) sang hệ toạ độ
    // ẢNH GỐC, rồi dựng mặt nạ + lấy màu trực tiếp trên canvas nguồn full
    // độ phân giải — tránh mất dữ liệu màu do ảnh hiển thị bị thu nhỏ.
    const srcPoints = points.map(toSourcePoint);

    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = sourceCanvas.width;
    maskCanvas.height = sourceCanvas.height;
    const mctx = maskCanvas.getContext('2d');
    mctx.beginPath();
    mctx.moveTo(srcPoints[0].x, srcPoints[0].y);
    for (let i = 1; i < srcPoints.length; i++) mctx.lineTo(srcPoints[i].x, srcPoints[i].y);
    mctx.closePath();
    mctx.fillStyle = '#fff';
    mctx.fill();

    const xs = srcPoints.map(p => p.x), ys = srcPoints.map(p => p.y);
    const x0 = Math.max(0, Math.floor(Math.min(...xs)));
    const y0 = Math.max(0, Math.floor(Math.min(...ys)));
    const x1 = Math.min(sourceCanvas.width, Math.ceil(Math.max(...xs)));
    const y1 = Math.min(sourceCanvas.height, Math.ceil(Math.max(...ys)));
    const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);

    const maskData = mctx.getImageData(x0, y0, w, h).data;
    const imgData = sourceCtx.getImageData(x0, y0, w, h).data;

    let rSum = 0, gSum = 0, bSum = 0, count = 0;
    for (let i = 0; i < w * h; i++) {
      if (maskData[i * 4 + 3] < 128) continue; // ngoài vùng khoanh
      rSum += imgData[i * 4];
      gSum += imgData[i * 4 + 1];
      bSum += imgData[i * 4 + 2];
      count++;
    }

    if (count === 0) { clearDrawing(); return; }
    const rgb = [Math.round(rSum / count), Math.round(gSum / count), Math.round(bSum / count)];
    pixelCountEl.textContent = count.toLocaleString('vi-VN') + ' px';
    applyReading(rgb);
  }

  /* ================= Đọc & hiển thị kết quả (dùng chung) ================= */
  function applyReading(rgb) {
    const result = matchPh(rgb, chart);
    lastResult = { rgb, result };

    phValueEl.classList.remove('stale');
    phValueEl.innerHTML = `${result.ph.toFixed(2)} <span class="unit">pH</span>`;
    confVal.textContent = result.confidence.toFixed(0) + '%';
    deVal.textContent = result.deltaE.toFixed(2);
    confFill.style.width = result.confidence + '%';

    sampleSwatch.style.background = rgbToHex(rgb);
    sampleHex.textContent = rgbToHex(rgb).toUpperCase();
    matchHex.textContent = rgbToHex(result.matchedRgb).toUpperCase();
  }

  function resetReadoutToStale() {
    lastResult = null;
    phValueEl.classList.add('stale');
    phValueEl.innerHTML = `— <span class="unit">pH</span>`;
    confVal.textContent = '—';
    deVal.textContent = '—';
    confFill.style.width = '0%';
    sampleSwatch.style.background = '#eee';
    sampleHex.textContent = '—';
    matchHex.textContent = '—';
  }

  /* ================= Log điểm đo ================= */
  lockBtn.addEventListener('click', () => {
    if (!lastResult) return;
    const time = new Date().toLocaleTimeString('vi-VN');
    const label = mode === 'draw' ? 'Vùng vẽ' : mode === 'auto' ? 'Tự động' : 'Điểm';
    logs.unshift({ time, label, ...lastResult });
    renderLog();
  });
  clearLogBtn.addEventListener('click', () => { logs = []; renderLog(); });

  function renderLog() {
    if (logs.length === 0) {
      logList.textContent = 'Chưa có điểm đo nào được chốt. Bấm "Chốt điểm đo" để ghi lại kết quả.';
      return;
    }
    logList.innerHTML = logs.map((l, i) => `
      <div style="display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid var(--line);">
        <span style="width:14px; height:14px; border-radius:4px; background:${rgbToHex(l.rgb)}; flex:none; border:1px solid var(--line);"></span>
        <span style="flex:1;">#${logs.length - i} · ${l.label} · ${l.time}</span>
        <b style="color:var(--teal-deep);">pH ${l.result.ph.toFixed(2)}</b>
      </div>
    `).join('');
  }
})();
