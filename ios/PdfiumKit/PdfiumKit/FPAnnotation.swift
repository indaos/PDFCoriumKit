import Foundation
@_implementationOnly import PDFium

/// PDF annotation wrapper providing access to type, geometry, appearance and content.
public final class FPAnnotation {
    public let page: FPPage
    internal let handle: FPDF_ANNOTATION

    internal init(page: FPPage, handle: FPDF_ANNOTATION) {
        self.page = page
        self.handle = handle
    }

    deinit { FPDFPage_CloseAnnot(handle) }

    /// Returns the concrete annotation subtype.
    public var subtype: FPAnnotationSubtype { FPAnnotationSubtype(rawValue: FPDFAnnot_GetSubtype(handle)) ?? .text }

    /// Bitfield of annotation flags (read/write).
    public var flags: Int {
        get { Int(FPDFAnnot_GetFlags(handle)) }
        set { _ = FPDFAnnot_SetFlags(handle, Int32(newValue)) }
    }

    /// Annotation bounding box in page coordinates.
    public var rect: PDFRect {
        var r = FS_RECTF(left: 0, top: 0, right: 0, bottom: 0)
        _ = FPDFAnnot_GetRect(handle, &r)
        return PDFRect(left: r.left, bottom: r.bottom, right: r.right, top: r.top)
    }

    /// Sets the annotation bounding box in page coordinates.
    public func setRect(_ rect: PDFRect) {
        var r = rect.fsRect
        FPDFAnnot_SetRect(handle, &r)
        FPDFPage_GenerateContent(page.handle)
    }

    /// Sets the stroke width for border-capable annotations.
    public func setBorder(width: Float) {
        FPDFAnnot_SetBorder(handle, 0, 0, width)
        FPDFPage_GenerateContent(page.handle)
    }

    /// Sets the stroke color for the annotation.
    public func setStrokeColor(_ color: PDFColor) {
        FPDFAnnot_SetColor(handle, FPDFANNOT_COLORTYPE_Color, UInt32(color.r), UInt32(color.g), UInt32(color.b), UInt32(color.a))
        FPDFPage_GenerateContent(page.handle)
    }

    /// Returns the current annotation color (stroke/fill as applicable).
    public func color() -> PDFColor {
        var r: UInt32 = 0, g: UInt32 = 0, b: UInt32 = 0, a: UInt32 = 0
        _ = FPDFAnnot_GetColor(handle, FPDFANNOT_COLORTYPE_Color, &r, &g, &b, &a)
        return PDFColor(r: UInt8(r), g: UInt8(g), b: UInt8(b), a: UInt8(a))
    }

    /// Returns true if the annotation dictionary contains a given key.
    public func hasKey(_ key: String) -> Bool { key.withCString { FPDFAnnot_HasKey(handle, $0) != 0 } }

    /// Returns the underlying PDF object type for a given dictionary key.
    public func valueType(forKey key: String) -> Int { key.withCString { Int(FPDFAnnot_GetValueType(handle, $0)) } }

    /// Sets a string value in the annotation dictionary for the given key.
    public func setString(_ key: String, _ value: String) -> Bool {
        withFPDFWideString(value) { valueW in
            key.withCString { k in FPDFAnnot_SetStringValue(handle, k, valueW) != 0 }
        }
    }

    /// Gets a string value from the annotation dictionary for the given key.
    public func getString(_ key: String) -> String? {
        return key.withCString { k in
            let needed = Int(FPDFAnnot_GetStringValue(handle, k, nil, 0))
            guard needed > 0 else { return nil }
            var buf = [UInt16](repeating: 0, count: needed/2)
            _ = FPDFAnnot_GetStringValue(handle, k, &buf, UInt(needed))
            return String(utf16CodeUnits: buf, count: max(0, buf.count - 1))
        }
    }

    /// Gets a numeric value from the annotation dictionary for the given key.
    public func getNumber(_ key: String) -> Float? {
        var v: Float = 0
        let ok = key.withCString { k in FPDFAnnot_GetNumberValue(handle, k, &v) }
        return ok != 0 ? v : nil
    }

    /// Sets the appearance stream for the given appearance mode.
    public func setAP(mode: Int32, stream: String?) -> Bool {
        if let s = stream {
            return withFPDFWideString(s) { w in FPDFAnnot_SetAP(handle, mode, w) != 0 }
        } else {
            return FPDFAnnot_SetAP(handle, mode, nil) != 0
        }
    }

    /// Returns the appearance stream for the given appearance mode, if any.
    public func getAP(mode: Int32) -> String? {
        let needed = Int(FPDFAnnot_GetAP(handle, mode, nil, 0))
        guard needed > 0 else { return nil }
        var buf = [UInt16](repeating: 0, count: needed/2)
        _ = FPDFAnnot_GetAP(handle, mode, &buf, UInt(needed))
        return String(utf16CodeUnits: buf, count: max(0, buf.count - 1))
    }

    /// Returns a linked annotation for a given key (e.g., Popup), if present.
    public func linkedAnnot(forKey key: String) -> FPAnnotation? {
        guard let a = key.withCString({ FPDFAnnot_GetLinkedAnnot(handle, $0) }) else { return nil }
        return FPAnnotation(page: page, handle: a)
    }

    /// Returns the number of quadpoints attached to the annotation.
    public var attachmentPointCount: Int { Int(FPDFAnnot_CountAttachmentPoints(handle)) }

