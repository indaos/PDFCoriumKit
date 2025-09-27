#include "PDFiumSave.h"
#include <stdio.h>
#include <stdbool.h>
// Pull in PDFium headers only in implementation.
#include <public/fpdfview.h>
#include <public/fpdf_save.h>

typedef struct {
    FPDF_FILEWRITE fileWrite;
    FILE* file;
} FileWriter;

static int WriteBlock(FPDF_FILEWRITE* f, const void* data, unsigned long size) {
    if (!f) return 0;
    FileWriter* writer = (FileWriter*)f;
    if (!writer->file) return 0;
    size_t written = fwrite(data, 1, size, writer->file);
    return (written == size) ? 1 : 0;
}

int FPDF_SaveAsPath(FPDF_DOCUMENT doc, const char* path, int flags) {
    if (!doc || !path) return 0;
    FILE* fp = fopen(path, "wb");
    if (!fp) return 0;

    FileWriter writer;
    writer.file = fp;
    writer.fileWrite.version = 1;
    writer.fileWrite.WriteBlock = WriteBlock;

    int ok = FPDF_SaveAsCopy(doc, &writer.fileWrite, flags);
    fclose(fp);
    return ok;
}
