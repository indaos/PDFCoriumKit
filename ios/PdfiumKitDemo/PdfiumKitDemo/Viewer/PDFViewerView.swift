import SwiftUI
import UIKit
import PdfiumKit

enum PDFTool {
    case none
    case highlight
    case text
    case rect
    case draw
    case signature
}

struct PDFViewerView: View {
    let url: URL

    @State private var document: FPDocument?
    @State private var pageIndex: Int = 0
    @State private var image: UIImage?
    @State private var tool: PDFTool = .none
    @State private var drawPoints: [CGPoint] = []
    @State private var dragStart: CGPoint?
    @State private var inputText: String = ""

    @State private var isEditingInline = false
    @State private var inlineEditorRect: CGRect? = nil
    @State private var editingIsFormField = false
    @State private var pageSize: CGSize = .zero
    @State private var lastRenderZoomStep: CGFloat = 1.0
    @State private var shareURL: URL?
    @State private var livePathPoints: [CGPoint]? = nil
    @State private var liveRect: CGRect? = nil
    @State private var fieldOverlayRects: [CGRect] = []
    @State private var lastTapPdfPoint: CGPoint? = nil
    @State private var form: FPForm?
    @State private var focusedField: FPAnnotation? = nil
    @State private var debugMessage: String = ""
    @State private var showInspector: Bool = false
    @State private var isSigning: Bool = false
    @State private var signatureImage: UIImage? = nil
    @State private var signatureTargetRect: PDFRect? = nil
    @State private var signatureTargetAnnot: FPAnnotation? = nil
    @State private var sigCapture: Bool = false