    /// Returns the quadpoints at the specified index, if any.
    public func attachmentPoints(at index: Int) -> PDFQuad? {
        var q = FS_QUADPOINTSF(x1: 0, y1: 0, x2: 0, y2: 0, x3: 0, y3: 0, x4: 0, y4: 0)
        guard FPDFAnnot_GetAttachmentPoints(handle, Int(index), &q) != 0 else { return nil }
        return PDFQuad(
            p1: CGPoint(x: CGFloat(q.x1), y: CGFloat(q.y1)),
            p2: CGPoint(x: CGFloat(q.x2), y: CGFloat(q.y2)),
            p3: CGPoint(x: CGFloat(q.x3), y: CGFloat(q.y3)),
            p4: CGPoint(x: CGFloat(q.x4), y: CGFloat(q.y4))
        )
    }

    /// Appends quadpoints to the annotation.
    @discardableResult
    public func appendAttachmentPoints(_ quad: PDFQuad) -> Bool {
        var q = FS_QUADPOINTSF(
            x1: Float(quad.p1.x), y1: Float(quad.p1.y),
            x2: Float(quad.p2.x), y2: Float(quad.p2.y),
            x3: Float(quad.p3.x), y3: Float(quad.p3.y),
            x4: Float(quad.p4.x), y4: Float(quad.p4.y)
        )
        return FPDFAnnot_AppendAttachmentPoints(handle, &q) != 0
    }

    /// Replaces quadpoints at a given index with the provided points.
    @discardableResult
    public func setAttachmentPoints(at index: Int, quad: PDFQuad) -> Bool {
        var q = FS_QUADPOINTSF(
            x1: Float(quad.p1.x), y1: Float(quad.p1.y),
            x2: Float(quad.p2.x), y2: Float(quad.p2.y),
            x3: Float(quad.p3.x), y3: Float(quad.p3.y),
            x4: Float(quad.p4.x), y4: Float(quad.p4.y)
        )
        return FPDFAnnot_SetAttachmentPoints(handle, Int(index), &q) != 0
    }

    /// Returns the number of ink paths in the ink annotation.
    public var inkPathCount: Int { Int(FPDFAnnot_GetInkListCount(handle)) }

    /// Returns the points for a given ink path index.
    public func inkPathPoints(pathIndex: Int) -> [CGPoint] {
        let needed = Int(FPDFAnnot_GetInkListPath(handle, UInt(pathIndex), nil, 0))
        guard needed > 0 else { return [] }
        var buf = [FS_POINTF](repeating: FS_POINTF(x: 0, y: 0), count: needed)
        _ = FPDFAnnot_GetInkListPath(handle, UInt(pathIndex), &buf, UInt(needed))
        return buf.map { CGPoint(x: CGFloat($0.x), y: CGFloat($0.y)) }
    }

    /// Appends a new ink stroke and returns its index.
    @discardableResult
    public func addInkStroke(points: [CGPoint]) -> Int {
        var pts = points.map { FS_POINTF(x: Float($0.x), y: Float($0.y)) }
        let idx: Int32 = pts.withUnsafeBufferPointer { buf in
            FPDFAnnot_AddInkStroke(handle, buf.baseAddress, buf.count)
        }
        return Int(idx)
    }

    /// Removes all ink paths from the annotation.
    @discardableResult
    public func removeInkList() -> Bool { FPDFAnnot_RemoveInkList(handle) != 0 }

    /// Returns polygon/polyline vertices for the annotation, if applicable.
    public func vertices() -> [CGPoint] {
        let needed = Int(FPDFAnnot_GetVertices(handle, nil, 0))
        guard needed > 0 else { return [] }
        var buf = [FS_POINTF](repeating: FS_POINTF(x: 0, y: 0), count: needed)
        _ = FPDFAnnot_GetVertices(handle, &buf, UInt(needed))
        return buf.map { CGPoint(x: CGFloat($0.x), y: CGFloat($0.y)) }
    }

    /// Returns the start and end points for a line annotation.
    public func line() -> (start: CGPoint, end: CGPoint)? {
        var s = FS_POINTF(x: 0, y: 0), e = FS_POINTF(x: 0, y: 0)
        guard FPDFAnnot_GetLine(handle, &s, &e) != 0 else { return nil }
        return (CGPoint(x: CGFloat(s.x), y: CGFloat(s.y)), CGPoint(x: CGFloat(e.x), y: CGFloat(e.y)))
    }

    internal var objectCount: Int { Int(FPDFAnnot_GetObjectCount(handle)) }
    internal func object(at index: Int) -> FPDF_PAGEOBJECT? { FPDFAnnot_GetObject(handle, Int32(index)) }
    @discardableResult internal func appendObject(_ obj: FPDF_PAGEOBJECT) -> Bool { FPDFAnnot_AppendObject(handle, obj) != 0 }
    @discardableResult internal func removeObject(at index: Int) -> Bool { FPDFAnnot_RemoveObject(handle, Int32(index)) != 0 }
    @discardableResult internal func updateObject(_ obj: FPDF_PAGEOBJECT) -> Bool { FPDFAnnot_UpdateObject(handle, obj) != 0 }

    /// Sets a URI target for a link annotation.
    public func setURI(_ uri: String) -> Bool { uri.withCString { FPDFAnnot_SetURI(handle, $0) != 0 } }

    internal func linkHandle() -> FPDF_LINK? { FPDFAnnot_GetLink(handle) }
    internal func fileAttachmentHandle() -> FPDF_ATTACHMENT? { FPDFAnnot_GetFileAttachment(handle) }
    internal func addFileAttachment(name: String) -> FPDF_ATTACHMENT? {
        return withFPDFWideString(name) { FPDFAnnot_AddFileAttachment(handle, $0) }
    }
}
