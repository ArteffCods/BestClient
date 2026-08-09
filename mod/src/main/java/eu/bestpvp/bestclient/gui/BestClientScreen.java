package eu.bestpvp.bestclient.gui;

import eu.bestpvp.bestclient.BestClientConfig;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.Drawable;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.screen.narration.NarrationMessageBuilder;
import net.minecraft.client.gui.widget.ClickableWidget;
import net.minecraft.client.gui.widget.PressableWidget;
import net.minecraft.client.gui.widget.SliderWidget;
import net.minecraft.client.gui.widget.TextFieldWidget;
import net.minecraft.text.Text;

import java.util.ArrayList;
import java.util.List;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;

/**
 * The client menu, opened with Right Shift.
 *
 * Nothing here uses a vanilla widget skin. It is one dark panel with its own wordmark, a
 * search field, a category rail down the left and a grid of module tiles - the shape a
 * player expects from a PvP client, not from a Minecraft options screen. Every surface is
 * drawn from flat rectangles in the launcher's palette, so the in-game half and the
 * launcher look like the same product.
 *
 * A tile is the control: clicking anywhere on it turns the module on or off, and the tile
 * itself answers - accent bar, lit icon, brighter name, a dot in the corner. There are no
 * small switches to aim at.
 *
 * The world keeps running underneath, and everything is written to disk on close.
 */
public class BestClientScreen extends Screen {

    /* Palette, shared with the launcher. Alpha first, as the game expects. */
    private static final int PANEL = 0xF2110C17;
    private static final int DIVIDER = 0xFF241C2E;
    private static final int FIELD = 0xFF17121E;
    private static final int RAIL_ACTIVE = 0xFF1F1729;
    private static final int TILE = 0xFF17121E;
    private static final int TILE_HOVER = 0xFF221A2C;
    private static final int TILE_ON = 0xFF2A1626;
    private static final int TILE_ON_HOVER = 0xFF351B2F;
    private static final int TRACK = 0xFF2C2338;
    private static final int ROSE = 0xFFFF75C3;
    private static final int ROSE_SOFT = 0xFFFFB8E0;
    private static final int INK = 0xFFF6EEF4;
    private static final int INK_DIM = 0xFFA291AD;
    private static final int INK_FAINT = 0xFF6B5C78;

    /* Layout. One fixed panel: the grid is sized so every module fits without scrolling. */
    private static final int PANEL_W = 464;
    private static final int PANEL_H = 262;
    private static final int PAD = 12;
    private static final int HEADER_H = 34;
    private static final int RAIL_W = 76;
    private static final int RAIL_ROW_H = 22;
    private static final int SEARCH_W = 150;
    private static final int COLUMNS = 3;
    private static final int TILE_W = 112;
    private static final int TILE_H = 34;
    private static final int TILE_GAP = 8;
    private static final int ROW_GAP = 7;

    private enum Category {
        ALL("All"),
        VISUAL("Visual"),
        HUD("HUD");

        final String label;

        Category(String label) {
            this.label = label;
        }
    }

    private int panelX;
    private int panelY;
    private Category activeCategory = Category.ALL;
    private String query = "";

    private final List<Tile> tiles = new ArrayList<>();

    public BestClientScreen() {
        super(Text.literal("BestClient"));
    }

