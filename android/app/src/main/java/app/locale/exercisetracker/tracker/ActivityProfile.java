package app.locale.exercisetracker.tracker;

/** Per-activity tuning thresholds. Mirrors src/activities.js on the web side. */
final class ActivityProfile {
    final String id;
    final String label;
    /** Fixes with horizontal accuracy worse than this (m) are ignored for live distance. */
    final float accuracyGate;
    /** Implausible speed (m/s) used to reject position spikes. */
    final float maxSpeed;
    /** Below this speed (m/s) the user is considered stationary. */
    final float stationarySpeed;

    private ActivityProfile(String id, String label, float accuracyGate, float maxSpeed, float stationarySpeed) {
        this.id = id;
        this.label = label;
        this.accuracyGate = accuracyGate;
        this.maxSpeed = maxSpeed;
        this.stationarySpeed = stationarySpeed;
    }

    static ActivityProfile forId(String id) {
        if (id == null) id = "run";
        switch (id) {
            case "walk":
                return new ActivityProfile("walk", "Walk", 30f, 4f, 0.4f);
            case "cycle":
                return new ActivityProfile("cycle", "Cycle", 30f, 30f, 1.0f);
            case "ski":
                return new ActivityProfile("ski", "Ski", 30f, 45f, 1.0f);
            case "run":
            default:
                return new ActivityProfile("run", "Run", 25f, 9f, 0.8f);
        }
    }
}
