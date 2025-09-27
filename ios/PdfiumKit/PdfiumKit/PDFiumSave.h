#pragma once

#ifdef __cplusplus
extern "C" {
#endif

// Opaque PDFium type (match PDFium tag name)
typedef struct fpdf_document_t__* FPDF_DOCUMENT;

// Simple helper to save a PDFium document to a filesystem path.
// Returns 1 on success, 0 on failure.
int FPDF_SaveAsPath(FPDF_DOCUMENT doc, const char* path, int flags);

#ifdef __cplusplus
}
#endif
