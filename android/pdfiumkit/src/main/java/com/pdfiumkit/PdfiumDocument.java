package com.pdfiumkit;

import android.graphics.Bitmap;

public class PdfiumDocument {
    static {
        System.loadLibrary("pdfiumkit");
        nativeInit();
    }

    private long nativeCtx = 0;

    public void open(String path) {
        open(path, null);
    }

    public void open(String path, String password) {
        if (nativeCtx != 0) close();
        nativeCtx = nativeOpenDocument(path, password);
    }

    public boolean isOpen() { return nativeCtx != 0; }

    public void close() {
        if (nativeCtx != 0) {
            nativeCloseDocument(nativeCtx);
            nativeCtx = 0;
        }
    }

    public int getPageCount() { return nativeGetPageCount(nativeCtx); }

    public long loadPage(int index) { return nativeLoadPage(nativeCtx, index); }

    public void closePage(long pagePtr) { nativeClosePage(nativeCtx, pagePtr); }

    public float getPageWidth(long pagePtr) { return nativeGetPageWidth(pagePtr); }

    public float getPageHeight(long pagePtr) { return nativeGetPageHeight(pagePtr); }

    public void renderPageBitmap(long pagePtr, Bitmap bitmap,
                                 int startX, int startY, int sizeX, int sizeY, int rotate, int flags) {
        nativeRenderPageBitmap(nativeCtx, pagePtr, bitmap, startX, startY, sizeX, sizeY, rotate, flags);
    }

    public int getFormType() { return nativeGetFormType(nativeCtx); }

    public boolean focusFormAt(long pagePtr, float pageX, float pageY) {
        return nativeFocusFormAt(nativeCtx, pagePtr, pageX, pageY);
    }

    public void formSelectAll(long pagePtr) { nativeFormSelectAll(nativeCtx, pagePtr); }

    public void formReplaceSelection(long pagePtr, String text) { nativeFormReplaceSelection(nativeCtx, pagePtr, text); }

    public boolean save(String path) { return nativeSave(nativeCtx, path); }

    // Native
    private static native long nativeOpenDocument(String path, String password);
    private static native void nativeInit();
    private static native void nativeCloseDocument(long ctx);
    private static native int nativeGetPageCount(long ctx);
    private static native long nativeLoadPage(long ctx, int index);
    private static native void nativeClosePage(long ctx, long page);
    private static native float nativeGetPageWidth(long page);
    private static native float nativeGetPageHeight(long page);
    private static native void nativeRenderPageBitmap(long ctx, long page, Bitmap bitmap,
                                                     int startX, int startY, int sizeX, int sizeY, int rotate, int flags);
    private static native int nativeGetFormType(long ctx);
    private static native boolean nativeFocusFormAt(long ctx, long page, float pageX, float pageY);
    private static native void nativeFormSelectAll(long ctx, long page);
    private static native void nativeFormReplaceSelection(long ctx, long page, String text);
    private static native boolean nativeSave(long ctx, String path);
}
