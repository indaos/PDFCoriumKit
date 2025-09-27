import Foundation
import UIKit
import CoreGraphics
@_implementationOnly import PDFium

/// Page content editing utilities for adding basic objects.
public final class FPEditor {
    private let document: FPDocument
    public init(document: FPDocument) { self.document = document }

    /// Adds a stroked rectangle to the page.
    @discardableResult
    public func addRect(to page: FPPage, rect: PDFRect, stroke: PDFColor = .init(r: 0, g: 0, b: 0, a: 255), lineWidth: Float = 1, fill: PDFColor? = nil) -> Bool {
        guard let path = FPDFPageObj_CreateNewRect(rect.left, rect.bottom, rect.right - rect.left, rect.top - rect.bottom) else { return false }
        _ = FPDFPageObj_SetStrokeColor(path, UInt32(stroke.r), UInt32(stroke.g), UInt32(stroke.b), UInt32(stroke.a))
        _ = FPDFPageObj_SetStrokeWidth(path, lineWidth)
        if let f = fill { _ = FPDFPageObj_SetFillColor(path, UInt32(f.r), UInt32(f.g), UInt32(f.b), UInt32(f.a)) }
        _ = FPDFPath_SetDrawMode(path, fill == nil ? FPDF_FILLMODE_NONE : FPDF_FILLMODE_WINDING, 1)
        FPDFPage_InsertObject(page.handle, path)
        _ = FPDFPage_GenerateContent(page.handle)
        return true
    }

    /// Adds a text object at a position using a standard font name (e.g. Helvetica).
    @discardableResult
    public func addText(to page: FPPage, text: String, fontName: String = "Helvetica", fontSize: Float = 12, position: CGPoint) -> Bool {
        guard let textObj = FPDFPageObj_NewTextObj(document.handle, fontName, fontSize) else { return false }
        withFPDFWideString(text) { wstr in _ = FPDFText_SetText(textObj, wstr) }
        FPDFPageObj_Transform(textObj, 1, 0, 0, 1, Double(position.x), Double(position.y))
        _ = FPDFPageObj_SetFillColor(textObj, 0, 0, 0, 255)
        FPDFPage_InsertObject(page.handle, textObj)
        _ = FPDFPage_GenerateContent(page.handle)
        return true
    }

    /// Adds a bitmap image into the page at the specified rectangle.
    @discardableResult
    public func addImage(to page: FPPage, image: UIImage, rect: PDFRect) -> Bool {
        guard let cg = image.cgImage else { return false }
        let w = cg.width
        let h = cg.height
        let bytesPerRow = w * 4
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let bitmapInfo = CGBitmapInfo.byteOrder32Little.union(CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedFirst.rawValue))
        var data = Data(count: h * bytesPerRow)
        let ok = data.withUnsafeMutableBytes { raw -> Bool in
            guard let base = raw.baseAddress else { return false }
            guard let ctx = CGContext(data: base, width: w, height: h, bitsPerComponent: 8, bytesPerRow: bytesPerRow, space: colorSpace, bitmapInfo: bitmapInfo.rawValue) else { return false }
            ctx.interpolationQuality = .high
            ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
            return true
        }
        guard ok else { return false }

        guard let bmp = data.withUnsafeMutableBytes({ raw -> FPDF_BITMAP? in
            guard let base = raw.baseAddress else { return nil }
            return FPDFBitmap_CreateEx(Int32(w), Int32(h), Int32(FPDFBitmap_BGRA), base, Int32(bytesPerRow))
        }) else { return false }
        defer { FPDFBitmap_Destroy(bmp) }

        guard let imgObj = FPDFPageObj_NewImageObj(document.handle) else { return false }
        _ = FPDFImageObj_SetBitmap(nil, 0, imgObj, bmp)
        _ = FPDFImageObj_SetMatrix(imgObj, Double(rect.right - rect.left), 0, 0, Double(rect.top - rect.bottom), Double(rect.left), Double(rect.bottom))
        FPDFPage_InsertObject(page.handle, imgObj)
        _ = FPDFPage_GenerateContent(page.handle)
        return true
    }
}
