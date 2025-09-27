#include "FormFill.h"
#include <string.h>
// Pull in PDFium headers only in implementation.
#include <public/fpdfview.h>
#include <public/fpdf_formfill.h>

// Minimal FPDF_FORMFILLINFO implementation with version 2, mostly empty.
typedef struct {
    FPDF_FORMFILLINFO info;
} MinimalFormFillInfo;

static MinimalFormFillInfo g_info;

FPDF_FORMHANDLE FPForm_Init(FPDF_DOCUMENT doc) {
    memset(&g_info, 0, sizeof(g_info));
    g_info.info.version = 2; // Commonly used; callbacks optional for many cases
    return FPDFDOC_InitFormFillEnvironment(doc, &g_info.info);
}

void FPForm_Exit(FPDF_FORMHANDLE handle) {
    if (handle) {
        FPDFDOC_ExitFormFillEnvironment(handle);
    }
}
