package app.locale.exercisetracker.tracker;

import android.hardware.SensorManager;

/**
 * Fuses barometric altitude (smooth, relative) with GNSS altitude (noisy, absolute).
 * The barometer provides the shape of the profile; a slow complementary filter
 * anchors it to GNSS mean-sea-level altitude so it does not drift with weather.
 */
final class AltitudeFusion {
    private static final double TAU_SECONDS = 60.0;
    private static final double PRESSURE_ALPHA = 0.15;

    private double pressureHpa = Double.NaN;
    private double offset = Double.NaN;
    private long lastAnchorMs = 0;

    boolean hasPressure() {
        return !Double.isNaN(pressureHpa);
    }

    double pressureHpa() {
        return pressureHpa;
    }

    void onPressure(float hpa) {
        if (hpa <= 0) return;
        pressureHpa = Double.isNaN(pressureHpa) ? hpa : pressureHpa + PRESSURE_ALPHA * (hpa - pressureHpa);
    }

    private double baroAltitude() {
        return SensorManager.getAltitude(SensorManager.PRESSURE_STANDARD_ATMOSPHERE, (float) pressureHpa);
    }

    /**
     * Feed a GNSS altitude sample.
     * @param gnssAlt MSL altitude in metres (NaN if unavailable)
     * @param vAcc vertical accuracy in metres (NaN if unknown)
     * @return best altitude estimate (NaN if none available)
     */
    double onGnss(double gnssAlt, double vAcc, long timeMs) {
        if (!hasPressure()) return gnssAlt;
        double baro = baroAltitude();
        if (!Double.isNaN(gnssAlt)) {
            double acc = Double.isNaN(vAcc) ? 15.0 : vAcc;
            if (Double.isNaN(offset)) {
                if (acc <= 25.0) {
                    offset = gnssAlt - baro;
                    lastAnchorMs = timeMs;
                }
            } else if (acc <= 25.0) {
                double dt = Math.max(0.1, Math.min(10.0, (timeMs - lastAnchorMs) / 1000.0));
                // Better vertical accuracy gives the GNSS sample more weight.
                double weight = Math.max(0.1, Math.min(1.0, 5.0 / acc));
                double k = weight * dt / (TAU_SECONDS + dt);
                offset += k * ((gnssAlt - baro) - offset);
                lastAnchorMs = timeMs;
            }
        }
        if (Double.isNaN(offset)) return gnssAlt;
        return baro + offset;
    }
}
