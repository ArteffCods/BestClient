package eu.bestpvp.bestclient;

import net.minecraft.client.MinecraftClient;

/**
 * Holds the one option the fullbright override cares about.
 *
 * The mixin sits on every SimpleOption in the game, so it must not walk from
 * MinecraftClient to the gamma option on each call. The reference is resolved the first
 * time it is needed - the client and its options exist by then, which is not true while
 * the options themselves are being constructed - and reused for the rest of the session.
 */
public final class Fullbright {

    private static Object gamma;

    private Fullbright() {
    }

    /** The gamma option, or null until the client has finished building its options. */
    public static Object gammaOption() {
        Object resolved = gamma;

        if (resolved != null) {
            return resolved;
        }

        MinecraftClient client = MinecraftClient.getInstance();

        if (client == null || client.options == null) {
            return null;
        }

        resolved = client.options.getGamma();
        gamma = resolved;

        return resolved;
    }
}
