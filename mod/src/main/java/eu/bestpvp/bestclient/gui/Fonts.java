package eu.bestpvp.bestclient.gui;

import net.minecraft.text.MutableText;
import net.minecraft.text.Style;
import net.minecraft.text.Text;
import net.minecraft.util.Identifier;

/**
 * The client's own typeface.
 *
 * Minecraft's pixel alphabet is the single thing that gives a mod menu away as a mod menu,
 * so the interface is set in Montserrat - the same face the launcher uses - loaded through
 * the game's TrueType provider at four-times oversampling, which is what keeps it sharp at
 * every GUI scale.
 *
 * The font definition lists the vanilla glyphs first and Montserrat second, so anything
 * Montserrat does not carry still draws, and a font that fails to load leaves a readable
 * menu rather than a row of missing-glyph boxes.
 */
public final class Fonts {

    private static final Style UI = Style.EMPTY.withFont(Identifier.of("bestclient", "ui"));

    private Fonts() {
    }

    public static MutableText of(String value) {
        return Text.literal(value).setStyle(UI);
    }
}
