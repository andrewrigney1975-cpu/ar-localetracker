# R8 rules for the Locale watch app. The AndroidX, Wear and Health Services libraries ship their
# own consumer rules, and the app uses no reflection, so nothing extra is kept yet.

# Release builds drop verbose, debug and info logging (security audit I-4); warnings and errors
# stay. Mirrors app/proguard-rules.pro.
-assumenosideeffects class android.util.Log {
    public static int v(...);
    public static int d(...);
    public static int i(...);
}
