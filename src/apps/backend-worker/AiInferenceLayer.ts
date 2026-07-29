import { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  WorkersAiClientLayer,
  WorkersAiConfigLayer,
  WorkersAiGateway,
  WorkersAiInferenceLayer,
} from "#/modules/ai/adapters/cloudflare/AiInferenceCloudflare";
import { AiInferenceUnavailableLayer } from "#/modules/ai/layers/AiInferenceLayer";
import { InboxAiGateway } from "#/platform/cloudflare/Resources";

/** Selects the unavailable local adapter or the production Workers AI gateway. */
export const backendAiInferenceLayer = (isDevelopment: boolean) =>
  Effect.gen(function* () {
    if (isDevelopment) {
      return AiInferenceUnavailableLayer;
    }

    const queryGateway = yield* Cloudflare.AI.QueryGateway(InboxAiGateway);
    const gatewayClientLayer = Layer.succeed(
      WorkersAiGateway,
      WorkersAiGateway.of({
        run: ({ input, model }) =>
          Effect.gen(function* () {
            const [ai, gatewayId] = yield* Effect.all([
              queryGateway.raw,
              queryGateway.id,
            ]).pipe(Effect.provide(RuntimeContext.phantom));

            return yield* Effect.tryPromise({
              try: () =>
                ai.run(model, input, {
                  gateway: { id: gatewayId },
                }),
              catch: (cause) => cause,
            });
          }),
      })
    );

    return WorkersAiInferenceLayer.pipe(
      Layer.provide(
        WorkersAiClientLayer.pipe(
          Layer.provide(WorkersAiConfigLayer),
          Layer.provide(gatewayClientLayer)
        )
      )
    );
  });
