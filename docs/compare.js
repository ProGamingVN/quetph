(() => {
  const PHCore = window.PHCore;
  const PHVision = window.PHVision;
  const { loadChart, matchPh, sampleCircleAverage, rgbToHex, buildFineTable } = PHCore;
  const chart = loadChart();

  // Kiểu lấy mẫu áp dụng CHUNG cho cả 3 khung A/B/C: 'point' (kính ngắm, lấy
  // trung bình thô, KHÔNG hiệu chỉnh ánh sáng) hoặc 'auto' (click vào mẫu —
  // tự tìm nền trắng xung quanh + hiệu chỉnh von Kries, giống hệt pipeline
  // của chế độ Tự động ở trang Quét mẫu). Mặc định dùng 'auto' vì đây chính
  // là nguyên nhân khiến 2 ảnh CÙNG 1 mẫu nhưng chụp khác điều kiện sáng lại
  // ra pH lệch nhau nhiều ở chế độ Điểm cũ (không có hiệu chỉnh ánh sáng).
  let sampleMode = 'auto';

  /* ---------- Bộ khung xử lý cho mỗi khung ảnh (A / B / C) ---------- */
  function createStage(prefix) {
    const dz = document.getElementById('dz' + prefix);
    const fileInput = dz.querySelector('input[type=file]');
    const emptyMsg = document.getElementById('empty' + prefix);
    const stageInner = document.getElementById('stageInner' + prefix);
    const canvas = document.getElementById('canvas' + prefix);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const overlay = document.getElementById('overlay' + prefix);
    const octx = overlay.getContext('2d');
    const reticle = document.getElementById('reticle' + prefix);
    const handle = document.getElementById('handle' + prefix);
    const swatch = document.getElementById('swatch' + prefix);
    const hexEl = document.getElementById('hex' + prefix);
    const phEl = document.getElementById('ph' + prefix);
    const autoInfo = document.getElementById('autoInfo' + prefix);
    const swatchWhite = document.getElementById('swatchWhite' + prefix);
    const whiteHexEl = document.getElementById('whiteHex' + prefix);
    const lightEl = document.getElementById('light' + prefix);
    const autoError = document.getElementById('autoError' + prefix);

    // Canvas NGUỒN: giữ nguyên 100% độ phân giải gốc của ảnh, tách biệt
    // khỏi canvas hiển thị (canvas ở trên có thể bị thu nhỏ để vừa khung
    // xem). Mọi phép lấy màu đều đọc từ đây để không mất dữ liệu màu.
    const sourceCanvas = document.createElement('canvas');
    const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });

    const state = { img: null, rgb: null, ph: null, pos: { x: 0, y: 0 }, radius: 12, scale: 1 };

    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
    dz.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) load(f); });
    dz.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', e => { if (e.target.files[0]) load(e.target.files[0]); });

    function load(file) {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = e => {
        const image = new Image();
        image.onload = () => setup(image);
        image.src = e.target.result;
      };
      reader.readAsDataURL(file);
    }

    function setup(image) {
      state.img = image;
      emptyMsg.style.display = 'none';
      stageInner.style.display = 'inline-block';

      // Vẽ ảnh 1:1 lên canvas nguồn (không co giãn) để lấy màu chính xác
      sourceCanvas.width = image.width;
      sourceCanvas.height = image.height;
      sourceCtx.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
      sourceCtx.drawImage(image, 0, 0);

      const maxW = 460;
      const s = image.width > maxW ? maxW / image.width : 1;
      state.scale = s;
      const w = Math.round(image.width * s), h = Math.round(image.height * s);
      canvas.width = w; canvas.height = h;
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      overlay.width = w; overlay.height = h;
      overlay.style.width = w + 'px'; overlay.style.height = h + 'px';
      // Canvas này chỉ để hiển thị — không dùng để lấy màu.
      ctx.imageSmoothingEnabled = s < 1;
      ctx.drawImage(image, 0, 0, w, h);
      octx.clearRect(0, 0, overlay.width, overlay.height);
      autoError.style.display = 'none';
      autoInfo.style.display = 'none';

      applyModeVisual();

      if (sampleMode === 'point') {
        state.pos = { x: w / 2, y: h / 2 };
        updateReticleVisual();
        samplePoint();
      } else {
        clearReading();
      }
    }

    function updateReticleVisual() {
      const d = Math.max(state.radius * 2, 14);
      reticle.style.width = d + 'px';
      reticle.style.height = d + 'px';
      reticle.style.left = state.pos.x + 'px';
      reticle.style.top = state.pos.y + 'px';
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

    let dragging = false;
    handle.addEventListener('pointerdown', e => {
      if (sampleMode !== 'point') return;
      dragging = true; reticle.classList.add('dragging'); handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', e => {
      if (!dragging) return;
      state.pos = toCanvasPoint(e.clientX, e.clientY);
      updateReticleVisual();
      samplePoint();
    });
    ['pointerup', 'pointercancel'].forEach(ev => handle.addEventListener(ev, () => { dragging = false; reticle.classList.remove('dragging'); }));

    canvas.addEventListener('pointerdown', e => {
      if (!state.img) return;
      const cp = toCanvasPoint(e.clientX, e.clientY);
      if (sampleMode === 'point') {
        state.pos = cp;
        updateReticleVisual();
        samplePoint();
      } else {
        const srcX = Math.round(cp.x / state.scale);
        const srcY = Math.round(cp.y / state.scale);
        sampleAuto(srcX, srcY);
      }
    });

    /* ---------- Chế độ Điểm: trung bình thô tại vị trí kính ngắm ---------- */
    function samplePoint() {
      if (!state.img) return;
      // Quy đổi tâm + bán kính từ toạ độ hiển thị sang toạ độ ẢNH GỐC rồi
      // mới lấy mẫu trên canvas nguồn full độ phân giải.
      const srcX = state.pos.x / state.scale;
      const srcY = state.pos.y / state.scale;
      const srcRadius = Math.max(1, state.radius / state.scale);
      const rgb = sampleCircleAverage(sourceCtx, srcX, srcY, srcRadius);
      const result = matchPh(rgb, chart);
      state.rgb = rgb;
      state.ph = result.ph;
      autoInfo.style.display = 'none';
      autoError.style.display = 'none';
      swatch.style.background = rgbToHex(rgb);
      hexEl.textContent = rgbToHex(rgb).toUpperCase();
      phEl.textContent = result.ph.toFixed(2);
      onUpdate();
    }

    /* ---------- Chế độ Tự động: click vào mẫu ----------
       Dùng lại NGUYÊN pipeline analyzeClick() của trang Quét mẫu: tự dò
       vùng lõi mẫu, tự tìm nền trắng xung quanh NGAY LÚC ĐÓ (không lấy nền
       trắng trung bình của thang màu), rồi hiệu chỉnh ánh sáng (von Kries)
       trước khi so khớp — nên kết quả không còn lệch chỉ vì ảnh A/B/C được
       chụp dưới ánh sáng khác nhau. */
    function sampleAuto(srcX, srcY) {
      const result = PHVision.analyzeClick(sourceCanvas, srcX, srcY, chart);
      octx.clearRect(0, 0, overlay.width, overlay.height);

      if (!result.ok) {
        autoError.textContent = '⚠️ ' + result.reason;
        autoError.style.display = '';
        autoInfo.style.display = 'none';
        return;
      }
      autoError.style.display = 'none';

      const { sample, lighting, match } = result;
      state.rgb = sample.correctedRgb;
      state.ph = match.ph;

      swatch.style.background = rgbToHex(sample.correctedRgb);
      hexEl.textContent = rgbToHex(sample.correctedRgb).toUpperCase();
      phEl.textContent = match.ph.toFixed(2);

      swatchWhite.style.background = rgbToHex(sample.backgroundRgb);
      whiteHexEl.textContent = rgbToHex(sample.backgroundRgb).toUpperCase();
      lightEl.textContent = `${lighting.level} — ${lighting.reason}`;
      autoInfo.style.display = '';

      onUpdate();
    }

    function clearReading() {
      state.rgb = null;
      state.ph = null;
      swatch.style.background = '#eee';
      hexEl.textContent = '—';
      phEl.textContent = '—';
      autoInfo.style.display = 'none';
      autoError.style.display = 'none';
      onUpdate();
    }

    function applyModeVisual() {
      // Ở chế độ Tự động: ẩn kính ngắm kéo được (không dùng), click trực
      // tiếp vào mẫu để quét — giống hệt hành vi ở trang Quét mẫu.
      reticle.style.display = sampleMode === 'point' ? '' : 'none';
    }

    return {
      get rgb() { return state.rgb; },
      get ph() { return state.ph; },
      onModeChange() {
        octx.clearRect(0, 0, overlay.width, overlay.height);
        applyModeVisual();
        if (!state.img) return;
        if (sampleMode === 'point') {
          state.pos = { x: canvas.width / 2, y: canvas.height / 2 };
          updateReticleVisual();
          samplePoint();
        } else {
          clearReading();
        }
      },
    };
  }

  let onUpdate = () => {};

  const A = createStage('A');
  const B = createStage('B');
  const C = createStage('C');

  /* ---------- Chuyển đổi kiểu lấy mẫu: Điểm / Tự động ---------- */
  const modePointSampleBtn = document.getElementById('modePointSampleBtn');
  const modeAutoSampleBtn = document.getElementById('modeAutoSampleBtn');
  function setSampleMode(next) {
    sampleMode = next;
    modePointSampleBtn.classList.toggle('active', next === 'point');
    modeAutoSampleBtn.classList.toggle('active', next === 'auto');
    [A, B, C].forEach(s => s.onModeChange());
    refreshResult();
  }
  modePointSampleBtn.addEventListener('click', () => setSampleMode('point'));
  modeAutoSampleBtn.addEventListener('click', () => setSampleMode('auto'));

  /* ---------- Chế độ pH mong muốn ---------- */
  const targetPhInput = document.getElementById('targetPh');
  const swatchTarget = document.getElementById('swatchTarget');
  const hexTarget = document.getElementById('hexTarget');

  function colorForPh(ph) {
    const fine = buildFineTable(chart, 0.05);
    let closest = fine[0];
    for (const e of fine) if (Math.abs(e.ph - ph) < Math.abs(closest.ph - ph)) closest = e;
    return closest.rgb;
  }

  function updateTargetSwatch() {
    const ph = Math.max(0, Math.min(14, parseFloat(targetPhInput.value) || 0));
    const rgb = colorForPh(ph);
    swatchTarget.style.background = rgbToHex(rgb);
    hexTarget.textContent = rgbToHex(rgb).toUpperCase();
    return rgb;
  }
  targetPhInput.addEventListener('input', () => { updateTargetSwatch(); refreshResult(); });

  /* ---------- Chuyển chế độ ---------- */
  const modeImgBtn = document.getElementById('modeImgBtn');
  const modePhBtn = document.getElementById('modePhBtn');
  const modeImg = document.getElementById('modeImg');
  const modePh = document.getElementById('modePh');
  let mode = 'img';

  modeImgBtn.addEventListener('click', () => { mode = 'img'; modeImgBtn.classList.add('active'); modePhBtn.classList.remove('active'); modeImg.style.display = ''; modePh.style.display = 'none'; refreshResult(); });
  modePhBtn.addEventListener('click', () => { mode = 'ph'; modePhBtn.classList.add('active'); modeImgBtn.classList.remove('active'); modeImg.style.display = 'none'; modePh.style.display = ''; refreshResult(); });

  /* ---------- Kết quả ---------- */
  const accVal = document.getElementById('accVal');
  const devVal = document.getElementById('devVal');
  const dePhVal = document.getElementById('dePhVal');

  function refreshResult() {
    let phLeft, phRight;
    if (mode === 'img') {
      if (A.ph == null || B.ph == null) return clearResult();
      phLeft = A.ph; phRight = B.ph;
    } else {
      if (C.ph == null) return clearResult();
      phRight = C.ph;
      updateTargetSwatch(); // cập nhật ô màu chuẩn ứng với pH mong muốn
      phLeft = parseFloat(targetPhInput.value) || 0;
    }

    // % lệch / % chính xác tính trực tiếp theo thang pH (0–14), đúng như
    // yêu cầu: lệch 0.2 pH trên thang 14 => 0.2/14 × 100%.
    const dePh = Math.abs(phLeft - phRight);
    const dev = Math.min(100, (dePh / 14) * 100);
    const acc = 100 - dev;

    accVal.textContent = acc.toFixed(1) + '%';
    devVal.textContent = dev.toFixed(1) + '%';
    dePhVal.textContent = dePh.toFixed(2);

    setCardTone(accVal.closest('.metric-card'), acc >= 90 ? 'good' : acc >= 70 ? 'warn' : 'bad');
  }

  function setCardTone(card, tone) {
    card.classList.remove('good', 'warn', 'bad');
    card.classList.add(tone);
  }

  function clearResult() {
    accVal.textContent = '—';
    devVal.textContent = '—';
    dePhVal.textContent = '—';
  }

  onUpdate = refreshResult;
  updateTargetSwatch();
  clearResult();
})();
