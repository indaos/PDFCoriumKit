package com.pdfiumkit.demo;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.util.AttributeSet;
import android.view.GestureDetector;
import android.view.MotionEvent;
import android.view.ScaleGestureDetector;
import android.view.View;

import androidx.annotation.Nullable;

import com.pdfiumkit.PdfiumDocument;

public class PdfRenderView extends View {
    public enum Mode { VIEW, FILL }

    public interface InteractionListener {
        void onTap(float pageX, float pageY);
    }

    private PdfiumDocument doc;
    private long pagePtr;
    private float pageW, pageH;
    private float scale = 1.0f;
    private Bitmap buffer;
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Matrix drawMatrix = new Matrix();
    private final ScaleGestureDetector scaleDetector;
    private final GestureDetector gestureDetector;
    private Mode mode = Mode.VIEW;
    private InteractionListener interactionListener;

    public PdfRenderView(Context context, @Nullable AttributeSet attrs) {
        super(context, attrs);
        setWillNotDraw(false);
        scaleDetector = new ScaleGestureDetector(context, new ScaleListener());
        gestureDetector = new GestureDetector(context, new GestureDetector.SimpleOnGestureListener() {
            @Override
            public boolean onSingleTapConfirmed(MotionEvent e) {
                if (interactionListener != null) {
                    float[] pt = viewToPage(e.getX(), e.getY());
                    interactionListener.onTap(pt[0], pt[1]);
                    return true;
                }
                return super.onSingleTapConfirmed(e);
            }
        });
    }

    public void setInteractionListener(InteractionListener l) { this.interactionListener = l; }

    public void bind(PdfiumDocument doc, long pagePtr, float pageW, float pageH) {
        this.doc = doc;
        this.pagePtr = pagePtr;
        this.pageW = pageW;
        this.pageH = pageH;
        ensureBuffer();
    }

    public void setScale(float s) {
        this.scale = Math.max(0.2f, Math.min(8.0f, s));
        ensureBuffer();
        render();
    }

    public float getScale() { return scale; }

    public void setMode(Mode m) { this.mode = m; }
    public Mode getMode() { return mode; }

    public long getCurrentPagePtr() { return pagePtr; }

    private void ensureBuffer() {
        if (pageW <= 0 || pageH <= 0) return;
        int bw = Math.max(1, Math.round(pageW * scale));
        int bh = Math.max(1, Math.round(pageH * scale));
        if (buffer == null || buffer.getWidth() != bw || buffer.getHeight() != bh) {
            if (buffer != null) buffer.recycle();
            buffer = Bitmap.createBitmap(bw, bh, Bitmap.Config.ARGB_8888);
        }
    }

    public void render() {
        if (doc == null || pagePtr == 0 || buffer == null) return;
        // Render with annotation flag so non-widget annotations (e.g., ink) show as well.
        doc.renderPageBitmap(pagePtr, buffer, 0, 0, buffer.getWidth(), buffer.getHeight(), 0,
                /*flags*/1);
        invalidate();
    }

    private float[] viewToPage(float vx, float vy) {
        // Currently we render page into buffer at scale, and draw buffer at top-left.
        // So view coords map to page user-space by dividing by scale.
        return new float[]{vx / scale, vy / scale};
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        canvas.drawColor(Color.DKGRAY);
        if (buffer != null) {
            drawMatrix.reset();
            drawMatrix.postScale(1f, 1f);
            canvas.drawBitmap(buffer, 0, 0, paint);
        }
    }

    @Override
    public boolean onTouchEvent(MotionEvent event) {
        boolean handled = scaleDetector.onTouchEvent(event);
        handled = gestureDetector.onTouchEvent(event) || handled;
        return handled || super.onTouchEvent(event);
    }

    private class ScaleListener extends ScaleGestureDetector.SimpleOnScaleGestureListener {
        @Override
        public boolean onScale(ScaleGestureDetector detector) {
            setScale(scale * detector.getScaleFactor());
            return true;
        }
    }
}
