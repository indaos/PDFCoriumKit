// Minimal JNI bridge to PDFium static library
// Links to libpdfium.a from out/android/release/lib/<abi>

#include <jni.h>
#include <android/log.h>
#include <android/bitmap.h>
#include <string>
#include <mutex>

// PDFium public headers
#include "fpdfview.h"
#include "fpdf_formfill.h"
#include "fpdf_annot.h"
#include "fpdf_save.h"

#define LOG_TAG "pdfiumkit"
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)

namespace {

std::once_flag g_pdfiumInitOnce;

void ensure_pdfium_init() {
    std::call_once(g_pdfiumInitOnce, [](){
        FPDF_LIBRARY_CONFIG config{};
        config.version = 3;
        FPDF_InitLibraryWithConfig(&config);
        LOGI("PDFium initialized");
    });
}

struct DocumentContext {
    FPDF_DOCUMENT doc = nullptr;
    FPDF_FORMHANDLE form = nullptr;
};

static jclass g_runtimeException = nullptr;

void throwRuntime(JNIEnv* env, const char* msg) {
    if (!g_runtimeException) {
        jclass cls = env->FindClass("java/lang/RuntimeException");
        g_runtimeException = (jclass)env->NewGlobalRef(cls);
    }
    env->ThrowNew(g_runtimeException, msg);
}

jlong ptr_to_jlong(void* p) {
    return reinterpret_cast<jlong>(p);
}

template<typename T>
T* jlong_to_ptr(jlong v) {
    return reinterpret_cast<T*>(v);
}

// Helpers
std::u16string to_u16(JNIEnv* env, jstring s) {
    if (!s) return u"";
    const jchar* chars = env->GetStringChars(s, nullptr);
    jsize len = env->GetStringLength(s);
    std::u16string out((const char16_t*)chars, (size_t)len);
    env->ReleaseStringChars(s, chars);
    return out;
}

} // namespace

extern "C" JNIEXPORT jlong JNICALL
Java_com_pdfiumkit_PdfiumDocument_nativeOpenDocument(JNIEnv* env, jobject thiz, jstring jpath, jstring jpassword) {
    ensure_pdfium_init();
    if (!jpath) {
        throwRuntime(env, "Path is null");
        return 0;
    }
    const char* path = env->GetStringUTFChars(jpath, nullptr);
    const char* pwd = jpassword ? env->GetStringUTFChars(jpassword, nullptr) : nullptr;

    FPDF_DOCUMENT doc = FPDF_LoadDocument(path, pwd);
    if (jpassword) env->ReleaseStringUTFChars(jpassword, pwd);
    env->ReleaseStringUTFChars(jpath, path);

    if (!doc) {
        unsigned long err = FPDF_GetLastError();
        LOGE("FPDF_LoadDocument failed: %lu", err);
        throwRuntime(env, "Failed to load PDF document");
        return 0;
    }

    auto* ctx = new DocumentContext();
    ctx->doc = doc;

    FPDF_FORMFILLINFO ffi{};
    ffi.version = 1; // minimal callbacks
    ctx->form = FPDFDOC_InitFormFillEnvironment(doc, &ffi);

    return ptr_to_jlong(ctx);
}

extern "C" JNIEXPORT void JNICALL
Java_com_pdfiumkit_PdfiumDocument_nativeCloseDocument(JNIEnv* env, jobject thiz, jlong jctx) {
    auto* ctx = jlong_to_ptr<DocumentContext>(jctx);
    if (!ctx) return;
    if (ctx->form) {
        FPDFDOC_ExitFormFillEnvironment(ctx->form);
        ctx->form = nullptr;
    }
    if (ctx->doc) {
        FPDF_CloseDocument(ctx->doc);
        ctx->doc = nullptr;
    }
    delete ctx;
}

extern "C" JNIEXPORT jint JNICALL
Java_com_pdfiumkit_PdfiumDocument_nativeGetPageCount(JNIEnv* env, jobject thiz, jlong jctx) {
    auto* ctx = jlong_to_ptr<DocumentContext>(jctx);
    if (!ctx || !ctx->doc) return 0;
    return (jint)FPDF_GetPageCount(ctx->doc);
}

extern "C" JNIEXPORT jlong JNICALL
Java_com_pdfiumkit_PdfiumDocument_nativeLoadPage(JNIEnv* env, jobject thiz, jlong jctx, jint index) {
    auto* ctx = jlong_to_ptr<DocumentContext>(jctx);
    if (!ctx || !ctx->doc) return 0;
    FPDF_PAGE page = FPDF_LoadPage(ctx->doc, index);
    if (!page) return 0;
    if (ctx->form) {
        FORM_OnAfterLoadPage(page, ctx->form);
        FORM_DoPageAAction(page, ctx->form, FPDFPAGE_AACTION_OPEN);
    }
    return ptr_to_jlong(page);
}