    @Override
    protected void init() {
        this.panelX = (this.width - PANEL_W) / 2;
        this.panelY = (this.height - PANEL_H) / 2;
        this.tiles.clear();

        // The panel is a plain drawable added first, so it paints under every widget: the
        // screen renders its drawables in the order they were added.
        Drawable panel = (context, mouseX, mouseY, delta) -> drawPanel(context);
        this.addDrawable(panel);

        int railY = this.panelY + HEADER_H + 6;

        for (Category category : Category.values()) {
            this.addDrawableChild(new CategoryTab(this.panelX + PAD, railY, category));
            railY += RAIL_ROW_H + 4;
        }

        int searchX = this.panelX + PANEL_W - PAD - SEARCH_W;
        TextFieldWidget search = new TextFieldWidget(this.textRenderer,
                searchX + 22, this.panelY + 13, SEARCH_W - 28, 12, Text.empty());
        search.setDrawsBackground(false);
        search.setMaxLength(24);
        search.setEditableColor(INK);
        search.setText(this.query);
        search.setChangedListener(value -> {
            this.query = value;
            positionTiles();
        });
        this.addDrawableChild(search);

        // Visual first: the lighting controls belong together and read as the head of the
        // list whichever category is open.
        addToggle(Category.VISUAL, Icons.SUN, "Fullbright",
                () -> BestClientConfig.fullbright, value -> BestClientConfig.fullbright = value);
        this.tiles.add(new Brightness());
        addToggle(Category.VISUAL, Icons.EYE, "Hurt camera",
                () -> BestClientConfig.hurtCamera, value -> BestClientConfig.hurtCamera = value);

        addToggle(Category.HUD, Icons.BARS, "FPS",
                () -> BestClientConfig.showFps, value -> BestClientConfig.showFps = value);
        addToggle(Category.HUD, Icons.MOUSE, "CPS",
                () -> BestClientConfig.showCps, value -> BestClientConfig.showCps = value);
        addToggle(Category.HUD, Icons.PIN, "Coordinates",
                () -> BestClientConfig.showCoordinates, value -> BestClientConfig.showCoordinates = value);
        addToggle(Category.HUD, Icons.ARROW, "Direction",
                () -> BestClientConfig.showDirection, value -> BestClientConfig.showDirection = value);
        addToggle(Category.HUD, Icons.GAUGE, "Speed",
                () -> BestClientConfig.showSpeed, value -> BestClientConfig.showSpeed = value);
        addToggle(Category.HUD, Icons.SIGNAL, "Ping",
                () -> BestClientConfig.showPing, value -> BestClientConfig.showPing = value);
        addToggle(Category.HUD, Icons.CLOCK, "Clock",
                () -> BestClientConfig.showClock, value -> BestClientConfig.showClock = value);
        addToggle(Category.HUD, Icons.HOURGLASS, "Playtime",
                () -> BestClientConfig.showPlaytime, value -> BestClientConfig.showPlaytime = value);
        addToggle(Category.HUD, Icons.CHIP, "Memory",
                () -> BestClientConfig.showMemory, value -> BestClientConfig.showMemory = value);
        addToggle(Category.HUD, Icons.KEYBOARD, "Keystrokes",
                () -> BestClientConfig.showKeystrokes, value -> BestClientConfig.showKeystrokes = value);

        for (Tile tile : this.tiles) {
            this.addDrawableChild(tile.widget());
        }

        positionTiles();
    }

    private void addToggle(Category category, Icons.Icon icon, String name,
                           BooleanSupplier getter, Consumer<Boolean> setter) {
        this.tiles.add(new Toggle(category, icon, name, getter, setter));
    }

    /**
     * Places the tiles that match the current category and search, and hides the rest.
     *
     * Hiding rather than rebuilding is what keeps typing in the search field smooth: the
     * widgets are created once and filtering only moves them. A hidden widget is neither
     * drawn nor clickable, so nothing can be hit by accident where a tile used to be.
     */
    private void positionTiles() {
        String needle = this.query.trim().toLowerCase();

        int gridX = this.panelX + PAD + RAIL_W + 10;
        int gridY = this.panelY + HEADER_H + 6;
        int shown = 0;

        for (Tile tile : this.tiles) {
            boolean matches = (this.activeCategory == Category.ALL || tile.category() == this.activeCategory)
                    && (needle.isEmpty() || tile.name().toLowerCase().contains(needle));

            ClickableWidget widget = tile.widget();
            widget.visible = matches;
            widget.active = matches;

            if (!matches) {
                continue;
            }

            widget.setPosition(gridX + (shown % COLUMNS) * (TILE_W + TILE_GAP),
                    gridY + (shown / COLUMNS) * (TILE_H + ROW_GAP));
            shown++;
        }
    }

    /** The panel, its wordmark, the search field's ground and the rail divider. */
    private void drawPanel(DrawContext context) {
        int right = this.panelX + PANEL_W;
        int bottom = this.panelY + PANEL_H;

        rounded(context, this.panelX, this.panelY, PANEL_W, PANEL_H, PANEL);

        // Wordmark: "BEST" plain, "CLIENT" in the brand pink.
        Text best = Text.literal("BEST");
        context.drawTextWithShadow(this.textRenderer, best, this.panelX + PAD, this.panelY + 13, INK);
        context.drawTextWithShadow(this.textRenderer, Text.literal("CLIENT"),
                this.panelX + PAD + this.textRenderer.getWidth(best) + 2, this.panelY + 13, ROSE);

        // Search field: our own rounded ground with the magnifier inside it. The widget
        // draws no background of its own.
        int searchX = right - PAD - SEARCH_W;
        rounded(context, searchX, this.panelY + 8, SEARCH_W, 22, FIELD);
        Icons.SEARCH.draw(context, searchX + 6, this.panelY + 14, INK_FAINT);

        if (this.query.isEmpty()) {
            context.drawText(this.textRenderer, Text.literal("Search"),
                    searchX + 22, this.panelY + 13, INK_FAINT, false);
        }

        context.fill(this.panelX + PAD, this.panelY + HEADER_H - 2, right - PAD,
                this.panelY + HEADER_H - 1, DIVIDER);

        // Hairline between the rail and the grid, and the close hint under the rail.
        int railRight = this.panelX + PAD + RAIL_W + 5;
        context.fill(railRight, this.panelY + HEADER_H + 6, railRight + 1, bottom - PAD, DIVIDER);

        context.drawText(this.textRenderer, Text.literal("ESC to close"),
                this.panelX + PAD, bottom - PAD - 6, INK_FAINT, false);
    }

