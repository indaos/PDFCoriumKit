import UIKit
@_implementationOnly import PDFium

/// Subset of annotation subtypes used by the Swift API.
public enum FPAnnotationSubtype: Int32 {
    case text = 0
    case link = 1
    case freeText = 2
    case line = 3
    case square = 4
    case circle = 5
    case polygon = 6
    case polyline = 7
    case highlight = 8
    case underline = 9
    case squiggly = 10
    case strikeout = 11
    case stamp = 12
    case caret = 13
    case ink = 15
    case popup = 16
    case fileAttachment = 17
    case sound = 18
    case movie = 19
    case widget = 20
    case screen = 21
    case printerMark = 22
    case trapNet = 23
    case watermark = 24
    case threeD = 25
    case richMedia = 26
    case xfaWidget = 27

    var fpdfValue: Int32 { rawValue }
}

/// Quad defined by four corner points in page space.
public struct PDFQuad {
    public var p1: CGPoint
    public var p2: CGPoint
    public var p3: CGPoint
    public var p4: CGPoint

    public init(p1: CGPoint, p2: CGPoint, p3: CGPoint, p4: CGPoint) {
        self.p1 = p1; self.p2 = p2; self.p3 = p3; self.p4 = p4
    }
}

/// RGBA color, compatible with PDFium color fields.
public struct PDFColor {
    public var r: UInt8
    public var g: UInt8
    public var b: UInt8
    public var a: UInt8

    public init(r: UInt8, g: UInt8, b: UInt8, a: UInt8 = 255) {
        self.r = r; self.g = g; self.b = b; self.a = a
    }

    public init(_ uiColor: UIColor) {
        var rr: CGFloat = 0, gg: CGFloat = 0, bb: CGFloat = 0, aa: CGFloat = 0
        uiColor.getRed(&rr, green: &gg, blue: &bb, alpha: &aa)
        r = UInt8(max(0, min(255, Int(rr * 255))))
        g = UInt8(max(0, min(255, Int(gg * 255))))
        b = UInt8(max(0, min(255, Int(bb * 255))))
        a = UInt8(max(0, min(255, Int(aa * 255))))
    }
}

/// Page-space rectangle with origin at bottom-left.
public struct PDFRect {
    public var left: Float
    public var bottom: Float
    public var right: Float
    public var top: Float

    public init(left: Float, bottom: Float, right: Float, top: Float) {
        self.left = left
        self.bottom = bottom
        self.right = right
        self.top = top
    }

    internal var fsRect: FS_RECTF {
        FS_RECTF(left: left, top: top, right: right, bottom: bottom)
    }
}

/// Errors thrown by the Swift wrapper.
public enum PDFiumError: Error, CustomStringConvertible {
    case initializationFailed
    case openFailed
    case pageLoadFailed
    case saveFailed
    case invalidOperation(String)

    public var description: String {
        switch self {
        case .initializationFailed: return "PDFium init failed"
        case .openFailed: return "Failed to open PDF"
        case .pageLoadFailed: return "Failed to load page"
        case .saveFailed: return "Failed to save PDF"
        case .invalidOperation(let msg): return msg
        }
    }
}

@inline(__always)
/// Calls body with a null-terminated UTF-16LE view of the Swift string.
func withFPDFWideString<Result>(_ string: String, _ body: (UnsafePointer<UInt16>) -> Result) -> Result {
    var utf16: [UInt16] = Array(string.utf16) + [0]
    #if _endian(big)
    utf16 = utf16.map { UInt16(littleEndian: $0) }
    #endif
    return utf16.withUnsafeBufferPointer { buf in
        return body(buf.baseAddress!)
    }
}
