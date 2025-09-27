import Foundation
import UIKit
@_implementationOnly import PDFium

/// Loaded page handle providing size, rendering, and annotations.
public final class FPPage {
    public let document: FPDocument
    internal let handle: FPDF_PAGE

    internal init(document: FPDocument, handle: FPDF_PAGE) {
        self.document = document
        self.handle = handle
    }

    deinit { FPDF_ClosePage(handle) }

    /// Page width in points.
    public var width: CGFloat { CGFloat(FPDF_GetPageWidthF(handle)) }
    /// Page height in points.
    public var height: CGFloat { CGFloat(FPDF_GetPageHeightF(handle)) }

    /// Renders the page to an image at the approximate target width.
    public func render(targetWidth: Int = 1024, background: PDFColor = PDFColor(r: 255, g: 255, b: 255, a: 255)) -> UIImage? {
        let wpt = Float(width)
        let hpt = Float(height)
        guard wpt > 0, hpt > 0 else { return nil }
        let scale = max(1, Float(targetWidth) / wpt)
        let w = Int(wpt * scale)
        let h = Int(hpt * scale)

        guard let bmp = FPDFBitmap_CreateEx(Int32(w), Int32(h), Int32(FPDFBitmap_BGRA), nil, Int32(w * 4)) else { return nil }
        defer { FPDFBitmap_Destroy(bmp) }

        let color32: UInt32 = (UInt32(background.a) << 24) | (UInt32(background.r) << 16) | (UInt32(background.g) << 8) | UInt32(background.b)
        FPDFBitmap_FillRect(bmp, 0, 0, Int32(w), Int32(h), UInt(color32))
        FPDF_RenderPageBitmap(bmp, handle, 0, 0, Int32(w), Int32(h), 0, Int32(FPDF_ANNOT))

        guard let buffer = FPDFBitmap_GetBuffer(bmp) else { return nil }
        let data = Data(bytes: buffer, count: w * h * 4)

        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let bitmapInfo = CGBitmapInfo.byteOrder32Little.union(CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedFirst.rawValue))
        guard let provider = CGDataProvider(data: data as CFData) else { return nil }
        guard let cg = CGImage(
            width: w,
            height: h,
            bitsPerComponent: 8,
            bitsPerPixel: 32,
            bytesPerRow: w * 4,
            space: colorSpace,
            bitmapInfo: bitmapInfo,
            provider: provider,
            decode: nil,
            shouldInterpolate: true,
            intent: .defaultIntent
        ) else { return nil }
        return UIImage(cgImage: cg, scale: UIScreen.main.scale, orientation: .up)
    }

    @discardableResult
    /// Adds a square (rectangle) annotation.
    public func addSquare(rect: PDFRect, color: PDFColor = .init(r: 255, g: 0, b: 0), borderWidth: Float = 2) -> FPAnnotation? {
        guard let a = FPDFPage_CreateAnnot(handle, FPDF_ANNOT_SQUARE) else { return nil }
        var r = rect.fsRect
        FPDFAnnot_SetRect(a, &r)
        FPDFAnnot_SetBorder(a, 0, 0, borderWidth)
        FPDFAnnot_SetColor(a, FPDFANNOT_COLORTYPE_Color, UInt32(color.r), UInt32(color.g), UInt32(color.b), UInt32(color.a))
        FPDFPage_GenerateContent(handle)
        return FPAnnotation(page: self, handle: a)
    }

    @discardableResult
    /// Adds a highlight annotation covering a rectangle.
    public func addHighlight(rect: PDFRect, color: PDFColor = .init(r: 255, g: 255, b: 0, a: 128)) -> FPAnnotation? {
        guard let a = FPDFPage_CreateAnnot(handle, FPDF_ANNOT_HIGHLIGHT) else { return nil }
        var r = rect.fsRect
        FPDFAnnot_SetRect(a, &r)
        FPDFAnnot_SetColor(a, FPDFANNOT_COLORTYPE_Color, UInt32(color.r), UInt32(color.g), UInt32(color.b), UInt32(color.a))
        var q = FS_QUADPOINTSF(
            x1: r.left, y1: r.top,
            x2: r.right, y2: r.top,
            x3: r.left, y3: r.bottom,
            x4: r.right, y4: r.bottom
        )
        _ = FPDFAnnot_AppendAttachmentPoints(a, &q)
        FPDFPage_GenerateContent(handle)
        return FPAnnotation(page: self, handle: a)
    }

    @discardableResult
    /// Adds a text note annotation with optional contents.
    public func addNote(rect: PDFRect, contents: String, color: PDFColor = .init(r: 255, g: 255, b: 0)) -> FPAnnotation? {
        guard let a = FPDFPage_CreateAnnot(handle, FPDF_ANNOT_TEXT) else { return nil }
        var r = rect.fsRect
        FPDFAnnot_SetRect(a, &r)
        FPDFAnnot_SetColor(a, FPDFANNOT_COLORTYPE_Color, UInt32(color.r), UInt32(color.g), UInt32(color.b), UInt32(color.a))
        withFPDFWideString(contents) { wstr in
            _ = FPDFAnnot_SetStringValue(a, "Contents", wstr)
        }
        FPDFPage_GenerateContent(handle)
        return FPAnnotation(page: self, handle: a)
    }

    @discardableResult
    /// Adds an underline annotation covering a rectangle.
    public func addUnderline(rect: PDFRect, color: PDFColor = .init(r: 0, g: 0, b: 255)) -> FPAnnotation? {
        guard let a = FPDFPage_CreateAnnot(handle, FPDF_ANNOT_UNDERLINE) else { return nil }
        var r = rect.fsRect
        FPDFAnnot_SetRect(a, &r)
        FPDFAnnot_SetColor(a, FPDFANNOT_COLORTYPE_Color, UInt32(color.r), UInt32(color.g), UInt32(color.b), UInt32(color.a))
        FPDFPage_GenerateContent(handle)
        return FPAnnotation(page: self, handle: a)
    }

    @discardableResult
    /// Adds a strikeout annotation covering a rectangle.
    public func addStrikeout(rect: PDFRect, color: PDFColor = .init(r: 255, g: 0, b: 0)) -> FPAnnotation? {
        guard let a = FPDFPage_CreateAnnot(handle, FPDF_ANNOT_STRIKEOUT) else { return nil }
        var r = rect.fsRect
        FPDFAnnot_SetRect(a, &r)
        FPDFAnnot_SetColor(a, FPDFANNOT_COLORTYPE_Color, UInt32(color.r), UInt32(color.g), UInt32(color.b), UInt32(color.a))
        FPDFPage_GenerateContent(handle)
        return FPAnnotation(page: self, handle: a)
    }

    @discardableResult
    /// Adds a squiggly underline annotation covering a rectangle.
    public func addSquiggly(rect: PDFRect, color: PDFColor = .init(r: 255, g: 165, b: 0)) -> FPAnnotation? {
        guard let a = FPDFPage_CreateAnnot(handle, FPDF_ANNOT_SQUIGGLY) else { return nil }
        var r = rect.fsRect
        FPDFAnnot_SetRect(a, &r)
        FPDFAnnot_SetColor(a, FPDFANNOT_COLORTYPE_Color, UInt32(color.r), UInt32(color.g), UInt32(color.b), UInt32(color.a))
        FPDFPage_GenerateContent(handle)
        return FPAnnotation(page: self, handle: a)
    }

    @discardableResult
    /// Adds an ink annotation from a list of page points.
    public func addInk(points: [CGPoint], color: PDFColor = .init(r: 0, g: 0, b: 0), width: Float = 2) -> FPAnnotation? {
        guard let a = FPDFPage_CreateAnnot(handle, FPDF_ANNOT_INK) else { return nil }
        var fsPoints: [FS_POINTF] = points.map { FS_POINTF(x: Float($0.x), y: Float($0.y)) }
        _ = fsPoints.withUnsafeBufferPointer { buf in
            FPDFAnnot_AddInkStroke(a, buf.baseAddress, buf.count)
        }
        FPDFAnnot_SetColor(a, FPDFANNOT_COLORTYPE_Color, UInt32(color.r), UInt32(color.g), UInt32(color.b), UInt32(color.a))
        FPDFAnnot_SetBorder(a, 0, 0, width)
        if let minX = points.map({ $0.x }).min(), let maxX = points.map({ $0.x }).max(),
           let minY = points.map({ $0.y }).min(), let maxY = points.map({ $0.y }).max() {
            var r = FS_RECTF(left: Float(minX), top: Float(maxY), right: Float(maxX), bottom: Float(minY))
            FPDFAnnot_SetRect(a, &r)
        }
        FPDFPage_GenerateContent(handle)
        return FPAnnotation(page: self, handle: a)
    }

    /// All annotations present on the page.
    public func annotations() -> [FPAnnotation] {
        let count = Int(FPDFPage_GetAnnotCount(handle))
        guard count > 0 else { return [] }
        var out: [FPAnnotation] = []
        for i in 0..<count {
            if let a = FPDFPage_GetAnnot(handle, Int32(i)) {
                out.append(FPAnnotation(page: self, handle: a))
            }
        }
        return out
    }

    @discardableResult
    /// Flattens annotations into page content for normal display.
    public func flattenNormalDisplay() -> Bool {
        return FPDFPage_Flatten(handle, Int32(FLAT_NORMALDISPLAY)) == 1
    }
}
