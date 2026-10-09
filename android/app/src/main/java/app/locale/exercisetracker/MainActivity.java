package app.locale.exercisetracker;

import android.os.Bundle;
import app.locale.exercisetracker.tracker.LocaleTrackerPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LocaleTrackerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
