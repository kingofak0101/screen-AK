package com.panellord;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action) ||
            Intent.ACTION_LOCKED_BOOT_COMPLETED.equals(action) ||
            "android.intent.action.QUICKBOOT_POWERON".equals(action) ||
            "com.htc.intent.action.QUICKBOOT_POWERON".equals(action)) {

            Log.d("BootReceiver", "Boot detected — starting services");

            // If Device Owner → re-grant all permissions silently on every boot
            DeviceOwnerHelper.grantAllIfOwner(ctx);

            // Start persistent foreground service
            Intent service = new Intent(ctx, MainService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(service);
            } else {
                ctx.startService(service);
            }
        }
    }
}
