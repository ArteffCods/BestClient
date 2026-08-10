package eu.bestpvp.bestclient.hud;

import eu.bestpvp.bestclient.BestClientConfig;
import eu.bestpvp.bestclient.gui.Draw;
import eu.bestpvp.bestclient.gui.Fonts;
import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.network.PlayerListEntry;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.text.Text;

/**
 * The readouts in the top-left corner and the keystroke overlay under them.
 *
 * Everything here runs once per frame, so it does no work it can avoid: a row that is
 * switched off costs a single boolean test, and the strings are only rebuilt when the
 * number behind them actually changes - a coordinate readout that would otherwise
 * allocate three boxed integers and a StringBuilder every frame instead allocates
 * nothing while you stand still.
 *
 * The frame rate and the click rate are both measured here rather than read from the
 * game, which keeps the overlay independent of what the client happens to expose.
 */
public final class BestClientHud {

    private static final int ROSE = 0xFFFFB8E0;
    private static final int INK = 0xFFF6EEF4;
    private static final int KEY_ON = 0xFFFF75C3;
    private static final int KEY_OFF = 0xB3110C17;
    private static final int KEY_TEXT_ON = 0xFF0D0913;
    private static final int KEY_TEXT_OFF = 0xFFA291AD;
    private static final int LINE_HEIGHT = 10;
    private static final int MARGIN = 4;

    /* Frame counter: frames since the last one-second boundary. */
    private static int frames;
    private static long frameWindowStart;
    private static String fpsText = "0";

    /* Click times, newest last, only the last second is kept. */
    private static final long[] CLICKS = new long[40];
    private static int clickCount;
    private static boolean attackWasDown;
    private static int lastCps = -1;
    private static String cpsText = "0";

    /* Cached strings, rebuilt only when their value changes. */
    private static long lastPosition = Long.MIN_VALUE;
    private static String positionText = "";
    private static int lastPing = Integer.MIN_VALUE;
    private static String pingText = "";
    private static long lastClockMinute = Long.MIN_VALUE;
    private static String clockText = "";
    private static long lastPlaytimeSecond = Long.MIN_VALUE;
    private static String playtimeText = "";
    private static long lastMemoryMb = Long.MIN_VALUE;
    private static String memoryText = "";

    /* Speed is sampled on a fixed interval; per-frame deltas are far too jittery to read. */
    private static final long SPEED_INTERVAL_MS = 250L;
    private static long speedSampledAt;
    private static double speedFromX;
    private static double speedFromZ;
    private static String speedText = "0.0";

    private static final long STARTED_AT = System.currentTimeMillis();

    private BestClientHud() {
    }

    public static void register() {
        HudRenderCallback.EVENT.register((context, tickCounter) -> render(context));
    }

    private static void render(DrawContext context) {
        MinecraftClient client = MinecraftClient.getInstance();

        // The meters keep running even while nothing is drawn, so the first frame after
        // switching a row on reports a real number instead of a wild one.
        countFrame();

        if (client == null || client.player == null || client.options.hudHidden) {
            return;
        }

        if (BestClientConfig.showCps) {
            countClicks(client);
        }

        int y = MARGIN;

        if (BestClientConfig.showFps) {
            y = line(context, client, "FPS", fpsText, y);
        }

        if (BestClientConfig.showCps) {
            y = line(context, client, "CPS", cpsText, y);
        }

        if (BestClientConfig.showCoordinates) {
            y = line(context, client, "XYZ", position(client), y);
        }

        if (BestClientConfig.showDirection) {
            y = line(context, client, "FACING", facing(client), y);
        }

        if (BestClientConfig.showSpeed) {
            y = line(context, client, "SPEED", speed(client), y);
        }

        if (BestClientConfig.showPing) {
            y = line(context, client, "PING", ping(client), y);
        }

        if (BestClientConfig.showClock) {
            y = line(context, client, "TIME", clock(), y);
        }

        if (BestClientConfig.showPlaytime) {
            y = line(context, client, "SESSION", playtime(), y);
        }

        if (BestClientConfig.showMemory) {
            y = line(context, client, "MEM", memory(), y);
        }

        if (BestClientConfig.showKeystrokes) {
            drawKeystrokes(context, client, y + 4);
        }
    }

