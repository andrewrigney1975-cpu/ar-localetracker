# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# Release builds drop verbose, debug and info logging (security audit I-4): logcat is readable
# over ADB, and these lines describe workouts as they happen. Warnings and errors stay, for
# diagnosing failures, and carry no personal data. Mirrored in wear/proguard-rules.pro.
-assumenosideeffects class android.util.Log {
    public static int v(...);
    public static int d(...);
    public static int i(...);
}

# Capacitor reads each plugin's @CapacitorPlugin(permissions = {@Permission ...}) at run time.
# Nothing in code ever creates those annotation types, so R8's full mode treated
# PluginHandle.getPluginAnnotation() as always null and deleted Bridge.getPermissionStates()'s
# loop: every alias read as not granted ("Location permission: Not granted", "Start from
# watch: Allow") and LocaleTracker.start() refused, while Android had granted everything.
# Keep the annotation types and their values.
-keepattributes RuntimeVisibleAnnotations,AnnotationDefault
-keep @interface com.getcapacitor.annotation.** { *; }
-keep class com.getcapacitor.PluginHandle { *; }