    var body: some View {
        VStack(spacing: 0) {
            toolbar
            PDFPageCanvas(image: image,
                          onTap: handleTap,
                          onDragBegan: handleDragBegan,
                          onDragMoved: handleDragMoved,
                          onDragEnded: handleDragEnded,
                          onZoomChanged: handleZoomChanged,
                          disableScroll: tool == .draw || tool == .rect || tool == .highlight,
                          previewPathPoints: livePathPoints,
                          previewRect: liveRect,
                          overlayRects: (tool == .text ? fieldOverlayRects : []),
                          editorText: $inputText,
                          isEditing: isEditingInline,
                          editorRect: inlineEditorRect,
                          editorFontSize: currentEditorFontSize(),
                          editorTextColor: currentEditorTextColor(),
                          onEditorCommit: { commitInlineEditor() },
                          onEditorCancel: { cancelInlineEditor() })
                .background(Color.black.opacity(0.02))
            footer
        }
        .onAppear { loadDoc() }

        .sheet(isPresented: $showInspector) {
            if let doc = document, let page = try? doc.page(index: pageIndex) {
                ScrollView { Text(fieldInspector(doc: doc, page: page)).padding() }
            } else {
                Text("No document")
            }
        }
        .fullScreenCover(isPresented: $isSigning) {
            VStack {
                Text("Draw Signature").font(.headline)
                ZStack {
                    Rectangle().fill(Color(UIColor.secondarySystemBackground))
                    SignaturePad(image: $signatureImage, capture: $sigCapture)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                .frame(height: 240)
                HStack {
                    Button("Clear") { signatureImage = nil }
                    Spacer()
                    Button("Cancel") { isSigning = false; signatureImage = nil }
                    Button("Done") {
                        sigCapture = true
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { handleSignatureDone() }
                    }
                    .buttonStyle(.borderedProminent)
                }
                .padding()
            }
            .padding()
            .interactiveDismissDisabled(true)
        }
    }

    private var toolbar: some View {
        HStack {
            Button(action: { changePage(-1) }) { Image(systemName: "chevron.left") }
                .disabled((document?.pageCount ?? 0) <= 1 || pageIndex == 0)
            Button(action: { changePage(1) }) { Image(systemName: "chevron.right") }
                .disabled((document?.pageCount ?? 0) == 0 || pageIndex >= (document?.pageCount ?? 1)-1)
            Spacer()
            Button(action: { tool = (tool == .highlight ? .none : .highlight) }) { Image(systemName: "highlighter") }
            Button(action: { tool = (tool == .draw ? .none : .draw) }) { Image(systemName: "pencil") }
            Button(action: share) { Image(systemName: "square.and.arrow.up") }
            Button(action: { showInspector = true }) { Image(systemName: "info.circle") }
        }
        .padding(8)
        .background(Color(UIColor.secondarySystemBackground))
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("Page \(pageIndex+1)/\(document?.pageCount ?? 0)")
                Spacer()
                Button(action: { handleZoomChanged(0.75) }) { Image(systemName: "minus.magnifyingglass") }
                Button(action: { handleZoomChanged(1.5) }) { Image(systemName: "plus.magnifyingglass") }
            }
            if !debugMessage.isEmpty {
                Text(debugMessage)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(8)
        .background(Color(UIColor.secondarySystemBackground))
    }

    private func loadDoc() {
        document = try? FPDocument(url: url)
        pageIndex = 0
        if let doc = document { form = FPForm(document: doc) }
        if let doc = document, let form = form, let page = try? doc.page(index: pageIndex) {
            form.onAfterLoad(page: page)
        }
        render()
    }

    private func changePage(_ delta: Int) {
        guard let doc = document else { return }
        let newIndex = min(max(0, pageIndex + delta), doc.pageCount-1)
        guard newIndex != pageIndex else { return }
        if let form = form, let oldPage = try? doc.page(index: pageIndex) {
            form.onBeforeClose(page: oldPage)
        }
        pageIndex = newIndex
        if let form = form, let newPage = try? doc.page(index: pageIndex) {
            form.onAfterLoad(page: newPage)
        }
        render()
    }

    private func render() {
        guard let doc = document, let page = try? doc.page(index: pageIndex) else { return }
        pageSize = CGSize(width: page.width, height: page.height)
        image = PdfRenderer.render(page: page, form: form, targetWidth: Int(1500 * lastRenderZoomStep))

        fieldOverlayRects = computeFieldOverlays(doc: doc, page: page)

        if isEditingInline {
            if editingIsFormField, let annot = focusedField {
                inlineEditorRect = imageRectForAnnot(annot: annot, page: page)
            } else if let tapPdf = lastTapPdfPoint {
                let pImg = pdfToImage(tapPdf)
                inlineEditorRect = freeTextRect(atImagePoint: pImg)
            }
        }
    }

    // MARK: Interaction Handlers
    private func handleTap(_ p: CGPoint) {
        guard let doc = document, let page = try? doc.page(index: pageIndex) else { return }

        if tool == .none || tool == .text || tool == .signature {
            if let form = self.form ?? FPForm(document: doc) {
                let pdfPoint = pToPdf(p)
                if let annot = form.formField(at: pdfPoint, on: page) {
                    let ftName = annot.getString("FT") ?? ""
                    if ftName.contains("Sig") {
                        signatureTargetRect = annot.rect
                        signatureTargetAnnot = annot
                        isSigning = true
                        debugMessage = "Signature target: FT=\(ftName)"
                        return
                    }
                }
            }
        }
        switch tool {
        case .text:

            if let form = self.form ?? FPForm(document: doc) {
                let pdfPoint = pToPdf(p)
                if let annot = form.formField(at: pdfPoint, on: page) {
                    let ftName = annot.getString("FT") ?? ""
                    // AcroForm text: FT=='Tx'; XFA text often maps similarly
                    if ftName.contains("Tx") {
                        _ = form.setFocused(annot)
                        _ = form.selectAllText(on: page)
                        lastTapPdfPoint = pdfPoint
                        focusedField = annot
                        let name = form.formFieldName(for: annot) ?? "<unnamed>"
                        let val = form.formFieldValue(for: annot) ?? ""
                        inputText = val
                        editingIsFormField = true
                        inlineEditorRect = imageRectForAnnot(annot: annot, page: page)
                        debugMessage = "Editing field ‘\(name)’ (FT=\(ftName)), current: ‘\(val)’"
                        isEditingInline = true
                        return
                    }
                }
            }

            lastTapPdfPoint = pToPdf(p)
            editingIsFormField = false
            focusedField = nil
            inputText = ""
            inlineEditorRect = freeTextRect(atImagePoint: p)
            isEditingInline = true
        case .none, .highlight, .rect, .draw, .signature:
            if tool == .signature {

                let pdfPoint = pToPdf(p)
                let w: Float = 180, h: Float = 60
                signatureTargetRect = PDFRect(left: Float(pdfPoint.x), bottom: Float(pdfPoint.y - CGFloat(h/2)), right: Float(pdfPoint.x) + w, top: Float(pdfPoint.y + CGFloat(h/2)))
                isSigning = true
                debugMessage = "Signature free placement at tap."
                return
            }

            if let form = self.form ?? FPForm(document: doc) {
                let pdfPoint = pToPdf(p)
                if let annot = form.formField(at: pdfPoint, on: page) {
                    // If it's a text field, prompt to edit (detect via /FT == Tx)
                    let ftName = annot.getString("FT") ?? ""
                    guard ftName.contains("Tx") else { break }
                    _ = form.setFocused(annot)
                    _ = form.selectAllText(on: page)
                    lastTapPdfPoint = pdfPoint
                    focusedField = annot
                    let name = form.formFieldName(for: annot) ?? "<unnamed>"
                    let val = form.formFieldValue(for: annot) ?? ""
                    inputText = val
                    editingIsFormField = true
                    inlineEditorRect = imageRectForAnnot(annot: annot, page: page)
                    debugMessage = "Editing field ‘\(name)’, current: ‘\(val)’"
                    isEditingInline = true
                    return
                }
            }

            let pdfPoint = pToPdf(p)
            for link in page.links() {
                let r = link.rect
                if Double(pdfPoint.x) >= Double(r.left) && Double(pdfPoint.x) <= Double(r.right) && Double(pdfPoint.y) >= Double(r.bottom) && Double(pdfPoint.y) <= Double(r.top) {
                    switch link.target {
                    case .page(let idx): pageIndex = max(0, min((document?.pageCount ?? 1)-1, idx)); render()
                    case .uri(let s): if let u = URL(string: s) { UIApplication.shared.open(u) }
                    case .filePath: break
                    case .unknown: break
                    }
                    break
                }
            }
        }
    }

    private func handleDragBegan(_ p: CGPoint) {
        switch tool {
        case .draw:
            drawPoints = [p]
            livePathPoints = [p]
        case .rect, .highlight:
            dragStart = p
            liveRect = CGRect(origin: p, size: .zero)
        default: break
        }
    }

    private func handleDragMoved(_ p: CGPoint) {
        switch tool {
        case .draw:
            drawPoints.append(p)
            livePathPoints = drawPoints
        default: break
        }
    }

    private func handleDragEnded(_ p: CGPoint) {
        guard let doc = document, let page = try? doc.page(index: pageIndex) else { return }
        switch tool {
        case .draw:
            if drawPoints.count > 1 {
                let pdfPts = drawPoints.map(pToPdf)
                _ = page.addInk(points: pdfPts)
                render()
            }
            drawPoints.removeAll()
            livePathPoints = nil
        case .rect:
            if let start = dragStart {
                let r = rectFromPoints(start, p)
                _ = page.addSquare(rect: r)
                render()
            }
            dragStart = nil
            liveRect = nil
        case .highlight:
            if let start = dragStart {
                let r = rectFromPoints(start, p)
                _ = page.addHighlight(rect: r)
                render()
            }
            dragStart = nil
            liveRect = nil
        default: break
        }
    }


    private func pToPdf(_ p: CGPoint) -> CGPoint {

        guard pageSize.width > 0, pageSize.height > 0, let img = image else { return .zero }
        let sx = pageSize.width / img.size.width
        let sy = pageSize.height / img.size.height

        let pdfX = p.x * sx
        let pdfY = (img.size.height - p.y) * sy
        return CGPoint(x: pdfX, y: pdfY)
    }

    private func pdfToImage(_ p: CGPoint) -> CGPoint {
        guard pageSize.width > 0, pageSize.height > 0, let img = image else { return .zero }
        let sx = pageSize.width / img.size.width
        let sy = pageSize.height / img.size.height
        let imgX = p.x / sx
        let imgY = img.size.height - (p.y / sy)
        return CGPoint(x: imgX, y: imgY)
    }

    private func currentEditorFontSize() -> CGFloat? {
        guard let img = image else { return nil }
        let sy = pageSize.height / img.size.height
        if editingIsFormField, let form = form, let annot = focusedField {
            if let fs = form.fontSize(annot), fs > 0 {
                return CGFloat(fs) / sy
            }

            if let r = inlineEditorRect { return max(10, min(r.height * 0.55, 48)) }
            return nil
        } else {

            return 14.0 / sy
        }
    }

    private func currentEditorTextColor() -> UIColor? {
        if editingIsFormField, let form = form, let annot = focusedField {
            if let c = form.fontColor(annot) {
                return UIColor(red: CGFloat(c.r)/255.0, green: CGFloat(c.g)/255.0, blue: CGFloat(c.b)/255.0, alpha: 1)
            }
        }
        return nil
    }

    private func rectFromPoints(_ a: CGPoint, _ b: CGPoint) -> PDFRect {
        let pa = pToPdf(a), pb = pToPdf(b)
        let left = Float(min(pa.x, pb.x))
        let right = Float(max(pa.x, pb.x))
        let bottom = Float(min(pa.y, pb.y))
        let top = Float(max(pa.y, pb.y))
        return PDFRect(left: left, bottom: bottom, right: right, top: top)
    }

    private func commitTextInput() {
        defer { inputText = "" }
        guard let doc = document, let page = try? doc.page(index: pageIndex) else { return }

        if let form = form, let annot = focusedField {
            _ = form.setFocused(annot)
            _ = form.selectAllText(on: page)
            print(">>>"+inputText+"<<<")
            form.replaceSelection(on: page, text: inputText)

            let beforeSaveVal = form.formFieldValue(for: annot) ?? ""
            if beforeSaveVal != inputText {
                _ = annot.setString("V", inputText)

                _ = annot.setAP(mode: 0, stream: nil)
            }

            let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("edited.pdf")
            do {
                try doc.save(to: tmp)
                if let newDoc = try? FPDocument(url: tmp) {
                    document = newDoc
                    self.form = FPForm(document: newDoc)
                    if let page = try? newDoc.page(index: pageIndex), let form = self.form { form.onAfterLoad(page: page) }
                }
            } catch {

            }
            render()

            if let newDoc = document, let form2 = self.form, let pg = try? newDoc.page(index: pageIndex) {
                if let tap = lastTapPdfPoint, let newAnnot = form2.formField(at: tap, on: pg) {
                    let name = form2.formFieldName(for: newAnnot) ?? "<unnamed>"
                    let val = form2.formFieldValue(for: newAnnot) ?? ""
                    debugMessage = "Field ‘\(name)’ now: ‘\(val)’"
                } else {
                    debugMessage = "Committed text, but couldn’t re-find field at tap."
                }
            }
            focusedField = nil
            lastTapPdfPoint = nil
            return
        } else {
            let editor = FPEditor(document: doc)
            let pos: CGPoint
            if let tap = lastTapPdfPoint { pos = tap } else { pos = CGPoint(x: page.width/2, y: page.height/2) }
            _ = editor.addText(to: page, text: inputText, fontName: "Helvetica", fontSize: 14, position: pos)
            render()
            fieldOverlayRects = []
            tool = .none
            focusedField = nil
            lastTapPdfPoint = nil
            debugMessage = "Added free text annotation."
        }
    }

    private func commitInlineEditor() {
        commitTextInput()
        isEditingInline = false
        inlineEditorRect = nil
        editingIsFormField = false
    }

    private func cancelInlineEditor() {
        isEditingInline = false
        inlineEditorRect = nil
        inputText = ""
        focusedField = nil
        lastTapPdfPoint = nil
        editingIsFormField = false
    }


    private func fieldInspector(doc: FPDocument, page: FPPage) -> String {
        guard let form = form else { return "No form" }
        var lines: [String] = []
        for annot in page.annotations() where annot.subtype == .widget {
            let t = form.formFieldType(for: annot)
            let name = form.formFieldName(for: annot) ?? "<unnamed>"
            let val = form.formFieldValue(for: annot) ?? ""
            lines.append("Type=\(t) Name=\(name) Value=\(val)")
        }
        return lines.isEmpty ? "No fields on this page" : lines.joined(separator: "\n")
    }

    private func handleZoomChanged(_ scale: CGFloat) {

        let step = max(0.5, (scale).rounded(.toNearestOrAwayFromZero))
        if abs(step - lastRenderZoomStep) >= 0.5 {
            lastRenderZoomStep = step
            render()
        }
    }

    private func share() {
        guard let doc = document else { return }
        let dst = FileManager.default.temporaryDirectory.appendingPathComponent("shared-annotated.pdf")
        do { try doc.save(to: dst); shareURL = dst } catch { return }
        guard let shareURL = shareURL else { return }
        let av = UIActivityViewController(activityItems: [shareURL], applicationActivities: nil)
        UIApplication.shared.windows.first?.rootViewController?.present(av, animated: true)
    }

    private func forceFlatten() {
        guard let doc = document, let page = try? doc.page(index: pageIndex) else { return }
        _ = page.flattenNormalDisplay()
        render()
    }

    private func handleSignatureDone() {
        defer { isSigning = false }
        guard let rect = signatureTargetRect, let doc = document, let page = try? doc.page(index: pageIndex) else { return }
        var imgToUse: UIImage?
        if let root = UIApplication.shared.windows.first?.rootViewController?.presentedViewController?.view,
           let canvas = root.subviews.first(where: { String(describing: type(of: $0)).contains("SignatureCanvasView") }) as? SignatureCanvasView {
            imgToUse = canvas.exportImage()
        }
        if imgToUse == nil { imgToUse = signatureImage }
        guard let img = imgToUse else { return }
        let editor = FPEditor(document: doc)
        _ = editor.addImage(to: page, image: img, rect: rect)
        signatureImage = nil
        signatureTargetRect = nil

        if signatureTargetAnnot != nil {
            _ = page.flattenNormalDisplay()
            signatureTargetAnnot = nil
        }
        render()
    }

    private func computeFieldOverlays(doc: FPDocument, page: FPPage) -> [CGRect] {
        guard let img = image else { return [] }
        var rects: [CGRect] = []
        let scaleX = img.size.width / pageSize.width
        let scaleY = img.size.height / pageSize.height
        for annot in page.annotations() where annot.subtype == .widget {

            let ftName = annot.getString("FT") ?? ""
            if ftName.contains("Tx") || ftName.contains("Ch") {
                let r = annot.rect
                let x = CGFloat(r.left) * scaleX
                let y = (img.size.height - CGFloat(r.top) * scaleY)
                let w = CGFloat(r.right - r.left) * scaleX
                let h = CGFloat(r.top - r.bottom) * scaleY
                rects.append(CGRect(x: x, y: y, width: w, height: h))
            }
        }
        return rects
    }

    private func imageRectForAnnot(annot: FPAnnotation, page: FPPage) -> CGRect? {
        guard let img = image else { return nil }
        let scaleX = img.size.width / pageSize.width
        let scaleY = img.size.height / pageSize.height
        let r = annot.rect
        let x = CGFloat(r.left) * scaleX
        let y = (img.size.height - CGFloat(r.top) * scaleY)
        let w = CGFloat(r.right - r.left) * scaleX
        let h = CGFloat(r.top - r.bottom) * scaleY
        return CGRect(x: x, y: y, width: w, height: h)
    }

    private func freeTextRect(atImagePoint p: CGPoint) -> CGRect {

        let w: CGFloat = 240
        let h: CGFloat = 36
        let x = max(0, p.x - w/2)
        let y = max(0, p.y - h/2)
        return CGRect(x: x, y: y, width: w, height: h)
    }
}
