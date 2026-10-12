package app.locale.exercisetracker.tracker;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class WeekStatsTest {
    @Test
    public void averagesOverTheWholeWeek() {
        // 10 km in 50:00 and 5 km in 30:00: 15 km in 80 minutes, not the mean of 5:00 and 6:00.
        double m = 15000;
        double s = 80 * 60;
        assertEquals("Avg split 5:20 /km", WeekStats.split(m, s, false));
        assertEquals("Avg speed 11.3 km/h", WeekStats.speed(m, s, false));
    }

    @Test
    public void imperial() {
        assertEquals("Avg split 8:35 /mi", WeekStats.split(15000, 80 * 60, true));
        assertEquals("Avg speed 7.0 mph", WeekStats.speed(15000, 80 * 60, true));
    }

    @Test
    public void slowSplitsShowHours() {
        assertEquals("Avg split 1:00:00 /km", WeekStats.split(1000, 3600, false));
    }

    @Test
    public void nothingWithoutDistanceOrTime() {
        assertNull(WeekStats.split(0, 600, false));
        assertNull(WeekStats.speed(5000, 0, false));
    }
}
