package eu.bestpvp.bestclient.mixin;

import eu.bestpvp.bestclient.BestClientConfig;
import eu.bestpvp.bestclient.Fullbright;
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
 * recalculated, no chunk is rebuilt.
 *
 * This runs for every option the game reads, so the order of the tests matters: switched
 * off, the whole injection is one static boolean load. Switched on, it is a comparison
 * against a reference resolved once and cached in {@link Fullbright} - never a lookup
 * through MinecraftClient on the hot path.
 */
@Mixin(SimpleOption.class)
public class SimpleOptionMixin {

    @Inject(method = "getValue", at = @At("HEAD"), cancellable = true)
    private void bestclient$fullbright(CallbackInfoReturnable<Object> info) {
        if (!BestClientConfig.fullbright) {
            return;
        }

        if (this == Fullbright.gammaOption()) {
            info.setReturnValue(BestClientConfig.clampStrength(BestClientConfig.fullbrightStrength));
        }
    }
}
