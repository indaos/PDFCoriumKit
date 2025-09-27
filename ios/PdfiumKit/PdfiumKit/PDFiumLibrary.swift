import Foundation
@_implementationOnly import PDFium

/// Initializes PDFium once per process.
enum PDFiumLibrary {
    private static var initialized = false

    /// Ensures PDFium is initialized for subsequent calls.
    static func ensureInitialized() {
        if !initialized {
            FPDF_InitLibrary()
            initialized = true
        }
    }
}
