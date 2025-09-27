import Foundation
@_implementationOnly import PDFium

/// Outline (bookmark) handle with navigation helpers.
public final class FPBookmark {
    public let document: FPDocument
    internal let handle: FPDF_BOOKMARK

    internal init(document: FPDocument, handle: FPDF_BOOKMARK) {
        self.document = document
        self.handle = handle
    }

    /// Bookmark title string.
    public var title: String {
        let needed = Int(FPDFBookmark_GetTitle(handle, nil, 0))
        guard needed > 0 else { return "" }
        var buf = [UInt8](repeating: 0, count: needed)
        _ = FPDFBookmark_GetTitle(handle, &buf, UInt(buf.count))
        return buf.withUnsafeBytes { raw -> String in
            let u16 = raw.bindMemory(to: UInt16.self)
            let count = max(0, u16.count - 1)
            return String(utf16CodeUnits: u16.baseAddress!, count: count)
        }
    }

    /// Number of direct child bookmarks.
    public var childrenCount: Int { Int(FPDFBookmark_GetCount(handle)) }

    /// First child bookmark.
    public var firstChild: FPBookmark? {
        guard let child = FPDFBookmark_GetFirstChild(document.handle, handle) else { return nil }
        return FPBookmark(document: document, handle: child)
    }

    /// Next sibling bookmark.
    public var nextSibling: FPBookmark? {
        guard let sib = FPDFBookmark_GetNextSibling(document.handle, handle) else { return nil }
        return FPBookmark(document: document, handle: sib)
    }

    internal var destination: FPDF_DEST? { FPDFBookmark_GetDest(document.handle, handle) }
    internal var action: FPDF_ACTION? { FPDFBookmark_GetAction(handle) }

    /// Destination page index for this bookmark, if it points to a page.
    public func destinationPageIndex() -> Int? {
        if let d = destination { let idx = FPDFDest_GetDestPageIndex(document.handle, d); return idx >= 0 ? Int(idx) : nil }
        if let a = action { if FPDFAction_GetType(a) == PDFACTION_GOTO { if let d = FPDFAction_GetDest(document.handle, a) { let idx = FPDFDest_GetDestPageIndex(document.handle, d); return idx >= 0 ? Int(idx) : nil } } }
        return nil
    }
}

public extension FPDocument {
    /// Top-level outline bookmarks for the document.
    func outline() -> [FPBookmark] {
        var results: [FPBookmark] = []
        var node = FPDFBookmark_GetFirstChild(handle, nil)
        while let n = node {
            let bm = FPBookmark(document: self, handle: n)
            results.append(bm)
            node = FPDFBookmark_GetNextSibling(handle, n)
        }
        return results
    }

    /// Value type representation of a bookmark subtree.
    struct BookmarkNode { public var title: String; public var pageIndex: Int?; public var children: [BookmarkNode] }

    /// Full outline tree as value types.
    func outlineTree() -> [BookmarkNode] {
        func build(_ bookmark: FPBookmark?) -> BookmarkNode? {
            guard let bookmark = bookmark else { return nil }
            let title = bookmark.title
            let idx = bookmark.destinationPageIndex()
            var kids: [BookmarkNode] = []
            var child = bookmark.firstChild
            while let c = child {
                if let node = build(c) { kids.append(node) }
                child = c.nextSibling
            }
            return BookmarkNode(title: title, pageIndex: idx, children: kids)
        }

        var out: [BookmarkNode] = []
        var n = FPDFBookmark_GetFirstChild(handle, nil)
        while let h = n {
            if let node = build(FPBookmark(document: self, handle: h)) { out.append(node) }
            n = FPDFBookmark_GetNextSibling(handle, h)
        }
        return out
    }
}
