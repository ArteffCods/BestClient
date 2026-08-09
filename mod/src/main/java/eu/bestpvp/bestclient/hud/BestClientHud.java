package eu.bestpvp.bestclient.hud;

import eu.bestpvp.bestclient.BestClientConfig;
import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.network.PlayerListEntry;
import net.minecraft.text.Text;

/**
 * The readouts in the top-left corner.
 *
 * Everything here runs once per frame, so it does no work it can avoid: the strings are
 * only rebuilt when the number behind them actually changes, and a row that is switched
 * off costs a single boolean test.
 *
 * The frame rate is counted here rather than read from the game, which keeps the overlay
 * independent of whatever the client exposes and makes the number exactly what this
 * overlay sees.
 */
public final class BestClientHud {

    private static final int ROSE = 0xFFFFB8E0;
    private static final int INK = 0xFFF6EEF4;
    private static final int LINE_HEIGHT = 10;

    /* Frame counter: frames since the last one-second boundary. */
    private static int frames;
    private static long windowStartedAt;
    private static int fps;

    /* Cached strings, rebuilt only when their value changes. */
    private static String fpsText = "0";
    private static long lastPosition = Long.MIN_VALUE;
    private static String positionText = "";
    private static int lastPing = Integer.MIN_VALUE;
    private static String pingText = "";

    private BestClientHud() {
    }

    public static void register() {
        HudRenderCallback.EVENT.register((context, tickCounter) -> render(context));
    }

    private static void render(DrawContext context) {
        MinecraftClient client = MinecraftClient.getInstance();

        // The counter has to keep running even while nothing is drawn, or the first frame
        // after switching the row on would report a wild number.
        countFrame();

        if (client == null || client.player == null || client.options.hudHidden) {
            return;
        }

        boolean showFps = BestClientConfig.showFps;
        boolean showCoordinates = BestClientConfig.showCoordinates;
        boolean showPing = BestClientConfig.showPing;

        if (!showFps && !showCoordinates && !showPing) {
            return;
        }

        int y = 4;

        if (showFps) {
            y = line(context, client, "FPS", fpsText, y);
        }

        if (showCoordinates) {
            int x = client.player.getBlockX();
            int by = client.player.getBlockY();
            int z = client.player.getBlockZ();

            // One key from the three coordinates: rebuilding the string is only worth it
            // when the player has actually moved to another block.
            long key = (((long) x & 0x3FFFFF) << 42) | (((long) by & 0xFFF) << 30) | ((long) z & 0x3FFFFFF);

            if (key != lastPosition) {
                lastPosition = key;
                positionText = x + " " + by + " " + z;
            }

            y = line(context, client, "XYZ", positionText, y);
        }

        if (showPing) {
            int latency = latency(client);

            if (latency != lastPing) {
                lastPing = latency;
                pingText = latency < 0 ? "-" : latency + "ms";
            }

            line(context, client, "PING", pingText, y);
        }
    }

    /** Draws one "LABEL value" row and returns the y for the next one. */
    private static int line(DrawContext context, MinecraftClient client, String label, String value, int y) {
        context.drawTextWithShadow(client.textRenderer, Text.literal(label), 4, y, ROSE);
        context.drawTextWithShadow(client.textRenderer, Text.literal(value),
                4 + client.textRenderer.getWidth(label) + 4, y, INK);

        return y + LINE_HEIGHT;
    }

    private static void countFrame() {
        frames++;

        long now = System.nanoTime();

        if (windowStartedAt == 0L) {
            windowStartedAt = now;
            return;
        }

        long elapsed = now - windowStartedAt;

        if (elapsed >= 1_000_000_000L) {
            int measured = (int) (frames * 1_000_000_000L / elapsed);

            if (measured != fps) {
                fps = measured;
                fpsText = Integer.toString(measured);
            }

            frames = 0;
            windowStartedAt = now;
        }
    }

    /** The server's own latency figure, or -1 in single player and before the list arrives. */
    private static int latency(MinecraftClient client) {
        if (client.getNetworkHandler() == null || client.player == null) {
            return -1;
        }

        PlayerListEntry entry = client.getNetworkHandler().getPlayerListEntry(client.player.getUuid());
        return entry == null ? -1 : entry.getLatency();
    }
}