extern "C" JNIEXPORT void JNICALL
Java_com_pdfiumkit_PdfiumDocument_nativeClosePage(JNIEnv* env, jobject thiz, jlong jctx, jlong jpage) {
    auto* ctx = jlong_to_ptr<DocumentContext>(jctx);
    auto* page = jlong_to_ptr<void>(jpage);
    if (!page) return;
    if (ctx && ctx->form) {
        FORM_DoPageAAction((FPDF_PAGE)page, ctx->form, FPDFPAGE_AACTION_CLOSE);
        FORM_OnBeforeClosePage((FPDF_PAGE)page, ctx->form);
    }
    FPDF_ClosePage((FPDF_PAGE)page);
}

extern "C" JNIEXPORT jfloat JNICALL
Java_com_pdfiumkit_PdfiumDocument_nativeGetPageWidth(JNIEnv* env, jobject thiz, jlong jpage) {
    auto* page = jlong_to_ptr<void>(jpage);
    if (!page) return 0;
    return (jfloat)FPDF_GetPageWidthF((FPDF_PAGE)page);
}

extern "C" JNIEXPORT jfloat JNICALL
Java_com_pdfiumkit_PdfiumDocument_nativeGetPageHeight(JNIEnv* env, jobject thiz, jlong jpage) {
    auto* page = jlong_to_ptr<void>(jpage);
    if (!page) return 0;
    return (jfloat)FPDF_GetPageHeightF((FPDF_PAGE)page);
}

extern "C" JNIEXPORT void JNICALL
Java_com_pdfiumkit_PdfiumDocument_nativeRenderPageBitmap(JNIEnv* env, jobject thiz, jlong jctx, jlong jpage,
                                                         jobject bitmap, jint start_x, jint start_y,
                                                         jint size_x, jint size_y, jint rotate, jint flags) {
    auto* ctx = jlong_to_ptr<DocumentContext>(jctx);
    auto* page = jlong_to_ptr<void>(jpage);
    if (!page) return;

    AndroidBitmapInfo info;
    if (AndroidBitmap_getInfo(env, bitmap, &info) != ANDROID_BITMAP_RESULT_SUCCESS) {
        throwRuntime(env, "Bitmap_getInfo failed");
        return;
    }
    void* pixels = nullptr;
    if (AndroidBitmap_lockPixels(env, bitmap, &pixels) != ANDROID_BITMAP_RESULT_SUCCESS) {
        throwRuntime(env, "Bitmap_lockPixels failed");
        return;
    }

    FPDF_BITMAP bmp = FPDFBitmap_CreateEx(info.width, info.height, FPDFBitmap_BGRA,
                                           pixels, info.stride);
    // Clear to white
    FPDFBitmap_FillRect(bmp, 0, 0, info.width, info.height, 0xFFFFFFFF);
    FPDF_RenderPageBitmap(bmp, (FPDF_PAGE)page, start_x, start_y, size_x, size_y, rotate, flags);

    if (ctx && ctx->form) {
        // Draw form widgets on top
        FPDF_FFLDraw(ctx->form, bmp, (FPDF_PAGE)page, start_x, start_y, size_x, size_y, rotate, flags);
    }

    FPDFBitmap_Destroy(bmp);
    AndroidBitmap_unlockPixels(env, bitmap);
}

