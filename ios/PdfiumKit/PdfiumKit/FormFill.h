#pragma once

#ifdef __cplusplus
extern "C" {
#endif

// Opaque PDFium types (match PDFium tag names)
typedef struct fpdf_document_t__* FPDF_DOCUMENT;
typedef struct fpdf_form_handle_t__* FPDF_FORMHANDLE;

// Minimal form fill environment helpers.
// Returns NULL on failure.
FPDF_FORMHANDLE FPForm_Init(FPDF_DOCUMENT doc);
void FPForm_Exit(FPDF_FORMHANDLE handle);

#ifdef __cplusplus
}
#endif
