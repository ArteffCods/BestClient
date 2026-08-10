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
 * There is no Minecraft in the look of this screen. No widget texture, no nine-slice
 * button, no pixel alphabet: the surfaces are rounded rectangles with anti-aliased corners
 * drawn from spans, the type is Montserrat through the game's TrueType provider, and the
 * colours are the launcher's - so the in-game half and the desktop half read as one
 * product. A resource pack cannot restyle any of it, because none of it is a texture.
 *
 * The composition is the one a player expects from a PvP client: a floating card with a
 * drop shadow, a wordmark and a search pill across the top, a category rail down the left,
 * and a grid of module tiles. A tile is the control - clicking it toggles the module, and
 * the tile answers with an accent bar, a lit icon chip and its own ON/OFF line. Hover and
 * the card's entrance are animated against the wall clock, not the tick, so they stay
 * smooth whatever the frame rate.
 *
 * The world keeps running underneath, and everything is written to disk on close.
 */
public class BestClientScreen extends Screen {

    /* Palette, shared with the launcher. Alpha first, as the game expects. */
    private static final int CARD_TOP = 0xFA181121;
    private static final int CARD_BOTTOM = 0xFA0D0913;
    private static final int SHADOW = 0xFF000000;
    private static final int HIGHLIGHT = 0x14FFFFFF;
    private static final int FIELD = 0xFF1B1526;
    private static final int TILE_TOP = 0xFF1D1628;
    private static final int TILE_BOTTOM = 0xFF17111F;
    private static final int TILE_ON_TOP = 0xFF3A1C33;
    private static final int TILE_ON_BOTTOM = 0xFF241221;
    private static final int CHIP_OFF = 0xFF241C31;
    private static final int TRACK = 0xFF2C2338;
    private static final int ROSE = 0xFFFF75C3;
    private static final int ROSE_SOFT = 0xFFFFB8E0;
    private static final int ROSE_DEEP = 0xFFD94A9C;
    private static final int INK = 0xFFF6EEF4;
    private static final int INK_DIM = 0xFFA291AD;
    private static final int INK_FAINT = 0xFF6B5C78;

    /* Layout. One fixed card: the grid is sized so every module fits without scrolling. */
    private static final int CARD_W = 470;
    private static final int CARD_H = 252;
    private static final int CARD_R = 10;
    private static final int PAD = 12;
    private static final int HEADER_H = 40;
    private static final int RAIL_W = 84;
    private static final int RAIL_ROW_H = 26;
    private static final int RAIL_GAP = 6;
    private static final int SEARCH_W = 156;
    private static final int SEARCH_H = 22;
    private static final int COLUMNS = 3;
    private static final int TILE_W = 111;
    private static final int TILE_H = 32;
    private static final int TILE_R = 6;
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

    private int cardX;
    private int cardY;
    private Category activeCategory = Category.ALL;
    private String query = "";

    /** Entrance progress, 0 to 1. Every colour on the card is faded through it. */
    private float open;
    private long lastFrameAt;
    private float frameDelta;

    private final List<Tile> tiles = new ArrayList<>();

    public BestClientScreen() {
        super(Text.literal("BestClient"));
    }

