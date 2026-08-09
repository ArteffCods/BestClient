package eu.bestpvp.bestclient;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import net.fabricmc.loader.api.FabricLoader;

import java.io.IOException;
import java.io.Reader;
import java.io.Writer;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * The mod's settings, stored next to the game's own config so they survive a reinstall.
 *
 * The fields are read on the render thread every frame, so they are plain statics rather
 * than a lookup through a map - a fullbright check must cost nothing.
 */
public final class BestClientConfig {

    /** Overrides the game's gamma so caves are lit without touching world lighting. */
    public static boolean fullbright = false;

    /** How far the fullbright override pushes gamma. 15 is the usual "full" value. */
    public static double fullbrightStrength = 15.0D;

    /** Vanilla tilts the camera when you take a hit; turning it off steadies aim. */
    public static boolean hurtCamera = true;

    /** Frames per second, measured by the overlay itself. */
    public static boolean showFps = false;

    /** Block position, rounded, in the overlay. */
    public static boolean showCoordinates = false;

    /** Round-trip time to the server, as the tab list reports it. */
    public static boolean showPing = false;

    /** Left-click rate, counted from the attack key over a one-second window. */
    public static boolean showCps = false;

    /** The facing you are looking at, as a compass point and an axis. */
    public static boolean showDirection = false;

    /** Horizontal blocks per second. */
    public static boolean showSpeed = false;

    /** The wall clock, in the system's own time. */
    public static boolean showClock = false;

    /** How long this session has been running. */
    public static boolean showPlaytime = false;

    /** Java heap in use against the maximum. */
    public static boolean showMemory = false;

    /** The WASD and mouse-button overlay. */
    public static boolean showKeystrokes = false;

    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

    /**
     * Dragging the brightness slider changes the value on every mouse move. Writing the
     * file on each of those would mean dozens of disk writes a second, so a change only
     * marks the config dirty and the screen flushes it once, on close.
     */
    private static boolean dirty = false;

    private BestClientConfig() {
    }

    /** Mirror of the fields, used only as the on-disk shape. */
    private static final class Data {
        boolean fullbright = false;
        double fullbrightStrength = 15.0D;
        boolean hurtCamera = true;
        boolean showFps = false;
        boolean showCoordinates = false;
        boolean showPing = false;
        boolean showCps = false;
        boolean showDirection = false;
        boolean showSpeed = false;
        boolean showClock = false;
        boolean showPlaytime = false;
        boolean showMemory = false;
        boolean showKeystrokes = false;
    }

    private static Path file() {
        return FabricLoader.getInstance().getConfigDir().resolve("bestclient.json");
    }

    public static void load() {
        Path path = file();

        if (!Files.isRegularFile(path)) {
            return;
        }

        try (Reader reader = Files.newBufferedReader(path)) {
            Data data = GSON.fromJson(reader, Data.class);

            if (data != null) {
                fullbright = data.fullbright;
                fullbrightStrength = clampStrength(data.fullbrightStrength);
                hurtCamera = data.hurtCamera;
                showFps = data.showFps;
                showCoordinates = data.showCoordinates;
                showPing = data.showPing;
                showCps = data.showCps;
                showDirection = data.showDirection;
                showSpeed = data.showSpeed;
                showClock = data.showClock;
                showPlaytime = data.showPlaytime;
                showMemory = data.showMemory;
                showKeystrokes = data.showKeystrokes;
            }
        } catch (IOException | RuntimeException error) {
            BestClientMod.LOGGER.warn("Could not read bestclient.json, using defaults.", error);
        }
    }

    /** Records that something changed without touching the disk yet. */
    public static void markDirty() {
        dirty = true;
    }

    /** Writes the file if anything changed since the last write. */
    public static void flush() {
        if (dirty) {
            save();
        }
    }

    public static void save() {
        dirty = false;

        Data data = new Data();
        data.fullbright = fullbright;
        data.fullbrightStrength = fullbrightStrength;
        data.hurtCamera = hurtCamera;
        data.showFps = showFps;
        data.showCoordinates = showCoordinates;
        data.showPing = showPing;
        data.showCps = showCps;
        data.showDirection = showDirection;
        data.showSpeed = showSpeed;
        data.showClock = showClock;
        data.showPlaytime = showPlaytime;
        data.showMemory = showMemory;
        data.showKeystrokes = showKeystrokes;

        try {
            Files.createDirectories(file().getParent());

            try (Writer writer = Files.newBufferedWriter(file())) {
                GSON.toJson(data, writer);
            }
        } catch (IOException error) {
            BestClientMod.LOGGER.warn("Could not write bestclient.json.", error);
        }
    }

    public static double clampStrength(double value) {
        return Math.max(1.0D, Math.min(20.0D, value));
    }
}
