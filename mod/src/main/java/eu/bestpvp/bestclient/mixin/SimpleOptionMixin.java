package eu.bestpvp.bestclient.mixin;

import eu.bestpvp.bestclient.BestClientConfig;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.option.SimpleOption;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/**
 * Fullbright, done the cheap way.
 *
 * The obvious implementations are expensive: a night-vision effect re-runs the status
 * effect pipeline every tick, and rewriting block light forces a full chunk relight and
 * fights Sodium for the lightmap. This instead answers the gamma option with a high value
 * when the game asks for it, which happens once per lightmap update. Nothing is
 * recalculated, no chunk is rebuilt, and the cost is one reference comparison.
 *
 * Only the gamma option is affected - every other SimpleOption falls straight through.
 */
@Mixin(SimpleOption.class)
public class SimpleOptionMixin {

    @Inject(method = "getValue", at = @At("HEAD"), cancellable = true)
    private void bestclient$fullbright(CallbackInfoReturnable<Object> info) {
        if (!BestClientConfig.fullbright) {
            return;
        }

        MinecraftClient client = MinecraftClient.getInstance();

        // Mixins can run before the client exists (option construction during startup).
        if (client == null || client.options == null) {
            return;
        }

        if ((Object) this == client.options.getGamma()) {
            info.setReturnValue(BestClientConfig.clampStrength(BestClientConfig.fullbrightStrength));
        }
    }
}