    @Override
    protected void init() {
        this.cardX = (this.width - CARD_W) / 2;
        this.cardY = (this.height - CARD_H) / 2;
        this.tiles.clear();

        // The card is a plain drawable added first, so it paints under every widget: the
        // screen renders its drawables in the order they were added. It also drives the
        // frame clock the animations read.
        Drawable card = (context, mouseX, mouseY, delta) -> drawCard(context);
        this.addDrawable(card);

        int railY = this.cardY + HEADER_H + 4;

        for (Category category : Category.values()) {
            this.addDrawableChild(new CategoryTab(this.cardX + PAD, railY, category));
            railY += RAIL_ROW_H + RAIL_GAP;
        }

        int searchX = this.cardX + CARD_W - PAD - SEARCH_W;
        TextFieldWidget search = new TextFieldWidget(this.textRenderer,
                searchX + 24, this.cardY + 15, SEARCH_W - 32, 12, Text.empty());
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
     * Hiding rather than rebuilding is what keeps typing in the search pill smooth: the
     * widgets are created once and filtering only moves them. A hidden widget is neither
     * drawn nor clickable, so nothing can be hit where a tile used to be.
     */
    private void positionTiles() {
        String needle = this.query.trim().toLowerCase();

        int gridX = this.cardX + PAD + RAIL_W + 12;
        int gridY = this.cardY + HEADER_H + 4;
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

    /** The card, its shadow, the wordmark, the search pill and the rail divider. */
    private void drawCard(DrawContext context) {
        tickClock();

        int right = this.cardX + CARD_W;
        int bottom = this.cardY + CARD_H;

        Draw.shadow(context, this.cardX, this.cardY, CARD_W, CARD_H, CARD_R, fade(SHADOW));
        Draw.gradient(context, this.cardX, this.cardY, CARD_W, CARD_H, CARD_R,
                fade(CARD_TOP), fade(CARD_BOTTOM));

        // One pixel of light along the top edge: the whole reason the card reads as glass
        // rather than as a hole cut in the screen.
        context.fill(this.cardX + CARD_R, this.cardY, right - CARD_R, this.cardY + 1, fade(HIGHLIGHT));

        // Wordmark: "BEST" plain, "CLIENT" in the brand pink.
        Text best = Fonts.of("BEST");
        int wordY = this.cardY + 15;
        context.drawText(this.textRenderer, best, this.cardX + PAD, wordY, fade(INK), false);
        context.drawText(this.textRenderer, Fonts.of("CLIENT"),
                this.cardX + PAD + this.textRenderer.getWidth(best) + 3, wordY, fade(ROSE), false);

        // Search pill: our own rounded ground with the magnifier inside it. The widget
        // draws no background of its own.
        int searchX = right - PAD - SEARCH_W;
        int searchY = this.cardY + 10;
        Draw.round(context, searchX, searchY, SEARCH_W, SEARCH_H, SEARCH_H / 2, fade(FIELD));
        Icons.SEARCH.draw(context, searchX + 8, searchY + 6, fade(INK_FAINT));

        if (this.query.isEmpty()) {
            context.drawText(this.textRenderer, Fonts.of("Search"),
                    searchX + 24, searchY + 7, fade(INK_FAINT), false);
        }

        // Hairline between the rail and the grid, fading out at both ends so it reads as a
        // seam rather than as a drawn border.
        int seam = this.cardX + PAD + RAIL_W + 6;
        int seamTop = this.cardY + HEADER_H + 4;
        Draw.gradient(context, seam, seamTop, 1, bottom - PAD - seamTop, 0,
                fade(0x00FFFFFF), fade(HIGHLIGHT));

        context.drawText(this.textRenderer, Fonts.of("ESC to close"),
                this.cardX + PAD, bottom - PAD - 8, fade(INK_FAINT), false);
    }

    /**
     * Advances the animation clock.
     *
     * Wall time, not tick delta: the menu never pauses the game, so tick delta says
     * nothing useful about how long the last frame took, and a hover that eased in ticks
     * would run at a different speed on every machine.
     */
    private void tickClock() {
        long now = System.nanoTime();

        if (this.lastFrameAt == 0L) {
            this.frameDelta = 0.0F;
        } else {
            // Capped: a stutter or a breakpoint must not teleport every animation.
            this.frameDelta = Math.min(0.1F, (now - this.lastFrameAt) / 1_000_000_000.0F);
        }

        this.lastFrameAt = now;
        this.open = Draw.approach(this.open, 1.0F, 11.0F, this.frameDelta);
    }

    /** Every colour on the card goes through the entrance fade. */
    private int fade(int argb) {
        return Draw.alpha(argb, this.open);
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

    /** A module you switch on or off; the whole tile is the button. */
    private class Toggle extends PressableWidget implements Tile {

        private final Category category;
        private final Icons.Icon icon;
        private final String name;
        private final BooleanSupplier getter;
        private final Consumer<Boolean> setter;

        /** Hover and on/off, both eased so nothing on the card snaps. */
        private float hover;
        private float lit;

        Toggle(Category category, Icons.Icon icon, String name,
               BooleanSupplier getter, Consumer<Boolean> setter) {
            super(0, 0, TILE_W, TILE_H, Text.literal(name));
            this.category = category;
            this.icon = icon;
            this.name = name;
            this.getter = getter;
            this.setter = setter;
            this.lit = getter.getAsBoolean() ? 1.0F : 0.0F;
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
            boolean on = this.getter.getAsBoolean();
            float step = BestClientScreen.this.frameDelta;

            this.hover = Draw.approach(this.hover, over(this, mouseX, mouseY) ? 1.0F : 0.0F, 14.0F, step);
            this.lit = Draw.approach(this.lit, on ? 1.0F : 0.0F, 14.0F, step);

            int x = this.getX();
            int y = this.getY();

            int top = Draw.mix(TILE_TOP, TILE_ON_TOP, this.lit);
            int bottom = Draw.mix(TILE_BOTTOM, TILE_ON_BOTTOM, this.lit);

            Draw.gradient(context, x, y, TILE_W, TILE_H, TILE_R, fade(top), fade(bottom));

            // Hover reads as light falling on the tile, not as a different colour.
            if (this.hover > 0.01F) {
                Draw.round(context, x, y, TILE_W, TILE_H, TILE_R,
                        fade(Draw.alpha(0x18FFFFFF, this.hover)));
            }

            // Accent bar down the left edge, growing in as the module lights up.
            if (this.lit > 0.01F) {
                int barHeight = Math.round((TILE_H - 12) * this.lit);
                int barY = y + (TILE_H - barHeight) / 2;
                Draw.round(context, x + 3, barY, 2, barHeight, 1, fade(Draw.alpha(ROSE, this.lit)));
            }

            // Icon in its own chip, which is what stops the row reading as a list item.
            int chipX = x + 9;
            int chipY = y + (TILE_H - 19) / 2;
            Draw.round(context, chipX, chipY, 19, 19, 5,
                    fade(Draw.mix(CHIP_OFF, Draw.alpha(ROSE_DEEP, 0.55F), this.lit)));
            this.icon.draw(context, chipX + 4, chipY + 4,
                    fade(Draw.mix(INK_FAINT, ROSE_SOFT, this.lit)));

            int textX = chipX + 25;
            context.drawText(BestClientScreen.this.textRenderer, Fonts.of(this.name),
                    textX, y + 7, fade(Draw.mix(INK_DIM, INK, this.lit)), false);
            context.drawText(BestClientScreen.this.textRenderer, Fonts.of(on ? "ON" : "OFF"),
                    textX, y + 18, fade(Draw.mix(INK_FAINT, ROSE, this.lit)), false);
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

        private float hover;

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
            this.hover = Draw.approach(this.hover, over(this, mouseX, mouseY) ? 1.0F : 0.0F,
                    14.0F, BestClientScreen.this.frameDelta);

            int x = this.getX();
            int y = this.getY();
            // The value only does anything while fullbright is on, so the tile says so
            // instead of pretending.
            boolean live = BestClientConfig.fullbright;

            Draw.gradient(context, x, y, TILE_W, TILE_H, TILE_R, fade(TILE_TOP), fade(TILE_BOTTOM));

            if (this.hover > 0.01F) {
                Draw.round(context, x, y, TILE_W, TILE_H, TILE_R,
                        fade(Draw.alpha(0x18FFFFFF, this.hover)));
            }

            int chipX = x + 9;
            int chipY = y + 3;
            Draw.round(context, chipX, chipY, 15, 15, 4, fade(CHIP_OFF));
            Icons.CONTRAST.draw(context, chipX + 2, chipY + 2, fade(live ? ROSE_SOFT : INK_FAINT));

            int textX = chipX + 21;
            context.drawText(BestClientScreen.this.textRenderer, Fonts.of("Brightness"),
                    textX, y + 6, fade(live ? INK : INK_DIM), false);

            String readout = String.format("%.1f", toStrength());
            Text value = Fonts.of(readout);
            context.drawText(BestClientScreen.this.textRenderer, value,
                    x + TILE_W - 9 - BestClientScreen.this.textRenderer.getWidth(value), y + 6,
                    fade(live ? ROSE_SOFT : INK_FAINT), false);

            int trackLeft = x + 4;
            int trackRight = x + TILE_W - 4;
            int trackY = y + TILE_H - 9;

            Draw.round(context, trackLeft, trackY, trackRight - trackLeft, 3, 1, fade(TRACK));

            int filled = (int) Math.round(this.value * (trackRight - trackLeft));

            if (filled > 2) {
                Draw.gradient(context, trackLeft, trackY, filled, 3, 1,
                        fade(live ? ROSE_SOFT : INK_FAINT), fade(live ? ROSE : INK_FAINT));
            }

            int knob = Math.min(trackRight - 5, Math.max(trackLeft, trackLeft + filled - 2));
            Draw.round(context, knob, trackY - 2, 5, 7, 2, fade(live ? ROSE_SOFT : INK_DIM));
        }
    }

    /** One category in the left rail, drawn as a pill. */
    private class CategoryTab extends PressableWidget {

        private final Category category;
        private float selected;
        private float hover;

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
            boolean isActive = BestClientScreen.this.activeCategory == this.category;
            float step = BestClientScreen.this.frameDelta;

            this.selected = Draw.approach(this.selected, isActive ? 1.0F : 0.0F, 14.0F, step);
            this.hover = Draw.approach(this.hover, over(this, mouseX, mouseY) ? 1.0F : 0.0F, 14.0F, step);

            int x = this.getX();
            int y = this.getY();

            if (this.selected > 0.01F) {
                Draw.gradient(context, x, y, RAIL_W, RAIL_ROW_H, RAIL_ROW_H / 2,
                        fade(Draw.alpha(ROSE_DEEP, 0.34F * this.selected)),
                        fade(Draw.alpha(ROSE_DEEP, 0.16F * this.selected)));
            }

            if (this.hover > 0.01F) {
                Draw.round(context, x, y, RAIL_W, RAIL_ROW_H, RAIL_ROW_H / 2,
                        fade(Draw.alpha(0x14FFFFFF, this.hover)));
            }

            // A dot rather than a bar: the rail is pill-shaped, and a bar would cut it.
            int dot = Math.round(4 * this.selected);

            if (dot > 0) {
                Draw.round(context, x + 9, y + RAIL_ROW_H / 2 - dot / 2, dot, dot, dot / 2,
                        fade(Draw.alpha(ROSE, this.selected)));
            }

            context.drawText(BestClientScreen.this.textRenderer, Fonts.of(this.category.label),
                    x + 18, y + (RAIL_ROW_H - 8) / 2,
                    fade(Draw.mix(INK_DIM, ROSE_SOFT, this.selected)), false);
        }

        @Override
        protected void appendClickableNarrations(NarrationMessageBuilder builder) {
            this.appendDefaultNarrations(builder);
        }
    }
}
