package eu.bestpvp.bestclient.mixin;

import eu.bestpvp.bestclient.BestClientConfig;
import net.minecraft.client.render.GameRenderer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Hurt camera.
 *
 * Vanilla rolls the view when you take damage, which is exactly the moment aim matters
 * most. Cancelling the tilt is a single early return - the matrix work never happens.
 */
@Mixin(GameRenderer.class)
public class GameRendererMixin {

    @Inject(method = "tiltViewWhenHurt", at = @At("HEAD"), cancellable = true)
    private void bestclient$hurtCamera(CallbackInfo info) {
        if (!BestClientConfig.hurtCamera) {
            info.cancel();
        }
    }
}
