import Foundation
@_implementationOnly import PDFium

/// Interactive form (AcroForm/XFA) helper for focus, values, and styling.
public final class FPForm {
    public let document: FPDocument
    internal let handle: FPDF_FORMHANDLE

    /// Initializes a form fill environment for a document.
    public init?(document: FPDocument) {
        self.document = document
        guard let h = FPForm_Init(document.handle) else { return nil }
        self.handle = h
        let yellow: UInt = 0x00FFCC00
        FPDF_SetFormFieldHighlightColor(handle, FPDF_FORMFIELD_UNKNOWN, yellow)
        FPDF_SetFormFieldHighlightAlpha(handle, 80)
        FORM_DoDocumentJSAction(handle)
        FORM_DoDocumentOpenAction(handle)
    }

    deinit { FPForm_Exit(handle) }

    /// Notifies the form engine that a page was loaded.
    public func onAfterLoad(page: FPPage) { FORM_OnAfterLoadPage(page.handle, handle) }
    /// Notifies the form engine that a page will close.
    public func onBeforeClose(page: FPPage) { FORM_OnBeforeClosePage(page.handle, handle) }
    @discardableResult
    /// Sets which annotation subtypes can receive keyboard focus.
    public func setFocusable(subtypes: [FPAnnotationSubtype]) -> Bool {
        var raw = subtypes.map { $0.fpdfValue }
        return raw.withUnsafeMutableBufferPointer { ptr in
            FPDFAnnot_SetFocusableSubtypes(handle, ptr.baseAddress, ptr.count) != 0
        }
    }

    /// Returns the currently focusable annotation subtypes.
    public func getFocusable() -> [FPAnnotationSubtype] {
        let count = Int(FPDFAnnot_GetFocusableSubtypesCount(handle))
        guard count > 0 else { return [] }
        var arr = [Int32](repeating: 0, count: count)
        let ok = arr.withUnsafeMutableBufferPointer { ptr in
            FPDFAnnot_GetFocusableSubtypes(handle, ptr.baseAddress, ptr.count) != 0
        }
        guard ok else { return [] }
        return arr.compactMap { FPAnnotationSubtype(rawValue: $0) }
    }

    /// Returns the form field flags for an annotation.
    public func formFieldFlags(for annot: FPAnnotation) -> Int { Int(FPDFAnnot_GetFormFieldFlags(handle, annot.handle)) }
    @discardableResult
    /// Sets form field flags for an annotation.
    public func setFormFieldFlags(for annot: FPAnnotation, flags: Int) -> Bool { FPDFAnnot_SetFormFieldFlags(handle, annot.handle, Int32(flags)) != 0 }