    @Override
    public void close() {
        // Everything the player touched is written once, here, rather than on every
        // keystroke and every pixel of slider drag.
        BestClientConfig.flush();
        super.close();
    }

    @Override
    public boolean shouldPause() {
        // Never pause: the menu has to be usable mid-fight without freezing the world.
        return false;
    }

    /** A filled rectangle with two-pixel corners bitten out, drawn as three quads. */
    private static void rounded(DrawContext context, int x, int y, int width, int height, int colour) {
        context.fill(x + 2, y, x + width - 2, y + height, colour);
        context.fill(x, y + 2, x + 2, y + height - 2, colour);
        context.fill(x + width - 2, y + 2, x + width, y + height - 2, colour);
    }

    /**
     * Hover, worked out from the mouse position the renderer was handed rather than from
     * the widget's own flag: the flag has changed name and meaning between versions, and
     * this cannot be wrong.
     */
    private static boolean over(ClickableWidget widget, int mouseX, int mouseY) {
        return mouseX >= widget.getX() && mouseX < widget.getX() + widget.getWidth()
                && mouseY >= widget.getY() && mouseY < widget.getY() + widget.getHeight();
    }

    /**
     * What the grid needs from a module, whichever widget draws it: a toggle is a button
     * and brightness is a slider, and the game gives those two no common base beyond
     * ClickableWidget.
     */
    private interface Tile {
        Category category();

        String name();

        ClickableWidget widget();
    }

    /** Shared painting: ground, accent bar, icon, name, state dot. */
    private void paintTile(DrawContext context, int x, int y, boolean hover, boolean on,
                           Icons.Icon icon, String name) {
        rounded(context, x, y, TILE_W, TILE_H,
                on ? (hover ? TILE_ON_HOVER : TILE_ON) : (hover ? TILE_HOVER : TILE));

        // The accent bar is the loudest "this is on" signal, and it costs one quad.
        if (on) {
            context.fill(x, y + 3, x + 2, y + TILE_H - 3, ROSE);
        }

        icon.draw(context, x + 10, y + 6, on ? ROSE_SOFT : INK_FAINT);

        context.drawText(this.textRenderer, Text.literal(name),
                x + 27, y + 9, on ? INK : INK_DIM, false);

        int dotX = x + TILE_W - 13;
        context.fill(dotX, y + 9, dotX + 5, y + 14, on ? ROSE : TRACK);
    }

    /** A module you switch on or off; the whole tile is the button. */
    private class Toggle extends PressableWidget implements Tile {

        private final Category category;
        private final Icons.Icon icon;
        private final String name;
        private final BooleanSupplier getter;
        private final Consumer<Boolean> setter;

        Toggle(Category category, Icons.Icon icon, String name,
               BooleanSupplier getter, Consumer<Boolean> setter) {
            super(0, 0, TILE_W, TILE_H, Text.literal(name));
            this.category = category;
            this.icon = icon;
            this.name = name;
            this.getter = getter;
            this.setter = setter;
        }

        @Override
        public Category category() {
            return this.category;
        }

        @Override
        public String name() {
            return this.name;
        }

        @Override
        public ClickableWidget widget() {
            return this;
        }

        // PressableWidget routes both a click and the keyboard's Space/Enter here, so the
        // tile needs no input handling of its own.
        @Override
        public void onPress() {
            this.setter.accept(!this.getter.getAsBoolean());
            BestClientConfig.markDirty();
        }

        @Override
        protected void renderWidget(DrawContext context, int mouseX, int mouseY, float delta) {
            paintTile(context, this.getX(), this.getY(), over(this, mouseX, mouseY),
                    this.getter.getAsBoolean(), this.icon, this.name);
        }

