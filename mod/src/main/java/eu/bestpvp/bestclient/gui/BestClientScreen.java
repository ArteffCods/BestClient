package eu.bestpvp.bestclient.gui;

import eu.bestpvp.bestclient.BestClientConfig;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.Drawable;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.screen.narration.NarrationMessageBuilder;
import net.minecraft.client.gui.widget.PressableWidget;
import net.minecraft.client.gui.widget.SliderWidget;
import net.minecraft.text.Text;

import java.util.function.BooleanSupplier;
import java.util.function.Consumer;

/**
 * The client menu, opened with Right Shift.
 *
 * One card, one column of rows, each row a pixel icon, a name, a line of explanation and
 * the control itself on the right. The vanilla button texture is deliberately not used:
 * the launcher and the in-game menu are the same product, so this borrows the launcher's
 * palette - near-black cards, one pink accent, a green switch - and draws every control by
 * hand from flat rectangles.
 *
 * The world keeps running underneath. Nothing here pauses the game, so the menu is usable
 * mid-fight, and everything is written to disk when the screen closes.
 */
public class BestClientScreen extends Screen {

    /* Launcher palette, alpha-first as the game expects. */
    private static final int CARD = 0xF20D0913;
    private static final int ROW = 0xFF17121E;
    private static final int ROW_HOVER = 0xFF241C2E;
    private static final int ROSE = 0xFFFF75C3;
    private static final int ROSE_SOFT = 0xFFFFB8E0;
    private static final int INK = 0xFFF6EEF4;
    private static final int INK_DIM = 0xFFA291AD;
    private static final int INK_FAINT = 0xFF6B5C78;
    private static final int ON = 0xFF63D492;
    private static final int OFF = 0xFF2C2338;

    private static final int CARD_WIDTH = 250;
    private static final int PADDING = 10;
    private static final int ROW_HEIGHT = 28;
    private static final int ROW_GAP = 3;
    private static final int HEADER = 30;
    private static final int FOOTER = 32;
    private static final int ROWS = 6;

    private int cardX;
    private int cardY;
    private int cardHeight;

    public BestClientScreen() {
        super(Text.literal("BestClient"));
    }

    @Override
    protected void init() {
        this.cardHeight = HEADER + ROWS * (ROW_HEIGHT + ROW_GAP) - ROW_GAP + FOOTER;
        this.cardX = (this.width - CARD_WIDTH) / 2;
        this.cardY = (this.height - this.cardHeight) / 2;

        int x = this.cardX + PADDING;
        int width = CARD_WIDTH - PADDING * 2;
        int y = this.cardY + HEADER;

        // The card is a plain drawable added before the rows, so it paints underneath
        // them: the screen renders its drawables in the order they were added.
        Drawable card = (context, mouseX, mouseY, delta) -> drawCard(context);
        this.addDrawable(card);

        this.addDrawableChild(new OptionRow(x, y, width, Icons.SUN, "Fullbright",
                "Lights every cave without touching the world",
                () -> BestClientConfig.fullbright,
                value -> BestClientConfig.fullbright = value));

        y += ROW_HEIGHT + ROW_GAP;

        this.addDrawableChild(new BrightnessRow(x, y, width));

        y += ROW_HEIGHT + ROW_GAP;

        this.addDrawableChild(new OptionRow(x, y, width, Icons.EYE, "Hurt camera",
                "Vanilla tilts the view when you are hit",
                () -> BestClientConfig.hurtCamera,
                value -> BestClientConfig.hurtCamera = value));

        y += ROW_HEIGHT + ROW_GAP;

        this.addDrawableChild(new OptionRow(x, y, width, Icons.BARS, "FPS counter",
                "Frames per second, top left",
                () -> BestClientConfig.showFps,
                value -> BestClientConfig.showFps = value));

        y += ROW_HEIGHT + ROW_GAP;

        this.addDrawableChild(new OptionRow(x, y, width, Icons.PIN, "Coordinates",
                "Your block position, top left",
                () -> BestClientConfig.showCoordinates,
                value -> BestClientConfig.showCoordinates = value));

        y += ROW_HEIGHT + ROW_GAP;

        this.addDrawableChild(new OptionRow(x, y, width, Icons.SIGNAL, "Ping",
                "Round trip to the server, top left",
                () -> BestClientConfig.showPing,
                value -> BestClientConfig.showPing = value));

        y += ROW_HEIGHT + ROW_GAP + 6;

        this.addDrawableChild(new DoneButton(x, y, width, 18));
    }

