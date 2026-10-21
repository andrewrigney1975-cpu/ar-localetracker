package app.locale.exercisetracker.screen;

import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Handler;
import android.os.HandlerThread;
import android.view.PixelCopy;
import android.view.View;
import android.view.Window;
import android.webkit.WebView;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;

/**
 * Screenshots for sharing. PixelCopy reads the window's composited surface, so WebGL content
 * (the MapLibre map, the Three.js view) comes out as shown; drawing the WebView into a bitmap
 * or html2canvas-style re-rendering leaves those blank. The image is cropped to a rectangle
 * given in CSS pixels (viewport coordinates) and written as a PNG to the cache, where the
 * Share plugin's FileProvider (cache-path) can hand it to other apps.
 */
@CapacitorPlugin(name = "LocaleScreen")
public class LocaleScreenPlugin extends Plugin {
    private static final String DIR = "shots";

    private HandlerThread worker;
    private Handler workerHandler;

    @Override
    public void load() {
        worker = new HandlerThread("LocaleScreen");
        worker.start();
        workerHandler = new Handler(worker.getLooper());
    }

    @Override
    protected void handleOnDestroy() {
        if (worker != null) worker.quitSafely();
    }

    /** captureScreen({x?, y?, width?, height?, filename?}) → {uri, width, height}. Without a rectangle, the whole WebView. */
    @PluginMethod
    public void captureScreen(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            Window window = getActivity().getWindow();
            View decor = window.getDecorView();
            WebView web = getBridge().getWebView();
            if (decor.getWidth() <= 0 || decor.getHeight() <= 0) {
                call.reject("Nothing on screen to capture");
                return;
            }
            int[] at = new int[2];
            web.getLocationInWindow(at);
            float density = getContext().getResources().getDisplayMetrics().density;
            int left = at[0];
            int top = at[1];
            int right = at[0] + web.getWidth();
            int bottom = at[1] + web.getHeight();
            Double x = call.getDouble("x");
            Double y = call.getDouble("y");
            Double w = call.getDouble("width");
            Double h = call.getDouble("height");
            if (x != null && y != null && w != null && h != null) {
                int l = at[0] + Math.round((float) (x * density));
                int t = at[1] + Math.round((float) (y * density));
                // Clip to the WebView, so a rectangle partly off screen still works.
                right = Math.min(right, l + Math.round((float) (w * density)));
                bottom = Math.min(bottom, t + Math.round((float) (h * density)));
                left = Math.max(left, l);
                top = Math.max(top, t);
            }
            left = Math.max(0, left);
            top = Math.max(0, top);
            right = Math.min(decor.getWidth(), right);
            bottom = Math.min(decor.getHeight(), bottom);
            if (right - left < 1 || bottom - top < 1) {
                call.reject("Nothing to capture in that area");
                return;
            }
            final android.graphics.Rect crop = new android.graphics.Rect(left, top, right, bottom);
            Bitmap shot = Bitmap.createBitmap(crop.width(), crop.height(), Bitmap.Config.ARGB_8888);
            String filename = safeName(call.getString("filename", "screenshot.png"));
            PixelCopy.request(window, crop, shot, (result) -> {
                if (result != PixelCopy.SUCCESS) {
                    shot.recycle();
                    call.reject("Screenshot failed (" + result + ")");
                    return;
                }
                save(call, shot, filename);
            }, workerHandler);
        });
    }

    /** Runs on the worker thread: PNG compression of a full screen takes ~100 ms. */
    private void save(PluginCall call, Bitmap shot, String filename) {
        File dir = new File(getContext().getCacheDir(), DIR);
        if (!dir.isDirectory() && !dir.mkdirs()) {
            shot.recycle();
            call.reject("Could not create the screenshot folder");
            return;
        }
        // Only the latest screenshot is kept; earlier ones have already been shared.
        File[] old = dir.listFiles();
        if (old != null) for (File f : old) f.delete();
        File file = new File(dir, filename);
        int width = shot.getWidth();
        int height = shot.getHeight();
        try (FileOutputStream out = new FileOutputStream(file)) {
            shot.compress(Bitmap.CompressFormat.PNG, 100, out);
        } catch (IOException e) {
            call.reject("Could not save the screenshot", e);
            return;
        } finally {
            shot.recycle();
        }
        JSObject o = new JSObject();
        o.put("uri", Uri.fromFile(file).toString());
        o.put("width", width);
        o.put("height", height);
        call.resolve(o);
    }

    /** Keep the filename to a plain name with a .png extension. */
    static String safeName(String name) {
        String base = name == null ? "" : name.replaceAll("[^A-Za-z0-9 ._-]", "").trim();
        if (base.isEmpty() || base.startsWith(".")) base = "screenshot";
        return base.toLowerCase().endsWith(".png") ? base : base + ".png";
    }
}
