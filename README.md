# PdfiumKit

Cross‑platform PDF tooling built on the open‑source PDFium engine (Chromium) via its public C API. 

- Android: JNI bridge + demo app
- iOS: Swift wrapper + SwiftUI demo
- Web: WASM adapter + browser demo

## Highlights

- Open PDFs (with optional passwords)
- Render pages to bitmaps/canvas
- Interactive form support (focus, select/replace text, list/checkbox helpers)
- Basic annotation helpers (ink, highlight, rectangle, text insertion)
- Save updated documents (file or Blob)
- Progressive loading on Web via FPDFAvail when available
- Small, readable bridges intended for embedding and extension

## Repository Layout

- `android/` — Android library (`pdfiumkit`) and demo app
- `ios/` — Swift wrapper library (`PdfiumKit`) and SwiftUI demo app
- `web/` — Standalone browser demo using PDFium WASM

Paths below are relative to this `sdk/` folder.

## Android

- minSdk `21`, target/compileSdk `34`
- Requires NDK + CMake (AGP wires CMake 3.22.1)
- PDFium artifacts expected at:
  - Headers: `src-android/pdfium/public`
  - Libraries: `out/android/release/lib/<abi>/libpdfium.a`

Open `android/` in Android Studio and build the demo module. Gradle passes the following to CMake:

- `PDFIUM_HEADERS_DIR` → `src-android/pdfium/public`
- `PDFIUM_LIB_DIR` → `out/android/release/lib`

Quick start (Java):

```java
PdfiumDocument doc = new PdfiumDocument();
doc.open("/sdcard/Download/sample.pdf"); // optional password overload available
long page = doc.loadPage(0);
float w = doc.getPageWidth(page), h = doc.getPageHeight(page);

Bitmap bmp = Bitmap.createBitmap(Math.max(1, (int) w), Math.max(1, (int) h), Bitmap.Config.ARGB_8888);
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
```

Notes

- Ensure `libpdfium.a` is built and placed for each ABI under `out/android/release/lib/<abi>/`.
- The JNI bridge initializes PDFium once and manages a minimal form‑fill environment.

## iOS

- Library Xcode project: `ios/PdfiumKit/PdfiumKit.xcodeproj`
- SwiftUI demo: `ios/PdfiumKitDemo/PdfiumKitDemo.xcodeproj`
- The project references a `pdfium.xcframework`. By default, the reference points to `out/ios/release/pdfium.xcframework` (relative to the repository). If you rebuild or relocate it, update the Xcode reference accordingly.

Quick start (Swift):

```swift
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
```

Notes

- `FPDocument` is a thin RAII wrapper around a PDFium document.
- `FPForm` manages the form‑fill environment and helpers (focus, selection, values).
- `PdfRenderer` draws the page and overlays widgets.

## Web

- Plain HTML/JS demo using Emscripten glue if present; falls back to direct WASM instantiation.
- Files:
  - `web/index.html`, `web/styles.css`
  - `web/lib/pdfium.js`, `web/lib/pdfium.wasm`
  - `web/pdfiumkit.js` (adapter), `web/app.js` (demo wiring)

Serve the folder over HTTP (WASM requires it). Examples:

- Python: `cd web && python3 -m http.server`
- Node: `npx serve web`

Quick start (JavaScript):

```js
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
  adapter.setTextFieldValue(widgets[0], 'John Doe');
}

// Save to Blob
const blob = adapter.saveDocument(doc);
// ... trigger download or upload ...

adapter.closePage(page);
adapter.closeDocument(doc);
```

Notes

- The adapter exposes rendering, annotations (ink/highlight/rect), basic text insertion, widget helpers, and saving.
- Progressive loading via `FPDFAvail_*` is used when available.

## Building PDFium (Overview)

PdfiumKit assumes you provide PDFium binaries and public headers.

- Android
  - Build PDFium static libraries for `armeabi-v7a`, `arm64-v8a`, `x86`, `x86_64`.
  - Place headers under `src-android/pdfium/public` and libs under `out/android/release/lib/<abi>/libpdfium.a`.
- iOS
  - Provide `out/ios/release/pdfium.xcframework` (the Xcode project references this path).
  - If you rebuild PDFium, replace the xcframework and ensure its public headers are included within it.
- Web
  - `web/lib/pdfium.js` and `web/lib/pdfium.wasm` are included for the demo. If you rebuild, drop‑in replace them.

Refer to the upstream PDFium build documentation for platform‑specific steps (including flags for form filling, saving, etc.).

## Status & Limitations

- Bridges focus on core flows; many advanced PDFium APIs are not wrapped.
- Some Web features are not implemented or are stubbed (e.g., full flattening pipeline, rich FreeText editing).
- Android build expects external PDFium artifacts; verify paths in `android/pdfiumkit/build.gradle` if customizing.


- Built on [PDFium (Chromium)](https://github.com/chromium/pdfium).