    /** Draws one "LABEL value" row and returns the y for the next one. */
    private static int line(DrawContext context, MinecraftClient client, String label, String value, int y) {
        Text name = Fonts.of(label);

        context.drawTextWithShadow(client.textRenderer, name, MARGIN, y, ROSE);
        context.drawTextWithShadow(client.textRenderer, Fonts.of(value),
                MARGIN + client.textRenderer.getWidth(name) + 4, y, INK);

        return y + LINE_HEIGHT;
    }

    private static void countFrame() {
        frames++;

        long now = System.nanoTime();

        if (frameWindowStart == 0L) {
            frameWindowStart = now;
            return;
        }

        long elapsed = now - frameWindowStart;

        if (elapsed >= 1_000_000_000L) {
            fpsText = Integer.toString((int) (frames * 1_000_000_000L / elapsed));
            frames = 0;
            frameWindowStart = now;
        }
    }

    /**
     * Counts left clicks by watching the attack key's held state change from frame to
     * frame.
     *
     * Deliberately not `wasPressed()`: that drains the same queue the game reads to decide
     * whether you swung, so counting with it would eat clicks in a fight. `isPressed()`
     * only observes, and at any normal frame rate the rising edge of a click is never
     * missed.
     */
    private static void countClicks(MinecraftClient client) {
        boolean down = client.options.attackKey.isPressed();
        long now = System.currentTimeMillis();

        if (down && !attackWasDown && clickCount < CLICKS.length) {
            CLICKS[clickCount++] = now;
        }

        attackWasDown = down;

        // Drop everything older than a second, keeping the rest in order.
        int kept = 0;
        for (int i = 0; i < clickCount; i++) {
            if (now - CLICKS[i] < 1000L) {
                CLICKS[kept++] = CLICKS[i];
            }
        }
        clickCount = kept;

        if (kept != lastCps) {
            lastCps = kept;
            cpsText = Integer.toString(kept);
        }
    }

    private static String position(MinecraftClient client) {
        int x = client.player.getBlockX();
        int y = client.player.getBlockY();
        int z = client.player.getBlockZ();

        // One key from the three coordinates: rebuilding the string is only worth it when
        // the player has actually moved to another block.
        long key = (((long) x & 0x3FFFFF) << 42) | (((long) y & 0xFFF) << 30) | ((long) z & 0x3FFFFFF);

        if (key != lastPosition) {
            lastPosition = key;
            positionText = x + " " + y + " " + z;
        }

        return positionText;
    }

    /**
     * Compass point and the axis it moves you along.
     *
     * Yaw 0 faces south in Minecraft, and every 45 degrees is one of eight points, so the
     * index is the yaw divided by 45 and rounded - the same arithmetic the game uses for
     * its own facing, done here to keep the mod off a mapping name.
     */
    private static String facing(MinecraftClient client) {
        float yaw = client.player.getYaw() % 360.0F;
        if (yaw < 0.0F) {
            yaw += 360.0F;
        }

        // Every branch is a constant, so there is nothing to cache here.
        return switch ((int) Math.floor(yaw / 45.0D + 0.5D) & 7) {
            case 0 -> "South (+Z)";
            case 1 -> "South West";
            case 2 -> "West (-X)";
            case 3 -> "North West";
            case 4 -> "North (-Z)";
            case 5 -> "North East";
            case 6 -> "East (+X)";
            default -> "South East";
        };
    }

