package com.pdfiumkit.demo;

import android.content.ContentResolver;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.view.Menu;
import android.view.MenuItem;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.appcompat.widget.Toolbar;

import com.pdfiumkit.PdfiumDocument;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;

public class MainActivity extends AppCompatActivity {
    private PdfRenderView pdfView;
    private DrawingView drawingView;
    private final PdfiumDocument doc = new PdfiumDocument();
    private int currentPage = 0;

    private final ActivityResultLauncher<String> openDoc = registerForActivityResult(
            new ActivityResultContracts.GetContent(), this::onPickedUri);

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        Toolbar tb = findViewById(R.id.toolbar);
        setSupportActionBar(tb);
        tb.setOnMenuItemClickListener(this::onMenuItemClick);

        pdfView = findViewById(R.id.pdfView);
        drawingView = findViewById(R.id.drawingView);
        pdfView.setInteractionListener(new PdfRenderView.InteractionListener() {
            @Override
            public void onTap(float pageX, float pageY) {
                if (pdfView.getMode() == PdfRenderView.Mode.FILL && doc.isOpen()) {
                    long pagePtr = pdfView.getCurrentPagePtr();
                    if (doc.focusFormAt(pagePtr, pageX, pageY)) {
                        // simple text input
                        TextInputDialog.show(MainActivity.this, "Enter value", text -> {
                            doc.formSelectAll(pagePtr);
                            doc.formReplaceSelection(pagePtr, text);
                            pdfView.render();
                        });
                    } else {
                        Toast.makeText(MainActivity.this, "No form at tap", Toast.LENGTH_SHORT).show();
                    }
                }
            }
        });
    }

    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        getMenuInflater().inflate(R.menu.menu_main, menu);
        return true;
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        if (onMenuItemClick(item)) return true;
        return super.onOptionsItemSelected(item);
    }

    private boolean onMenuItemClick(MenuItem item) {
        int id = item.getItemId();
        if (id == R.id.action_open) {
            openDoc.launch("application/pdf");
            return true;
        } else if (id == R.id.action_prev) {
            if (doc.isOpen()) movePage(-1);
            return true;
        } else if (id == R.id.action_next) {
            if (doc.isOpen()) movePage(1);
            return true;
        } else if (id == R.id.action_zoom_in) {
            pdfView.setScale(pdfView.getScale() * 1.2f);
            return true;
        } else if (id == R.id.action_zoom_out) {
            pdfView.setScale(pdfView.getScale() / 1.2f);
            return true;
        } else if (id == R.id.action_fill) {
            pdfView.setMode(PdfRenderView.Mode.FILL);
            drawingView.setVisibility(android.view.View.GONE);
            return true;
        } else if (id == R.id.action_draw) {
            pdfView.setMode(PdfRenderView.Mode.VIEW);
            drawingView.setVisibility(android.view.View.VISIBLE);
            drawingView.toggle();
            return true;
        } else if (id == R.id.action_save) {
            if (doc.isOpen()) {
                File out = new File(getCacheDir(), "edited.pdf");
                boolean ok = doc.save(out.getAbsolutePath());
                Toast.makeText(this, ok ? "Saved: " + out.getAbsolutePath() : "Save failed", Toast.LENGTH_LONG).show();
            }
            return true;
        }
        return false;
    }

    private void onPickedUri(Uri uri) {
        if (uri == null) return;
        try {
            File cache = copyToCache(uri);
            doc.open(cache.getAbsolutePath());
            currentPage = 0;
            renderCurrentPage();
        } catch (Exception e) {
            Toast.makeText(this, "Open failed: " + e.getMessage(), Toast.LENGTH_LONG).show();
            e.printStackTrace();
        }
    }

    private File copyToCache(Uri uri) throws Exception {
        ContentResolver cr = getContentResolver();
        String name = "doc.pdf";
        try (android.database.Cursor c = cr.query(uri, null, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) name = c.getString(idx);
            }
        }
        File out = new File(getCacheDir(), name);
        try (InputStream is = cr.openInputStream(uri); FileOutputStream os = new FileOutputStream(out)) {
            byte[] buf = new byte[8192];
            int r;
            while ((r = is.read(buf)) != -1) os.write(buf, 0, r);
        }
        return out;
    }

    private void movePage(int delta) {
        int count = doc.getPageCount();
        int newPage = Math.max(0, Math.min(count - 1, currentPage + delta));
        if (newPage != currentPage) {
            currentPage = newPage;
            renderCurrentPage();
        }
    }

    private void renderCurrentPage() {
        long pagePtr = doc.loadPage(currentPage);
        float w = doc.getPageWidth(pagePtr);
        float h = doc.getPageHeight(pagePtr);
        pdfView.bind(doc, pagePtr, w, h);
        pdfView.render();
    }
}
