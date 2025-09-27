/**
 * PdfiumAdapter public API (main methods)
 * - init(): Initialize the PDFium runtime and bind exports.
 * - loadDocumentFromArrayBuffer(buf, [password]): Open PDF bytes returns doc handle.
 * - getPageCount(doc): Return number of pages.
 * - loadPage(doc, index): Load a page returns page handle.
 * - closePage(page): Close a page handle.
 * - closeDocument(doc): Close a document and release resources.
 * - reloadDocument(oldDoc): Reopen using retained memory returns new doc handle.
 * - getPageSize(page): Return { width, height } in points.
 * - renderPageToCanvas(page, canvas, opts): Render into a canvas  returns { width, height, scale }.
 * - addInk(page, points): Create an ink annotation returns boolean.
 * - addRectangle(page, rect): Create a rectangle annotation returns boolean.
 * - addHighlight(page, rect): Create a highlight rectangle returns boolean.
 * - addFreeText(page, text, pt): Create FreeText annotation returns boolean (not implemented).
 * - addImage(page, imageCanvas, rect): Add an image returns boolean (not implemented).
 * - flatten(page): Flatten annotations on a page returns boolean (not implemented).
 * - listWidgetFields(page): Enumerate form widgets returns array of widget descriptors.
 * - setTextFieldValue(annot, text): Set text widget value and appearance → boolean.
 * - addTextContent(doc, page, rect, text): Insert text page object returns boolean.
 * - saveDocument(doc): Save to a Blob returns Blob|null.
 * - getCapabilities(): Report available feature groups returns object.
 * - debugTraceTextPersistence(annot, text): Debug value persistence returns Promise<object>.
 */
console.log("[pdfium] adapter script loaded 7");

