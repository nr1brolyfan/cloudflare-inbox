import { supportedModernPasskeyAlgorithmIds } from "@effect-auth/core/PasskeyConfiguration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { AuthRuntimeConfig } from "#/modules/account-security/adapters/cloudflare/AuthRuntimeConfigCloudflare";
import {
  PasskeyRuntimeConfig,
  PasskeyRuntimeConfigSchema,
} from "#/modules/account-security/ports/PasskeyRuntimeConfig";

export const PasskeyRuntimeConfigEffectAuthLayer = Layer.effect(
  PasskeyRuntimeConfig,
  Effect.gen(function* () {
    const auth = yield* AuthRuntimeConfig;
    return yield* Schema.decodeUnknownEffect(PasskeyRuntimeConfigSchema)({
      attestation: "none",
      authenticatorSelection: {
        requireResidentKey: true,
        residentKey: "required",
        userVerification: "required",
      },
      expectedOrigins: [auth.publicOrigin.origin],
      pubKeyCredParams: supportedModernPasskeyAlgorithmIds.map((alg) => ({
        alg,
        type: "public-key",
      })),
      relyingParty: {
        id: auth.publicOrigin.hostname,
        name: "Cloudflare Inbox",
      },
      requireUserVerification: true,
      userVerification: "required",
    }).pipe(Effect.orDie);
  })
);
