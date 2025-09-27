import Foundation
@_implementationOnly import PDFium

public extension FPDocument {
    /// Standard document metadata tags.
    enum MetaTag: String { case Title, Author, Subject, Keywords, Creator, Producer, CreationDate, ModDate }

    /// Returns a metadata string for the given tag.
    func meta(_ tag: MetaTag) -> String? {
        let key = tag.rawValue
        let needed = Int(FPDF_GetMetaText(handle, key, nil, 0))
        guard needed > 0 else { return nil }
        var buf = [UInt8](repeating: 0, count: needed)
        _ = FPDF_GetMetaText(handle, key, &buf, UInt(buf.count))
        return buf.withUnsafeBytes { raw -> String? in
            let u16 = raw.bindMemory(to: UInt16.self)
            let count = max(0, u16.count - 1)
            return String(utf16CodeUnits: u16.baseAddress!, count: count)
        }
    }

    /// Returns the page label shown in viewers for a given page index.
    func pageLabel(index: Int) -> String? {
        let needed = Int(FPDF_GetPageLabel(handle, Int32(index), nil, 0))
        guard needed > 0 else { return nil }
        var buf = [UInt8](repeating: 0, count: needed)
        _ = FPDF_GetPageLabel(handle, Int32(index), &buf, UInt(buf.count))
        return buf.withUnsafeBytes { raw -> String? in
            let u16 = raw.bindMemory(to: UInt16.self)
            let count = max(0, u16.count - 1)
            return String(utf16CodeUnits: u16.baseAddress!, count: count)
        }
    }
}