class PdfiumAdapter {
  /**
   * Constructs the adapter and initializes internal state containers.
   * @constructor
   */
  constructor() {
    this.Module = null;
    this.exports = {};
    this.initialized = false;
    this._bumpEnabled = false;
    this._docs = new Map();
    this._skipFFLPages = new Set();
    this._clearAPOnEdit = false;
    this._forceCallbackSave = true;
  }
  /**
   * Logs debug information to the console if available.
   * @param {...any} args - Values to log.
   * @returns {void}
   */
  _log(...args) {
    try { console.log('[pdfium dbg]', ...args); } catch {}
  }
  /**
   * Initializes the PDFium module, binds exports, and sets capabilities.
   * Attempts Emscripten glue first, then falls back to direct WASM.
   * @returns {Promise<void>}
   */
  async init() {
    if (this.initialized) return;
    const g = typeof globalThis !== "undefined" ? globalThis : window;
    await this.#loadScript("lib/pdfium.js?v=76");
    if (typeof g.PDFiumModule !== "function") {
      throw new Error("pdfium.js did not expose PDFiumModule factory");
    }
    this.Module = await g.PDFiumModule({
      locateFile: (path, prefix) =>
        path.endsWith(".wasm") ? "lib/pdfium.wasm?v=75" : (prefix || "") + path,
    });

    await new Promise((resolve) => {
      const done = () => {
        try {
          console.log("[pdfium] init: runtime ready");
        } catch {}
        resolve();
      };
      if (this.Module.calledRun || this.Module.runtimeInitialized)
        return done();
      const prev = this.Module.onRuntimeInitialized;
      this.Module.onRuntimeInitialized = () => {
        prev && prev();
        done();
      };
      setTimeout(done, 800);
    });

    this.#bind();
    try {
      this.initLibrary();
    } catch {}
    try {
      console.log("[pdfium] capabilities", this.getCapabilities());
    } catch {}

    const caps = this.getCapabilities();
    if (
      !caps.loadMem &&
      !caps.loadDoc &&
      !caps.avail &&
      !caps.page &&
      !caps.render
    ) {
      console.warn("[pdfium] Emscripten glue exposes no APIs; trying direct WASM fallback");
      const ok = await this.#initViaWasmDirectWithStubs("lib/pdfium.wasm?v=76");
      if (ok) this._usingDirectWasm = true;
      if (ok) {
        this.#bind();
        try {
          console.log("[pdfium] capabilities (direct)", this.getCapabilities());
        } catch {}
      } else {
        console.warn("[pdfium] Direct WASM fallback failed");
      }
    }
    this.initialized = true;
  }
  /**
   * Dynamically loads a script tag and resolves once loaded.
   * @param {string} src - URL of the script to load.
   * @returns {Promise<void>}
   */
  #loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  /**
   * Instantiates PDFium WASM directly with stubbed imports when glue is unavailable.
   * @param {string} path - Path to the .wasm binary.
   * @returns {Promise<boolean>} True if instantiation succeeded.
   */
  async #initViaWasmDirectWithStubs(path) {
    try {
      this._usingDirectWasm = true;
      const res = await fetch(path);
      if (!res.ok) throw new Error(res.status + " " + res.statusText);
      const bytes = await res.arrayBuffer();
      const mod = await WebAssembly.compile(bytes);
      const imports = WebAssembly.Module.imports(mod);
      const importObject = {};
      let memObj = null;
      let tableObj = null;

      const env = {};
      const makeInvoke = (sig) => {
        return function (idx, ...args) {
          try {
            const fn = tableObj.get(idx);
            return fn(...args);
          } catch (e) {
            console.error("[pdfium] invoke_" + sig + " threw", e);
            throw e;
          }
        };
      };
      for (const im of imports) {
        if (!importObject[im.module]) importObject[im.module] = {};
        if (im.module === "env") {
          if (im.name.startsWith("invoke_")) {
            const sig = im.name.substring("invoke_".length);
            env[im.name] = makeInvoke(sig);
          } else if (im.name === "emscripten_memcpy_big") {
            env[im.name] = (dest, src, num) => {
              const heap = new Uint8Array(memObj.buffer);
              heap.copyWithin(dest >>> 0, src >>> 0, (src + num) >>> 0);
              return dest;
            };
          } else if (im.name === "emscripten_resize_heap") {
            env[im.name] = () => 0;
          } else if (im.name === "abort" || im.name === "_abort") {
            env[im.name] = () => {
              throw new Error("abort");
            };
          } else {
            env[im.name] = (...a) => {
              console.warn("[pdfium] stub env." + im.name, a);
              return 0;
            };
          }
        }
      }
      importObject["env"] = Object.assign({}, importObject["env"] || {}, env);

      const wasi = new Proxy(
        {},
        {
          get(_, prop) {
            if (prop === "fd_write") {
              return (fd, iov, iovcnt, pnum) => {
                try {
                  const view = new DataView(memObj.buffer);
                  let out = "";
                  let total = 0;
                  for (let i = 0; i < iovcnt; i++) {
                    const ptr = iov + i * 8;
                    const buf = view.getUint32(ptr, true);
                    const len = view.getUint32(ptr + 4, true);
                    const bytes = new Uint8Array(memObj.buffer, buf, len);
                    out += new TextDecoder().decode(bytes);
                    total += len;
                  }
                  if (fd === 1 || fd === 2)
                    console.log("[wasi fd_write]", out.trim());
                  if (pnum) view.setUint32(pnum, total, true);
                  return 0;
                } catch {
                  return 0;
                }
              };
            }
            return (...args) => {
              console.warn("[pdfium] stub wasi", String(prop), args);
              return 0;
            };
          },
        },
      );
      importObject["wasi_snapshot_preview1"] = wasi;

      const needsMemory = imports.some(
        (im) =>
          im.kind === "memory" || (im.module === "env" && im.name === "memory"),
      );
      if (needsMemory) {
        memObj = new WebAssembly.Memory({ initial: 512, maximum: 2048 });
        importObject["env"] = importObject["env"] || {};
        importObject["env"]["memory"] = memObj;
      }

      const result = await WebAssembly.instantiate(mod, importObject);
      const inst = result.instance || result;
      if (!memObj && inst.exports && inst.exports.memory)
        memObj = inst.exports.memory;
      if (inst.exports && inst.exports.__indirect_function_table)
        tableObj = inst.exports.__indirect_function_table;
      this.Module = {
        exports: inst.exports || {},
        HEAPU8: memObj ? new Uint8Array(memObj.buffer) : null,
        HEAP8: memObj ? new Int8Array(memObj.buffer) : null,
        memory: memObj || null,
      };
      this.exports = inst.exports || {};
      console.log("[pdfium] direct wasm instantiated");
      return true;
    } catch (e) {
      console.warn("[pdfium] direct wasm failed:", e.message);
      return false;
    }
  }

  /**
   * Binds PDFium exports from Emscripten cwrap or direct WASM exports.
   * @returns {void}
   */
  #bind() {
    const M = this.Module;
    if (M && typeof M.cwrap === "function") {
      const cwrap = M.cwrap.bind(M);
      const W = (M && (M.wasmExports || M.exports)) || null;
      const opt = (name, retType, argTypes) => {
        try {
          return cwrap(name, retType, argTypes);
        } catch {
          try {
            if (
              W &&
              Array.isArray(argTypes) &&
              argTypes.every((t) => t === "number")
            ) {
              return W[name] || W["_" + name] || null;
            }
          } catch {}
          return null;
        }
      };
      this.exports = {
        PDFium_Init: opt("PDFium_Init", "void", []),
        FPDF_InitLibrary: opt("FPDF_InitLibrary", "void", []),
        FPDF_InitLibraryWithConfig: opt("FPDF_InitLibraryWithConfig", "void", [
          "number",
        ]),
        FPDF_DestroyLibrary: opt("FPDF_DestroyLibrary", "void", []),
        FPDFPage_GenerateContent: opt("FPDFPage_GenerateContent", "number", [
          "number",
        ]),
        FPDFPage_Flatten: opt("FPDFPage_Flatten", "number", [
          "number",
          "number",
        ]),
        FFI_SaveToBuffer: opt("FFI_SaveToBuffer", "number", [
          "number",
          "number",
          "number",
          "number",
        ]),
        FFI_SetNeedAppearances: opt("FFI_SetNeedAppearances", "number", [
          "number",
          "number",
        ]),
        FFI_SetFieldV: opt("FFI_SetFieldV", "number", [
          "number",
          "number",
        ]),
        FPDF_SaveAsCopy: opt("FPDF_SaveAsCopy", "number", [
          "number",
          "number",
          "number",
        ]),
        FPDF_SaveWithVersion: opt("FPDF_SaveWithVersion", "number", [
          "number",
          "number",
          "number",
          "number",
        ]),
        FFI_Init: opt("FFI_Init", "number", ["number"]),
        FFI_RegisterPage: opt("FFI_RegisterPage", "void", [
          "number",
          "number",
          "number",
        ]),
        FFI_Exit: opt("FFI_Exit", "void", ["number"]),
        FPDF_GetLastError: opt("FPDF_GetLastError", "number", []),
        FPDF_LoadMemDocument: opt("FPDF_LoadMemDocument", "number", [
          "number",
          "number",
          "number",
        ]),
        FPDF_LoadDocument: opt("FPDF_LoadDocument", "number", [
          "string",
          "string",
        ]),
        FPDF_CloseDocument: opt("FPDF_CloseDocument", "void", ["number"]),
        FPDF_GetPageCount: opt("FPDF_GetPageCount", "number", ["number"]),
        FPDF_LoadPage: opt("FPDF_LoadPage", "number", ["number", "number"]),
        FPDF_ClosePage: opt("FPDF_ClosePage", "void", ["number"]),
        FPDFPage_CreateAnnot: opt("FPDFPage_CreateAnnot", "number", [
          "number",
          "number",
        ]),
        FPDFPage_CloseAnnot: opt("FPDFPage_CloseAnnot", "void", [
          "number",
        ]),
        FPDFAnnot_SetRect: opt("FPDFAnnot_SetRect", "number", [
          "number",
          "number",
        ]),
        FPDFAnnot_SetBorder: opt("FPDFAnnot_SetBorder", "number", [
          "number",
          "number",
          "number",
          "number",
        ]),
        FPDFAnnot_SetColor: opt("FPDFAnnot_SetColor", "number", [
          "number",
          "number",
          "number",
          "number",
          "number",
        ]),
        FPDFAnnot_AddInkStroke: opt("FPDFAnnot_AddInkStroke", "number", [
          "number",
          "number",
          "number",
        ]),
        FPDF_GetPageWidthF: opt("FPDF_GetPageWidthF", "number", ["number"]),
        FPDF_GetPageHeightF: opt("FPDF_GetPageHeightF", "number", ["number"]),
        FPDFBitmap_Create: opt("FPDFBitmap_Create", "number", [
          "number",
          "number",
          "number",
        ]),
        FPDFBitmap_Destroy: opt("FPDFBitmap_Destroy", "void", ["number"]),
        FPDFBitmap_FillRect: opt("FPDFBitmap_FillRect", "void", [
          "number",
          "number",
          "number",
          "number",
          "number",
          "number",
        ]),
        FPDFBitmap_GetBuffer: opt("FPDFBitmap_GetBuffer", "number", ["number"]),
        FPDFBitmap_GetStride: opt("FPDFBitmap_GetStride", "number", ["number"]),
        FPDF_RenderPageBitmap: opt("FPDF_RenderPageBitmap", "void", [
          "number",
          "number",
          "number",
          "number",
          "number",
          "number",
          "number",
        ]),
        FPDFAvail_Create: opt("FPDFAvail_Create", "number", [
          "number",
          "number",
        ]),
        FPDFAvail_Destroy: opt("FPDFAvail_Destroy", "void", ["number"]),
        FPDFAvail_IsDocAvail: opt("FPDFAvail_IsDocAvail", "number", [
          "number",
          "number",
        ]),
        FPDFAvail_GetDocument: opt("FPDFAvail_GetDocument", "number", [
          "number",
          "number",
        ]),
        FPDFAvail_IsPageAvail: opt("FPDFAvail_IsPageAvail", "number", [
          "number",
          "number",
          "number",
        ]),
        FPDFPage_GetAnnotCount: opt("FPDFPage_GetAnnotCount", "number", [
          "number",
        ]),
        FPDFPage_GetAnnot: opt("FPDFPage_GetAnnot", "number", [
          "number",
          "number",
        ]),
        FPDFAnnot_GetSubtype: opt("FPDFAnnot_GetSubtype", "number", ["number"]),
        FPDFAnnot_GetRect: opt("FPDFAnnot_GetRect", "number", [
          "number",
          "number",
        ]),
        FPDFAnnot_GetFormFieldType: opt(
          "FPDFAnnot_GetFormFieldType",
          "number",
          ["number", "number"],
        ),
        FPDFAnnot_GetFormFieldName: opt(
          "FPDFAnnot_GetFormFieldName",
          "number",
          ["number", "number", "number", "number"],
        ),
        FPDFAnnot_GetFormFieldValue: opt(
          "FPDFAnnot_GetFormFieldValue",
          "number",
          ["number", "number", "number", "number"],
        ),
        FPDFAnnot_SetStringValue: opt("FPDFAnnot_SetStringValue", "number", [
          "number",
          "string",
          "number",
        ]),
        FPDFAnnot_GetStringValue: opt("FPDFAnnot_GetStringValue", "number", [
          "number",
          "string",
          "number",
          "number",
        ]),
        FPDFAnnot_GetLinkedAnnot: opt("FPDFAnnot_GetLinkedAnnot", "number", [
          "number",
          "string",
        ]),
        FPDFText_LoadPage: opt("FPDFText_LoadPage", "number", ["number"]),
        FPDFText_ClosePage: opt("FPDFText_ClosePage", "void", ["number"]),
        FPDFText_CountChars: opt("FPDFText_CountChars", "number", ["number"]),
        FPDFText_GetCharBox: opt("FPDFText_GetCharBox", "number", [
          "number",
          "number",
          "number",
          "number",
          "number",
          "number",
        ]),
        FPDFText_CountRects: opt("FPDFText_CountRects", "number", [
          "number",
          "number",
          "number",
        ]),
        FPDFText_GetRect: opt("FPDFText_GetRect", "number", [
          "number",
          "number",
          "number",
          "number",
          "number",
          "number",
        ]),
        FORM_OnAfterLoadPage: opt("FORM_OnAfterLoadPage", "void", [
          "number",
          "number",
        ]),
        FORM_OnBeforeClosePage: opt("FORM_OnBeforeClosePage", "void", [
          "number",
          "number",
        ]),
        FPDF_FFLDraw: opt("FPDF_FFLDraw", "void", [
          "number",
          "number",
          "number",
          "number",
          "number",
          "number",
          "number",
          "number",
        ]),
        FORM_SetFocusedAnnot: opt("FORM_SetFocusedAnnot", "number", [
          "number",
          "number",
          "number",
        ]),
        FORM_ReplaceSelection: opt("FORM_ReplaceSelection", "void", [
          "number",
          "number",
          "string",
        ]),
        FORM_ForceToKillFocus: opt("FORM_ForceToKillFocus", "void", [
          "number",
        ]),
        FORM_SetFocusedAnnot: opt("FORM_SetFocusedAnnot", "number", [
          "number",
          "number",
          "number",
        ]),
        FORM_ReplaceSelection: opt("FORM_ReplaceSelection", "void", [
          "number",
          "number",
          "string",
        ]),
        FORM_ForceToKillFocus: opt("FORM_ForceToKillFocus", "void", [
          "number",
        ]),
        FPDFPageObj_CreateNewPath: opt("FPDFPageObj_CreateNewPath", "number", [
          "number",
          "number",
        ]),
        FPDFPath_MoveTo: opt("FPDFPath_MoveTo", "void", [
          "number",
          "number",
          "number",
        ]),
        FPDFPath_LineTo: opt("FPDFPath_LineTo", "void", [
          "number",
          "number",
          "number",
        ]),
        FPDFPath_Close: opt("FPDFPath_Close", "void", [
          "number",
        ]),
        FPDFPath_SetDrawMode: opt("FPDFPath_SetDrawMode", "void", [
          "number",
          "number",
          "number",
        ]),
        FPDFAnnot_AppendObject: opt("FPDFAnnot_AppendObject", "number", [
          "number",
          "number",
        ]),
        FPDFAnnot_UpdateObject: opt("FPDFAnnot_UpdateObject", "number", [
          "number",
          "number",
        ]),
        FPDFText_LoadStandardFont: opt(
          "FPDFText_LoadStandardFont",
          "number",
          ["number", "string", "number"],
        ),
        FPDFPageObj_CreateTextObj: opt(
          "FPDFPageObj_CreateTextObj",
          "number",
          ["number", "number", "number"],
        ),
        FPDFText_SetText: opt("FPDFText_SetText", "number", [
          "number",
          "string",
        ]),
        FPDFPage_InsertObject: opt("FPDFPage_InsertObject", "void", [
          "number",
          "number",
        ]),
        FPDFPageObj_Transform: opt("FPDFPageObj_Transform", "void", [
          "number",
          "number",
          "number",
          "number",
          "number",
          "number",
        ]),
        FPDFPage_GenerateContent: opt("FPDFPage_GenerateContent", "number", [
          "number",
        ]),
        FPDFAnnot_SetQuadPoints: opt("FPDFAnnot_SetQuadPoints", "number", [
          "number",
          "number",
          "number",
        ]),
        FPDFAnnot_AppendQuadPoints: opt(
          "FPDFAnnot_AppendQuadPoints",
          "number",
          ["number", "number"],
        ),
        FPDFAnnot_GetQuadPointsCount: opt(
          "FPDFAnnot_GetQuadPointsCount",
          "number",
          ["number"],
        ),
        FPDFAnnot_SetAP: opt("FPDFAnnot_SetAP", "number", [
          "number",
          "number",
          "number",
        ]),
        FPDFAnnot_GetAP: opt("FPDFAnnot_GetAP", "number", [
          "number",
          "number",
          "number",
          "number",
        ]),
      };
      return;
    }
    const E = M && (M.exports || M);
    if (!E) return;
    const pick = (n) => E[n] || E["_" + n] || null;
    this.exports = {
      PDFium_Init: pick("PDFium_Init"),
      FPDF_InitLibrary: pick("FPDF_InitLibrary"),
      FPDF_InitLibraryWithConfig: pick("FPDF_InitLibraryWithConfig"),
      FPDF_DestroyLibrary: pick("FPDF_DestroyLibrary"),
      FPDFPage_GenerateContent: pick("FPDFPage_GenerateContent"),
      FFI_SaveToBuffer: pick("FFI_SaveToBuffer"),
      FPDF_SaveAsCopy: pick("FPDF_SaveAsCopy"),
      FPDF_SaveWithVersion: pick("FPDF_SaveWithVersion"),
      FFI_Init: pick("FFI_Init"),
      FFI_Exit: pick("FFI_Exit"),
      FPDF_GetLastError: pick("FPDF_GetLastError"),
      FPDF_LoadMemDocument: pick("FPDF_LoadMemDocument"),
      FPDF_LoadDocument: pick("FPDF_LoadDocument"),
      FPDF_CloseDocument: pick("FPDF_CloseDocument"),
      FPDF_GetPageCount: pick("FPDF_GetPageCount"),
      FPDF_LoadPage: pick("FPDF_LoadPage"),
      FPDF_ClosePage: pick("FPDF_ClosePage"),
      FPDFPage_CreateAnnot: pick("FPDFPage_CreateAnnot"),
      FPDFPage_CloseAnnot: pick("FPDFPage_CloseAnnot"),
      FPDFAnnot_SetRect: pick("FPDFAnnot_SetRect"),
      FPDFAnnot_SetBorder: pick("FPDFAnnot_SetBorder"),
      FPDFAnnot_SetColor: pick("FPDFAnnot_SetColor"),
      FPDFAnnot_AddInkStroke: pick("FPDFAnnot_AddInkStroke"),
      FPDF_GetPageWidthF:
        pick("FPDF_GetPageWidthF") || pick("FPDF_GetPageWidth"),
      FPDF_GetPageHeightF:
        pick("FPDF_GetPageHeightF") || pick("FPDF_GetPageHeight"),
      FPDFBitmap_Create: pick("FPDFBitmap_Create"),
      FPDFBitmap_Destroy: pick("FPDFBitmap_Destroy"),
      FPDFBitmap_FillRect: pick("FPDFBitmap_FillRect"),
      FPDFBitmap_GetBuffer: pick("FPDFBitmap_GetBuffer"),
      FPDFBitmap_GetStride: pick("FPDFBitmap_GetStride"),
      FPDF_RenderPageBitmap: pick("FPDF_RenderPageBitmap"),
      FPDFPageObj_CreateNewPath: pick("FPDFPageObj_CreateNewPath"),
      FPDFPath_MoveTo: pick("FPDFPath_MoveTo"),
      FPDFPath_LineTo: pick("FPDFPath_LineTo"),
      FPDFPath_Close: pick("FPDFPath_Close"),
      FPDFPath_SetDrawMode: pick("FPDFPath_SetDrawMode"),
      FPDFAnnot_AppendObject: pick("FPDFAnnot_AppendObject"),
      FPDFAnnot_UpdateObject: pick("FPDFAnnot_UpdateObject"),
      FPDFAvail_Create: pick("FPDFAvail_Create"),
      FPDFAvail_Destroy: pick("FPDFAvail_Destroy"),
      FPDFAvail_IsDocAvail: pick("FPDFAvail_IsDocAvail"),
      FPDFAvail_GetDocument: pick("FPDFAvail_GetDocument"),
      FPDFAvail_IsPageAvail: pick("FPDFAvail_IsPageAvail"),
      FPDFAvail_GetFirstPageNum: pick("FPDFAvail_GetFirstPageNum"),
      
      FPDFPage_GetAnnotCount: pick("FPDFPage_GetAnnotCount"),
      FPDFPage_GetAnnot: pick("FPDFPage_GetAnnot"),
      FPDFAnnot_GetSubtype: pick("FPDFAnnot_GetSubtype"),
      FPDFAnnot_GetRect: pick("FPDFAnnot_GetRect"),
      FPDFAnnot_GetFormFieldType: pick("FPDFAnnot_GetFormFieldType"),
      FPDFAnnot_GetFormFieldName: pick("FPDFAnnot_GetFormFieldName"),
      FPDFAnnot_GetFormFieldValue: pick("FPDFAnnot_GetFormFieldValue"),
      FPDFAnnot_SetStringValue: pick("FPDFAnnot_SetStringValue"),
      FPDFAnnot_GetStringValue: pick("FPDFAnnot_GetStringValue"),
      FPDFText_LoadPage: pick("FPDFText_LoadPage"),
      FPDFText_ClosePage: pick("FPDFText_ClosePage"),
      FPDFText_CountChars: pick("FPDFText_CountChars"),
      FPDFText_GetCharBox: pick("FPDFText_GetCharBox"),
      FPDFText_CountRects: pick("FPDFText_CountRects"),
      FPDFText_GetRect: pick("FPDFText_GetRect"),
      FPDFAnnot_SetQuadPoints: pick("FPDFAnnot_SetQuadPoints"),
      FPDFAnnot_AppendQuadPoints: pick("FPDFAnnot_AppendQuadPoints"),
      FPDFAnnot_GetQuadPointsCount: pick("FPDFAnnot_GetQuadPointsCount"),
    };
  }

  /**
   * Reports which feature groups are available based on bound exports.
   * @returns {{init:boolean,loadMem:boolean,loadDoc:boolean,avail:boolean,page:boolean,render:boolean}}
   */
  getCapabilities() {
    const e = this.exports || {};
    return {
      init: !!(
        e.PDFium_Init ||
        e.FPDF_InitLibrary ||
        e.FPDF_InitLibraryWithConfig
      ),
      loadMem: !!e.FPDF_LoadMemDocument,
      loadDoc: !!e.FPDF_LoadDocument,
      avail: !!(e.FPDFAvail_Create && e.FPDFAvail_GetDocument),
      page: !!(
        e.FPDF_GetPageCount &&
        e.FPDF_LoadPage &&
        (e.FPDF_GetPageWidthF || e.FPDF_GetPageWidth)
      ),
      render: !!(
        e.FPDFBitmap_Create &&
        e.FPDFBitmap_GetBuffer &&
        e.FPDFBitmap_GetStride &&
        e.FPDF_RenderPageBitmap
      ),
    };
  }

  /**
   * Ensures memory views are ready and installs a bump allocator fallback when needed.
   * @returns {boolean} True if an allocator is available.
   */
  ensureAllocator() {
    const M = this.Module;
    if (!M) return false;
    if (!M.HEAPU8 && M.HEAP8 && M.HEAP8.buffer) {
      M.HEAPU8 = new Uint8Array(M.HEAP8.buffer);
    }
    if (!M.HEAPU8) return false;

    if (typeof M._malloc === "function") return true;
    if (typeof M._free !== "function") M._free = () => {};

    try {
      const align16 = (n) => (n + 15) & ~15;
      const W = (M && (M.wasmExports || M.exports)) || null;
      const mem = (W && W.memory) || M.memory || null;
      const refreshViews = () => {
        const b = (mem && mem.buffer) || M.HEAPU8.buffer;
        M.HEAP8 = new Int8Array(b);
        M.HEAPU8 = new Uint8Array(b);
        M.HEAP16 = new Int16Array(b);
        M.HEAPU16 = new Uint16Array(b);
        M.HEAP32 = new Int32Array(b);
        M.HEAPU32 = new Uint32Array(b);
        M.HEAPF32 = new Float32Array(b);
        M.HEAPF64 = new Float64Array(b);
      };
      refreshViews();
      if (
        typeof M.__bump_ptr !== "number" ||
        typeof M.__bump_limit !== "number"
      ) {
        const heapBytes = M.HEAPU8.length >>> 0;
        const start = align16((heapBytes * 3) >>> 2);
        M.__bump_ptr = start;
        M.__bump_limit = heapBytes;
      }
      M._malloc = (n) => {
        n = align16(n >>> 0);
        if (M.__bump_ptr + n > M.__bump_limit) {
          if (mem && typeof mem.grow === "function") {
            const pageSize = 65536;
            const need = M.__bump_ptr + n - M.__bump_limit + 256 * 1024;
            const pages = Math.ceil(need / pageSize);
            try {
              mem.grow(pages);
              refreshViews();
              M.__bump_limit = M.HEAPU8.length >>> 0;
            } catch (e) {
              throw new Error("Out of memory (grow failed): " + e.message);
            }
          } else {
            throw new Error("Out of memory (bump allocator)");
          }
        }
        const p = M.__bump_ptr;
        M.__bump_ptr += n;
        return p;
      };
      this._bumpEnabled = true;
      console.warn(
        "Using bump allocator fallback: wasm malloc/free not exported.",
      );
      return true;
    } catch (e) {
      console.warn("Failed to enable bump allocator:", e.message);
      return false;
    }
  }

  /**
   * Returns a function that adds JS callbacks to the WASM table.
   * Prefers Emscripten addFunction; falls back to WebAssembly.Table.
   * @returns {(fn:Function, sig?:string)=>number|null}
   */
  _getAddFunction() {
    const M = this.Module || {};
    if (typeof M.addFunction === 'function') {
      return (fn, sig) => M.addFunction(fn, sig || 'v');
    }
    const W = (M && (M.wasmExports || M.exports)) || null;
    const tbl = (W && W.__indirect_function_table) || this._table;
    const WF = (typeof WebAssembly !== 'undefined') && WebAssembly.Function;
    if (tbl instanceof WebAssembly.Table) {
      return (fn, sig) => {
        let f = fn;
        try {
          if (WF && sig) {
            const ret = sig[0] === 'v' ? [] : ['i'];
            const params = Array.from(sig.slice(1)).map(() => 'i');
            f = new WF({ parameters: params, results: ret }, fn);
          }
        } catch {}
        const idx = tbl.length;
        tbl.grow(1);
        tbl.set(idx, f);
        return idx;
      };
    }
    return null;
  }

  /**
   * Calls the appropriate PDFium initialization export if available.
   * @returns {void}
   */
  initLibrary() {
    if (this.exports.PDFium_Init) {
      try {
        this.exports.PDFium_Init();
      } catch (e) {
        console.warn("PDFium_Init failed (ignored):", e.message);
      }
    } else if (this.exports.FPDF_InitLibrary) {
      try {
        this.exports.FPDF_InitLibrary();
      } catch (e) {
        console.warn("FPDF_InitLibrary failed (ignored):", e.message);
      }
    } else if (this.exports.FPDF_InitLibraryWithConfig) {
      try {
        this.exports.FPDF_InitLibraryWithConfig(0);
      } catch (e) {
        console.warn("FPDF_InitLibraryWithConfig failed (ignored):", e.message);
      }
    } else {
      console.info(
        "No FPDF_InitLibrary export; proceeding without explicit init.",
      );
    }
  }
  /**
   * Destroys the PDFium library if supported by this build.
   * @returns {void}
   */
  destroyLibrary() {
    this.exports.FPDF_DestroyLibrary();
  }

  /**
   * Loads a PDF document from an ArrayBuffer using memory or progressive APIs.
   * @param {ArrayBuffer} buf - The raw PDF bytes.
   * @param {string|null} [password=null] - Optional document password.
   * @returns {number} Document handle (0 on failure).
   */
  loadDocumentFromArrayBuffer(buf, password = null) {
    const size = buf.byteLength >>> 0;
    const BIG = 512 * 1024 * 1024;
    const hasMemAPI = !!this.exports.FPDF_LoadMemDocument;
    if (hasMemAPI && size <= BIG) {
      const allocReady = this.ensureAllocator();
      if (allocReady) {
        console.log("[pdfium] load: FPDF_LoadMemDocument");
        const ptr = this.Module._malloc(size);
        if (typeof ptr !== "number" || ptr <= 0)
          throw new Error("malloc failed");
        this.Module.HEAPU8.set(new Uint8Array(buf), ptr);
        const doc = this.exports.FPDF_LoadMemDocument(
          ptr,
          size,
          password ? password : 0,
        );
        if (!doc)
          throw new Error(
            "FPDF_LoadMemDocument failed: " +
              (this.exports.FPDF_GetLastError
                ? this.exports.FPDF_GetLastError()
                : "unknown"),
          );
        const rec = { kind: "mem", ptr, len: size, bufRef: buf };
        try {
          if (this.exports.FFI_Init) {
            const env = this.exports.FFI_Init(doc);
            if (env) rec.formEnv = env;
          }
        } catch {}
        this._docs.set(doc, rec);
        this._currentDoc = doc;
        return doc;
      }
    }

    const addFn = this._getAddFunction();
    if (
      this.exports.FPDFAvail_Create &&
      this.exports.FPDFAvail_GetDocument &&
      addFn
    ) {
      console.log("[pdfium] load: FPDFAvail progressive");
      const M = this.Module;
      const HEAP32 = M.HEAP32 || new Int32Array(M.HEAPU8.buffer);
      const intSize = 4;
      let isDataAvailFn, getBlockFn, addSegmentFn;
      let fileAvailPtr = 0,
        fileAccessPtr = 0,
        hintsPtr = 0;
      try {
        isDataAvailFn = addFn((pThis, offset, sz) => 1, "iiii");
        getBlockFn = addFn((param, pos, pBuf, sz) => {
          const u8 = new Uint8Array(buf);
          M.HEAPU8.set(u8.subarray(pos, pos + sz), pBuf >>> 0);
          return 1;
        }, "iiiii");
        addSegmentFn = addFn((pThis, offset, sz) => {}, "viii");

        fileAvailPtr = M._malloc(2 * intSize);
        HEAP32[fileAvailPtr >> 2] = 1;
        HEAP32[(fileAvailPtr + intSize) >> 2] = isDataAvailFn;
        fileAccessPtr = M._malloc(3 * intSize);
        HEAP32[fileAccessPtr >> 2] = size;
        HEAP32[(fileAccessPtr + intSize) >> 2] = getBlockFn;
        HEAP32[(fileAccessPtr + 2 * intSize) >> 2] = 0;
        hintsPtr = M._malloc(2 * intSize);
        HEAP32[hintsPtr >> 2] = 1;
        HEAP32[(hintsPtr + intSize) >> 2] = addSegmentFn;

        const avail = this.exports.FPDFAvail_Create(
          fileAvailPtr,
          fileAccessPtr,
        );
        if (!avail) throw new Error("FPDFAvail_Create failed");
        let ok = -1;
        try {
          ok = this.exports.FPDFAvail_IsDocAvail(avail, hintsPtr);
        } catch {}
        const doc = this.exports.FPDFAvail_GetDocument(avail, 0);
        if (!doc) throw new Error("FPDFAvail_GetDocument failed");
        const rec = {
          kind: "progressive",
          bufRef: buf,
          avail,
          fileAvailPtr,
          fileAccessPtr,
          hintsPtr,
          isDataAvailFn,
          getBlockFn,
          addSegmentFn,
        };
        try {
          if (this.exports.FFI_Init) {
            const env = this.exports.FFI_Init(doc);
            if (env) rec.formEnv = env;
          }
        } catch {}
        this._docs.set(doc, rec);
        this._currentDoc = doc;
        return doc;
      } catch (e) {
        console.warn("[pdfium] progressive unavailable:", e.message);
        try {
          fileAvailPtr && M._free(fileAvailPtr);
        } catch {}
        try {
          fileAccessPtr && M._free(fileAccessPtr);
        } catch {}
        try {
          hintsPtr && M._free(hintsPtr);
        } catch {}
      }
    }
    throw new Error(
      "Neither memory nor file-based load APIs available in this build.",
    );
  }

  /**
   * Returns the number of pages in the given document.
   * @param {number} doc - Document handle.
   * @returns {number} Page count.
   */
  getPageCount(doc) {
    return this.exports.FPDF_GetPageCount(doc) >>> 0;
  }
  /**
   * Loads and returns a page handle, performing progressive availability checks when needed.
   * @param {number} doc - Document handle.
   * @param {number} index - Zero-based page index.
   * @returns {number} Page handle (0 on failure).
   */
  loadPage(doc, index) {
    const rec = this._docs.get(doc);
    if (
      rec &&
      rec.kind === "progressive" &&
      this.exports.FPDFAvail_IsPageAvail
    ) {
      try {
        this.exports.FPDFAvail_IsPageAvail(rec.avail, index, rec.hintsPtr);
      } catch {}
    }
    let page = this.exports.FPDF_LoadPage(doc, index);
    if (!page) {
      const M = this.Module;
      const W = (M && (M.wasmExports || M.exports)) || null;
      const mem = (W && W.memory) || M.memory || null;
      if (mem && typeof mem.grow === "function") {
        for (let i = 0; i < 4 && !page; i++) {
          try {
            mem.grow(256);
          } catch {
            break;
          }
          try {
            const b = mem.buffer;
            M.HEAP8 = new Int8Array(b);
            M.HEAPU8 = new Uint8Array(b);
            M.HEAP16 = new Int16Array(b);
            M.HEAPU16 = new Uint16Array(b);
            M.HEAP32 = new Int32Array(b);
            M.HEAPU32 = new Uint32Array(b);
            M.HEAPF32 = new Float32Array(b);
            M.HEAPF64 = new Float64Array(b);
          } catch {}
          try {
            page = this.exports.FPDF_LoadPage(doc, index);
          } catch {
            page = 0;
          }
        }
      }
    }
    try {
      const rec = this._docs.get(doc) || {};
      const env = rec.formEnv || 0;
      if (this.exports.FFI_RegisterPage) { this.exports.FFI_RegisterPage(doc, index, page); }
      if (env && this.exports.FORM_OnAfterLoadPage) { this.exports.FORM_OnAfterLoadPage(page, env); }
    } catch {}
    this._currentPage = page;
    return page;
  }
  /**
   * Closes a page handle and notifies the form engine lifecycle.
   * @param {number} page - Page handle.
   * @returns {void}
   */
  closePage(page) {
    try {
      const rec = this._docs.get(this._currentDoc) || {};
      const env = rec.formEnv || 0;
      if (env && this.exports.FORM_OnBeforeClosePage) {
        this.exports.FORM_OnBeforeClosePage(page, env);
      }
      if (this.exports.FFI_UnregisterPage) { }
    } catch {}
    this.exports.FPDF_ClosePage(page);
  }
  /**
   * Closes a document and releases any associated resources.
   * @param {number} doc - Document handle.
   * @returns {void}
   */
  closeDocument(doc) {
    if (!doc) return;
    try {
      const rec = this._docs.get(doc);
      if (rec && rec.formEnv && this.exports.FFI_Exit) {
        try { this.exports.FFI_Exit(rec.formEnv); } catch {}
        rec.formEnv = 0;
      }
    } catch {}
    try {
      this.exports.FPDF_CloseDocument && this.exports.FPDF_CloseDocument(doc);
    } catch {}
    const rec = this._docs.get(doc);
    if (
      rec &&
      rec.kind === "mem" &&
      rec.ptr &&
      typeof this.Module._free === "function"
    ) {
      try {
        this.Module._free(rec.ptr);
      } catch {}
    }
    if (rec && rec.kind === "progressive") {
      try {
        this.exports.FPDFAvail_Destroy &&
          this.exports.FPDFAvail_Destroy(rec.avail);
      } catch {}
      try {
        this.Module._free && this.Module._free(rec.fileAvailPtr);
      } catch {}
      try {
        this.Module._free && this.Module._free(rec.fileAccessPtr);
      } catch {}
      try {
        this.Module._free && this.Module._free(rec.hintsPtr);
      } catch {}
    }
    this._docs.delete(doc);
  }
  /**
   * Reopens a document using pinned memory or a retained buffer reference.
   * @param {number} oldDoc - Previous document handle.
   * @returns {number} New document handle (0 on failure).
   */
  reloadDocument(oldDoc) {
    const rec = this._docs.get(oldDoc);
    if (!rec) return 0;
    try {
      this.exports.FPDF_CloseDocument &&
        this.exports.FPDF_CloseDocument(oldDoc);
    } catch {}
    this._docs.delete(oldDoc);

    if (rec.bufRef && this.exports.FPDF_LoadMemDocument) {
      try {
        const buf = rec.bufRef;
        const ptr = this.Module._malloc(buf.byteLength);
        this.Module.HEAPU8.set(new Uint8Array(buf), ptr);
        const doc = this.exports.FPDF_LoadMemDocument(ptr, buf.byteLength, 0);
        if (doc) {
          try {
            if (rec.ptr && this.Module._free) this.Module._free(rec.ptr);
          } catch {}
          const newRec = { kind: "mem", ptr, len: buf.byteLength, bufRef: buf };
          try {
            if (this.exports.FFI_Init) {
              const env = this.exports.FFI_Init(doc);
              if (env) newRec.formEnv = env;
            }
          } catch {}
          this._docs.set(doc, newRec);
          return doc;
        }
      } catch {}
    }
    if (rec.kind === "mem" && rec.ptr && rec.len) {
      try {
        const doc = this.exports.FPDF_LoadMemDocument(rec.ptr, rec.len, 0);
        if (doc) {
          const newRec = { ...rec };
          try {
            if (this.exports.FFI_Init) {
              const env = this.exports.FFI_Init(doc);
              if (env) newRec.formEnv = env;
            }
          } catch {}
          this._docs.set(doc, newRec);
          return doc;
        }
      } catch {}
    }
    return 0;
  }
  /**
   * Returns the width and height of a page in points.
   * @param {number} page - Page handle.
   * @returns {{width:number,height:number}} Page size.
   */
  getPageSize(page) {
    let w = 0,
      h = 0;
    try {
      w = this.exports.FPDF_GetPageWidthF
        ? this.exports.FPDF_GetPageWidthF(page)
        : 0;
    } catch {}
    try {
      h = this.exports.FPDF_GetPageHeightF
        ? this.exports.FPDF_GetPageHeightF(page)
        : 0;
    } catch {}
    if (
      (!w || !h) &&
      this.exports.FPDF_GetPageWidth &&
      this.exports.FPDF_GetPageHeight
    ) {
      try {
        w = w || this.exports.FPDF_GetPageWidth(page);
      } catch {}
      try {
        h = h || this.exports.FPDF_GetPageHeight(page);
      } catch {}
    }
    if (!w || !h) {
      w = 612;
      h = 792;
    }
    return { width: w, height: h };
  }

  /**
   * Renders a page into a canvas 2D context.
   * @param {number} page - Page handle.
   * @param {HTMLCanvasElement} canvas - Target canvas element.
   * @param {{devicePixelRatio?:number,targetWidth?:number,offsetX?:number,offsetY?:number}} [opts] - Render options.
   * @returns {{width:number,height:number,scale:number}} Rendered bitmap size and scale.
   */
  renderPageToCanvas(page, canvas, opts = {}) {
    if (
      !this.exports.FPDFBitmap_Create ||
      !this.exports.FPDF_RenderPageBitmap
    ) {
      throw new Error("Rendering APIs not exported by this PDFium build.");
    }
    const ctx = canvas.getContext("2d");
    const dpr = Math.max(
      1,
      opts.devicePixelRatio || window.devicePixelRatio || 1,
    );
    const targetCssWidth = Math.max(
      1,
      Math.floor(opts.targetWidth || canvas.width),
    );
    const size = this.getPageSize(page);
    const scale = targetCssWidth / size.width;
    const targetCssHeight = Math.max(1, Math.floor(size.height * scale));
    const width = Math.max(1, Math.floor(targetCssWidth * dpr));
    const height = Math.max(1, Math.floor(targetCssHeight * dpr));
    canvas.width = width;
    canvas.height = height;

    const rotate = 0;
    const FPDF_ANNOT = 0x01;
    const FPDF_LCD_TEXT = 0x02;
    const FPDF_GRAYSCALE = 0x08;
    const FPDF_REVERSE_BYTE_ORDER = 0x10;
    const FPDF_PRINTING = 0x200;
    const tryCombos = [
      {
        flags: FPDF_ANNOT | FPDF_LCD_TEXT,
        swap: true,
        note: "ANNOT|LCD + swap",
      },
      {
        flags: FPDF_ANNOT | FPDF_LCD_TEXT | FPDF_REVERSE_BYTE_ORDER,
        swap: false,
        note: "ANNOT|LCD|REVERSE no-swap",
      },
      {
        flags: FPDF_ANNOT | FPDF_PRINTING,
        swap: true,
        note: "ANNOT|PRINTING + swap",
      },
      {
        flags: FPDF_ANNOT | FPDF_GRAYSCALE,
        swap: true,
        note: "ANNOT|GRAYSCALE + swap",
      },
    ];
    let rendered = false;
    const dx = Math.floor(opts.offsetX || 0);
    const dy = Math.floor(opts.offsetY || 0);
    for (const combo of tryCombos) {
      const bitmap = this.exports.FPDFBitmap_Create(width, height, 0);
      if (!bitmap) continue;
      this.exports.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff);
      try {
        const rec = this._docs.get(this._currentDoc) || {};
        const env = rec.formEnv || 0;
        const doFFL = env && this.exports.FPDF_FFLDraw && !this._skipFFLPages.has(page);
        const suppressAnnot = this._skipFFLPages.has(page);
        const flags = suppressAnnot ? (combo.flags & ~FPDF_ANNOT) : combo.flags;
        this.exports.FPDF_RenderPageBitmap(
          bitmap,
          page,
          0,
          0,
          width,
          height,
          rotate,
          flags,
        );
        try {
          if (doFFL) {
            this.exports.FPDF_FFLDraw(
              env,
              bitmap,
              page,
              0,
              0,
              width,
              height,
              rotate,
              combo.flags,
            );
          }
        } catch {}
      } catch (e) {
        console.warn(
          "[pdfium] RenderPageBitmap failed with flags",
          combo.flags,
          "→ retry without annotations",
          e.message,
        );
        try {
          const rec2 = this._docs.get(this._currentDoc) || {};
          const env2 = rec2.formEnv || 0;
          const doFFL2 = env2 && this.exports.FPDF_FFLDraw && !this._skipFFLPages.has(page);
          this.exports.FPDF_RenderPageBitmap(
            bitmap,
            page,
            0,
            0,
            width,
            height,
            rotate,
            0,
          );
          try {
            if (doFFL2) {
              this.exports.FPDF_FFLDraw(
                env2,
                bitmap,
                page,
                0,
                0,
                width,
                height,
                rotate,
                0,
              );
            }
          } catch {}
        } catch (e2) {
          this.exports.FPDFBitmap_Destroy(bitmap);
          console.warn(
            "[pdfium] render fallback without annotations failed:",
            e2 && e2.message ? e2.message : e2,
          );
          continue;
        }
      }
      const ptr = this.exports.FPDFBitmap_GetBuffer(bitmap);
      const stride = this.exports.FPDFBitmap_GetStride(bitmap);
      const src = new Uint8Array(
        this.Module.HEAPU8.buffer,
        ptr,
        stride * height,
      );

      let nonWhite = 0;
      for (let i = 0; i < src.length; i += 32) {
        const b = src[i + 0],
          g = src[i + 1],
          r = src[i + 2];
        if (!(r === 0xff && g === 0xff && b === 0xff)) {
          nonWhite++;
          break;
        }
      }
      if (nonWhite === 0 && combo !== tryCombos[tryCombos.length - 1]) {
        this.exports.FPDFBitmap_Destroy(bitmap);
        continue;
      }
      const data = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y++) {
        const srcRow = y * stride;
        const dstRow = y * width * 4;
        for (let x = 0; x < width; x++) {
          const s = srcRow + x * 4;
          const d = dstRow + x * 4;
          if (combo.swap) {
            data[d + 0] = src[s + 2];
            data[d + 1] = src[s + 1];
            data[d + 2] = src[s + 0];
            data[d + 3] = 255;
          } else {
            data[d + 0] = src[s + 0];
            data[d + 1] = src[s + 1];
            data[d + 2] = src[s + 2];
            data[d + 3] = 255;
          }
        }
      }
      const imageData = new ImageData(data, width, height);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.putImageData(imageData, dx, dy);

      this.exports.FPDFBitmap_Destroy(bitmap);
      let sum = 0,
        min = 255,
        max = 0;
      for (let i = 0; i < src.length; i += 97) {
        const v = src[i];
        sum += v;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      console.log(
        "[pdfium] render combo used:",
        combo.note,
        "stride",
        stride,
        "minByte",
        min,
        "maxByte",
        max,
      );
      rendered = true;
      break;
    }
    if (!rendered) {
      console.warn(
        "[pdfium] render produced white image; PDF may require features missing in this build",
      );
      try {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
      } catch {}
    }
    return { width, height, scale };
  }

  /**
   * Adds an ink annotation to the page.
   * @param {number} page - Page handle.
   * @param {{x:number,y:number}[]} points - Stroke points in page coordinates.
   * @returns {boolean} True on success.
   */
  addInk(page, points) {
    const E = this.exports;
    if (!E.FPDFPage_CreateAnnot || !E.FPDFAnnot_AddInkStroke) {
      console.warn("Ink not available: missing annotation exports");
      return false;
    }
    const INK = 15;
    const annot = E.FPDFPage_CreateAnnot(page, INK);
    this._log('addInk: create annot', { annot });
    if (!annot) return false;
    try {
      const n = points.length;
      if (n < 2) return false;
      const buf = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        buf[i * 2 + 0] = points[i].x;
        buf[i * 2 + 1] = points[i].y;
      }
      const bytes = buf.byteLength;
      const ptr = this.Module._malloc(bytes);
      new Uint8Array(this.Module.HEAPU8.buffer, ptr, bytes).set(
        new Uint8Array(buf.buffer),
      );
      const ok = E.FPDFAnnot_AddInkStroke(annot, ptr, n);
      this._log('addInk: AddInkStroke ret', ok);
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      const pad = 2;
      const rectBuf = new Float32Array([
        minX - pad,
        maxY + pad,
        maxX + pad,
        minY - pad,
      ]);
      const rectPtr = this.Module._malloc(rectBuf.byteLength);
      new Uint8Array(
        this.Module.HEAPU8.buffer,
        rectPtr,
        rectBuf.byteLength,
      ).set(new Uint8Array(rectBuf.buffer));
      if (E.FPDFAnnot_SetRect) {
        const rset = E.FPDFAnnot_SetRect(annot, rectPtr);
        this._log('addInk: SetRect ret', rset);
      }
      if (E.FPDFAnnot_SetColor) {
        const cset = E.FPDFAnnot_SetColor(annot, 0, 0, 0, 255, 255);
        this._log('addInk: SetColor ret', cset);
      }
      try {
        if (
          E.FPDFPageObj_CreateNewPath &&
          E.FPDFPath_MoveTo &&
          E.FPDFPath_LineTo &&
          E.FPDFPath_SetDrawMode &&
          E.FPDFAnnot_AppendObject &&
          E.FPDFAnnot_UpdateObject
        ) {
          const p0 = points[0];
          const path = E.FPDFPageObj_CreateNewPath(p0.x, p0.y);
          for (let i = 1; i < points.length; i++) {
            E.FPDFPath_LineTo(path, points[i].x, points[i].y);
          }
          E.FPDFPath_SetDrawMode(path, 0, 1);
          E.FPDFAnnot_AppendObject(annot, path);
          try { E.FPDFAnnot_UpdateObject(annot, path); } catch {}
        }
      } catch {}
      if (E.FPDFAnnot_SetBorder) {
        const bset = E.FPDFAnnot_SetBorder(annot, 0, 0, 2.0);
        this._log('addInk: SetBorder ret', bset);
      }
      try {
        if (E.FPDFPage_CloseAnnot) {
          E.FPDFPage_CloseAnnot(annot);
          this._log('addInk: CloseAnnot ok');
        }
      } catch (e) { this._log('addInk: CloseAnnot fail', e?.message || e); }
      try {
        if (E.FPDFPage_GenerateContent) {
          const gen = E.FPDFPage_GenerateContent(page);
          this._log('addInk: GenerateContent ret', gen);
        }
      } catch (e) { this._log('addInk: GenerateContent fail', e?.message || e); }
      try {
        if (E.FPDFPage_GetAnnotCount) {
          const cnt = E.FPDFPage_GetAnnotCount(page);
          this._log('addInk: annot count after', cnt);
        }
      } catch {}
      return ok !== 0;
    } catch (e) {
      console.warn("addInk failed:", e.message);
      return false;
    }
  }
  /**
   * Adds a stroked rectangle annotation.
   * @param {number} page - Page handle.
   * @param {{left:number,top:number,right:number,bottom:number}} rect - Rectangle in page coordinates.
   * @returns {boolean} True on success.
   */
  addRectangle(page, rect) {
    const E = this.exports;
    if (!E.FPDFPage_CreateAnnot || !E.FPDFAnnot_SetRect) {
      console.warn("Rectangle not available: missing annotation exports");
      return false;
    }
    const SQUARE = 5;
    const annot = E.FPDFPage_CreateAnnot(page, SQUARE);
    if (!annot) return false;
    try {
      const top = rect.top,
        bottom = rect.bottom,
        left = rect.left,
        right = rect.right;
      const buf = new Float32Array([left, top, right, bottom]);
      const ptr = this.Module._malloc(buf.byteLength);
      new Uint8Array(this.Module.HEAPU8.buffer, ptr, buf.byteLength).set(
        new Uint8Array(buf.buffer),
      );
      const ok = E.FPDFAnnot_SetRect(annot, ptr);
      this._log('addRectangle: SetRect ret', ok);
      if (E.FPDFAnnot_SetColor) E.FPDFAnnot_SetColor(annot, 0, 255, 165, 0, 255);
      try {
        if (
          E.FPDFPageObj_CreateNewPath &&
          E.FPDFPath_MoveTo &&
          E.FPDFPath_LineTo &&
          E.FPDFPath_Close &&
          E.FPDFPath_SetDrawMode &&
          E.FPDFAnnot_AppendObject &&
          E.FPDFAnnot_UpdateObject
        ) {
          const path = E.FPDFPageObj_CreateNewPath(rect.left, rect.bottom);
          E.FPDFPath_LineTo(path, rect.right, rect.bottom);
          E.FPDFPath_LineTo(path, rect.right, rect.top);
          E.FPDFPath_LineTo(path, rect.left, rect.top);
          E.FPDFPath_Close(path);
          E.FPDFPath_SetDrawMode(path, 0, 1);
          E.FPDFAnnot_AppendObject(annot, path);
          try { E.FPDFAnnot_UpdateObject(annot, path); } catch {}
        }
      } catch {}
      if (E.FPDFAnnot_SetBorder) E.FPDFAnnot_SetBorder(annot, 0, 0, 2.0);
      try { if (E.FPDFPage_CloseAnnot) { E.FPDFPage_CloseAnnot(annot); this._log('addRectangle: CloseAnnot ok'); } } catch (e) { this._log('addRectangle: CloseAnnot fail', e?.message || e); }
      try { if (E.FPDFPage_GenerateContent) { const g = E.FPDFPage_GenerateContent(page); this._log('addRectangle: GenerateContent', g); } } catch (e) { this._log('addRectangle: GenerateContent fail', e?.message || e); }
      return ok !== 0;
    } catch (e) {
      console.warn("addRectangle failed:", e.message);
      return false;
    }
  }
  /**
   * Adds a filled highlight rectangle annotation.
   * @param {number} page - Page handle.
   * @param {{left:number,top:number,right:number,bottom:number}} rect - Rectangle in page coordinates.
   * @returns {boolean} True on success.
   */
  addHighlight(page, rect) {
    const E = this.exports;
    if (!E.FPDFPage_CreateAnnot || !E.FPDFAnnot_SetRect) {
      console.warn("Highlight not available: missing annotation exports");
      return false;
    }
    const SQUARE = 5;
    const annot = E.FPDFPage_CreateAnnot(page, SQUARE);
    if (!annot) return false;
    try {
      const top = rect.top,
        bottom = rect.bottom,
        left = rect.left,
        right = rect.right;
      const buf = new Float32Array([left, top, right, bottom]);
      const ptr = this.Module._malloc(buf.byteLength);
      new Uint8Array(this.Module.HEAPU8.buffer, ptr, buf.byteLength).set(
        new Uint8Array(buf.buffer),
      );
      const ok = E.FPDFAnnot_SetRect(annot, ptr);
      this._log('addHighlight: SetRect ret', ok);
      try {
        if (E.FPDFAnnot_SetColor) {
          try {
            E.FPDFAnnot_SetColor(annot, 1, 255, 255, 0, 160);
          } catch {}
          try {
            E.FPDFAnnot_SetColor(annot, 0, 255, 255, 0, 160);
          } catch {}
        }
      } catch {}
      try {
        E.FPDFAnnot_SetBorder && E.FPDFAnnot_SetBorder(annot, 0, 0, 0.0);
      } catch {}
      try { if (E.FPDFPage_CloseAnnot) { E.FPDFPage_CloseAnnot(annot); this._log('addHighlight: CloseAnnot ok'); } } catch (e) { this._log('addHighlight: CloseAnnot fail', e?.message || e); }
      try { if (E.FPDFPage_GenerateContent) { const g = E.FPDFPage_GenerateContent(page); this._log('addHighlight: GenerateContent', g); } } catch (e) { this._log('addHighlight: GenerateContent fail', e?.message || e); }
      return ok !== 0;
    } catch (e) {
      console.warn("addHighlight failed:", e.message);
      return false;
    }
  }
  /**
   * Adds a FreeText annotation (not implemented in this build).
   * @param {number} page - Page handle.
   * @param {string} text - Text content.
   * @param {{x:number,y:number}} pt - Position in page coordinates.
   * @returns {boolean} Always false (not implemented).
   */
  addFreeText(page, text, pt) {
    console.warn(
      "FreeText annotation requires appearance generation; not implemented in this build.",
    );
    return false;
  }
  /**
   * Adds an image to the page (not implemented in this build).
   * @param {number} page - Page handle.
   * @param {HTMLCanvasElement} imageCanvas - Source image canvas.
   * @param {{left:number,top:number,right:number,bottom:number}} rect - Target rectangle.
   * @returns {boolean} Always false (not implemented).
   */
  addImage(page, imageCanvas, rect) {
    console.warn(
      "addImage not implemented for prebuilt WASM. Requires image object APIs.",
    );
    return false;
  }
  /**
   * Flattens annotations on the page (not implemented in this build).
   * @param {number} page - Page handle.
   * @returns {boolean} Always false (not implemented).
   */
  flatten(page) {
    console.warn(
      "flatten not implemented for prebuilt WASM. Requires annotation flatten APIs.",
    );
    return false;
  }
  /**
   * Saves the document to a Blob via buffer shim or callback writer.
   * Also normalizes widget appearances for better viewer compatibility.
   * @param {number} doc - Document handle.
   * @returns {Blob|null} PDF Blob on success, otherwise null.
   */
  saveDocument(doc) {
    try {
      if (!doc) throw new Error("no document");
      const E = this.exports || {};
      
      try {
        if (
          E.FPDF_GetPageCount &&
          E.FPDF_LoadPage &&
          E.FPDFPage_GetAnnotCount &&
          E.FPDFPage_GetAnnot &&
          E.FPDFAnnot_GetSubtype &&
          E.FPDFAnnot_SetAP
        ) {
          const pages = this.getPageCount(doc) >>> 0;
          for (let i = 0; i < pages; i++) {
            let page = 0;
            try { page = E.FPDF_LoadPage(doc, i) >>> 0; } catch {}
            if (!page) continue;
            try {
              const cnt = E.FPDFPage_GetAnnotCount(page) >>> 0;
              for (let j = 0; j < cnt; j++) {
                let a = 0;
                try { a = E.FPDFPage_GetAnnot(page, j) >>> 0; } catch {}
                if (!a) continue;
                let subtype = 0;
                try { subtype = E.FPDFAnnot_GetSubtype(a) >>> 0; } catch {}
                if (subtype !== 20) {
                  try { E.FPDFPage_CloseAnnot && E.FPDFPage_CloseAnnot(a); } catch {}
                  continue;
                }
                let isText = false;
                try {
                  if (E.FPDFAnnot_GetFormFieldType) {
                    const recEnv = this._docs.get(this._currentDoc) || {};
                    const env2 = recEnv.formEnv || 0;
                    if (env2) {
                      const t = E.FPDFAnnot_GetFormFieldType(env2, a) | 0;
                      isText = (t === 6);
                    }
                  }
                } catch {}
                if (!isText && E.FPDFAnnot_GetStringValue) {
                  try {
                    const cap = 64;
                    const p = this.Module._malloc(cap);
                    const got = E.FPDFAnnot_GetStringValue(a, 'FT', p, cap) | 0;
                    if (got > 0) {
                      const td = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-16le') : null;
                      if (td) {
                        const bytes = new Uint8Array(this.Module.HEAPU8.buffer, p, got);
                        const s = td.decode(bytes).replace(/\u0000+$/g, '');
                        if (/^Tx$/i.test(s)) isText = true;
                      }
                    }
                    this.Module._free(p);
                  } catch {}
                }
                if (isText) {
                  let pVal = 0;
                  try {
                    let needV = 0;
                    if (E.FPDFAnnot_GetStringValue)
                      needV = E.FPDFAnnot_GetStringValue(a, 'V', 0, 0) | 0;
                    if ((needV <= 2) && E.FPDFAnnot_GetFormFieldValue) {
                      const recEnv = this._docs.get(this._currentDoc) || {};
                      const env2 = recEnv.formEnv || 0;
                      let need = 0;
                      try { need = env2 ? (E.FPDFAnnot_GetFormFieldValue(env2, a, 0, 0) | 0) : 0; } catch {}
                      if (need > 0 && need < 65536) {
                        pVal = this.Module._malloc(need);
                        const got = env2 ? (E.FPDFAnnot_GetFormFieldValue(env2, a, pVal, need) | 0) : 0;
                        if (got <= 0) { this.Module._free(pVal); pVal = 0; }
                      }
                    }
                  } catch {}
                  try {
                    const W = (this.Module && (this.Module.wasmExports || this.Module.exports)) || null;
                    const setStr = (W && W.FPDFAnnot_SetStringValue) || E.FPDFAnnot_SetStringValue;
                    if (pVal) {
                      let did = 0;
                      try { if (E.FFI_SetFieldV) { did = E.FFI_SetFieldV(a, pVal) >>> 0; } } catch {}
                      if (!did && setStr) {
                        const kptr = this._allocUtf8('V');
                        try { setStr(a, kptr, pVal); } finally { this._freePtr(kptr); }
                      }
                    }
                  } catch {}
                  try {
                    if (E.FPDFAnnot_GetRect && E.FPDFPageObj_CreateTextObj && E.FPDFAnnot_AppendObject) {
                      try { E.FPDFAnnot_SetAP(a, 0, 0); } catch {}
                      const rectBuf = this.Module._malloc(16);
                      const okr = E.FPDFAnnot_GetRect(a, rectBuf) | 0;
                      if (okr) {
                        const f32 = new Float32Array(this.Module.HEAPU8.buffer, rectBuf, 4);
                        const left = f32[0], top = f32[1], right = f32[2], bottom = f32[3];
                        const height = Math.max(1, top - bottom);
                        let font = 0;
                        try { font = E.FPDFText_LoadStandardFont ? (E.FPDFText_LoadStandardFont(doc, "Helvetica") >>> 0) : 0; }
                        catch (e) { try { font = E.FPDFText_LoadStandardFont ? (E.FPDFText_LoadStandardFont(doc, "Helvetica", 0) >>> 0) : 0; } catch {} }
                        if (font) {
                          const size = Math.max(6, height * 0.7);
                          const textObj = E.FPDFPageObj_CreateTextObj(doc, font, size) >>> 0;
                          if (textObj) {
                            let hadVal = false;
                            let wptr = 0;
                            if (pVal) { wptr = pVal; hadVal = true; }
                            else {
                              try {
                                const need = E.FPDFAnnot_GetStringValue ? (E.FPDFAnnot_GetStringValue(a, 'V', 0, 0) | 0) : 0;
                                if (need > 2 && need < 65536) {
                                  wptr = this.Module._malloc(need);
                                  const got = E.FPDFAnnot_GetStringValue(a, 'V', wptr, need) | 0;
                                  hadVal = got > 2;
                                }
                              } catch {}
                            }
                            const W = (this.Module && (this.Module.wasmExports || this.Module.exports)) || null;
                            const setText = W && W.FPDFText_SetText;
                            if (setText && hadVal && wptr) {
                              const okSet = setText(textObj, wptr) | 0;
                              if (okSet) {
                                const e = left + 2.0;
                                const f = bottom + Math.max(1, height * 0.15);
                                E.FPDFPageObj_Transform && E.FPDFPageObj_Transform(textObj, 1, 0, 0, 1, e, f);
                                E.FPDFAnnot_AppendObject(a, textObj);
                                try { E.FPDFAnnot_UpdateObject(a, textObj); } catch {}
                              }
                            }
                            if (!pVal && wptr) { try { this.Module._free(wptr); } catch {} }
                          }
                        }
                      }
                      this.Module._free(rectBuf);
                    }
                  } catch {}
                  if (pVal) { try { this.Module._free(pVal); } catch {} }
                }
                try { E.FPDFPage_CloseAnnot && E.FPDFPage_CloseAnnot(a); } catch {}
              }
            } finally {
              try { E.FPDF_ClosePage && E.FPDF_ClosePage(page); } catch {}
            }
          }
        }
      } catch (e) { this._log && this._log('save: clear APs failed', e?.message || e); }
      
      try { if (E.FFI_SetNeedAppearances) { const na = E.FFI_SetNeedAppearances(doc, 1); this._log && this._log('save: SetNeedAppearances', na); } } catch {}
      
      if (!this._forceCallbackSave && typeof E.FFI_SaveToBuffer === "function") {
        const rec = this._docs.get(doc) || {};
        const base = (rec && (rec.len || (rec.bufRef && rec.bufRef.byteLength))) || 1024 * 1024;
        let cap = Math.max(256 * 1024, base + 512 * 1024);
        const maxCap = 256 * 1024 * 1024;
        for (;;) {
          const ptr = this.Module._malloc(cap);
          let wrote = -1;
          try {
            const FPDF_SAVE_FLAG_NO_INCREMENTAL = 1;
            wrote = E.FFI_SaveToBuffer(doc, ptr, cap, FPDF_SAVE_FLAG_NO_INCREMENTAL);
          } catch (e) {
            this.Module._free(ptr);
            throw e;
          }
          try { console.log("[save] FFI_SaveToBuffer", { cap, wrote }); } catch {}
          if (typeof wrote === "number" && wrote > 0 && wrote <= cap) {
            const out = new Uint8Array(this.Module.HEAPU8.buffer, ptr, wrote);
            const blob = new Blob([new Uint8Array(out)], { type: "application/pdf" });
            try { this.Module._free(ptr); } catch {}
            return blob;
          }
          if (wrote === 0) {
          }
          try { this.Module._free(ptr); } catch {}
          if (cap >= maxCap) throw new Error("save buffer too large");
          cap = Math.min(maxCap, cap * 2);
        }
      }
      const saveFn = E.FPDF_SaveAsCopy || E.FPDF_SaveWithVersion;
      if (!saveFn) throw new Error("save APIs not exported");
      const addFn = this._getAddFunction();
      if (!addFn) throw new Error("no addFunction/table to install callback");
      const M = this.Module;
      const HEAP32 = M.HEAP32 || new Int32Array(M.HEAPU8.buffer);
      const chunks = [];
      const writeBlock = (pThis, pData, size) => {
        try {
          const u8 = new Uint8Array(M.HEAPU8.buffer, pData >>> 0, size >>> 0);
          chunks.push(new Uint8Array(u8));
          return 1;
        } catch {
          return 0;
        }
      };
      let writeFnIdx;
      try {
        writeFnIdx = addFn(writeBlock, "iiii");
      } catch (e) {
        throw new Error("wasm table addFunction failed: " + (e?.message || e));
      }
      const intSize = 4;
      const fwPtr = M._malloc(3 * intSize);
      HEAP32[fwPtr >> 2] = 1;
      HEAP32[(fwPtr + intSize) >> 2] = writeFnIdx >>> 0;
      HEAP32[(fwPtr + 2 * intSize) >> 2] = 0;
      const FPDF_SAVE_FLAG_NO_INCREMENTAL = 1 << 0;
      const flags = 0;
      let ok = 0;
      try {
        if (E.FPDF_SaveAsCopy) ok = E.FPDF_SaveAsCopy(doc, fwPtr, flags);
        else ok = E.FPDF_SaveWithVersion(doc, fwPtr, flags, 0);
      } catch (e) {
        throw new Error("FPDF_Save failed: " + (e?.message || e));
      }
      try { console.log("[save] callback path ok=", ok, "chunks=", chunks.length, "bytes=", chunks.reduce((a,c)=>a+c.length,0)); } catch {}
      try { M._free(fwPtr); } catch {}
      if (!ok) throw new Error("FPDF_Save returned failure");
      const blob = new Blob(chunks, { type: "application/pdf" });
      return blob;
    } catch (e) {
      console.warn("saveDocument failed:", e.message);
      return null;
    }
  }
  /**
   * Enumerates form widget annotations on the page.
   * @param {number} page - Page handle.
   * @returns {Array<{handle:number,rect:{left:number,top:number,right:number,bottom:number},type:number,isSignature:boolean,fieldName?:string,ftString?:string,rawType?:number}>}
   */
  listWidgetFields(page) {
    const E = this.exports;
    const out = [];
    if (
      !E.FPDFPage_GetAnnotCount ||
      !E.FPDFPage_GetAnnot ||
      !E.FPDFAnnot_GetSubtype ||
      !E.FPDFAnnot_GetRect
    )
      return out;
    const count = E.FPDFPage_GetAnnotCount(page) >>> 0;
    const rec = this._docs.get(this._currentDoc) || {};
    const env = rec.formEnv || 0;
    const tdUTF16 =
      typeof TextDecoder !== "undefined" ? new TextDecoder("utf-16le") : null;
    for (let i = 0; i < count; i++) {
      const annot = E.FPDFPage_GetAnnot(page, i);
      if (!annot) continue;
      const subtype = E.FPDFAnnot_GetSubtype(annot) >>> 0;
      if (subtype !== 20) continue;
      const rectBuf = this.Module._malloc(16);
      const ok = E.FPDFAnnot_GetRect(annot, rectBuf);
      if (ok) {
        const f32 = new Float32Array(this.Module.HEAPU8.buffer, rectBuf, 4);
        const left = f32[0],
          top = f32[1],
          right = f32[2],
          bottom = f32[3];
        let rawType = null;
        try {
          if (E.FPDFAnnot_GetFormFieldType)
            rawType = env ? E.FPDFAnnot_GetFormFieldType(env, annot) : null;
        } catch {}
        let ftype = 0;
        if (
          typeof rawType === "number" &&
          Number.isFinite(rawType) &&
          rawType >= 0
        )
          ftype = rawType;
        let isSig = false;
        let fieldName = undefined;
        let ftString = "";
        try {
          if (E.FPDFAnnot_GetStringValue) {
            const cap = 512;
            const bufPtr = this.Module._malloc(cap);
            const got = E.FPDFAnnot_GetStringValue(annot, "FT", bufPtr, cap);
            if (got && got > 0 && tdUTF16) {
              const len = Math.min(got, cap);
              const bytes = new Uint8Array(
                this.Module.HEAPU8.buffer,
                bufPtr,
                len,
              );
              const txt = tdUTF16.decode(bytes).replace(/\u0000+$/g, "");
              ftString = txt;
              if (/Sig/i.test(txt)) isSig = true;
            }
            this.Module._free(bufPtr);
          }
          try {
            if (E.FPDFAnnot_GetFormFieldName && env) {
              const capN = 1024;
              const namePtr = this.Module._malloc(capN);
              const glen = E.FPDFAnnot_GetFormFieldName(env, annot, namePtr, capN);
              if (glen && glen > 0 && tdUTF16) {
                const lenN = Math.min(glen, capN);
                const nameBytes = new Uint8Array(
                  this.Module.HEAPU8.buffer,
                  namePtr,
                  lenN,
                );
                const nameTxt = tdUTF16
                  .decode(nameBytes)
                  .replace(/\u0000+$/g, "");
                if (/sig/i.test(nameTxt)) isSig = true;
                fieldName = nameTxt;
              }
              this.Module._free(namePtr);
            }
          } catch {}
        } catch {}
        if (!ftype || ftype === 0) {
          if (isSig)
            ftype = 7;
          else if (/Tx/i.test(ftString))
            ftype = 6;
          else if (/Ch/i.test(ftString))
            ftype = 4;
          else if (/Btn/i.test(ftString)) ftype = 1;
        }
        const rec = {
          handle: annot,
          rect: { left, top, right, bottom },
          type: ftype,
          isSignature: isSig,
          fieldName,
          ftString,
          rawType,
        };
        try {
          console.log("[forms] widget", {
            index: i,
            subtype,
            rect: rec.rect,
            type: rec.type,
            rawType: rec.rawType,
            isSignature: rec.isSignature,
            fieldName: rec.fieldName || "",
            ftString: rec.ftString || "",
            hasTypeFn: !!E.FPDFAnnot_GetFormFieldType,
          });
        } catch {}
        out.push(rec);
      }
      this.Module._free(rectBuf);
    }
    return out;
  }

  /**
   * Sets a text widget's value using the form engine and updates /V.
   * @param {number} annot - Annotation handle of the widget.
   * @param {string} text - New value.
   * @returns {boolean} True if form operations succeeded.
   */
  setTextFieldValue(annot, text) {
    const E = this.exports;
    try {
      const rec = this._docs.get(this._currentDoc) || {};
      let env = rec.formEnv || 0;
      if (!env && this.exports.FFI_Init && this._currentDoc) {
        try { env = this.exports.FFI_Init(this._currentDoc); if (env) { rec.formEnv = env; this._docs.set(this._currentDoc, rec); } } catch {}
      }
      const page = this._currentPage || 0;
      this._log('setTextFieldValue: inputs', { env: !!env, page, annot, hasFocusFn: !!E.FORM_SetFocusedAnnot, hasReplace: !!E.FORM_ReplaceSelection });
      if (env && E.FORM_SetFocusedAnnot && E.FORM_ReplaceSelection) {
        let okFocus = 0;
        try { okFocus = E.FORM_SetFocusedAnnot(env, annot) >>> 0; this._log('setTextFieldValue: SetFocusedAnnot(env,annot)=', okFocus); }
        catch (e) {
          try { okFocus = E.FORM_SetFocusedAnnot(env, page, annot) >>> 0; this._log('setTextFieldValue: SetFocusedAnnot(env,page,annot)=', okFocus); }
          catch (e2) { this._log('setTextFieldValue: SetFocusedAnnot failed', e2?.message || e2); okFocus = 0; }
        }
        const W = (this.Module && (this.Module.wasmExports || this.Module.exports)) || null;
        const rep = (W && W.FORM_ReplaceSelection) || E.FORM_ReplaceSelection;
        const wptr = this._allocWString(text || "");
        try {
          try { rep(env, page, wptr); this._log('setTextFieldValue: ReplaceSelection(env,page,wstr)'); }
          catch (e3) {
            this._log('setTextFieldValue: ReplaceSelection failed (page variant)', e3?.message || e3);
            try { rep(env, wptr); this._log('setTextFieldValue: ReplaceSelection(env,wstr)'); } catch (e4) { this._log('setTextFieldValue: ReplaceSelection failed', e4?.message || e4); }
          }
        } finally { this._freePtr(wptr); }
        try { if (E.FORM_ForceToKillFocus) { E.FORM_ForceToKillFocus(env); this._log('setTextFieldValue: KillFocus ok'); } } catch (e) { this._log('setTextFieldValue: KillFocus fail', e?.message || e); }
        try {
          const W = (this.Module && (this.Module.wasmExports || this.Module.exports)) || null;
          const setStr = (W && W.FPDFAnnot_SetStringValue) || E.FPDFAnnot_SetStringValue;
          if (setStr) {
            const kptr = this._allocUtf8('V');
            const vptr = this._allocWString(text || "");
            try {
              let okV = 0;
              try {
                if (E.FFI_SetFieldV) {
                  const ok = E.FFI_SetFieldV(annot, vptr) >>> 0;
                  this._log('setTextFieldValue: FFI_SetFieldV ok', ok);
                }
              } catch {}
              try {
                okV = setStr(annot, kptr, vptr) >>> 0;
                this._log('setTextFieldValue: SetStringValue(/V) ok', okV);
              } catch {}
            } finally {
              this._freePtr(kptr);
              this._freePtr(vptr);
            }
          }
        } catch (e) { this._log('setTextFieldValue: Set /V failed', e?.message || e); }
        if (this._clearAPOnEdit) {
          try {
            if (E.FPDFAnnot_GetAP) {
              const before = E.FPDFAnnot_GetAP(annot, 0, 0, 0) >>> 0;
              this._log('setTextFieldValue: AP len before', before);
            }
          } catch {}
          try {
            if (E.FPDFAnnot_SetAP) {
              const cleared = E.FPDFAnnot_SetAP(annot, 0, 0) >>> 0;
              this._log('setTextFieldValue: Clear AP (NORMAL)', cleared);
            }
          } catch (e) { this._log('setTextFieldValue: Clear AP failed', e?.message || e); }
          try {
            if (E.FPDFAnnot_GetAP) {
              const after = E.FPDFAnnot_GetAP(annot, 0, 0, 0) >>> 0;
              this._log('setTextFieldValue: AP len after', after);
            }
          } catch {}
        }
        try { if (E.FPDFPage_CloseAnnot) E.FPDFPage_CloseAnnot(annot); } catch {}
        
        try {
          if (E.FPDFAnnot_GetStringValue) {
            const cap = 256;
            const buf = this.Module._malloc(cap);
            const got = E.FPDFAnnot_GetStringValue(annot, 'V', buf, cap);
            const td = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-16le') : null;
            let v = '';
            if (got > 0 && td) {
              const bytes = new Uint8Array(this.Module.HEAPU8.buffer, buf, got);
              v = td.decode(bytes).replace(/\u0000+$/g, '');
            }
            this._log('setTextFieldValue: readback V', { got, v });
            this.Module._free(buf);
          }
        } catch {}
        return !!okFocus;
      }
      return false;
    } catch (e) {
      console.warn("setTextFieldValue failed:", e.message);
      return false;
    }
  }

  /**
   * Inserts a plain text page object at the given rectangle.
   * @param {number} doc - Document handle.
   * @param {number} page - Page handle.
   * @param {{left:number,top:number,right:number,bottom:number}} rect - Target rectangle.
   * @param {string} text - Text to insert.
   * @returns {boolean} True on success.
   */
  addTextContent(doc, page, rect, text) {
    const E = this.exports;
    try {
      let font = 0;
      try { font = E.FPDFText_LoadStandardFont ? (E.FPDFText_LoadStandardFont(doc, "Helvetica") >>> 0) : 0; }
      catch (e) { try { font = E.FPDFText_LoadStandardFont ? (E.FPDFText_LoadStandardFont(doc, "Helvetica", 0) >>> 0) : 0; } catch {} }
      const size = Math.max(6, (rect.top - rect.bottom) * 0.7);
      const textObj = E.FPDFPageObj_CreateTextObj ? E.FPDFPageObj_CreateTextObj(doc, font, size) : 0;
      if (!textObj) return false;
      const W = (this.Module && (this.Module.wasmExports || this.Module.exports)) || null;
      const setText = W && W.FPDFText_SetText;
      if (!setText) { this._log('addTextContent: no raw FPDFText_SetText'); return false; }
      const wptr = this._allocWString(text || "");
      try {
        const ok = setText(textObj, wptr);
        if (!ok) return false;
      } finally {
        this._freePtr(wptr);
      }
      const e = rect.left;
      const f = rect.bottom + (rect.top - rect.bottom) * 0.15;
      E.FPDFPageObj_Transform && E.FPDFPageObj_Transform(textObj, 1, 0, 0, 1, e, f);
      E.FPDFPage_InsertObject && E.FPDFPage_InsertObject(page, textObj);
      E.FPDFPage_GenerateContent && E.FPDFPage_GenerateContent(page);
      try { if (page) this._skipFFLPages.add(page); } catch {}
      return true;
    } catch (err) {
      console.warn("addTextContent failed:", err?.message || err);
      return false;
    }
  }

  /**
   * Allocates a NUL-terminated UTF-8 string in WASM memory.
   * @param {string} s - JavaScript string.
   * @returns {number} Pointer to UTF-8 bytes.
   */
  _allocUtf8(s) {
    const enc = new TextEncoder();
    const bytes = enc.encode(s + "\0");
    const p = this.Module._malloc(bytes.length);
    new Uint8Array(this.Module.HEAPU8.buffer, p, bytes.length).set(bytes);
    return p;
  }
  /**
   * Allocates a NUL-terminated UTF-16LE string in WASM memory.
   * @param {string} s - JavaScript string.
   * @returns {number} Pointer to UTF-16LE bytes.
   */
  _allocWString(s) {
    const u16 = new Uint16Array(s.length + 1);
    for (let i = 0; i < s.length; i++) u16[i] = s.charCodeAt(i);
    u16[s.length] = 0;
    const bytes = new Uint8Array(u16.buffer);
    const p = this.Module._malloc(bytes.length);
    new Uint8Array(this.Module.HEAPU8.buffer, p, bytes.length).set(bytes);
    return p;
  }
  /**
   * Frees a pointer previously allocated in WASM memory.
   * @param {number} p - Pointer to free.
   * @returns {void}
   */
  _freePtr(p) {
    try { if (p) this.Module._free(p); } catch {}
  }
  /**
   * Traces persistence of a text widget value through save and reload.
   * @param {number} annot - Annotation handle of the widget.
   * @param {string} text - Expected value to probe.
   * @returns {Promise<object>} Structured report with pre/post checks and blob info.
   */
  async debugTraceTextPersistence(annot, text) {
    const E = this.exports;
    const report = { pre: {}, post: {}, blob: {} };
    try {
      const rec = this._docs.get(this._currentDoc) || {};
      const env = rec.formEnv || 0;
      const td = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-16le') : null;
      
      try {
        if (env && E.FPDFAnnot_GetFormFieldValue) {
          const need = E.FPDFAnnot_GetFormFieldValue(env, annot, 0, 0) | 0;
          if (need > 0 && need < 65536) {
            const p = this.Module._malloc(need);
            const got = E.FPDFAnnot_GetFormFieldValue(env, annot, p, need) | 0;
            let v = '';
            if (got > 0 && td) v = td.decode(new Uint8Array(this.Module.HEAPU8.buffer, p, got)).replace(/\u0000+$/g, '');
            report.pre.formValue = { need, got, v };
            this.Module._free(p);
          } else {
            report.pre.formValue = { need };
          }
        }
      } catch (e) { report.pre.formValueError = e?.message || String(e); }
      
      try {
        if (E.FPDFAnnot_GetStringValue) {
          const need = E.FPDFAnnot_GetStringValue(annot, 'V', 0, 0) | 0;
          report.pre.widgetVNeed = need;
          if (need > 0 && need < 65536) {
            const p = this.Module._malloc(need);
            const got = E.FPDFAnnot_GetStringValue(annot, 'V', p, need) | 0;
            let v = '';
            if (got > 0 && td) v = td.decode(new Uint8Array(this.Module.HEAPU8.buffer, p, got)).replace(/\u0000+$/g, '');
            report.pre.widgetV = { got, v };
            this.Module._free(p);
          }
        }
      } catch (e) { report.pre.widgetVError = e?.message || String(e); }
      
      try {
        if (E.FPDFAnnot_GetLinkedAnnot && E.FPDFAnnot_GetStringValue) {
          const parent = E.FPDFAnnot_GetLinkedAnnot(annot, 'Parent') >>> 0;
          if (parent) {
            const need = E.FPDFAnnot_GetStringValue(parent, 'V', 0, 0) | 0;
            report.pre.parentVNeed = need;
            if (need > 0 && need < 65536) {
              const p = this.Module._malloc(need);
              const got = E.FPDFAnnot_GetStringValue(parent, 'V', p, need) | 0;
              let v = '';
              if (got > 0 && td) v = td.decode(new Uint8Array(this.Module.HEAPU8.buffer, p, got)).replace(/\u0000+$/g, '');
              report.pre.parentV = { got, v };
              this.Module._free(p);
            }
          } else {
            report.pre.parentMissing = true;
          }
        }
      } catch (e) { report.pre.parentVError = e?.message || String(e); }
      
      try { if (E.FPDFAnnot_GetAP) report.pre.apLen = E.FPDFAnnot_GetAP(annot, 0, 0, 0) | 0; } catch {}

      
      const blob = this.saveDocument(this._currentDoc);
      if (!blob) throw new Error('saveDocument returned null');
      report.blob.size = blob.size;
      try {
        const buf = await blob.arrayBuffer();
        const u8 = new Uint8Array(buf);
        report.blob.scan = {
          asciiFound: this._scanBytes(u8, (text || '').split('').map(c=>c.charCodeAt(0))),
          u16leFound: this._scanBytes(u8, this._u16leBytes(text || '')),
        };
      } catch (e) { report.blob.scanError = e?.message || String(e); }

      
      try {
        const buf = await blob.arrayBuffer();
        const doc2 = this.loadDocumentFromArrayBuffer(buf, null);
        const page2 = this.loadPage(doc2, 0);
        
        const list = this.listWidgetFields(page2);
        const vals = [];
        for (const w of list) {
          let v = ''; let got = 0;
          try {
            if (E.FPDFAnnot_GetStringValue) {
              const need = E.FPDFAnnot_GetStringValue(w.handle, 'V', 0, 0) | 0;
              if (need > 0 && need < 65536) {
                const p = this.Module._malloc(need);
                got = E.FPDFAnnot_GetStringValue(w.handle, 'V', p, need) | 0;
                const td2 = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-16le') : null;
                if (got > 0 && td2) v = td2.decode(new Uint8Array(this.Module.HEAPU8.buffer, p, got)).replace(/\u0000+$/g, '');
                this.Module._free(p);
              }
            }
          } catch {}
          let ap = 0; try { if (E.FPDFAnnot_GetAP) ap = E.FPDFAnnot_GetAP(w.handle, 0, 0, 0) | 0; } catch {}
          vals.push({ fieldName: w.fieldName || '', type: w.type, got, v, ap });
        }
        report.post.widgets = vals;
        this.closePage(page2);
        this.closeDocument(doc2);
      } catch (e) { report.post.error = e?.message || String(e); }
    } catch (e) {
      report.error = e?.message || String(e);
    }
    try { console.log('[debugTraceTextPersistence]', report); } catch {}
    return report;
  }

  /**
   * Encodes a string as a sequence of UTF-16LE bytes (low byte first).
   * @param {string} s - JavaScript string.
   * @returns {number[]} Byte sequence.
   */
  _u16leBytes(s) {
    const out = [];
    for (let i = 0; i < s.length; i++) { out.push(s.charCodeAt(i) & 0xFF, 0x00); }
    return out;
  }
  /**
   * Scans a byte buffer for a contiguous sequence of bytes.
   * @param {Uint8Array} u8 - Buffer to search.
   * @param {number[]} needle - Byte sequence to look for.
   * @returns {boolean} True if found.
   */
  _scanBytes(u8, needle) {
    if (!needle || needle.length === 0) return false;
    outer: for (let i = 0; i + needle.length <= u8.length; i++) {
      for (let j = 0; j < needle.length; j++) if (u8[i + j] !== needle[j]) continue outer;
      return true;
    }
    return false;
  }
}

window.PdfiumAdapter = PdfiumAdapter;
