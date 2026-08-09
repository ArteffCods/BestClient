package eu.bestpvp.bestclient.gui;

import net.minecraft.client.gui.DrawContext;

/**
 * The menu's icons, drawn as pixel art rather than loaded as textures.
 *
 * A texture atlas would mean shipping a PNG, binding it, and living with whatever
 * filtering the resource pack applies; these are eleven-by-eleven bitmaps written out as
 * strings, so every icon lands on exact pixels at any GUI scale and re-colours for free.
 *
 * Each pattern is compressed once at class-load into horizontal runs, so drawing an icon
 * is a handful of quads instead of one per lit pixel.
 */
public final class Icons {

    private Icons() {
    }

    /** Fullbright: a sun. */
    public static final Icon SUN = of(
            ".....#.....",
            ".#.......#.",
            "....###....",
            "...#####...",
            "...#####...",
            "#..#####..#",
            "...#####...",
            "....###....",
            ".#.......#.",
            "...........",
            ".....#.....");

    /** Brightness: the standard half-filled contrast disc. */
    public static final Icon CONTRAST = of(
            "...........",
            "....###....",
            "..##...##..",
            ".###....#..",
            ".####...#..",
            "#####....#.",
            ".####...#..",
            ".###....#..",
            "..##...##..",
            "....###....",
            "...........");

    /** Hurt camera: an eye, because the setting is about what the view does. */
    public static final Icon EYE = of(
            "...........",
            "...........",
            "...........",
            "...#####...",
            ".##.....##.",
            "#...###...#",
            ".##.....##.",
            "...#####...",
            "...........",
            "...........",
            "...........");

    /** FPS: a rising bar chart. */
    public static final Icon BARS = of(
            "...........",
            ".......##..",
            ".......##..",
            ".......##..",
            "....##.##..",
            "....##.##..",
            "....##.##..",
            ".##.##.##..",
            ".##.##.##..",
            ".##.##.##..",
            "...........");

    /** Coordinates: a map pin. */
    public static final Icon PIN = of(
            "...........",
            "...#####...",
            "..##...##..",
            "..#..#..#..",
            "..##...##..",
            "...#####...",
            "....###....",
            ".....#.....",
            ".....#.....",
            "...........",
            "...........");

    /** Ping: signal arcs over a dot. */
    public static final Icon SIGNAL = of(
            "...........",
            "...........",
            "..#######..",
            ".##.....##.",
            "....###....",
            "...#...#...",
            "...........",
            ".....#.....",
            ".....#.....",
            "...........",
            "...........");

    private static Icon of(String... rows) {
        return new Icon(rows);
    }

    public static final class Icon {

        /** Flat triples of x, y, width - one entry per horizontal run of lit pixels. */
        private final int[] runs;

        private Icon(String[] rows) {
            int[] buffer = new int[rows.length * rows[0].length()];
            int count = 0;

            for (int y = 0; y < rows.length; y++) {
                String row = rows[y];
                int x = 0;

                while (x < row.length()) {
                    if (row.charAt(x) != '#') {
                        x++;
                        continue;
                    }

                    int start = x;
                    while (x < row.length() && row.charAt(x) == '#') {
                        x++;
                    }

                    buffer[count++] = start;
                    buffer[count++] = y;
                    buffer[count++] = x - start;
                }
            }

            this.runs = java.util.Arrays.copyOf(buffer, count);
        }

        public void draw(DrawContext context, int x, int y, int colour) {
            for (int i = 0; i < this.runs.length; i += 3) {
                int left = x + this.runs[i];
                int top = y + this.runs[i + 1];
                context.fill(left, top, left + this.runs[i + 2], top + 1, colour);
            }
        }
    }
}
