package com.panellord;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import java.util.UUID;

public class DeviceIdManager {
    private static final String PREFS  = "pl_prefs";
    private static final String KEY_ID = "device_id";

    public static String getDeviceId(Context ctx) {
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String id = prefs.getString(KEY_ID, null);
        if (id == null) {
            // Generate stable ID: android_<model>_<uuid_short>
            String model = Build.MODEL.replaceAll("[^a-zA-Z0-9]", "").toLowerCase();
            String uuid  = UUID.randomUUID().toString().replace("-", "").substring(0, 13);
            id = "android_" + model + "_" + uuid;
            prefs.edit().putString(KEY_ID, id).apply();
        }
        return id;
    }
}
