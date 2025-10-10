 # PdfiumKit

  Cross‑platform PDF tooling built on PDFium with Android, iOS, and Web implementations and demos. PdfiumKit focuses on a minimal, pragmatic surface over PDFium for opening, rendering, annotating, basic form
  filling, and saving.

  - Android: JNI bridge + demo app
  - iOS: Swift wrapper + SwiftUI demo
  - Web: WASM adapter + browser demo

  ## Highlights

  - Open PDFs (with optional passwords)
  - Render pages to bitmaps/canvas
  - Interactive form support (focus, select/replace text, list/checkbox helpers)
  - Basic annotation helpers (ink, highlight, rectangle, text insertion)
  - Save updated documents (file or Blob)
  - Progressive loading in Web via FPDFAvail when available
  - Small, readable bridges intended for embedding and extension

  ## Repository Layout

  - android/ — Android library (pdfiumkit) and demo app
  - ios/ — Swift wrapper library (PdfiumKit) and SwiftUI demo app
  - web/ — Standalone browser demo using PDFium WASM

  If this repository is nested in a parent folder (e.g., PdfiumKit/), adjust the paths accordingly.

  ## Android

  - Minimum SDK 21, target/compile SDK 34
  - Requires NDK + CMake (Gradle uses CMake 3.22.1)
  - Pdfium static libraries and headers are expected at:
      - Headers: src-android/pdfium/public
      - Libraries: out/android/release/lib/<abi>/libpdfium.a
  - Open android/ in Android Studio and build the demo module.

  Gradle wires CMake with:

  - PDFIUM_HEADERS_DIR → src-android/pdfium/public
  - PDFIUM_LIB_DIR → out/android/release/lib

  Quick start (Java):

<pre>
  PdfiumDocument doc = new PdfiumDocument();
  doc.open("/sdcard/Download/sample.pdf"); // optional password overload available
  long page = doc.loadPage(0);
  float w = doc.getPageWidth(page), h = doc.getPageHeight(page);

  Bitmap bmp = Bitmap.createBitmap(Math.max(1, (int)w), Math.max(1, (int)h), Bitmap.Config.ARGB_8888);
  // FPDF_ANNOT flag included so annotations render too (flag == 1)
  doc.renderPageBitmap(page, bmp, 0, 0, bmp.getWidth(), bmp.getHeight(), 0, 1);

  // Simple form fill example at page coordinates:
  if (doc.focusFormAt(page, 100f, 120f)) {
    doc.formSelectAll(page);
    doc.formReplaceSelection(page, "John Doe");
  }

  boolean saved = doc.save(getCacheDir() + "/edited.pdf");

  doc.closePage(page);
  doc.close();

</pre>

  Notes:

  - Ensure you’ve built/placed libpdfium.a for each ABI under out/android/release/lib/<abi>/.
  - The JNI bridge initializes PDFium once and manages a minimal form fill environment.

  ## iOS

  - Xcode project for library: ios/PdfiumKit/PdfiumKit.xcodeproj
  - SwiftUI demo: ios/PdfiumKitDemo/PdfiumKitDemo.xcodeproj
  - Bundled pdfium.xcframework is in ios/PdfiumKit/lib/pdfium.xcframework

  Quick start (Swift):
<pre>

  import PdfiumKit

  let doc = try FPDocument(url: inputURL)
  let page = try doc.page(index: 0)
  let form = FPForm(document: doc)

  let image = PdfRenderer.render(page: page, form: form, targetWidth: 1200)
  // Fill a text widget if tapped location maps to a field
  if let annot = form.formField(at: CGPoint(x: 100, y: 120), on: page) {
      _ = form.setFocused(annot)
      form.replaceSelection(on: page, text: "John Doe")
  }

  try doc.save(to: outputURL)
</pre>

  Notes:

  - FPDocument is a thin RAII wrapper.
  - FPForm manages the form fill environment and basic helpers (focus, selection, values).
  - PdfRenderer draws the page and overlays widgets.

  ## Web

  - Plain HTML/JS demo using Emscripten glue if present; falls back to direct WASM instantiation.
  - Files:
      - web/index.html, web/styles.css
      - web/lib/pdfium.js, web/lib/pdfium.wasm
      - web/pdfiumkit.js (adapter), web/app.js (demo wiring)

  Serve the folder over HTTP (WASM requires it). Examples:

  - Python: cd web && python3 -m http.server
  - Node: npx serve web

  Quick start (JS):
<pre>

  const adapter = new PdfiumAdapter();
  await adapter.init();

  const buf = await (await fetch('sample.pdf')).arrayBuffer();
  const doc = await adapter.loadDocumentFromArrayBuffer(buf);
  const page = adapter.loadPage(doc, 0);

  adapter.renderPageToCanvas(page, document.querySelector('#pageCanvas'), {
    targetWidth: 1200,
    devicePixelRatio: window.devicePixelRatio || 1
  });

  // Form example: set value for first detected text field (if any)
  const widgets = adapter.listWidgetFields(page);
  if (widgets && widgets.length) {
    adapter.setTextFieldValue(widgets[0], "John Doe");
  }

  // Save to Blob
  const blob = adapter.saveDocument(doc);
  // ... trigger download or upload ...

  adapter.closePage(page);
  adapter.closeDocument(doc);
</pre>

  Notes:

  - The adapter exposes rendering, annotations (ink/highlight/rect), basic text insertion, widget helpers, and saving.
  - Progressive loading via FPDFAvail_* is used when available.

  ## Building PDFium (Overview)

  PdfiumKit assumes you provide PDFium binaries/headers:

  - Android:
      - Build PDFium for armeabi-v7a, arm64-v8a, x86, x86_64 as static libraries.
      - Place headers under src-android/pdfium/public and libs under out/android/release/lib/<abi>/libpdfium.a.
  - iOS:
      - An xcframework is bundled at ios/PdfiumKit/lib/pdfium.xcframework.
      - If you rebuild PDFium, replace this xcframework (ensure public headers remain under its Headers/public).
  - Web:
      - lib/pdfium.js and lib/pdfium.wasm are included for the demo. If you rebuild, drop-in replace them.

  Refer to the upstream PDFium build documentation for platform‑specific steps and flags (form filling, saving, etc.).

  ## Status & Limitations

  - The bridges focus on core flows; advanced PDFium APIs are not fully wrapped.
  - Some Web features are not implemented or are stubbed (e.g., full flattening pipeline, rich FreeText editing).
  - Android build expects external PDFium artifacts; verify paths in android/pdfiumkit/build.gradle if customizing layout.

  ## Contributing

  Issues and PRs are welcome. If you extend wrappers or add features, keep changes small and focused, and include a brief usage snippet.

  ## Acknowledgements

  - Built on top of [PDFium (Chromium)](https://github.com/chromium/pdfium) and its public C API.

