/* ============================================================
   calib.js — UI logic cho trang calibration.html
   ============================================================
   Bổ sung THÊM vào QuetpH, KHÔNG sửa phcore.js / phvision.js /
   script.js. Chỉ dùng PHVision.analyzeClick() để quét mẫu (tái sử
   dụng đúng pipeline object/inner/background/white-balance đã có),
   và PHCalib để lưu/đọc/export calibration points.
   ============================================================ */

(() => {
  const PHCore = window.PHCore;
  const PHVision = window.PHVision;
  const PHCalib = window.PHCalib;

  const dropzone   = document.getElementById('dropzone');
  const fileInput  = document.getElementById('fileInput');
  const stage      = document.getElementById('stage');
  const emptyMsg   = document.getElementById('emptyMsg');
  const stageInner = document.getElementById('stageInner');
  const canvas     = document.getElementById('canvas');
  const ctx        = canvas.getContext('2d', { willReadFrequently: true });
  const overlay    = document.getElementById('overlayCanvas');
  const octx       = overlay.getContext('2d');
  const camTag     = document.getElementById('camTag');

  const dbgObject     = document.getElementById('dbgObject');
  const dbgInner      = document.getElementById('dbgInner');
  const dbgBackground = document.getElementById('dbgBackground');

  const scanError   = document.getElementById('scanError');
  const scanResult  = document.getElementById('scanResult');
  const swatchCore  = document.getElementById('swatchCore');
  const coreRgbText = document.getElementById('coreRgbText');
  const swatchWhite = document.getElementById('swatchWhite');
  const whiteRgbText = document.getElementById('whiteRgbText');
  const qualityBadge = document.getElementById('qualityBadge');
  const qualityIssues = document.getElementById('qualityIssues');
  const phInput     = document.getElementById('phInput');
  const addPointBtn = document.getElementById('addPointBtn');

  const calibEmpty     = document.getElementById('calibEmpty');
  const calibChartTable = document.getElementById('calibChartTable');
  const calibChartBody  = document.getElementById('calibChartBody');
  const pointCountTag   = document.getElementById('pointCountTag');
  const copyJsonBtn = document.getElementById('copyJsonBtn');
  const copyJsBtn   = document.getElementById('copyJsBtn');
  const clearAllBtn = document.getElementById('clearAllBtn');
  const copyFeedback = document.getElementById('copyFeedback');

  const sourceCanvas = document.createElement('canvas');
  const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });

  let img = null;
  let baseScale = 1;
  let lastScan = null; // kết quả analyzeClick() gần nhất (nếu ok)
  let lastQuality = null;
  let editingId = null; // id điểm đang sửa (chỉ 1 điểm cùng lúc)

  camTag.textContent = PHVision.getActiveProfileId();

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

    sourceCanvas.width = image.width;
    sourceCanvas.height = image.height;
    sourceCtx.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
    sourceCtx.drawImage(image, 0, 0);

    const maxW = 640;
    baseScale = image.width > maxW ? maxW / image.width : 1;
    const w = Math.round(image.width * baseScale);
    const h = Math.round(image.height * baseScale);
    canvas.width = w; canvas.height = h;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    overlay.width = w; overlay.height = h;
    overlay.style.width = w + 'px'; overlay.style.height = h + 'px';
    ctx.imageSmoothingEnabled = baseScale < 1;
    ctx.drawImage(img, 0, 0, w, h);

    octx.clearRect(0, 0, overlay.width, overlay.height);
    hideScanResult();
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

  canvas.addEventListener('pointerdown', e => {
    if (!img) return;
    const cp = toCanvasPoint(e.clientX, e.clientY);
    const srcX = Math.round(cp.x / baseScale);
    const srcY = Math.round(cp.y / baseScale);
    runScan(srcX, srcY);
  });

  [dbgObject, dbgInner, dbgBackground].forEach(cb => {
    cb.addEventListener('change', () => { if (lastScan) renderDebugMasks(lastScan); });
  });

  function runScan(srcX, srcY) {
    const chart = PHCore.loadChart(); // chỉ để analyzeClick() có tham số hợp lệ; Calibration không dùng field match
    const result = PHVision.analyzeClick(sourceCanvas, srcX, srcY, chart);

    octx.clearRect(0, 0, overlay.width, overlay.height);
    scanError.style.display = 'none';

    if (!result.ok) {
      lastScan = null;
      hideScanResult();
      scanError.textContent = '⚠️ ' + result.reason;
      scanError.style.display = '';
      return;
    }

    lastScan = result;
    renderDebugMasks(result);
    showScanResult(result);
  }

  function renderDebugMasks(result) {
    octx.clearRect(0, 0, overlay.width, overlay.height);
    const { work } = result;
    const draw = (c) => octx.drawImage(c, 0, 0, work.w, work.h, 0, 0, overlay.width, overlay.height);
    if (dbgBackground.checked) draw(result.debugMasks.backgroundCanvas);
    if (dbgObject.checked) draw(result.debugMasks.objectCanvas);
    if (dbgInner.checked) draw(result.debugMasks.innerCanvas);
  }

  function showScanResult(result) {
    const { sample } = result;
    const coreRgb = sample.rawRgb;
    const whiteRgb = sample.backgroundRgb;

    swatchCore.style.background = PHCore.rgbToHex(coreRgb);
    coreRgbText.textContent = `R: ${coreRgb[0]}  G: ${coreRgb[1]}  B: ${coreRgb[2]}`;
    swatchWhite.style.background = PHCore.rgbToHex(whiteRgb);
    whiteRgbText.textContent = `R: ${whiteRgb[0]}  G: ${whiteRgb[1]}  B: ${whiteRgb[2]}`;

    lastQuality = PHCalib.assessQuality(result);
    renderQuality(lastQuality);

    scanResult.style.display = '';
    updateAddButtonState();
  }

  function renderQuality(quality) {
    const isGood = quality.overall === 'GOOD';
    qualityBadge.textContent = isGood ? '✓ GOOD' : '⚠ WARNING';
    qualityBadge.style.color = isGood ? 'var(--teal-deep)' : 'var(--amber)';
    qualityBadge.style.borderColor = isGood ? '#cfe6df' : '#f1ddc0';
    qualityBadge.style.background = isGood ? 'var(--teal-soft)' : 'var(--amber-soft)';
    qualityIssues.innerHTML = quality.issues.map(i => `<li>${i.message}</li>`).join('');
  }

  function hideScanResult() {
    lastScan = null;
    lastQuality = null;
    scanResult.style.display = 'none';
  }

  function updateAddButtonState() {
    const phOk = phInput.value !== '' && Number.isFinite(+phInput.value) && +phInput.value >= 0 && +phInput.value <= 14;
    addPointBtn.disabled = !(lastScan && phOk);
  }
  phInput.addEventListener('input', updateAddButtonState);

  addPointBtn.addEventListener('click', () => {
    if (!lastScan) return;
    const ph = +phInput.value;
    if (!Number.isFinite(ph) || ph < 0 || ph > 14) return;

    // Nếu quality WARNING, xác nhận lại với người dùng trước khi lưu —
    // không tự động lưu dữ liệu xấu mà không báo (yêu cầu #15).
    if (lastQuality && lastQuality.overall === 'WARNING') {
      const msg = 'Lần quét này có cảnh báo chất lượng:\n\n' +
        lastQuality.issues.map(i => '• ' + i.message).join('\n') +
        '\n\nVẫn lưu điểm calibration này?';
      if (!window.confirm(msg)) return;
    }

    PHCalib.addCalibrationPoint({
      ph,
      sampleRgb: lastScan.sample.rawRgb,
      whiteRgb: lastScan.sample.backgroundRgb,
      camera: PHVision.getActiveProfileId(),
      quality: lastQuality ? lastQuality.overall : null,
    });

    phInput.value = '';
    hideScanResult();
    octx.clearRect(0, 0, overlay.width, overlay.height);
    renderChart();
  });

  /* ================= Bảng Calibration Chart ================= */
  function renderChart() {
    const points = [...PHCalib.loadCalibration()].sort((a, b) => a.ph - b.ph);
    pointCountTag.textContent = points.length + ' mốc';

    if (points.length === 0) {
      calibEmpty.style.display = '';
      calibChartTable.style.display = 'none';
      return;
    }
    calibEmpty.style.display = 'none';
    calibChartTable.style.display = '';

    calibChartBody.innerHTML = '';
    points.forEach(p => {
      const tr = document.createElement('tr');
      if (p.id === editingId) {
        tr.innerHTML = editRowHtml(p);
      } else {
        tr.innerHTML = viewRowHtml(p);
      }
      calibChartBody.appendChild(tr);
    });

    if (editingId != null) wireEditRow();
    wireViewRowButtons();
  }

  function swatchHtml(rgb) {
    return `<span style="display:inline-block;width:14px;height:14px;border-radius:4px;vertical-align:middle;margin-right:6px;border:1px solid var(--line);background:${PHCore.rgbToHex(rgb)};"></span>`;
  }

  function viewRowHtml(p) {
    const status = p.quality === 'WARNING' ? '<span class="pill" style="color:var(--amber);border-color:#f1ddc0;background:var(--amber-soft);">⚠ WARNING</span>'
      : p.quality === 'GOOD' ? '<span class="pill" style="color:var(--teal-deep);border-color:#cfe6df;background:var(--teal-soft);">✓ GOOD</span>'
      : '<span class="pill">—</span>';
    return `
      <td>${p.ph.toFixed(2)}</td>
      <td>${swatchHtml(p.sampleRgb)}${p.sampleRgb.join(', ')}</td>
      <td>${swatchHtml(p.whiteRgb)}${p.whiteRgb.join(', ')}</td>
      <td>${status}</td>
      <td>
        <button class="ghost editBtn" data-id="${p.id}" style="padding:4px 8px; font-size:11px;">Sửa</button>
        <button class="ghost deleteBtn" data-id="${p.id}" style="padding:4px 8px; font-size:11px; color:var(--coral);">Xoá</button>
      </td>`;
  }

  function editRowHtml(p) {
    return `
      <td><input type="number" step="0.01" min="0" max="14" id="editPh" value="${p.ph}" style="width:56px;"></td>
      <td>
        <input type="number" min="0" max="255" id="editSr" value="${p.sampleRgb[0]}" style="width:44px;">
        <input type="number" min="0" max="255" id="editSg" value="${p.sampleRgb[1]}" style="width:44px;">
        <input type="number" min="0" max="255" id="editSb" value="${p.sampleRgb[2]}" style="width:44px;">
      </td>
      <td>
        <input type="number" min="0" max="255" id="editWr" value="${p.whiteRgb[0]}" style="width:44px;">
        <input type="number" min="0" max="255" id="editWg" value="${p.whiteRgb[1]}" style="width:44px;">
        <input type="number" min="0" max="255" id="editWb" value="${p.whiteRgb[2]}" style="width:44px;">
      </td>
      <td>—</td>
      <td>
        <button class="primary saveEditBtn" data-id="${p.id}" style="padding:4px 8px; font-size:11px;">Lưu</button>
        <button class="ghost cancelEditBtn" style="padding:4px 8px; font-size:11px;">Huỷ</button>
      </td>`;
  }

  function wireViewRowButtons() {
    calibChartBody.querySelectorAll('.editBtn').forEach(btn => {
      btn.addEventListener('click', () => { editingId = btn.dataset.id; renderChart(); });
    });
    calibChartBody.querySelectorAll('.deleteBtn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!window.confirm('Xoá mốc calibration này?')) return;
        PHCalib.deleteCalibrationPoint(btn.dataset.id);
        renderChart();
      });
    });
  }

  function wireEditRow() {
    const saveBtn = calibChartBody.querySelector('.saveEditBtn');
    const cancelBtn = calibChartBody.querySelector('.cancelEditBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', () => { editingId = null; renderChart(); });
    if (saveBtn) saveBtn.addEventListener('click', () => {
      const id = saveBtn.dataset.id;
      const ph = +document.getElementById('editPh').value;
      const sampleRgb = ['editSr', 'editSg', 'editSb'].map(id2 => Math.max(0, Math.min(255, +document.getElementById(id2).value)));
      const whiteRgb = ['editWr', 'editWg', 'editWb'].map(id2 => Math.max(0, Math.min(255, +document.getElementById(id2).value)));
      if (!Number.isFinite(ph) || ph < 0 || ph > 14) { window.alert('pH phải trong khoảng 0–14.'); return; }
      PHCalib.updateCalibrationPoint(id, { ph, sampleRgb, whiteRgb });
      editingId = null;
      renderChart();
    });
  }

  /* ================= Copy / Xoá toàn bộ ================= */
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // Fallback cho trình duyệt/context không cho phép Clipboard API
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

  function showCopyFeedback(msg) {
    copyFeedback.textContent = msg;
    copyFeedback.style.display = '';
    setTimeout(() => { copyFeedback.style.display = 'none'; }, 2000);
  }

  copyJsonBtn.addEventListener('click', async () => {
    const points = PHCalib.loadCalibration();
    if (!points.length) { showCopyFeedback('Chưa có mốc calibration nào để copy.'); return; }
    const ok = await copyText(PHCalib.exportAsJson(points));
    showCopyFeedback(ok ? '✔ Đã copy JSON vào clipboard.' : 'Không copy được — trình duyệt chặn Clipboard API.');
  });

  copyJsBtn.addEventListener('click', async () => {
    const points = PHCalib.loadCalibration();
    if (!points.length) { showCopyFeedback('Chưa có mốc calibration nào để copy.'); return; }
    const ok = await copyText(PHCalib.exportAsJavaScript(points));
    showCopyFeedback(ok ? '✔ Đã copy JavaScript vào clipboard.' : 'Không copy được — trình duyệt chặn Clipboard API.');
  });

  clearAllBtn.addEventListener('click', () => {
    const points = PHCalib.loadCalibration();
    if (!points.length) return;
    if (!window.confirm(`Xoá toàn bộ ${points.length} mốc calibration? Hành động này không thể hoàn tác.`)) return;
    PHCalib.clearAllCalibration();
    renderChart();
  });

  renderChart();
})();
