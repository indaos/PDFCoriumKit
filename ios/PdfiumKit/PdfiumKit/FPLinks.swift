import Foundation
@_implementationOnly import PDFium

/// Link annotation target and bounding rect.
public struct FPLinkInfo {
    public enum Target {
        case page(index: Int)
        case uri(String)
        case filePath(String)
        case unknown
    }
    public var rect: PDFRect
    public var target: Target
}

public extension FPPage {
    /// Returns all links on the page with their target destinations.
    func links() -> [FPLinkInfo] {
        var out: [FPLinkInfo] = []
        var pos: Int32 = 0
        while true {
            var link: FPDF_LINK? = nil
            if FPDFLink_Enumerate(handle, &pos, &link) == 0 { break }
            guard let link = link else { break }
            var rect = FS_RECTF(left: 0, top: 0, right: 0, bottom: 0)
            _ = FPDFLink_GetAnnotRect(link, &rect)
            let dest = FPDFLink_GetDest(document.handle, link)
            var target: FPLinkInfo.Target = .unknown
            if let d = dest {
                let idx = FPDFDest_GetDestPageIndex(document.handle, d)
                if idx >= 0 { target = .page(index: Int(idx)) }
            } else if let act = FPDFLink_GetAction(link) {
                let t = FPDFAction_GetType(act)
                if t == PDFACTION_URI {
                    let needed = Int(FPDFAction_GetURIPath(document.handle, act, nil, 0))
                    if needed > 0 {
                        var buf = [CChar](repeating: 0, count: needed)
                        _ = FPDFAction_GetURIPath(document.handle, act, &buf, UInt(buf.count))
                        target = .uri(String(cString: buf))
                    }
                } else if t == PDFACTION_LAUNCH || t == PDFACTION_REMOTEGOTO {
                    let needed = Int(FPDFAction_GetFilePath(act, nil, 0))
                    if needed > 0 {
                        var buf = [CChar](repeating: 0, count: needed)
                        _ = FPDFAction_GetFilePath(act, &buf, UInt(buf.count))
                        target = .filePath(String(cString: buf))
                    }
                }
            }
            out.append(FPLinkInfo(rect: PDFRect(left: rect.left, bottom: rect.bottom, right: rect.right, top: rect.top), target: target))
        }
        return out
    }
}
