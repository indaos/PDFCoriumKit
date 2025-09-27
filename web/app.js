console.log('[app] script loaded');
window.addEventListener('error', (e) => {
  console.error('[window.onerror]', e?.message || e);
});

(() => {
  const adapter = new PdfiumAdapter();
  window.adapter = adapter;

  let doc = 0;
  let page = 0;
  let pageIndex = 0;
  let pageCount = 0;
  let zoom = 1.0;
  let tool = 'none';
  let dragStart = null;
  let drawPoints = [];
  let fieldList = [];
  const overlayPersist = {};
  let pageSize = { width: 0, height: 0 };
  let lastRenderScale = 1.0;
  let signatureTargetRect = null;
  let sigStrokes = [];
  let fieldEditor = null;
  let fieldEditorActive = null;

  const pageCanvas = document.getElementById('pageCanvas');
  const overlayCanvas = document.getElementById('overlayCanvas');
  const pageBox = document.getElementById('pageBox');
  const stage = document.getElementById('stage');
  const pageNumEl = document.getElementById('pageNum');
  const pageCountEl = document.getElementById('pageCount');
  const pageInput = document.getElementById('pageInput');
  const gotoPageBtn = document.getElementById('gotoPage');
  const zoomLabel = document.getElementById('zoomLabel');
  const inspector = document.getElementById('inspector');
  const inspectorToggle = document.getElementById('inspect');
  const signatureModal = document.getElementById('signatureModal');
  const signaturePad = document.getElementById('signaturePad');
  const fileInput = document.getElementById('fileInput');

  const overlayCtx = overlayCanvas.getContext('2d');
  const statusEl = document.getElementById('status');
  let currentDpr = 1;

  /**
   * Hides the page canvases and clears overlays.
   * @returns {void}
   */
  function hidePage() {
    try {
      pageCanvas.width = 0; pageCanvas.height = 0;
      pageCanvas.style.width = '0px'; pageCanvas.style.height = '0px';
      pageCanvas.style.display = 'none';
      overlayCanvas.width = 0; overlayCanvas.height = 0;
      overlayCanvas.style.width = '0px'; overlayCanvas.style.height = '0px';
      overlayCanvas.style.display = 'none';
      if (pageBox) { pageBox.style.visibility = 'hidden'; pageBox.style.display = 'none'; }
      clearOverlay();
    } catch {}
  }
  hidePage();

  let currentCssW = 0;
  let currentCssH = 0;

  /**
   * Updates the status banner with a message.
   * @param {string} msg - Status text; hidden when empty.
   * @returns {void}
   */
  function setStatus(msg) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.hidden = !msg;
  }

  /**
   * Reads the page number from URL query (?page=).
   * @returns {number|null} 1-based page index or null if missing/invalid.
   */
  function getPageFromUrl() {
    try {
      const u = new URL(window.location.href);
      const v = u.searchParams.get('page');
      if (!v) return null;
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < 1) return null;
      return n;
    } catch { return null; }
  }
  /**
   * Sets the page number in the URL query without reloading.
   * @param {number} n - 1-based page number.
   * @returns {void}
   */
  function setPageInUrl(n) {
    try {
      const u = new URL(window.location.href);
      u.searchParams.set('page', String(n));
      history.replaceState(null, '', u.toString());
    } catch {}
  }

  /**
   * Reads an integer query parameter from the URL.
   * @param {string} name - Parameter name.
   * @param {number} def - Default value on failure.
   * @returns {number} Parsed integer or default.
   */
  function getIntParam(name, def) {
    try { const u = new URL(window.location.href); const v = u.searchParams.get(name); if (v === null) return def; const n = parseInt(v, 10); return Number.isFinite(n) ? n : def; } catch { return def; }
  }
  let renderOffsetX = getIntParam('xoff', 0);
  let renderOffsetY = getIntParam('yoff', 0);

  /**
   * Positions the overlay canvas to the page canvas (no resizing).
   * @returns {void}
   */
  function fitOverlayToPage() {
    overlayCanvas.style.left = '0px';
    overlayCanvas.style.top = '0px';
  }


  /**
   * Updates the page number indicators and input bounds.
   * @returns {void}
   */
  function updatePageInfo() {
    if (pageNumEl) pageNumEl.textContent = (pageIndex + 1).toString();
    pageCountEl.textContent = pageCount.toString();
    if (pageInput) {
      pageInput.min = '1';
      pageInput.max = Math.max(1, pageCount).toString();
      pageInput.value = (pageIndex + 1).toString();
    }
  }

  /**
   * Sets zoom factor within [0.25, 4] and triggers render.
   * @param {number} z - Desired zoom factor.
   * @returns {void}
   */
  function setZoom(z) {
    zoom = Math.min(4, Math.max(0.25, z));
    zoomLabel.textContent = Math.round(zoom * 100) + '%';
    render();
  }

  /**
   * Clears the overlay canvas respecting current DPR and CSS size.
   * @returns {void}
   */
  function clearOverlay() {
    const dpr = (typeof currentDpr === 'number' ? currentDpr : (window.devicePixelRatio || 1));
    const cw = currentCssW || overlayCanvas.clientWidth;
    const ch = currentCssH || overlayCanvas.clientHeight;
    overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    overlayCtx.clearRect(0, 0, cw, ch);
  }

  /**
   * Renders the current page into the main canvas and overlays.
   * Retries with DPR=1 if high-DPI rendering appears transparent.
   * @returns {void}
   */
  function render() {
    if (!page) return;
    try { hideFieldEditor(); } catch {}

    const sysDpr = window.devicePixelRatio || 1;
    const targetCssWidth = Math.max(1, Math.floor((pageSize?.width || 0) * zoom) || 1200);

    function doRender(useDpr) {
      const res = adapter.renderPageToCanvas(page, pageCanvas, {
        targetWidth: targetCssWidth,
        devicePixelRatio: useDpr,
        offsetX: renderOffsetX,
        offsetY: renderOffsetY,
      });
    const width  = res.width;
    const height = res.height;
    const cssW = Math.max(1, Math.floor(width / useDpr));
    const cssH = Math.max(1, Math.floor(height / useDpr));

    pageCanvas.style.width  = cssW + 'px';
    pageCanvas.style.height = cssH + 'px';
    if (pageBox) { pageBox.style.width = cssW + 'px'; pageBox.style.height = cssH + 'px'; }

    overlayCanvas.width  = width;
    overlayCanvas.height = height;
    overlayCanvas.style.width  = cssW + 'px';
    overlayCanvas.style.height = cssH + 'px';
    fitOverlayToPage();

    overlayCtx.setTransform(useDpr, 0, 0, useDpr, 0, 0);
    overlayCtx.clearRect(0, 0, cssW, cssH);
    drawFieldHighlights(cssW, cssH);
    drawPersistedOverlays(cssW, cssH);

    return { width, height, cssW, cssH, dpr: useDpr };
  }


  /**
   * Draws translucent highlights over detected form widgets.
   * @param {number} cssW - Page CSS width.
   * @param {number} cssH - Page CSS height.
   * @returns {void}
   */
  function drawFieldHighlights(cssW, cssH) {
    if (!page) return;
    try {
      fieldList = adapter.listWidgetFields(page);
    } catch { fieldList = []; }
    const rect = pageCanvas.getBoundingClientRect();
    const w = rect.width || cssW;
    const h = rect.height || cssH;
    overlayCtx.save();
    overlayCtx.fillStyle = 'rgba(255, 255, 0, 0.2)';
    overlayCtx.strokeStyle = 'rgba(255, 196, 0, 0.8)';
    overlayCtx.lineWidth = 1;
    for (const f of fieldList) {
      const r = f.rect;
      const x = (r.left / pageSize.width) * w;
      const y = ((pageSize.height - r.top) / pageSize.height) * h;
      const ww = ((r.right - r.left) / pageSize.width) * w;
      const hh = ((r.top - r.bottom) / pageSize.height) * h;
      overlayCtx.fillRect(x, y, ww, hh);
      overlayCtx.strokeRect(x, y, ww, hh);
    }
    overlayCtx.restore();
  }

  /**
   * Draws persisted overlays: texts, inks, rectangles, highlights.
   * @param {number} cssW - Page CSS width.
   * @param {number} cssH - Page CSS height.
   * @returns {void}
   */
  function drawPersistedOverlays(cssW, cssH) {
    const p = overlayPersist[pageIndex];
    if (!p) return;
    overlayCtx.save();
    if (p.texts) {
      overlayCtx.fillStyle = 'rgba(0,0,0,1)';
      overlayCtx.textAlign = 'left';
      overlayCtx.textBaseline = 'middle';
      for (const t of p.texts) {
        const r = t.rect;
        const x = (r.left / pageSize.width) * cssW + 4;
        const yTop = ((pageSize.height - r.top) / pageSize.height) * cssH;
        const h = ((r.top - r.bottom) / pageSize.height) * cssH;
        const centerY = yTop + (h / 2);
        const fontPx = Math.max(10, Math.min(16, Math.floor(h * 0.6)));
        overlayCtx.font = `${fontPx}px sans-serif`;
        overlayCtx.fillText(t.text, x, centerY);
      }
    }
    if (p.inks) {
      overlayCtx.strokeStyle = '#1e40af';
      overlayCtx.lineWidth = 2;
      for (const s of p.inks) {
        const pts = s.points;
        overlayCtx.beginPath();
        for (let i = 0; i < pts.length; i++) {
          const x = (pts[i].x / pageSize.width) * cssW;
          const y = ((pageSize.height - pts[i].y) / pageSize.height) * cssH;
          if (i === 0) overlayCtx.moveTo(x, y); else overlayCtx.lineTo(x, y);
        }
        overlayCtx.stroke();
      }
    }
    if (p.rects) {
      overlayCtx.strokeStyle = 'rgba(255,165,0,0.9)';
      overlayCtx.lineWidth = 2;
      for (const r of p.rects) {
        const x = (r.left / pageSize.width) * cssW;
        const y = ((pageSize.height - r.top) / pageSize.height) * cssH;
        const w = ((r.right - r.left) / pageSize.width) * cssW;
        const h = ((r.top - r.bottom) / pageSize.height) * cssH;
        overlayCtx.strokeRect(x, y, w, h);
      }
    }
    if (p.highlights) {
      overlayCtx.fillStyle = 'rgba(255,255,0,0.25)';
      for (const r of p.highlights) {
        const x = (r.left / pageSize.width) * cssW;
        const y = ((pageSize.height - r.top) / pageSize.height) * cssH;
        const w = ((r.right - r.left) / pageSize.width) * cssW;
        const h = ((r.top - r.bottom) / pageSize.height) * cssH;
        overlayCtx.fillRect(x, y, w, h);
      }
    }
    overlayCtx.restore();
  }

  /**
   * Converts a PDF-space rect to CSS coordinates of the page canvas.
   * @param {{left:number,right:number,top:number,bottom:number}} r - Rect in PDF units.
   * @returns {{x:number,y:number,w:number,h:number}} Rect in CSS pixels.
   */
  function pdfRectToCssRect(r) {
    const rect = pageCanvas.getBoundingClientRect();
    const cssW = rect.width || currentCssW || pageCanvas.clientWidth || 1;
    const cssH = rect.height || currentCssH || pageCanvas.clientHeight || 1;
    const x = (r.left / pageSize.width) * cssW;
    const y = ((pageSize.height - r.top) / pageSize.height) * cssH;
    const w = ((r.right - r.left) / pageSize.width) * cssW;
    const h = ((r.top - r.bottom) / pageSize.height) * cssH;
    return { x, y, w, h };
  }

  /**
   * Ensures the floating input for inline text editing exists.
   * @returns {HTMLInputElement} The input element.
   */
  function ensureFieldEditor() {
    if (fieldEditor && fieldEditor.parentElement) return fieldEditor;
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'fieldEditor';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.style.position = 'absolute';
    input.style.zIndex = '1000';
    input.style.boxSizing = 'border-box';
    input.style.border = '1px solid #2563eb';
    input.style.background = 'rgba(255,255,255,0.9)';
    input.style.color = '#000';
    input.style.padding = '2px 4px';
    input.style.margin = '0';
    input.style.outline = 'none';
    input.style.display = 'none';
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commitFieldEditor(); }
      else if (e.key === 'Escape') { e.preventDefault(); hideFieldEditor(true); }
    });
    input.addEventListener('blur', () => { commitFieldEditor(); });
    (pageBox || document.body).appendChild(input);
    fieldEditor = input;
    return input;
  }

  /**
   * Shows the inline text editor over a widget rect.
   * @param {{rect:Object,handle:number}} field - Widget descriptor.
   * @param {string} [presetValue] - Optional initial text.
   * @returns {void}
   */
  function showFieldEditor(field, presetValue = '') {
    const fe = ensureFieldEditor();
    fieldEditorActive = { rect: field.rect, handle: field.handle };
    const r = pdfRectToCssRect(field.rect);
    const fontPx = Math.max(10, Math.min(16, Math.floor(r.h * 0.6)));
    fe.style.left = Math.round(r.x) + 'px';
    fe.style.top = Math.round(r.y) + 'px';
    fe.style.width = Math.max(20, Math.round(r.w)) + 'px';
    fe.style.height = Math.max(14, Math.round(r.h)) + 'px';
    fe.style.font = `${fontPx}px sans-serif`;
    fe.value = presetValue || '';
    fe.style.display = 'block';
    try { console.log('[inline-editor] show', { x: fe.style.left, y: fe.style.top, w: fe.style.width, h: fe.style.height, fontPx }); } catch {}
    setTimeout(() => { try { fe.focus(); fe.select(); } catch {} }, 0);
  }
  window.showFieldEditor = showFieldEditor;

  /**
   * Commits the inline editor value to a widget or overlay.
   * @returns {void}
   */
  function commitFieldEditor() {
    const fe = fieldEditor;
    if (!fe || fe.style.display === 'none' || !fieldEditorActive) return;
    const text = fe.value || '';
    const target = fieldEditorActive;
    hideFieldEditor();
    if (text.trim()) {
      let ok = false;
      try { ok = !!adapter.setTextFieldValue(target.handle, text.trim()); } catch {}
      if (!ok) {
        try { ok = !!adapter.addTextContent(doc, page, target.rect, text.trim()); } catch {}
      }
      if (!ok) {
        persistText(target.rect, text.trim());
      } else {
        try {
          const p = overlayPersist[pageIndex];
          if (p && Array.isArray(p.texts) && p.texts.length) {
            const tol = 0.5;
            p.texts = p.texts.filter((t) => {
              const r = t.rect || {};
              const a = target.rect || {};
              const near = (x, y) => Math.abs((x||0) - (y||0)) <= tol;
              const match = near(r.left,a.left) && near(r.top,a.top) && near(r.right,a.right) && near(r.bottom,a.bottom);
              return !match;
            });
          }
        } catch {}
      }
      render();
    }
  }

  /**
   * Hides the inline editor; optionally keeps active target.
   * @param {boolean} [cancelOnly=false] - If true, keep active state.
   * @returns {void}
   */
  function hideFieldEditor(cancelOnly = false) {
    if (!fieldEditor) return;
    fieldEditor.style.display = 'none';
    if (!cancelOnly) fieldEditorActive = null;
  }


  /**
   * Persists a text overlay to draw on subsequent renders.
   * @param {Object} rectPdf - PDF-space rect.
   * @param {string} text - Text content.
   * @returns {void}
   */
  function persistText(rectPdf, text) {
    const p = overlayPersist[pageIndex] || (overlayPersist[pageIndex] = { texts: [], inks: [], rects: [], highlights: [] });
    p.texts.push({ rect: rectPdf, text });
  }
  window.persistText = persistText;
  /**
   * Persists an ink overlay stroke sequence.
   * @param {{x:number,y:number}[]} pointsPdf - PDF-space stroke points.
   * @returns {void}
   */
  function addInkOverlay(pointsPdf) {
    const p = overlayPersist[pageIndex] || (overlayPersist[pageIndex] = { texts: [], inks: [], rects: [], highlights: [] });
    p.inks.push({ points: pointsPdf });
  }
  window.addInkOverlay = addInkOverlay;
  /**
   * Persists a rectangle overlay.
   * @param {Object} rectPdf - PDF-space rect.
   * @returns {void}
   */
  function persistRect(rectPdf) {
    const p = overlayPersist[pageIndex] || (overlayPersist[pageIndex] = { texts: [], inks: [], rects: [], highlights: [] });
    p.rects.push(rectPdf);
  }
  /**
   * Persists a highlight overlay.
   * @param {Object} rectPdf - PDF-space rect.
   * @returns {void}
   */
  function persistHighlight(rectPdf) {
    const p = overlayPersist[pageIndex] || (overlayPersist[pageIndex] = { texts: [], inks: [], rects: [], highlights: [] });
    p.highlights.push(rectPdf);
  }

  /**
   * Heuristically detects if the current page render is empty/transparent.
   * @returns {boolean} True if most likely transparent.
   */
  function looksTransparent() {
    try {
      const ctx = pageCanvas.getContext('2d', { willReadFrequently: true });
      const wpx = pageCanvas.width, hpx = pageCanvas.height;
      const samples = [
        [wpx >> 1, hpx >> 1],
        [1, 1],
        [wpx - 2, hpx - 2]
      ];
      for (const [x, y] of samples) {
        const a = ctx.getImageData(Math.max(0, x), Math.max(0, y), 1, 1).data[3];
        if (a !== 0) return false;
      }
      return true;
    } catch { return false; }
  }

  
  let info = doRender(sysDpr);

  
  if (sysDpr !== 1 && looksTransparent()) {
    console.warn('[render] Transparent output at DPR', sysDpr, '→ retry with DPR=1');
    info = doRender(1);
  }

    const msg = `[render] xoff=${renderOffsetX} yoff=${renderOffsetY} targetCssWidth=${targetCssWidth} dpr=${info.dpr} outPx=${info.width}x${info.height} outCss=${info.cssW}x${info.cssH}`;
    console.log(msg);
    setStatus(msg);
    currentDpr = info.dpr;
    currentCssW = info.cssW;
    currentCssH = info.cssH;
    try {
      pageCanvas.style.display = 'block';
      overlayCanvas.style.display = 'block';
      if (pageBox) pageBox.style.visibility = 'visible';
    } catch {}
  }

  /**
   * Opens a PDF ArrayBuffer with the adapter and renders page 1.
   * @param {ArrayBuffer} buf - Raw PDF bytes.
   * @returns {Promise<void>}
   */
  async function openBuffer(buf) {
    await adapter.init();
    adapter.initLibrary();
    if (doc) { adapter.closeDocument(doc); doc = 0; }
    try {
      pageCanvas.width = 0; pageCanvas.height = 0;
      pageCanvas.style.width = '0px'; pageCanvas.style.height = '0px';
      overlayCanvas.width = 0; overlayCanvas.height = 0;
      overlayCanvas.style.width = '0px'; overlayCanvas.style.height = '0px';
      if (pageBox) pageBox.style.visibility = 'hidden';
      currentCssW = 0; currentCssH = 0;
      clearOverlay();
    } catch {}
    doc = adapter.loadDocumentFromArrayBuffer(buf, null);
    pageCount = adapter.getPageCount(doc);
    const msg = `[open] pageCount=${pageCount}`; console.log(msg); setStatus(msg);
    pageIndex = 0;
    loadPage();
  }

  let lastPageHandle = 0;
  /**
   * Loads the current page index and triggers a render.
   * Attempts a document reload if the page handle looks stale.
   * @returns {void}
   */
  function loadPage() {
    try {
      pageCanvas.style.display = 'none';
      overlayCanvas.style.display = 'none';
      if (pageBox) { pageBox.style.visibility = 'hidden'; pageBox.style.display = 'none'; }
    } catch {}
    if (page) { adapter.closePage(page); page = 0; }
    page = adapter.loadPage(doc, pageIndex);
    if (!page || (lastPageHandle && page === lastPageHandle)) {
      console.warn('[loadPage] bad handle at index', pageIndex, 'handle=', page, '— attempting doc reload');
      const newDoc = adapter.reloadDocument(doc);
      if (newDoc) {
        doc = newDoc;
        page = adapter.loadPage(doc, pageIndex);
        console.log('[loadPage] after reload, handle=', page);
      }
    }
    if (!page) {
      console.error('[loadPage] failed to load page at index', pageIndex);
      setStatus('Failed to load page ' + (pageIndex+1));
      return;
    }
    console.log('[loadPage] pageIndex=', pageIndex, 'handle=', page);
    lastPageHandle = page;
    pageSize = adapter.getPageSize(page);
    const msg = `[loadPage] page=${page} size=${pageSize.width}x${pageSize.height}`; console.log(msg); setStatus(msg);
    updatePageInfo();
    try { if (pageBox) { pageBox.style.display = 'inline-block'; pageBox.style.visibility = 'visible'; } } catch {}
    render();
  }

  /**
   * Moves to another page by delta and loads it.
   * @param {number} delta - Positive or negative offset.
   * @returns {void}
   */
  function changePage(delta) {
    if (!doc) return;
    const idx = Math.max(0, Math.min(pageCount - 1, pageIndex + delta));
    if (idx !== pageIndex) { console.log('[changePage]', pageIndex, '->', idx); pageIndex = idx; loadPage(); }
  }

  /**
   * Converts a mouse event to canvas CSS coordinates.
   * @param {MouseEvent} evt - Mouse event.
   * @returns {{x:number,y:number}} CSS-space point.
   */
  function evtToCanvasPoint(evt) {
    const rect = pageCanvas.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  }
  /**
   * Converts a CSS-space point to PDF-space.
   * @param {{x:number,y:number}} p - CSS-space point.
   * @returns {{x:number,y:number}} PDF-space point.
   */
  function canvasToPdfPoint(p) {
    const rect = pageCanvas.getBoundingClientRect();
    const cssW = rect.width || 1;
    const cssH = rect.height || 1;
    const pdfX = (p.x / cssW) * pageSize.width;
    const pdfY = ((cssH - p.y) / cssH) * pageSize.height;
    return { x: pdfX, y: pdfY };
  }
  /**
   * Creates a PDF-space rect from two CSS-space points.
   * @param {{x:number,y:number}} a - First point.
   * @param {{x:number,y:number}} b - Second point.
   * @returns {{left:number,right:number,top:number,bottom:number}}
   */
  function rectFromTwoPoints(a, b) {
    const pa = canvasToPdfPoint(a), pb = canvasToPdfPoint(b);
    return {
      left: Math.min(pa.x, pb.x),
      right: Math.max(pa.x, pb.x),
      bottom: Math.min(pa.y, pb.y),
      top: Math.max(pa.y, pb.y)
    };
  }
  /**
   * Draws a live in-progress freehand path on the overlay.
   * @param {{x:number,y:number}[]} points - CSS-space points.
   * @returns {void}
   */
  function drawLivePath(points) {
    const dpr = (typeof currentDpr === 'number' ? currentDpr : (window.devicePixelRatio || 1));
    overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cw = currentCssW || overlayCanvas.clientWidth;
    const ch = currentCssH || overlayCanvas.clientHeight;
    overlayCtx.clearRect(0, 0, cw, ch);
    overlayCtx.strokeStyle = '#1e40af';
    overlayCtx.lineWidth = 2;
    overlayCtx.beginPath();
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (i === 0) overlayCtx.moveTo(p.x, p.y);
      else overlayCtx.lineTo(p.x, p.y);
    }
    overlayCtx.stroke();
  }

  /**
   * Draws a live in-progress rectangle selection on the overlay.
   * @param {{x:number,y:number}} a - Start CSS point.
   * @param {{x:number,y:number}} b - Current CSS point.
   * @returns {void}
   */
  function drawLiveRect(a, b) {
    const dpr = (typeof currentDpr === 'number' ? currentDpr : (window.devicePixelRatio || 1));
    overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cw = currentCssW || overlayCanvas.clientWidth;
    const ch = currentCssH || overlayCanvas.clientHeight;
    overlayCtx.clearRect(0, 0, cw, ch);
    overlayCtx.strokeStyle = '#ca8a04';
    overlayCtx.lineWidth = 2;
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    const w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
    overlayCtx.strokeRect(x, y, w, h);
  }

  /**
   * Draws a live in-progress highlight (filled rectangle) on the overlay.
   * @param {{x:number,y:number}} a - Start CSS point.
   * @param {{x:number,y:number}} b - Current CSS point.
   * @returns {void}
   */
  function drawLiveHighlight(a, b) {
    const dpr = (typeof currentDpr === 'number' ? currentDpr : (window.devicePixelRatio || 1));
    overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cw = currentCssW || overlayCanvas.clientWidth;
    const ch = currentCssH || overlayCanvas.clientHeight;
    overlayCtx.clearRect(0, 0, cw, ch);
    overlayCtx.fillStyle = 'rgba(255,255,0,0.25)';
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    const w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
    overlayCtx.fillRect(x, y, w, h);
  }

  /**
   * Mouse interaction handlers to draw, highlight, edit text, and place signatures.
   */
  pageCanvas.addEventListener('mousedown', (e) => {
    if (!page) return;
    const p = evtToCanvasPoint(e);
    try { fieldList = adapter.listWidgetFields(page) || []; } catch { fieldList = []; }
    try {
      const rectEl = pageCanvas.getBoundingClientRect();
      const w = rectEl.width, h = rectEl.height;
      const hit = fieldList.find(f => {
        const r = f.rect;
        const x = (r.left / pageSize.width) * w;
        const y = ((pageSize.height - r.top) / pageSize.height) * h;
        const ww = ((r.right - r.left) / pageSize.width) * w;
        const hh = ((r.top - r.bottom) / pageSize.height) * h;
        return p.x >= x && p.x <= x+ww && p.y >= y && p.y <= y+hh;
      });
      if (hit && (hit.isSignature || hit.type === 7)) {
        signatureTargetRect = hit.rect;
        console.log('[mousedown] signature widget click -> open modal', signatureTargetRect);
        openSignatureModal();
        return;
      }
    } catch {}
    console.log('[mousedown]', { tool, x: p.x, y: p.y, fields: fieldList.length });
    const FORM = { UNKNOWN:0, PUSHBUTTON:1, CHECKBOX:2, RADIOBUTTON:3, COMBOBOX:4, LISTBOX:5, TEXTFIELD:6, SIGNATURE:7 };
    if (tool === 'none') {
      const rectEl = pageCanvas.getBoundingClientRect();
      const w = rectEl.width, h = rectEl.height;
      const hit = fieldList.find(f => {
        const r = f.rect;
        const x = (r.left / pageSize.width) * w;
        const y = ((pageSize.height - r.top) / pageSize.height) * h;
        const ww = ((r.right - r.left) / pageSize.width) * w;
        const hh = ((r.top - r.bottom) / pageSize.height) * h;
        return p.x >= x && p.x <= x+ww && p.y >= y && p.y <= y+hh;
      });
      console.log('[none] hit', !!hit, hit);
      if (hit) {
        if (hit.isSignature || hit.type === 7) {
          signatureTargetRect = hit.rect;
          console.log('[none] signature widget -> open modal', signatureTargetRect);
          openSignatureModal();
        }
        return;
      }
    }
    if (tool === 'draw') { drawPoints = [p]; drawLivePath(drawPoints); }
    if (tool === 'rect') { dragStart = p; drawLiveRect(dragStart, p); }
    if (tool === 'highlight') { dragStart = p; try { clearOverlay(); } catch {} }
    if (tool === 'text') {
      const rectEl = pageCanvas.getBoundingClientRect();
      const w = rectEl.width, h = rectEl.height;
      const F = fieldList || [];
      const hit = F.find(f => {
        const r = f.rect;
        const x = (r.left / pageSize.width) * w;
        const y = ((pageSize.height - r.top) / pageSize.height) * h;
        const ww = ((r.right - r.left) / pageSize.width) * w;
        const hh = ((r.top - r.bottom) / pageSize.height) * h;
        return p.x >= x && p.x <= x+ww && p.y >= y && p.y <= y+hh;
      });
      console.log('[text] hit', !!hit, hit);
      if (hit) { window.showFieldEditor(hit); return; }
      const pdf = canvasToPdfPoint(p);
      const rect = { left: pdf.x, right: pdf.x + 160, bottom: pdf.y - 12, top: pdf.y + 12 };
      const val = prompt('Enter text:');
      if (val && val.trim()) { persistText(rect, val.trim()); render(); }
      return;
    }
    if (tool === 'signature') {
      const rectEl = pageCanvas.getBoundingClientRect();
      const w = rectEl.width, h = rectEl.height;
      const hit = fieldList.find(f => {
        const r = f.rect;
        const x = (r.left / pageSize.width) * w;
        const y = ((pageSize.height - r.top) / pageSize.height) * h;
        const ww = ((r.right - r.left) / pageSize.width) * w;
        const hh = ((r.top - r.bottom) / pageSize.height) * h;
        return p.x >= x && p.x <= x+ww && p.y >= y && p.y <= y+hh;
      });
      if (hit) console.log(`[field] type=${hit.type} isSig=${hit.isSignature} name=${hit.fieldName||''}`);
      console.log('[signature] hit', !!hit, hit);
      if (hit && (hit.isSignature || hit.type === FORM.SIGNATURE)) {
        signatureTargetRect = hit.rect;
        console.log('[signature] open modal for widget rect', signatureTargetRect);
        openSignatureModal();
        return;
      }
      const pdf = canvasToPdfPoint(p);
      signatureTargetRect = { left: pdf.x, bottom: pdf.y - 30, right: pdf.x + 180, top: pdf.y + 30 };
      console.log('[signature] open modal free placement rect', signatureTargetRect);
      openSignatureModal();
      return;
    }
  });
  pageCanvas.addEventListener('mousemove', (e) => {
    if (!page) return;
    const p = evtToCanvasPoint(e);
    if (tool === 'draw' && drawPoints.length) { drawPoints.push(p); drawLivePath(drawPoints); if ((drawPoints.length % 10) === 0) console.log('[mousemove][draw] pts', drawPoints.length); }
    if (tool === 'rect' && dragStart) { drawLiveRect(dragStart, p); }
    if (tool === 'highlight' && dragStart) { drawLiveHighlight(dragStart, p); }
  });
  /** Opens editor or prompts for signature when clicking form fields. */
  pageCanvas.addEventListener('click', (e) => {
    if (!page) return;
    if (tool !== 'none' && tool !== 'text') return;
    const p = evtToCanvasPoint(e);
    try { fieldList = adapter.listWidgetFields(page) || []; } catch { fieldList = []; }
    const rectEl = pageCanvas.getBoundingClientRect();
    const w = rectEl.width, h = rectEl.height;
    const hit = fieldList.find(f => {
      const r = f.rect;
      const x = (r.left / pageSize.width) * w;
      const y = ((pageSize.height - r.top) / pageSize.height) * h;
      const ww = ((r.right - r.left) / pageSize.width) * w;
      const hh = ((r.top - r.bottom) / pageSize.height) * h;
      return p.x >= x && p.x <= x+ww && p.y >= y && p.y <= y+hh;
    });
    if (!hit) return;
    const FORM = { TEXTFIELD: 6, SIGNATURE: 7 };
    if (hit.isSignature || hit.type === FORM.SIGNATURE) {
      signatureTargetRect = hit.rect; openSignatureModal(); return;
    }
    if (tool === 'text' || hit.type === FORM.TEXTFIELD || (hit.ftString && /Tx/i.test(hit.ftString))) {
      window.showFieldEditor(hit);
      return;
    }
    const wantSig = confirm('Open signature pad for this field? Press OK to sign, Cancel to enter text.');
    if (wantSig) {
      signatureTargetRect = hit.rect; openSignatureModal();
    } else {
      window.showFieldEditor(hit);
    }
  });
  const handleMouseUp = (ev) => {
    if (!page) return;
    const p = evtToCanvasPoint(ev);
    console.log('[mouseup]', { tool, drawPoints: drawPoints.length, hadDrag: !!dragStart, x: p.x, y: p.y });
    if (tool === 'draw' && drawPoints.length) {
      const pts = drawPoints.map(canvasToPdfPoint);
      try {
        let ok = false;
        if (adapter.addStrokePath) {
          ok = !!adapter.addStrokePath(page, pts);
          console.log('[draw] addStrokePath', ok);
        }
        if (!ok) {
          ok = !!adapter.addInk(page, pts);
          console.log('[draw] addInk', ok);
        }
        if (!ok) addInkOverlay(pts);
      } catch (e) {
        console.warn('[draw] persist failed:', e?.message || e);
        addInkOverlay(pts);
      }
      drawPoints = [];
      clearOverlay();
      render();
    }
    if ((tool === 'rect' || tool === 'highlight') && dragStart) {
      const rect = rectFromTwoPoints(dragStart, p);
      if (tool === 'rect') {
        persistRect(rect);
      } else {
        let ok = false;
        try { ok = !!adapter.addHighlight(page, rect); } catch {}
        if (!ok) {
          persistHighlight(rect);
        } else {
          try { if (adapter && adapter._usingDirectWasm) persistHighlight(rect); } catch {}
          try {
            if (page) { adapter.closePage(page); page = 0; }
          } catch {}
          try {
            page = adapter.loadPage(doc, pageIndex);
            if (!page) {
              const newDoc = adapter.reloadDocument(doc);
              if (newDoc) { doc = newDoc; page = adapter.loadPage(doc, pageIndex); }
            }
          } catch {}
        }
      }
      dragStart = null;
      clearOverlay();
      render();
    }
  };
  window.addEventListener('mouseup', handleMouseUp);
  pageCanvas.addEventListener('mouseleave', handleMouseUp);

  /** Toolbar and navigation wiring. */
  document.getElementById('prevPage').onclick = () => changePage(-1);
  document.getElementById('nextPage').onclick = () => changePage(1);
  if (gotoPageBtn) gotoPageBtn.onclick = () => {
    if (!doc) return;
    const n = parseInt(pageInput.value, 10);
    if (isNaN(n)) return;
    const idx = Math.max(0, Math.min(pageCount - 1, n - 1));
    if (idx !== pageIndex) { pageIndex = idx; loadPage(); }
  };
  if (pageInput) pageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      gotoPageBtn?.click();
    }
  });

  /** Keyboard navigation handlers. */
  window.addEventListener('keydown', (e) => {
    if (!doc) return;
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') changePage(-1);
    if (e.key === 'ArrowRight' || e.key === 'PageDown') changePage(1);
  });

  /** Sync with back/forward navigation by reading ?page=. */
  window.addEventListener('popstate', () => {
    if (!doc) return;
    const urlPage = getPageFromUrl();
    if (!urlPage) return;
    const idx = Math.max(0, Math.min(pageCount - 1, urlPage - 1));
    if (idx !== pageIndex) { pageIndex = idx; loadPage(); }
  });
  document.getElementById('zoomIn').onclick = () => setZoom(zoom + 0.25);
  document.getElementById('zoomOut').onclick = () => setZoom(zoom - 0.25);
  document.querySelectorAll('[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      tool = btn.dataset.tool;
      if (tool === 'signature') {
        console.log('[toolbar] signature selected -> open modal');
        signatureTargetRect = null;
        openSignatureModal();
      }
    });
  });

  inspectorToggle.onclick = () => {
    if (inspector.hasAttribute('hidden')) {
      inspector.removeAttribute('hidden');
      updateInspector();
    } else inspector.setAttribute('hidden', '');
  };
  document.getElementById('flatten').onclick = () => { adapter.flatten(page); render(); };
  document.getElementById('save').onclick = () => {
    console.log('[save] begin');
    const blob = adapter.saveDocument(doc);
    console.log('[save] blob', blob ? (blob.size + ' bytes') : 'null');
    if (blob) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'document.pdf';
      a.click();
      URL.revokeObjectURL(a.href);
    } else {
      alert('Save not available in prebuilt mode.');
    }
  };

  function updateInspector() {
    if (!page) return;
    const fields = adapter.listWidgetFields(page);
    if (!fields || !fields.length) {
      inspector.textContent = 'No fields or not implemented.';
    } else {
      inspector.textContent = fields.map(f => JSON.stringify(f)).join('\n');
    }
  }

  /** File open button and input wiring. */
  document.getElementById('openPdf').onclick = () => fileInput.click();
  document.getElementById('openPdf').addEventListener('click', () => {
    console.log('[app] Open PDF clicked');
    setStatus('Opening file picker...');
  });
  fileInput.onchange = async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) { console.log('[app] No file selected'); setStatus('No file selected'); return; }
    console.log('[app] Selected file:', f.name, f.size, 'bytes');
    setStatus('Loading ' + f.name + ' (' + f.size + ' bytes)');
    const buf = await f.arrayBuffer();
    openBuffer(buf).catch(err => {
      console.error(err);
      alert('Failed to load PDF: ' + err.message);
    });
  };

  /** Drag-and-drop open support. */
  stage.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  stage.addEventListener('drop', async (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    console.log('[app] Dropped file:', f.name, f.size);
    setStatus('Loading ' + f.name + ' (' + f.size + ' bytes)');
    const buf = await f.arrayBuffer();
    openBuffer(buf).catch(err => {
      console.error(err);
      setStatus('Failed: ' + (err?.message || err));
    });
  });

  /** Opens the signature modal and initializes the pad. */
  function openSignatureModal() {
    signatureModal.hidden = false;
    signatureModal.style.display = 'flex';
    signatureModal.setAttribute('aria-hidden', 'false');
    setupSignaturePad();
  }
  /** Closes the signature modal and tears down the pad. */
  function closeSignatureModal() {
    signatureModal.hidden = true;
    signatureModal.style.display = 'none';
    signatureModal.setAttribute('aria-hidden', 'true');
    teardownSignaturePad();
  }
  let sigCtx = null; let sigDrawing = false; let lastSigPt = null;
  /** Sets up signature pad drawing handlers and buffer. */
  function setupSignaturePad() {
    sigCtx = signaturePad.getContext('2d');
    sigCtx.fillStyle = '#fff'; sigCtx.fillRect(0, 0, signaturePad.width, signaturePad.height);
    sigCtx.lineWidth = 2; sigCtx.strokeStyle = '#111827'; sigCtx.lineCap = 'round'; sigCtx.lineJoin = 'round';
    sigStrokes = [];
    signaturePad.onmousedown = (e) => { sigDrawing = true; const p = padEvtToPt(e); lastSigPt = p; sigStrokes.push([p]); };
    signaturePad.onmousemove = (e) => {
      if (!sigDrawing) return;
      const p = padEvtToPt(e);
      sigCtx.beginPath(); sigCtx.moveTo(lastSigPt.x, lastSigPt.y); sigCtx.lineTo(p.x, p.y); sigCtx.stroke();
      lastSigPt = p;
      sigStrokes[sigStrokes.length-1].push(p);
    };
    window.addEventListener('mouseup', () => { sigDrawing = false; });
  }
  /** Removes signature pad handlers and clears references. */
  function teardownSignaturePad() {
    signaturePad.onmousedown = null; signaturePad.onmousemove = null; sigCtx = null; sigDrawing = false; lastSigPt = null;
  }
  /**
   * Converts a mouse event to pad-local coordinates.
   * @param {MouseEvent} e
   * @returns {{x:number,y:number}}
   */
  function padEvtToPt(e) {
    const r = signaturePad.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  document.getElementById('sigClear').onclick = () => {
    if (!sigCtx) return; sigCtx.fillStyle = '#fff'; sigCtx.fillRect(0, 0, signaturePad.width, signaturePad.height); sigCtx.fillStyle = '#000';
  };
  /** Sanity log for DOM hookups. */
  console.log('[app] DOM elements:', {
    pageCanvas: !!pageCanvas, overlayCanvas: !!overlayCanvas, stage: !!stage,
    pageNumEl: !!pageNumEl, pageCountEl: !!pageCountEl, fileInput: !!fileInput
  });
  setStatus('Ready. Click Open PDF and pick a file.');

  document.getElementById('sigCancel').onclick = () => { closeSignatureModal(); };
  document.getElementById('sigDone').onclick = () => {
    if (!page) return;
    if (!signatureTargetRect) {
      signatureTargetRect = { left: pageSize.width/2 - 90, right: pageSize.width/2 + 90, bottom: pageSize.height/2 - 30, top: pageSize.height/2 + 30 };
    }
    const padW = signaturePad.width, padH = signaturePad.height;
    const rect = signatureTargetRect;
    const pdfW = rect.right - rect.left;
    const pdfH = rect.top - rect.bottom;
    let any = false;
    for (const s of sigStrokes) {
      if (s.length < 2) continue;
      const ptsPdf = s.map(p => ({
        x: rect.left + (p.x / padW) * pdfW,
        y: rect.bottom + ((padH - p.y) / padH) * pdfH,
      }));
      const ok = adapter.addInk(page, ptsPdf);
      if (!ok) addInkOverlay(ptsPdf);
      any = true;
    }
    signatureTargetRect = null;
    render();
    closeSignatureModal();
  };

  /** Keep overlay alignment in sync with stage resize. */
  const resizeObserver = new ResizeObserver(() => fitOverlayToPage());
  resizeObserver.observe(stage);
})();
