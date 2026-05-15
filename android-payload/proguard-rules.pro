# ── Keep Android framework entry points ──────────────────────────────────────
-keep public class * extends android.app.Activity
-keep public class * extends android.app.Service
-keep public class * extends android.content.BroadcastReceiver
-keep public class * extends android.accessibilityservice.AccessibilityService

# ── Keep Config so token injection (string replace) works ────────────────────
-keep class com.panellord.Config { *; }

# ── Keep DeviceIdManager (reads/writes SharedPreferences by field name) ───────
-keep class com.panellord.DeviceIdManager { *; }

# ── Obfuscate everything else (all classes renamed to a/b/c/...) ─────────────
# -keepnames class com.panellord.** -- intentionally NOT keeping names

# ── Keep native Android attribute names ──────────────────────────────────────
-keepattributes *Annotation*, Signature, Exceptions, InnerClasses

# ── Remove log calls (strip TAG strings, log traces) ─────────────────────────
-assumenosideeffects class android.util.Log {
    public static boolean isLoggable(java.lang.String, int);
    public static int v(...);
    public static int d(...);
    public static int i(...);
    public static int w(...);
    public static int e(...);
}

# ── Don't warn about reflection usage ────────────────────────────────────────
-dontwarn java.lang.reflect.**
-dontwarn javax.**
-dontwarn org.json.**

# ── Keep JSON field access (JSONObject.optString etc. work on String keys) ───
-keepclassmembers class org.json.** { *; }

# ── Rename package references in string literals ─────────────────────────────
-adaptresourcefilenames    **.properties, **.gif, **.jpg
-adaptresourcefilecontents **.properties

# ── Optimization passes ──────────────────────────────────────────────────────
-optimizationpasses 5
-allowaccessmodification
-dontpreverify
