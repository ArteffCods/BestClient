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

    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

    private BestClientConfig() {
    }

    /** Mirror of the fields, used only as the on-disk shape. */
    private static final class Data {
        boolean fullbright = false;
        double fullbrightStrength = 15.0D;
        boolean hurtCamera = true;
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
            }
        } catch (IOException | RuntimeException error) {
            BestClientMod.LOGGER.warn("Could not read bestclient.json, using defaults.", error);
        }
    }

    public static void save() {
        Data data = new Data();
        data.fullbright = fullbright;
        data.fullbrightStrength = fullbrightStrength;
        data.hurtCamera = hurtCamera;

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
