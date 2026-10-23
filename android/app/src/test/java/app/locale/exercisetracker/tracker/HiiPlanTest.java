package app.locale.exercisetracker.tracker;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/** The native plan generator must make exactly the plans the JS one does (tests/hii.test.js writes the fixture). */
public class HiiPlanTest {
    private static JSONArray fixture() throws Exception {
        try (InputStream in = HiiPlanTest.class.getResourceAsStream("/fixtures/hii.json")) {
            assertNotNull("missing fixture hii.json", in);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            in.transferTo(out);
            return new JSONArray(out.toString(StandardCharsets.UTF_8));
        }
    }

    @Test
    public void replaysSharedPlans() throws Exception {
        JSONArray cases = fixture();
        assertEquals(8, cases.length());
        for (int c = 0; c < cases.length(); c++) {
            JSONObject in = cases.getJSONObject(c).getJSONObject("input");
            JSONObject exp = cases.getJSONObject(c).getJSONObject("expected");
            List<int[]> items = new ArrayList<>();
            int total = HiiPlan.plan(in.getInt("durationS"), HiiPlan.sharesOf(in.getJSONObject("shares")),
                HiiPlan.boutsOf(in.getJSONObject("bouts")), (int) in.getLong("seed"), items);
            assertEquals("case " + c + " duration", exp.getInt("durationS"), total);
            StringBuilder got = new StringBuilder();
            for (int[] it : items) got.append(HiiPlan.MODES[it[0]]).append(' ').append(it[1]).append(' ').append(it[2]).append('|');
            StringBuilder want = new StringBuilder();
            JSONArray e = exp.getJSONArray("items");
            for (int i = 0; i < e.length(); i++) {
                JSONArray it = e.getJSONArray(i);
                want.append(it.getString(0)).append(' ').append(it.getInt(1)).append(' ').append(it.getInt(2)).append('|');
            }
            assertEquals("case " + c, want.toString(), got.toString());
        }
    }

    @Test
    public void roundTripsThroughJsonAndFindsTheBout() throws Exception {
        HiiPlan p = HiiPlan.make(1800, HiiPlan.DEFAULT_SHARES, HiiPlan.DEFAULT_BOUTS, 1, 60);
        HiiPlan q = HiiPlan.fromJson(new JSONObject(p.toJson().toString()));
        assertEquals(p.toJson().toString(), q.toJson().toString());
        assertEquals(-1, q.indexAt(30));
        assertEquals(0, q.indexAt(61));
        assertEquals(q.items.get(0)[2] - 1, q.leftAt(61, 0));
        assertEquals(q.items.size(), q.indexAt(60 + 1800));
        q.stopS = 100;
        assertEquals(q.items.size(), q.indexAt(100));
    }
}
