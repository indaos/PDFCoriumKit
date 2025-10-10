package com.pdfiumkit.demo;

import android.app.AlertDialog;
import android.content.Context;
import android.text.InputType;
import android.widget.EditText;

public class TextInputDialog {
    public interface OnText {
        void onText(String text);
    }

    public static void show(Context ctx, String title, OnText cb) {
        final EditText input = new EditText(ctx);
        input.setInputType(InputType.TYPE_CLASS_TEXT);
        new AlertDialog.Builder(ctx)
                .setTitle(title)
                .setView(input)
                .setPositiveButton("OK", (d, w) -> cb.onText(input.getText().toString()))
                .setNegativeButton("Cancel", (d, w) -> d.dismiss())
                .show();
    }
}