    /** Horizontal blocks per second, sampled on an interval so the number can be read. */
    private static String speed(MinecraftClient client) {
        long now = System.currentTimeMillis();
        double x = client.player.getX();
        double z = client.player.getZ();

        if (speedSampledAt == 0L) {
            speedSampledAt = now;
            speedFromX = x;
            speedFromZ = z;
            return speedText;
        }

        long elapsed = now - speedSampledAt;

        if (elapsed >= SPEED_INTERVAL_MS) {
            double dx = x - speedFromX;
            double dz = z - speedFromZ;
            double blocksPerSecond = Math.sqrt(dx * dx + dz * dz) * 1000.0D / elapsed;

            speedText = String.format("%.1f", blocksPerSecond);
            speedSampledAt = now;
            speedFromX = x;
            speedFromZ = z;
        }

        return speedText;
    }

    /** The server's own latency figure, or a dash in single player and before it arrives. */
    private static String ping(MinecraftClient client) {
        int latency = -1;

        if (client.getNetworkHandler() != null) {
            PlayerListEntry entry = client.getNetworkHandler().getPlayerListEntry(client.player.getUuid());
            if (entry != null) {
                latency = entry.getLatency();
            }
        }

        if (latency != lastPing) {
            lastPing = latency;
            pingText = latency < 0 ? "-" : latency + "ms";
        }

        return pingText;
    }

    private static String clock() {
        long minute = System.currentTimeMillis() / 60_000L;

        if (minute != lastClockMinute) {
            lastClockMinute = minute;
            java.time.LocalTime now = java.time.LocalTime.now();
            clockText = String.format("%02d:%02d", now.getHour(), now.getMinute());
        }

        return clockText;
    }

    private static String playtime() {
        long seconds = (System.currentTimeMillis() - STARTED_AT) / 1000L;

        if (seconds != lastPlaytimeSecond) {
            lastPlaytimeSecond = seconds;
            playtimeText = seconds >= 3600L
                    ? String.format("%d:%02d:%02d", seconds / 3600L, (seconds % 3600L) / 60L, seconds % 60L)
                    : String.format("%d:%02d", seconds / 60L, seconds % 60L);
        }

        return playtimeText;
    }

    /**
     * Heap in use against the maximum, quantised to sixteen-megabyte steps: the raw figure
     * moves every frame as the game allocates, which is both unreadable and a fresh string
     * on each of those frames.
     */
    private static String memory() {
        Runtime runtime = Runtime.getRuntime();
        long usedMb = ((runtime.totalMemory() - runtime.freeMemory()) / 1_048_576L / 16L) * 16L;

        if (usedMb != lastMemoryMb) {
            lastMemoryMb = usedMb;
            memoryText = usedMb + "/" + runtime.maxMemory() / 1_048_576L + " MB";
        }

        return memoryText;
    }

    /**
     * The WASD block and the two mouse buttons underneath it, lit while held.
     *
     * The state comes from the same key bindings the game itself reads, so a rebound key
     * lights the right box, and nothing is consumed by looking.
     */
    private static void drawKeystrokes(DrawContext context, MinecraftClient client, int top) {
        int size = 14;
        int gap = 2;
        int left = MARGIN;

        key(context, client, left + size + gap, top, size, size, "W", client.options.forwardKey);

        int middle = top + size + gap;
        key(context, client, left, middle, size, size, "A", client.options.leftKey);
        key(context, client, left + size + gap, middle, size, size, "S", client.options.backKey);
        key(context, client, left + (size + gap) * 2, middle, size, size, "D", client.options.rightKey);

        int bottom = middle + size + gap;
        int wide = (size * 3 + gap * 2 - gap) / 2;
        key(context, client, left, bottom, wide, size, "LMB", client.options.attackKey);
        key(context, client, left + wide + gap, bottom, wide, size, "RMB", client.options.useKey);
    }

    private static void key(DrawContext context, MinecraftClient client, int x, int y,
                            int width, int height, String label, KeyBinding binding) {
        boolean down = binding.isPressed();

        Draw.round(context, x, y, width, height, 3, down ? KEY_ON : KEY_OFF);

        Text text = Fonts.of(label);
        context.drawText(client.textRenderer, text,
                x + (width - client.textRenderer.getWidth(text)) / 2, y + (height - 8) / 2 + 1,
                down ? KEY_TEXT_ON : KEY_TEXT_OFF, false);
    }
}
