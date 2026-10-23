package app.locale.exercisetracker.store;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** readUri opens only files another app shared: never file: paths or Locale's own providers. */
public class IncomingUriTest {
    private static final String OWN = "app.locale.exercisetracker";

    @Test
    public void readsContentSharedByAnotherApp() {
        assertTrue(LocaleStorePlugin.isForeignContent("content", "com.google.android.gm.sapi", "com.google.android.gm", OWN));
        assertTrue(LocaleStorePlugin.isForeignContent("content", "com.android.externalstorage.documents", "com.android.externalstorage", OWN));
        // Package visibility hides other apps' providers; ours always resolve.
        assertTrue(LocaleStorePlugin.isForeignContent("content", "com.example.hidden", null, OWN));
    }

    @Test
    public void refusesFilePathsAndOurOwnProviders() {
        assertFalse(LocaleStorePlugin.isForeignContent("file", null, null, OWN));
        assertFalse(LocaleStorePlugin.isForeignContent("file", "", null, OWN));
        assertFalse(LocaleStorePlugin.isForeignContent("content", OWN + ".fileprovider", OWN, OWN));
        assertFalse(LocaleStorePlugin.isForeignContent("content", OWN + ".androidx-startup", OWN, OWN));
        assertFalse(LocaleStorePlugin.isForeignContent("content", null, null, OWN));
        assertFalse(LocaleStorePlugin.isForeignContent("https", "example.com", null, OWN));
        assertFalse(LocaleStorePlugin.isForeignContent(null, null, null, OWN));
    }
}