        @Override
        protected void appendClickableNarrations(NarrationMessageBuilder builder) {
            this.appendDefaultNarrations(builder);
        }
    }

    /**
     * The brightness tile. It is a real slider, so it is built on SliderWidget for the
     * drag and keyboard handling and only its painting is replaced.
     *
     * The track is drawn four pixels in from each edge, which is exactly the span
     * SliderWidget maps the mouse across - so the knob always lands under the cursor.
     */
    private class Brightness extends SliderWidget implements Tile {

        Brightness() {
            super(0, 0, TILE_W, TILE_H, Text.empty(),
                    (BestClientConfig.clampStrength(BestClientConfig.fullbrightStrength) - 1.0D) / 19.0D);
        }

        private double toStrength() {
            return 1.0D + this.value * 19.0D;
        }

        @Override
        public Category category() {
            return Category.VISUAL;
        }

        @Override
        public String name() {
            return "Brightness";
        }

        @Override
        public ClickableWidget widget() {
            return this;
        }

        @Override
        protected void updateMessage() {
            // The readout is painted by hand next to the name; the widget's own message
            // would land in the middle of the tile.
            this.setMessage(Text.empty());
        }

        @Override
        protected void applyValue() {
            BestClientConfig.fullbrightStrength = BestClientConfig.clampStrength(toStrength());
            // Dragging fires this on every mouse move - the write is deferred to close().
            BestClientConfig.markDirty();
        }

        @Override
        protected void renderWidget(DrawContext context, int mouseX, int mouseY, float delta) {
            int x = this.getX();
            int y = this.getY();
            boolean hover = over(this, mouseX, mouseY);
            // The value only does anything while fullbright is on, so the tile says so
            // instead of pretending.
            boolean live = BestClientConfig.fullbright;

            rounded(context, x, y, TILE_W, TILE_H, hover ? TILE_HOVER : TILE);

            Icons.CONTRAST.draw(context, x + 10, y + 4, live ? ROSE_SOFT : INK_FAINT);

            String readout = String.format("%.1f", toStrength());
            int readoutWidth = BestClientScreen.this.textRenderer.getWidth(readout);

            context.drawText(BestClientScreen.this.textRenderer, Text.literal("Brightness"),
                    x + 27, y + 6, live ? INK : INK_DIM, false);
            context.drawText(BestClientScreen.this.textRenderer, Text.literal(readout),
                    x + TILE_W - 8 - readoutWidth, y + 6, live ? ROSE_SOFT : INK_FAINT, false);

            int trackLeft = x + 4;
            int trackRight = x + TILE_W - 4;
            int trackY = y + TILE_H - 9;

            context.fill(trackLeft, trackY, trackRight, trackY + 2, TRACK);

            int filled = trackLeft + (int) Math.round(this.value * (trackRight - trackLeft));
            context.fill(trackLeft, trackY, filled, trackY + 2, live ? ROSE : INK_FAINT);

            int knob = Math.min(trackRight - 4, Math.max(trackLeft, filled - 2));
            context.fill(knob, trackY - 2, knob + 4, trackY + 4, live ? ROSE_SOFT : INK_DIM);
        }
    }

    /** One category in the left rail. */
    private class CategoryTab extends PressableWidget {

        private final Category category;

        CategoryTab(int x, int y, Category category) {
            super(x, y, RAIL_W, RAIL_ROW_H, Text.literal(category.label));
            this.category = category;
        }

        @Override
        public void onPress() {
            BestClientScreen.this.activeCategory = this.category;
            positionTiles();
        }

        @Override
        protected void renderWidget(DrawContext context, int mouseX, int mouseY, float delta) {
            boolean selected = BestClientScreen.this.activeCategory == this.category;
            boolean hover = over(this, mouseX, mouseY);

            if (selected || hover) {
                rounded(context, this.getX(), this.getY(), this.getWidth(), this.getHeight(),
                        selected ? RAIL_ACTIVE : TILE);
            }

            if (selected) {
                context.fill(this.getX(), this.getY() + 4, this.getX() + 2,
                        this.getY() + this.getHeight() - 4, ROSE);
            }

            context.drawText(BestClientScreen.this.textRenderer, this.getMessage(),
                    this.getX() + 10, this.getY() + 7, selected ? ROSE_SOFT : INK_DIM, false);
        }

        @Override
        protected void appendClickableNarrations(NarrationMessageBuilder builder) {
            this.appendDefaultNarrations(builder);
        }
    }
}
