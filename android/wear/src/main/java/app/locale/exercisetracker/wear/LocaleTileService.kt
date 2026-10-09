package app.locale.exercisetracker.wear

import androidx.concurrent.futures.CallbackToFutureAdapter
import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.ColorBuilders.argb
import androidx.wear.protolayout.DimensionBuilders.dp
import androidx.wear.protolayout.DimensionBuilders.expand
import androidx.wear.protolayout.DimensionBuilders.sp
import androidx.wear.protolayout.LayoutElementBuilders
import androidx.wear.protolayout.ModifiersBuilders
import androidx.wear.protolayout.ResourceBuilders
import androidx.wear.protolayout.TimelineBuilders
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.TileBuilders
import androidx.wear.tiles.TileService
import com.google.common.util.concurrent.ListenableFuture

/** Tile: one tap to start a run, or a glance at the workout in progress. */
class LocaleTileService : TileService() {
    private companion object {
        const val RES_VERSION = "1"
    }

    override fun onTileRequest(requestParams: RequestBuilders.TileRequest): ListenableFuture<TileBuilders.Tile> {
        val s = PhoneLink.status.value
        val root = if (s.active) activeLayout(s) else idleLayout()
        val tile = TileBuilders.Tile.Builder()
            .setResourcesVersion(RES_VERSION)
            .setFreshnessIntervalMillis(if (s.active) 60_000 else 0)
            .setTileTimeline(TimelineBuilders.Timeline.fromLayoutElement(root))
            .build()
        return CallbackToFutureAdapter.getFuture { it.set(tile); "tile" }
    }

    override fun onTileResourcesRequest(requestParams: RequestBuilders.ResourcesRequest): ListenableFuture<ResourceBuilders.Resources> =
        CallbackToFutureAdapter.getFuture {
            it.set(ResourceBuilders.Resources.Builder().setVersion(RES_VERSION).build())
            "resources"
        }

    private fun launch(extra: String?): ModifiersBuilders.Clickable {
        val activity = ActionBuilders.AndroidActivity.Builder()
            .setPackageName(packageName)
            .setClassName(MainActivity::class.java.name)
        if (extra != null) {
            activity.addKeyToExtraMapping(
                MainActivity.EXTRA_START_ACTIVITY,
                ActionBuilders.AndroidStringExtra.Builder().setValue(extra).build(),
            )
        }
        return ModifiersBuilders.Clickable.Builder()
            .setId(extra ?: "open")
            .setOnClick(ActionBuilders.LaunchAction.Builder().setAndroidActivity(activity.build()).build())
            .build()
    }

    private fun text(value: String, size: Float, color: Int, bold: Boolean = false) =
        LayoutElementBuilders.Text.Builder()
            .setText(value)
            .setFontStyle(
                LayoutElementBuilders.FontStyle.Builder()
                    .setSize(sp(size))
                    .setColor(argb(color))
                    .setWeight(
                        if (bold) LayoutElementBuilders.FONT_WEIGHT_BOLD else LayoutElementBuilders.FONT_WEIGHT_NORMAL,
                    )
                    .build(),
            )
            .build()

    private fun pill(label: String, color: Int, click: ModifiersBuilders.Clickable) =
        LayoutElementBuilders.Box.Builder()
            .setWidth(dp(120f))
            .setHeight(dp(44f))
            .setModifiers(
                ModifiersBuilders.Modifiers.Builder()
                    .setClickable(click)
                    .setBackground(
                        ModifiersBuilders.Background.Builder()
                            .setColor(argb(color))
                            .setCorner(ModifiersBuilders.Corner.Builder().setRadius(dp(22f)).build())
                            .build(),
                    )
                    .build(),
            )
            .addContent(text(label, 15f, 0xFFFFFFFF.toInt(), bold = true))
            .build()

    private fun column(vararg items: LayoutElementBuilders.LayoutElement): LayoutElementBuilders.LayoutElement {
        val col = LayoutElementBuilders.Column.Builder()
            .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
        items.forEachIndexed { i, el ->
            if (i > 0) col.addContent(LayoutElementBuilders.Spacer.Builder().setHeight(dp(6f)).build())
            col.addContent(el)
        }
        return LayoutElementBuilders.Box.Builder()
            .setWidth(expand())
            .setHeight(expand())
            .addContent(col.build())
            .build()
    }

    private fun idleLayout() = column(
        text("Locale", 18f, 0xFFF2672E.toInt(), bold = true),
        text("Phone records GPS", 12f, 0xFFB0BAC4.toInt()),
        pill("Start run", 0xFFF2672E.toInt(), launch("run")),
        text("More activities in app", 11f, 0xFF8B97A3.toInt()),
    )

    private fun activeLayout(s: PhoneStatus) = column(
        text("${activityLabel(s.activity)} · ${if (s.state == "recording") "Recording" else "Paused"}", 13f, 0xFFF2672E.toInt()),
        text(formatDistance(s.distance, s.units), 22f, 0xFFFFFFFF.toInt(), bold = true),
        pill("Open", 0xFF2A3540.toInt(), launch(null)),
    )
}
