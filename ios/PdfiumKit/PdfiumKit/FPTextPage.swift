import Foundation
@_implementationOnly import PDFium

/// Text extraction and text-based annotation utilities for a page.
public final class FPTextPage {
    public let page: FPPage
    internal let handle: FPDF_TEXTPAGE

    internal init?(page: FPPage) {
        self.page = page
        guard let h = FPDFText_LoadPage(page.handle) else { return nil }
        self.handle = h
    }

    deinit { FPDFText_ClosePage(handle) }

    /// Number of text characters on the page.
    public var characterCount: Int { Int(FPDFText_CountChars(handle)) }

    /// Full page text content as a Swift String.
    public func text() -> String {
        let count = characterCount
        guard count > 0 else { return "" }
        var scalars = String.UnicodeScalarView()
        scalars.reserveCapacity(count)
        for i in 0..<count {
            let uni = FPDFText_GetUnicode(handle, Int32(i))
            if let scalar = UnicodeScalar(uni) { scalars.append(scalar) }
        }
        return String(scalars)
    }

    public struct SearchResult { public let range: Range<Int> }

    /// Finds occurrences of a query string with optional case and whole-word matching.
    public func find(_ query: String, matchCase: Bool = false, wholeWord: Bool = false) -> [SearchResult] {
        var flags: UInt = 0
        if matchCase { flags |= UInt(FPDF_MATCHCASE) }
        if wholeWord { flags |= UInt(FPDF_MATCHWHOLEWORD) }
        return withFPDFWideString(query) { wstr -> [SearchResult] in
            guard let h = FPDFText_FindStart(handle, wstr, flags, 0) else { return [] }
            defer { FPDFText_FindClose(h) }
            var results: [SearchResult] = []
            while FPDFText_FindNext(h) != 0 {
                let start = Int(FPDFText_GetSchResultIndex(h))
                let len = Int(FPDFText_GetSchCount(h))
                if start >= 0 && len > 0 { results.append(.init(range: start..<(start+len))) }
            }
            return results
        }
    }

    /// Web link info discovered from page text.
    public struct WebLink { public let url: String; public let rects: [PDFRect] }

    /// Returns inferred web links and the rectangles that cover them.
    public func webLinks() -> [WebLink] {
        guard let linkPage = FPDFLink_LoadWebLinks(handle) else { return [] }
        defer { FPDFLink_CloseWebLinks(linkPage) }
        let count = Int(FPDFLink_CountWebLinks(linkPage))
        guard count > 0 else { return [] }
        var out: [WebLink] = []
        for i in 0..<count {
            let needed = Int(FPDFLink_GetURL(linkPage, Int32(i), nil, 0))
            var url = ""
            if needed > 0 {
                var buf = [UInt16](repeating: 0, count: needed)
                _ = FPDFLink_GetURL(linkPage, Int32(i), &buf, Int32(buf.count))
                url = String(utf16CodeUnits: buf, count: max(0, needed - 1))
            }
            let rcount = Int(FPDFLink_CountRects(linkPage, Int32(i)))
            var rects: [PDFRect] = []
            for r in 0..<rcount {
                var l=0.0, t=0.0, rgt=0.0, b=0.0
                if FPDFLink_GetRect(linkPage, Int32(i), Int32(r), &l, &t, &rgt, &b) != 0 {
                    rects.append(PDFRect(left: Float(l), bottom: Float(b), right: Float(rgt), top: Float(t)))
                }
            }
            out.append(WebLink(url: url, rects: rects))
        }
        return out
    }

    /// Adds a highlight annotation covering a character range.
    @discardableResult
    public func addHighlight(range: Range<Int>, color: PDFColor = .init(r: 255, g: 255, b: 0, a: 128)) -> FPAnnotation? {
        let count = characterCount
        guard count > 0, range.lowerBound >= 0, range.upperBound <= count, range.lowerBound < range.upperBound else { return nil }
        guard let annot = FPDFPage_CreateAnnot(page.handle, FPDF_ANNOT_HIGHLIGHT) else { return nil }

        struct Box { var left: Double; var right: Double; var bottom: Double; var top: Double }
        var boxes: [Box] = []
        boxes.reserveCapacity(range.count)
        for i in range.lowerBound..<range.upperBound {
            var l=0.0, r=0.0, b=0.0, t=0.0
            if FPDFText_GetCharBox(handle, Int32(i), &l, &r, &b, &t) != 0 {
                boxes.append(Box(left: l, right: r, bottom: b, top: t))
            }
        }
        guard !boxes.isEmpty else { FPDFPage_CloseAnnot(annot); return nil }

        let tol = 2.0
        var lines: [[Box]] = []
        var current: [Box] = []
        for b in boxes.sorted(by: { $0.top > $1.top || ($0.top == $1.top && $0.left < $1.left) }) {
            if current.isEmpty { current.append(b); continue }
            if abs(current.last!.top - b.top) <= tol { current.append(b) }
            else { lines.append(current); current = [b] }
        }
        if !current.isEmpty { lines.append(current) }

        var unionLeft = Double.greatestFiniteMagnitude
        var unionRight = -Double.greatestFiniteMagnitude
        var unionTop = -Double.greatestFiniteMagnitude
        var unionBottom = Double.greatestFiniteMagnitude
        for line in lines {
            let left = line.map { $0.left }.min() ?? 0
            let right = line.map { $0.right }.max() ?? 0
            let top = line.map { $0.top }.max() ?? 0
            let bottom = line.map { $0.bottom }.min() ?? 0
            var quad = FS_QUADPOINTSF(x1: Float(left), y1: Float(top), x2: Float(right), y2: Float(top), x3: Float(left), y3: Float(bottom), x4: Float(right), y4: Float(bottom))
            _ = FPDFAnnot_AppendAttachmentPoints(annot, &quad)
            unionLeft = min(unionLeft, left)
            unionRight = max(unionRight, right)
            unionTop = max(unionTop, top)
            unionBottom = min(unionBottom, bottom)
        }
        if unionRight > unionLeft && unionTop > unionBottom {
            var r = FS_RECTF(left: Float(unionLeft), top: Float(unionTop), right: Float(unionRight), bottom: Float(unionBottom))
            FPDFAnnot_SetRect(annot, &r)
        }
        FPDFAnnot_SetColor(annot, FPDFANNOT_COLORTYPE_Color, UInt32(color.r), UInt32(color.g), UInt32(color.b), UInt32(color.a))
        FPDFPage_GenerateContent(page.handle)
        return FPAnnotation(page: page, handle: annot)
    }

