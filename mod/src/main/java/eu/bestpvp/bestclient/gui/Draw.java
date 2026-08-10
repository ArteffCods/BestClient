package eu.bestpvp.bestclient.gui;

import net.minecraft.client.gui.DrawContext;

/**
 * The drawing primitives the client menu is built from.
 *
 * Minecraft has no rounded rectangle, which is why every mod menu ends up looking like
 * Minecraft: square boxes and a nine-slice button texture. These build the shape out of
 * horizontal spans instead - one span per row, the corner rows inset along a circle, and
 * the pixel where the circle actually falls drawn at partial alpha so the edge is smooth
 * rather than stepped.
 *
 * Everything goes through DrawContext#fill, which is the same batched, blended OpenGL path
 * the rest of the game's interface uses. Nothing here binds a texture, so a resource pack
 * cannot restyle the menu and the look never drifts back towards vanilla.
 *
 * Cost: a rounded rectangle is two spans per corner row plus one call for the middle -
 * around forty quads for a tile, which is what a single vanilla button costs anyway.
 */
public final class Draw {

    private Draw() {
    }

    /** Scales a colour's alpha, for fades and for anti-aliased edge pixels. */
    public static int alpha(int argb, float factor) {
        int a = (int) (((argb >>> 24) & 0xFF) * clamp(factor));
        return (a << 24) | (argb & 0x00FFFFFF);
    }

    /** Straight per-channel interpolation, alpha included. */
    public static int mix(int from, int to, float t) {
        float k = clamp(t);

        int a = lerp((from >>> 24) & 0xFF, (to >>> 24) & 0xFF, k);
        int r = lerp((from >>> 16) & 0xFF, (to >>> 16) & 0xFF, k);
        int g = lerp((from >>> 8) & 0xFF, (to >>> 8) & 0xFF, k);
        int b = lerp(from & 0xFF, to & 0xFF, k);

        return (a << 24) | (r << 16) | (g << 8) | b;
    }

    /** Moves a value towards a target at a rate per second - the menu's only easing. */
    public static float approach(float current, float target, float perSecond, float deltaSeconds) {
        float step = clamp(perSecond * deltaSeconds);
        return current + (target - current) * step;
    }

    public static void round(DrawContext context, int x, int y, int width, int height,
                             int radius, int colour) {
        gradient(context, x, y, width, height, radius, colour, colour);
    }

    /**
     * A rounded rectangle shading from `top` to `bottom`.
     *
     * The straight middle is a single gradient call; only the corner bands are walked row
     * by row, because only there does the span width change.
     */
    public static void gradient(DrawContext context, int x, int y, int width, int height,
                                int radius, int top, int bottom) {
        if (width <= 0 || height <= 0) {
            return;
        }

        int r = Math.max(0, Math.min(radius, Math.min(width, height) / 2));

        if (r == 0) {
            context.fillGradient(x, y, x + width, y + height, top, bottom);
            return;
        }

        for (int i = 0; i < r; i++) {
            // Distance from the corner circle's centre to the middle of this row.
            double offset = r - i - 0.5D;
            double exact = r - Math.sqrt(Math.max(0.0D, (double) r * r - offset * offset));
            int inset = (int) Math.floor(exact);
            float coverage = (float) (1.0D - (exact - inset));

            row(context, x, y + i, width, inset, coverage, shade(top, bottom, height, i));
            row(context, x, y + height - 1 - i, width, inset, coverage,
                    shade(top, bottom, height, height - 1 - i));
        }

        context.fillGradient(x, y + r, x + width, y + height - r,
                shade(top, bottom, height, r), shade(top, bottom, height, height - r - 1));
    }

    /** One corner row: the solid span, plus the anti-aliased pixel at each end. */
    private static void row(DrawContext context, int x, int y, int width, int inset,
                            float coverage, int colour) {
        int left = x + inset;
        int right = x + width - inset;

        if (right - left <= 2) {
            context.fill(left, y, right, y + 1, alpha(colour, coverage));
            return;
        }

        context.fill(left + 1, y, right - 1, y + 1, colour);

        int edge = alpha(colour, coverage);
        context.fill(left, y, left + 1, y + 1, edge);
        context.fill(right - 1, y, right, y + 1, edge);
    }

    private static int shade(int top, int bottom, int height, int row) {
        return height <= 1 ? top : mix(top, bottom, (float) row / (height - 1));
    }

    /**
     * A soft drop shadow: three rounded rectangles growing outwards at low alpha.
     *
     * Three layers is the point at which another one stops being visible, and each is a
     * cheap shape, so the panel lifts off the world without a blur pass.
     */
    public static void shadow(DrawContext context, int x, int y, int width, int height,
                              int radius, int argb) {
        // Largest and faintest first, so the halo falls off with distance instead of
        // ending in a hard ring at the outer edge.
        for (int spread = 3; spread >= 1; spread--) {
            int grow = spread * 3;
            round(context, x - grow, y - grow + 1, width + grow * 2, height + grow * 2,
                    radius + grow, alpha(argb, 0.06F + 0.06F * (4 - spread)));
        }
    }

    private static int lerp(int from, int to, float t) {
        return from + Math.round((to - from) * t);
    }

    private static float clamp(float value) {
        return value < 0.0F ? 0.0F : (value > 1.0F ? 1.0F : value);
    }
}