extern "C" JNIEXPORT jint JNICALL
Java_com_pdfiumkit_PdfiumDocument_nativeGetFormType(JNIEnv* env, jobject thiz, jlong jctx) {
    auto* ctx = jlong_to_ptr<DocumentContext>(jctx);
    if (!ctx || !ctx->doc) return FORMTYPE_NONE;
    return (jint)FPDF_GetFormType(ctx->doc);
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_pdfiumkit_PdfiumDocument_nativeFocusFormAt(JNIEnv* env, jobject thiz, jlong jctx, jlong jpage, jfloat pageX, jfloat pageY) {
    auto* ctx = jlong_to_ptr<DocumentContext>(jctx);
    auto* page = jlong_to_ptr<void>(jpage);
    if (!ctx || !ctx->form || !page) return JNI_FALSE;
    FS_POINTF pt{pageX, pageY};
    FPDF_ANNOTATION annot = FPDFAnnot_GetFormFieldAtPoint(ctx->form, (FPDF_PAGE)page, &pt);
    if (!annot) return JNI_FALSE;
    FPDF_BOOL ok = FORM_SetFocusedAnnot(ctx->form, annot);
    FPDFPage_CloseAnnot(annot);
    return ok ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT void JNICALL
Java_com_pdfiumkit_PdfiumDocument_nativeFormSelectAll(JNIEnv* env, jobject thiz, jlong jctx, jlong jpage) {
    auto* ctx = jlong_to_ptr<DocumentContext>(jctx);
    auto* page = jlong_to_ptr<void>(jpage);
    if (!ctx || !ctx->form || !page) return;
    FORM_SelectAllText(ctx->form, (FPDF_PAGE)page);
}

extern "C" JNIEXPORT void JNICALL
Java_com_pdfiumkit_PdfiumDocument_nativeFormReplaceSelection(JNIEnv* env, jobject thiz, jlong jctx, jlong jpage, jstring jtext) {
    auto* ctx = jlong_to_ptr<DocumentContext>(jctx);
    auto* page = jlong_to_ptr<void>(jpage);
    if (!ctx || !ctx->form || !page) return;
    std::u16string t = to_u16(env, jtext);
    // FORM_ReplaceSelection expects null-terminated UTF-16LE string.
    const unsigned short* ws = reinterpret_cast<const unsigned short*>(t.c_str());
    FORM_ReplaceSelection(ctx->form, (FPDF_PAGE)page, ws);
}

// Optional: Save updated document (annotations/forms) to a target path
struct FileWriterCtx {
    FPDF_FILEWRITE base;
    FILE* fp;
};

static int WriteBlock(FPDF_FILEWRITE* pFileWrite, const void* data, unsigned long size) {
    FileWriterCtx* ctx = reinterpret_cast<FileWriterCtx*>(pFileWrite);
    return fwrite(data, 1, size, ctx->fp) == size ? 1 : 0;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_pdfiumkit_PdfiumDocument_nativeSave(JNIEnv* env, jobject thiz, jlong jctx, jstring jpath) {
    auto* ctx = jlong_to_ptr<DocumentContext>(jctx);
    if (!ctx || !ctx->doc) return JNI_FALSE;
    const char* path = env->GetStringUTFChars(jpath, nullptr);
    FILE* fp = fopen(path, "wb");
    env->ReleaseStringUTFChars(jpath, path);
    if (!fp) return JNI_FALSE;
    FileWriterCtx writer{};
    writer.base.version = 1;
    writer.base.WriteBlock = WriteBlock;
    writer.fp = fp;
    FPDF_BOOL ok = FPDF_SaveAsCopy(ctx->doc, &writer.base, 0);
    fclose(fp);
    return ok ? JNI_TRUE : JNI_FALSE;
}

// Optional: register natives by name to avoid relying on symbol export names
static JNINativeMethod gPdfiumDocumentMethods[] = {
    {"nativeOpenDocument", "(Ljava/lang/String;Ljava/lang/String;)J", (void*)Java_com_pdfiumkit_PdfiumDocument_nativeOpenDocument},
    {"nativeCloseDocument", "(J)V", (void*)Java_com_pdfiumkit_PdfiumDocument_nativeCloseDocument},
    {"nativeGetPageCount", "(J)I", (void*)Java_com_pdfiumkit_PdfiumDocument_nativeGetPageCount},
    {"nativeLoadPage", "(JI)J", (void*)Java_com_pdfiumkit_PdfiumDocument_nativeLoadPage},
    {"nativeClosePage", "(JJ)V", (void*)Java_com_pdfiumkit_PdfiumDocument_nativeClosePage},
    {"nativeGetPageWidth", "(J)F", (void*)Java_com_pdfiumkit_PdfiumDocument_nativeGetPageWidth},
    {"nativeGetPageHeight", "(J)F", (void*)Java_com_pdfiumkit_PdfiumDocument_nativeGetPageHeight},
    {"nativeRenderPageBitmap", "(JJLandroid/graphics/Bitmap;IIIIII)V", (void*)Java_com_pdfiumkit_PdfiumDocument_nativeRenderPageBitmap},
    {"nativeGetFormType", "(J)I", (void*)Java_com_pdfiumkit_PdfiumDocument_nativeGetFormType},
    {"nativeFocusFormAt", "(JJFF)Z", (void*)Java_com_pdfiumkit_PdfiumDocument_nativeFocusFormAt},
    {"nativeFormSelectAll", "(JJ)V", (void*)Java_com_pdfiumkit_PdfiumDocument_nativeFormSelectAll},
    {"nativeFormReplaceSelection", "(JJLjava/lang/String;)V", (void*)Java_com_pdfiumkit_PdfiumDocument_nativeFormReplaceSelection},
    {"nativeSave", "(JLjava/lang/String;)Z", (void*)Java_com_pdfiumkit_PdfiumDocument_nativeSave},
};

extern "C" JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
    JNIEnv* env = nullptr;
    if (vm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) != JNI_OK || !env) {
        return 0;
    }

    jclass cls = env->FindClass("com/pdfiumkit/PdfiumDocument");
    if (!cls) {
        LOGE("JNI_OnLoad: PdfiumDocument class not found; will rely on nativeInit");
        return JNI_VERSION_1_6;
    }
    if (env->RegisterNatives(cls, gPdfiumDocumentMethods, sizeof(gPdfiumDocumentMethods)/sizeof(gPdfiumDocumentMethods[0])) != 0) {
        LOGE("JNI_OnLoad: RegisterNatives failed; will rely on nativeInit");
        return JNI_VERSION_1_6;
    }
    LOGI("JNI_OnLoad: pdfiumkit natives registered");
    return JNI_VERSION_1_6;
}

extern "C" JNIEXPORT void JNICALL
Java_com_pdfiumkit_PdfiumDocument_nativeInit(JNIEnv* env, jclass clazz) {
    if (!env || !clazz) return;
    if (env->RegisterNatives(clazz, gPdfiumDocumentMethods, sizeof(gPdfiumDocumentMethods)/sizeof(gPdfiumDocumentMethods[0])) != 0) {
        LOGE("nativeInit: RegisterNatives failed");
    } else {
        LOGI("nativeInit: pdfiumkit natives registered");
    }
}