    /// Returns the field name (/T) for an annotation.
    public func formFieldName(for annot: FPAnnotation) -> String? {
        let needed = Int(FPDFAnnot_GetFormFieldName(handle, annot.handle, nil, 0))
        guard needed > 0 else { return nil }
        var buf = [UInt16](repeating: 0, count: needed/2)
        _ = FPDFAnnot_GetFormFieldName(handle, annot.handle, &buf, UInt(needed))
        return String(utf16CodeUnits: buf, count: max(0, buf.count-1))
    }
    /// Returns the alternate field name (/TU) for an annotation.
    public func formFieldAlternateName(for annot: FPAnnotation) -> String? {
        let needed = Int(FPDFAnnot_GetFormFieldAlternateName(handle, annot.handle, nil, 0))
        guard needed > 0 else { return nil }
        var buf = [UInt16](repeating: 0, count: needed/2)
        _ = FPDFAnnot_GetFormFieldAlternateName(handle, annot.handle, &buf, UInt(needed))
        return String(utf16CodeUnits: buf, count: max(0, buf.count-1))
    }
    /// Returns the field type value for an annotation.
    public func formFieldType(for annot: FPAnnotation) -> Int { Int(FPDFAnnot_GetFormFieldType(handle, annot.handle)) }
    /// Returns the field value (/V) for an annotation, if present.
    public func formFieldValue(for annot: FPAnnotation) -> String? {
        let needed = Int(FPDFAnnot_GetFormFieldValue(handle, annot.handle, nil, 0))
        guard needed > 0 else { return nil }
        var buf = [UInt16](repeating: 0, count: needed/2)
        _ = FPDFAnnot_GetFormFieldValue(handle, annot.handle, &buf, UInt(needed))
        return String(utf16CodeUnits: buf, count: max(0, buf.count-1))
    }
    /// Returns the number of options for a list/combo field.
    public func optionCount(for annot: FPAnnotation) -> Int { Int(FPDFAnnot_GetOptionCount(handle, annot.handle)) }
    /// Returns the label for an option at the given index.
    public func optionLabel(for annot: FPAnnotation, index: Int) -> String? {
        let needed = Int(FPDFAnnot_GetOptionLabel(handle, annot.handle, Int32(index), nil, 0))
        guard needed > 0 else { return nil }
        var buf = [UInt16](repeating: 0, count: needed/2)
        _ = FPDFAnnot_GetOptionLabel(handle, annot.handle, Int32(index), &buf, UInt(needed))
        return String(utf16CodeUnits: buf, count: max(0, buf.count-1))
    }
    /// Returns the number of controls in a radio button group.
    public func formControlCount(for annot: FPAnnotation) -> Int { Int(FPDFAnnot_GetFormControlCount(handle, annot.handle)) }
    /// Returns the control index within a radio button group.
    public func formControlIndex(for annot: FPAnnotation) -> Int { Int(FPDFAnnot_GetFormControlIndex(handle, annot.handle)) }
    /// Returns the export value for a control (e.g. radio/checkbox).
    public func formFieldExportValue(for annot: FPAnnotation) -> String? {
        let needed = Int(FPDFAnnot_GetFormFieldExportValue(handle, annot.handle, nil, 0))
        guard needed > 0 else { return nil }
        var buf = [UInt16](repeating: 0, count: needed/2)
        _ = FPDFAnnot_GetFormFieldExportValue(handle, annot.handle, &buf, UInt(needed))
        return String(utf16CodeUnits: buf, count: max(0, buf.count-1))
    }
    /// Returns the form field annotation under the given page point, if any.
    public func formField(at point: CGPoint, on page: FPPage) -> FPAnnotation? {
        var p = FS_POINTF(x: Float(point.x), y: Float(point.y))
        guard let h = FPDFAnnot_GetFormFieldAtPoint(handle, page.handle, &p) else { return nil }
        return FPAnnotation(page: page, handle: h)
    }
    /// Sets selection state for an option index in a list/combo field on a page.
    @discardableResult
    public func setIndexSelected(on page: FPPage, index: Int, selected: Bool) -> Bool {
        return FORM_SetIndexSelected(handle, page.handle, Int32(index), selected ? 1 : 0) != 0
    }
    /// Returns whether the option index is selected in a list/combo field on a page.
    public func isIndexSelected(on page: FPPage, index: Int) -> Bool {
        return FORM_IsIndexSelected(handle, page.handle, Int32(index)) != 0
    }
    /// Returns checked state for checkbox/radio widgets.
    public func isChecked(_ annot: FPAnnotation) -> Bool { FPDFAnnot_IsChecked(handle, annot.handle) != 0 }
    /// Returns the effective font size for variable text content, if available.
    public func fontSize(_ annot: FPAnnotation) -> Float? {
        var v: Float = 0
        return FPDFAnnot_GetFontSize(handle, annot.handle, &v) != 0 ? v : nil
    }

    @discardableResult
    /// Sets the font color for variable text content.
    public func setFontColor(_ annot: FPAnnotation, color: PDFColor) -> Bool {
        FPDFAnnot_SetFontColor(handle, annot.handle, UInt32(color.r), UInt32(color.g), UInt32(color.b)) != 0
    }
    /// Returns the font color for variable text content, if available.
    public func fontColor(_ annot: FPAnnotation) -> PDFColor? {
        var r: UInt32 = 0, g: UInt32 = 0, b: UInt32 = 0
        let ok = FPDFAnnot_GetFontColor(handle, annot.handle, &r, &g, &b)
        return ok != 0 ? PDFColor(r: UInt8(r), g: UInt8(g), b: UInt8(b)) : nil
    }
    /// Sets keyboard focus to a widget annotation.
    @discardableResult
    public func setFocused(_ annot: FPAnnotation) -> Bool { FORM_SetFocusedAnnot(handle, annot.handle) != 0 }

    /// Selects all text in the currently focused text widget on a page.
    @discardableResult
    public func selectAllText(on page: FPPage) -> Bool { FORM_SelectAllText(handle, page.handle) != 0 }
    /// Returns the currently selected text from the focused text widget.
    public func selectedText(on page: FPPage) -> String {
        let len = Int(FORM_GetSelectedText(handle, page.handle, nil, 0))
        guard len > 0 else { return "" }
        var buf = [UInt16](repeating: 0, count: len/2)
        _ = FORM_GetSelectedText(handle, page.handle, &buf, UInt(len))
        return String(utf16CodeUnits: buf, count: max(0, buf.count-1))
    }
    /// Replaces the selection in the focused text widget with the provided text.
    public func replaceSelection(on page: FPPage, text: String) {
        withFPDFWideString(text) { w in FORM_ReplaceSelection(handle, page.handle, w) }
    }
}
