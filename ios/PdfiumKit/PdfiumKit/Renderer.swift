import UIKit
@_implementationOnly import PDFium

/// Convenience renderer that draws a page and optional form widgets.
public enum PdfRenderer {
    /// Renders a page to a bitmap at the approximate target width and overlays form widgets when provided.
    public static func render(page: FPPage, form: FPForm?, targetWidth: Int = 1024) -> UIImage? {
        let widthPoints = Float(page.width)
        let heightPoints = Float(page.height)
        if widthPoints <= 0 || heightPoints <= 0 { return nil }

        let scale = max(1, Float(targetWidth) / widthPoints)
        let w = Int(widthPoints * scale)
        let h = Int(heightPoints * scale)

        guard let bmp = FPDFBitmap_CreateEx(Int32(w), Int32(h), Int32(FPDFBitmap_BGRA), nil, Int32(w * 4)) else { return nil }
        defer { FPDFBitmap_Destroy(bmp) }

        FPDFBitmap_FillRect(bmp, 0, 0, Int32(w), Int32(h), 0xFFFFFFFF)
        FPDF_RenderPageBitmap(bmp, page.handle, 0, 0, Int32(w), Int32(h), 0, Int32(FPDF_ANNOT))
        if let form = form {
            FPDF_FFLDraw(form.handle, bmp, page.handle, 0, 0, Int32(w), Int32(h), 0, Int32(FPDF_ANNOT))
        }

        guard let buffer = FPDFBitmap_GetBuffer(bmp) else { return nil }
        let data = Data(bytes: buffer, count: w * h * 4)

        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let bitmapInfo = CGBitmapInfo.byteOrder32Little.union(CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedFirst.rawValue))
        let cfData = data as CFData
        guard let provider = CGDataProvider(data: cfData) else { return nil }
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
}
