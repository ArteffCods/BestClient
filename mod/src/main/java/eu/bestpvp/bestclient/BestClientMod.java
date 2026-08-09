package eu.bestpvp.bestclient;

import eu.bestpvp.bestclient.gui.BestClientScreen;
import eu.bestpvp.bestclient.hud.BestClientHud;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.util.InputUtil;
import net.minecraft.util.Identifier;
import org.lwjgl.glfw.GLFW;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * BestClient's in-game half.
 *
 * It ships with the launcher rather than from Modrinth and cannot be switched off, so it
 * stays deliberately small: one key binding, one screen, and two rendering tweaks that
 * cost nothing per frame.
 */
public class BestClientMod implements ClientModInitializer {

    public static final String MOD_ID = "bestclient";
    public static final Logger LOGGER = LoggerFactory.getLogger("BestClient");

    private static KeyBinding menuKey;

    @Override
    public void onInitializeClient() {
        BestClientConfig.load();

        menuKey = KeyBindingHelper.registerKeyBinding(new KeyBinding(
                "key.bestclient.menu",
                InputUtil.Type.KEYSYM,
                GLFW.GLFW_KEY_RIGHT_SHIFT,
                KeyBinding.Category.create(Identifier.of("bestclient", "menu"))));

        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            // wasPressed() drains the queue, so a key held down opens the screen once.
            while (menuKey.wasPressed()) {
                if (client.currentScreen == null) {
                    client.setScreen(new BestClientScreen());
                }
            }
        });

        BestClientHud.register();

        LOGGER.info("BestClient ready - press Right Shift for the client menu.");
    }
}
