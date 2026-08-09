package eu.bestpvp.bestclient.gui;

import eu.bestpvp.bestclient.BestClientConfig;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.client.gui.widget.SliderWidget;
import net.minecraft.text.Text;

/**
 * The client menu, opened with Right Shift.
 *
 * One column of controls, centred, in the game's own widget vocabulary - it has to read
 * as part of Minecraft, not as an overlay bolted on top of it. Every change is written to
 * disk immediately, so nothing is lost if the game is closed from the menu.
 */
public class BestClientScreen extends Screen {

    private static final int ROW_HEIGHT = 24;
    private static final int WIDGET_WIDTH = 200;

    public BestClientScreen() {
        super(Text.literal("BestClient"));
    }

    @Override
    protected void init() {
        int x = this.width / 2 - WIDGET_WIDTH / 2;
        int y = this.height / 4 + 8;

        this.addDrawableChild(ButtonWidget.builder(fullbrightLabel(), button -> {
            BestClientConfig.fullbright = !BestClientConfig.fullbright;
            BestClientConfig.save();
            button.setMessage(fullbrightLabel());
        }).dimensions(x, y, WIDGET_WIDTH, 20).build());

        y += ROW_HEIGHT;

        this.addDrawableChild(new BrightnessSlider(x, y, WIDGET_WIDTH, 20));

        y += ROW_HEIGHT;

        this.addDrawableChild(ButtonWidget.builder(hurtCameraLabel(), button -> {
            BestClientConfig.hurtCamera = !BestClientConfig.hurtCamera;
            BestClientConfig.save();
            button.setMessage(hurtCameraLabel());
        }).dimensions(x, y, WIDGET_WIDTH, 20).build());

        y += ROW_HEIGHT + 8;

        this.addDrawableChild(ButtonWidget.builder(Text.literal("Done"), button -> this.close())
                .dimensions(x, y, WIDGET_WIDTH, 20)
                .build());
    }

    @Override
    public void render(DrawContext context, int mouseX, int mouseY, float delta) {
        super.render(context, mouseX, mouseY, delta);

        context.drawCenteredTextWithShadow(
                this.textRenderer, this.title, this.width / 2, this.height / 4 - 16, 0xFFB8E0);
    }

    @Override
    public boolean shouldPause() {
        // Never pause: the menu has to be usable mid-fight without freezing the world.
        return false;
    }

    private static Text fullbrightLabel() {
        return Text.literal("Fullbright: " + (BestClientConfig.fullbright ? "ON" : "OFF"));
    }

    private static Text hurtCameraLabel() {
        return Text.literal("Hurt camera: " + (BestClientConfig.hurtCamera ? "ON" : "OFF"));
    }

    /** Slider over the gamma value the fullbright override answers with (1.0 - 20.0). */
    private static class BrightnessSlider extends SliderWidget {

        BrightnessSlider(int x, int y, int width, int height) {
            super(x, y, width, height, Text.empty(), toFraction(BestClientConfig.fullbrightStrength));
            this.updateMessage();
        }

        private static double toFraction(double strength) {
            return (BestClientConfig.clampStrength(strength) - 1.0D) / 19.0D;
        }

        private double toStrength() {
            return 1.0D + this.value * 19.0D;
        }

        @Override
        protected void updateMessage() {
            this.setMessage(Text.literal(String.format("Brightness: %.1f", toStrength())));
        }

        @Override
        protected void applyValue() {
            BestClientConfig.fullbrightStrength = BestClientConfig.clampStrength(toStrength());
            BestClientConfig.save();
        }
    }
}
