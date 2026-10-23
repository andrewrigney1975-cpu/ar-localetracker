package app.locale.exercisetracker.tracker;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/** A /locale/hr message is read up to its newest MAX_SAMPLES samples of each kind (audit I-6). */
public class WearHeartRateCapTest {
    @Test
    public void readsWholeRealBatches() {
        assertEquals(0, WearListenerService.firstToRead(0));
        assertEquals(0, WearListenerService.firstToRead(125)); // 3 s of samples + 120 carried over
        assertEquals(0, WearListenerService.firstToRead(WearListenerService.MAX_SAMPLES));
    }

    @Test
    public void keepsOnlyTheNewestOfOversizedBatches() {
        assertEquals(1, WearListenerService.firstToRead(WearListenerService.MAX_SAMPLES + 1));
        assertEquals(1_000_000 - WearListenerService.MAX_SAMPLES, WearListenerService.firstToRead(1_000_000));
    }
}
