import Foundation
@_implementationOnly import PDFium

/// Document file attachment wrapper.
public final class FPAttachment {
    public let document: FPDocument
    internal let handle: FPDF_ATTACHMENT

    internal init(document: FPDocument, handle: FPDF_ATTACHMENT) {
        self.document = document
        self.handle = handle
    }

    deinit {}

    /// Attachment display name.
    public var name: String {
        let needed = Int(FPDFAttachment_GetName(handle, nil, 0))
        guard needed > 0 else { return "" }
        var buf = [UInt16](repeating: 0, count: needed/2)
        _ = FPDFAttachment_GetName(handle, &buf, UInt(needed))
        return String(utf16CodeUnits: buf, count: max(0, buf.count - 1))
    }

    /// Attachment data bytes, if accessible.
    public func data() -> Data? {
        var size: UInt = 0
        let ok = FPDFAttachment_GetFile(handle, nil, 0, &size)
        guard ok != 0, size > 0 else { return nil }
        var buf = [UInt8](repeating: 0, count: Int(size))
        var out: UInt = 0
        let ok2 = FPDFAttachment_GetFile(handle, &buf, UInt(buf.count), &out)
        guard ok2 != 0, out <= size else { return nil }
        return Data(buf[0..<Int(out)])
    }
}

public extension FPDocument {
    /// Returns all file attachments embedded in the document.
    func attachments() -> [FPAttachment] {
        let count = Int(FPDFDoc_GetAttachmentCount(handle))
        guard count > 0 else { return [] }
        var out: [FPAttachment] = []
        for i in 0..<count {
            if let a = FPDFDoc_GetAttachment(handle, Int32(i)) {
                out.append(FPAttachment(document: self, handle: a))
            }
        }
        return out
    }
}
