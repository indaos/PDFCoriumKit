import Foundation
import UIKit
@_implementationOnly import PDFium

/// Opened PDF document handle providing access to pages and save operations.
public final class FPDocument {
    internal let handle: FPDF_DOCUMENT

    /// Opens a document from a file URL with an optional password.
    public init(url: URL, password: String? = nil) throws {
        PDFiumLibrary.ensureInitialized()
        guard let h: FPDF_DOCUMENT = url.path.withCString({ cPath in
            if let pwd = password { return pwd.withCString { FPDF_LoadDocument(cPath, $0) } }
            return FPDF_LoadDocument(cPath, nil)
        }) else {
            throw PDFiumError.openFailed
        }
        self.handle = h
    }

    deinit { FPDF_CloseDocument(handle) }

    /// Total number of pages in the document.
    public var pageCount: Int { Int(FPDF_GetPageCount(handle)) }

    /// Loads a page by index.
    public func page(index: Int) throws -> FPPage {
        guard let p = FPDF_LoadPage(handle, Int32(index)) else { throw PDFiumError.pageLoadFailed }
        return FPPage(document: self, handle: p)
    }

    /// Saves the document to the given URL.
    @discardableResult
    public func save(to url: URL, flags: Int32 = 0) throws -> Bool {
        let ok = url.path.withCString { cPath in Int32(FPDF_SaveAsPath(handle, cPath, Int32(flags))) }
        guard ok == 1 else { throw PDFiumError.saveFailed }
        return true
    }
}
