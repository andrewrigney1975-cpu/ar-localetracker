package app.locale.exercisetracker.tracker;

import android.content.Context;
import android.util.Log;
import com.google.android.gms.wearable.CapabilityClient;
import com.google.android.gms.wearable.CapabilityInfo;
import com.google.android.gms.wearable.Node;
import com.google.android.gms.wearable.Wearable;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Set;
import org.json.JSONObject;

/**
 * Phone → watch messages over the Wearable Data Layer. Watch nodes are found by the
 * "locale_wear" capability the watch app declares, and cached briefly.
 */
final class WearSync {
    static final String CAPABILITY_WEAR = "locale_wear";
    static final String PATH_STATUS = "/locale/status";
    static final String PATH_ERROR = "/locale/error";

    private static final String TAG = "LocaleWear";
    private static final long NODE_CACHE_MS = 60_000;

    private static volatile Set<Node> nodes = Collections.emptySet();
    private static volatile long nodesAt = 0;
    private static volatile boolean refreshing = false;

    private WearSync() {}

    /** Send to every reachable watch running Locale. Fire-and-forget. */
    static void send(Context ctx, String path, JSONObject payload) {
        Context app = ctx.getApplicationContext();
        byte[] bytes = payload.toString().getBytes(StandardCharsets.UTF_8);
        Set<Node> current = nodes;
        if (System.currentTimeMillis() - nodesAt > NODE_CACHE_MS) refresh(app, path, bytes);
        else for (Node n : current) sendTo(app, n, path, bytes);
    }

    private static void refresh(Context app, String path, byte[] pending) {
        if (refreshing) return;
        refreshing = true;
        Wearable.getCapabilityClient(app)
            .getCapability(CAPABILITY_WEAR, CapabilityClient.FILTER_REACHABLE)
            .addOnCompleteListener(task -> {
                refreshing = false;
                nodesAt = System.currentTimeMillis();
                if (!task.isSuccessful()) {
                    // No Wear OS / Play services wearable support on this phone.
                    nodes = Collections.emptySet();
                    return;
                }
                CapabilityInfo info = task.getResult();
                nodes = info.getNodes();
                for (Node n : nodes) sendTo(app, n, path, pending);
            });
    }

    private static void sendTo(Context app, Node node, String path, byte[] bytes) {
        Wearable.getMessageClient(app)
            .sendMessage(node.getId(), path, bytes)
            .addOnFailureListener(e -> Log.d(TAG, "send " + path + " to " + node.getDisplayName() + " failed: " + e.getMessage()));
    }

    /** Forget cached nodes, e.g. after a capability change. */
    static void invalidate() {
        nodesAt = 0;
    }

    static JSONObject error(String code, String message) {
        JSONObject o = new JSONObject();
        try {
            o.put("code", code);
            o.put("message", message);
        } catch (Exception ignored) {
        }
        return o;
    }
}
