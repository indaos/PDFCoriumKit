import Foundation
import UIKit
@_implementationOnly import PDFium

/// Progressive page renderer for incremental drawing and cancellation.
public final class FPProgressiveRenderer {
    private let page: FPPage
    private let width: Int
    private let height: Int
    private let bitmap: FPDF_BITMAP
    private var closed = false

    /// Creates a renderer with a prefilled background.
    public init?(page: FPPage, pixelWidth: Int, pixelHeight: Int, background: PDFColor = .init(r: 255, g: 255, b: 255, a: 255)) {
        self.page = page
        self.width = pixelWidth
        self.height = pixelHeight
        guard let bmp = FPDFBitmap_CreateEx(Int32(pixelWidth), Int32(pixelHeight), Int32(FPDFBitmap_BGRA), nil, Int32(pixelWidth * 4)) else { return nil }
        self.bitmap = bmp
        let bg: UInt32 = (UInt32(background.a) << 24) | (UInt32(background.r) << 16) | (UInt32(background.g) << 8) | UInt32(background.b)
        FPDFBitmap_FillRect(bmp, 0, 0, Int32(pixelWidth), Int32(pixelHeight), UInt(bg))
    }

    deinit { if !closed { FPDF_RenderPage_Close(page.handle) ; FPDFBitmap_Destroy(bitmap) } }

    /// Starts progressive rendering and returns the current status code.
    public func start() -> Int32 {
        var pause = IFSDK_PAUSE(version: 1, NeedToPauseNow: { _ in 1 }, user: nil)
        return Int32(FPDF_RenderPageBitmap_Start(bitmap, page.handle, 0, 0, Int32(width), Int32(height), 0, Int32(FPDF_ANNOT), &pause))
    }

    /// Continues progressive rendering and returns the current status code.
    public func `continue`() -> Int32 {
        var pause = IFSDK_PAUSE(version: 1, NeedToPauseNow: { _ in 1 }, user: nil)
        return Int32(FPDF_RenderPage_Continue(page.handle, &pause))
    }

    /// Finishes rendering and returns the final image.
    public func finishImage() -> UIImage? {
        closed = true
        FPDF_RenderPage_Close(page.handle)
        guard let buf = FPDFBitmap_GetBuffer(bitmap) else { FPDFBitmap_Destroy(bitmap); return nil }
        let data = Data(bytes: buf, count: width * height * 4)
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let bitmapInfo = CGBitmapInfo.byteOrder32Little.union(CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedFirst.rawValue))
        guard let provider = CGDataProvider(data: data as CFData) else { FPDFBitmap_Destroy(bitmap); return nil }
        guard let cg = CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: width * 4, space: colorSpace, bitmapInfo: bitmapInfo, provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent) else { FPDFBitmap_Destroy(bitmap); return nil }
        FPDFBitmap_Destroy(bitmap)
        return UIImage(cgImage: cg)
    }
}