    /// Adds a quadpoint-based text markup annotation from a character range.
    @discardableResult
    public func addQuadpointAnnot(subtype: FPAnnotationSubtype, range: Range<Int>, color: PDFColor) -> FPAnnotation? {
        let count = characterCount
        guard count > 0, range.lowerBound >= 0, range.upperBound <= count, range.lowerBound < range.upperBound else { return nil }
        guard let annot = FPDFPage_CreateAnnot(page.handle, subtype.fpdfValue) else { return nil }

        struct Box { var left: Double; var right: Double; var bottom: Double; var top: Double }
        var boxes: [Box] = []
        boxes.reserveCapacity(range.count)
        for i in range.lowerBound..<range.upperBound {
            var l=0.0, r=0.0, b=0.0, t=0.0
            if FPDFText_GetCharBox(handle, Int32(i), &l, &r, &b, &t) != 0 {
                boxes.append(Box(left: l, right: r, bottom: b, top: t))
            }
        }
        guard !boxes.isEmpty else { FPDFPage_CloseAnnot(annot); return nil }

        let tol = 2.0
        var lines: [[Box]] = []
        var current: [Box] = []
        for b in boxes.sorted(by: { $0.top > $1.top || ($0.top == $1.top && $0.left < $1.left) }) {
            if current.isEmpty { current.append(b); continue }
            if abs(current.last!.top - b.top) <= tol { current.append(b) }
            else { lines.append(current); current = [b] }
        }
        if !current.isEmpty { lines.append(current) }

        for line in lines {
            let left = line.map { $0.left }.min() ?? 0
            let right = line.map { $0.right }.max() ?? 0
            let top = line.map { $0.top }.max() ?? 0
            let bottom = line.map { $0.bottom }.min() ?? 0
            var quad = FS_QUADPOINTSF(x1: Float(left), y1: Float(top), x2: Float(right), y2: Float(top), x3: Float(left), y3: Float(bottom), x4: Float(right), y4: Float(bottom))
            _ = FPDFAnnot_AppendAttachmentPoints(annot, &quad)
        }

        FPDFAnnot_SetColor(annot, FPDFANNOT_COLORTYPE_Color, UInt32(color.r), UInt32(color.g), UInt32(color.b), UInt32(color.a))
        FPDFPage_GenerateContent(page.handle)
        return FPAnnotation(page: page, handle: annot)
    }

    @discardableResult
    /// Adds an underline markup for the given character range.
    public func addUnderline(range: Range<Int>, color: PDFColor = .init(r: 0, g: 0, b: 255, a: 255)) -> FPAnnotation? {
        addQuadpointAnnot(subtype: .underline, range: range, color: color)
    }

    @discardableResult
    /// Adds a strikeout markup for the given character range.
    public func addStrikeout(range: Range<Int>, color: PDFColor = .init(r: 255, g: 0, b: 0, a: 255)) -> FPAnnotation? {
        addQuadpointAnnot(subtype: .strikeout, range: range, color: color)
    }

    @discardableResult
    /// Adds a squiggly underline markup for the given character range.
    public func addSquiggly(range: Range<Int>, color: PDFColor = .init(r: 255, g: 165, b: 0, a: 255)) -> FPAnnotation? {
        addQuadpointAnnot(subtype: .squiggly, range: range, color: color)
    }
    /// Highlights all text intersecting a rectangle by converting to a character range.
    @discardableResult
    public func addHighlight(inRect rect: PDFRect, color: PDFColor = .init(r: 255, g: 255, b: 0, a: 128)) -> FPAnnotation? {
        let n = characterCount
        var indices: [Int] = []
        for i in 0..<n {
            var l=0.0, r=0.0, b=0.0, t=0.0
            if FPDFText_GetCharBox(handle, Int32(i), &l, &r, &b, &t) != 0 {
                if !(r < Double(rect.left) || Double(rect.right) < l || t < Double(rect.bottom) || Double(rect.top) < b) {
                    indices.append(i)
                }
            }
        }
        guard let first = indices.first, let last = indices.last, first <= last else { return nil }
        return addQuadpointAnnot(subtype: .highlight, range: first..<(last+1), color: color)
    }
}