    /** The card itself: ground, name, and the accent rule under the header. */
    private void drawCard(DrawContext context) {
        int right = this.cardX + CARD_WIDTH;

        rounded(context, this.cardX, this.cardY, CARD_WIDTH, this.cardHeight, CARD);

        // Header: the name in the brand pink, with the accent rule under it running the
        // full width of the card's inner column.
        context.drawTextWithShadow(this.textRenderer, Text.literal("BestClient"),
                this.cardX + PADDING, this.cardY + 11, ROSE_SOFT);

        Text hint = Text.literal("Right Shift to close");
        int hintWidth = this.textRenderer.getWidth(hint);
        context.drawText(this.textRenderer, hint, right - PADDING - hintWidth,
                this.cardY + 12, INK_FAINT, false);

        context.fill(this.cardX + PADDING, this.cardY + 23, right - PADDING, this.cardY + 24, ROSE);
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
     * Shared painting for the option rows: card, icon, name, explanation. The control on
     * the right is whatever the subclass draws.
     */
    private abstract class Row extends PressableWidget {

        private final Icons.Icon icon;
        private final String hint;

        Row(int x, int y, int width, int height, Icons.Icon icon, String name, String hint) {
            super(x, y, width, height, Text.literal(name));
            this.icon = icon;
            this.hint = hint;
        }

        boolean over(int mouseX, int mouseY) {
            return mouseX >= this.getX() && mouseX < this.getX() + this.getWidth()
                    && mouseY >= this.getY() && mouseY < this.getY() + this.getHeight();
        }

        @Override
        protected void renderWidget(DrawContext context, int mouseX, int mouseY, float delta) {
            boolean hover = over(mouseX, mouseY);

            rounded(context, this.getX(), this.getY(), this.getWidth(), this.getHeight(),
                    hover ? ROW_HOVER : ROW);

            int iconY = this.getY() + (this.getHeight() - 11) / 2;
            this.icon.draw(context, this.getX() + 8, iconY, hover ? ROSE_SOFT : ROSE);

            int textX = this.getX() + 26;
            context.drawText(BestClientScreen.this.textRenderer, this.getMessage(),
                    textX, this.getY() + 6, INK, false);
            context.drawText(BestClientScreen.this.textRenderer, Text.literal(this.hint),
                    textX, this.getY() + 17, INK_FAINT, false);

            renderControl(context, mouseX, mouseY);
        }

        /** Draws the control at the right-hand end of the row. */
        protected abstract void renderControl(DrawContext context, int mouseX, int mouseY);

        @Override
        protected void appendClickableNarrations(NarrationMessageBuilder builder) {
            this.appendDefaultNarrations(builder);
        }
    }

    /** A row whose control is an on/off switch, in the launcher's green. */
    private class OptionRow extends Row {

        private static final int SWITCH_WIDTH = 26;
        private static final int SWITCH_HEIGHT = 12;

        private final BooleanSupplier getter;
        private final Consumer<Boolean> setter;

        OptionRow(int x, int y, int width, Icons.Icon icon, String name, String hint,
                  BooleanSupplier getter, Consumer<Boolean> setter) {
            super(x, y, width, ROW_HEIGHT, icon, name, hint);
            this.getter = getter;
            this.setter = setter;
        }

        @Override
        protected void renderControl(DrawContext context, int mouseX, int mouseY) {
            boolean on = this.getter.getAsBoolean();

            int right = this.getX() + this.getWidth() - PADDING;
            int left = right - SWITCH_WIDTH;
            int top = this.getY() + (this.getHeight() - SWITCH_HEIGHT) / 2;

            rounded(context, left, top, SWITCH_WIDTH, SWITCH_HEIGHT, on ? ON : OFF);

            int knob = on ? right - 2 - 8 : left + 2;
            context.fill(knob, top + 2, knob + 8, top + SWITCH_HEIGHT - 2,
                    on ? 0xFF0D0913 : INK_FAINT);
        }

        // PressableWidget already routes both a click and the keyboard's Space/Enter here,
        // so the row needs no input handling of its own.
        @Override
        public void onPress() {
            this.setter.accept(!this.getter.getAsBoolean());
            BestClientConfig.markDirty();
        }
    }

    /**
     * The brightness row. It carries a real slider, so it is built on SliderWidget for the
     * drag and keyboard handling and only its painting is replaced.
     *
     * The value is meaningless while Fullbright is off, so the row dims itself rather than
     * pretending it does something.
     */
    private class BrightnessRow extends SliderWidget {

        private static final int TRACK_WIDTH = 74;

        BrightnessRow(int x, int y, int width) {
            super(x, y, width, ROW_HEIGHT, Text.empty(), toFraction(BestClientConfig.fullbrightStrength));
        }

        private static double toFraction(double strength) {
            return (BestClientConfig.clampStrength(strength) - 1.0D) / 19.0D;
        }

        private double toStrength() {
            return 1.0D + this.value * 19.0D;
        }

        @Override
        protected void updateMessage() {
            // The number is painted by hand next to the track; the widget's own message
            // would land in the middle of the row, on top of the name.
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
            boolean hover = mouseX >= this.getX() && mouseX < this.getX() + this.getWidth()
                    && mouseY >= this.getY() && mouseY < this.getY() + this.getHeight();
            boolean live = BestClientConfig.fullbright;

            rounded(context, this.getX(), this.getY(), this.getWidth(), this.getHeight(),
                    hover ? ROW_HOVER : ROW);

            int iconY = this.getY() + (this.getHeight() - 11) / 2;
            Icons.CONTRAST.draw(context, this.getX() + 8, iconY, live ? ROSE : INK_FAINT);

            int textX = this.getX() + 26;
            context.drawText(BestClientScreen.this.textRenderer, Text.literal("Brightness"),
                    textX, this.getY() + 6, live ? INK : INK_DIM, false);
            context.drawText(BestClientScreen.this.textRenderer,
                    Text.literal(live ? "How far fullbright pushes the light" : "Turn Fullbright on to use this"),
                    textX, this.getY() + 17, INK_FAINT, false);

            int right = this.getX() + this.getWidth() - PADDING;
            String readout = String.format("%.1f", toStrength());
            int readoutWidth = BestClientScreen.this.textRenderer.getWidth(readout);

            context.drawText(BestClientScreen.this.textRenderer, Text.literal(readout),
                    right - readoutWidth, this.getY() + 11, live ? ROSE_SOFT : INK_FAINT, false);

            int trackRight = right - readoutWidth - 6;
            int trackLeft = trackRight - TRACK_WIDTH;
            int trackY = this.getY() + this.getHeight() / 2 - 1;

            context.fill(trackLeft, trackY, trackRight, trackY + 2, OFF);

            int filled = trackLeft + (int) Math.round(this.value * TRACK_WIDTH);
            context.fill(trackLeft, trackY, filled, trackY + 2, live ? ROSE : INK_FAINT);

            int knob = Math.min(trackRight - 4, Math.max(trackLeft, filled - 2));
            context.fill(knob, trackY - 3, knob + 4, trackY + 5, live ? ROSE_SOFT : INK_DIM);
        }
    }

    /** Closes the menu. Solid pink, the one filled control on the card. */
    private class DoneButton extends PressableWidget {

        DoneButton(int x, int y, int width, int height) {
            super(x, y, width, height, Text.literal("Done"));
        }

        @Override
        public void onPress() {
            BestClientScreen.this.close();
        }

        @Override
        protected void renderWidget(DrawContext context, int mouseX, int mouseY, float delta) {
            boolean hover = mouseX >= this.getX() && mouseX < this.getX() + this.getWidth()
                    && mouseY >= this.getY() && mouseY < this.getY() + this.getHeight();

            rounded(context, this.getX(), this.getY(), this.getWidth(), this.getHeight(),
                    hover ? ROSE : 0xFFD94A9C);

            int textWidth = BestClientScreen.this.textRenderer.getWidth(this.getMessage());
            context.drawText(BestClientScreen.this.textRenderer, this.getMessage(),
                    this.getX() + (this.getWidth() - textWidth) / 2,
                    this.getY() + (this.getHeight() - 8) / 2, 0xFF0D0913, false);
        }

        @Override
        protected void appendClickableNarrations(NarrationMessageBuilder builder) {
            this.appendDefaultNarrations(builder);
        }
    }
}
