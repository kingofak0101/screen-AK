package com.panellord;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

import org.json.JSONObject;

public class SimReceiver extends BroadcastReceiver {
    private static final String TAG = "SimReceiver";

    @Override
    public void onReceive(Context ctx, Intent intent) {
        String action = intent.getAction();
        if (action == null) return;
        if (!"android.intent.action.SIM_STATE_CHANGED".equals(action)) return;

        // "ss" extra contains state string: ABSENT, READY, LOADED, LOCKED, UNKNOWN
        String simState = intent.getStringExtra("ss");
        int slotIndex  = intent.getIntExtra("slot", 0);

        if (simState == null) return;

        final String event;
        if ("ABSENT".equalsIgnoreCase(simState)) {
            event = "sim_removed";
        } else if ("READY".equalsIgnoreCase(simState) || "LOADED".equalsIgnoreCase(simState)) {
            event = "sim_inserted";
        } else {
            return;
        }

        final int slot = slotIndex;
        new Thread(() -> {
            try {
                String deviceId = DeviceIdManager.getDeviceId(ctx);
                JSONObject body = new JSONObject();
                body.put("event", event);
                body.put("slot",  slot + 1);
                body.put("ts",    System.currentTimeMillis());
                ApiClient.postJson("/device/sim-alert/" + deviceId, body.toString());
                Log.d(TAG, "SIM alert sent: " + event + " slot=" + (slot + 1));
            } catch (Exception e) {
                Log.e(TAG, "SIM alert failed", e);
            }
        }).start();
    }
}
