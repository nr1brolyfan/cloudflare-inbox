import {
  PasskeyCredentialManagementLive,
  PasskeyCredentialStore,
  PasskeyOptionsLive,
  PasskeyVerificationLive,
} from "@effect-auth/core/Passkey";
import { SimpleWebAuthnPasskeyVerifierLive } from "@effect-auth/core/PasskeySimpleWebAuthn";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

/** Passkey domain services with the D1 credential store visible to every layer. */
export const PasskeyEffectAuthLayer = Layer.unwrap(
  Effect.gen(function* () {
    const credentialStore = yield* PasskeyCredentialStore;
    const credentialStoreLayer = Layer.succeed(
      PasskeyCredentialStore,
      PasskeyCredentialStore.of(credentialStore)
    );
    const verifierLayer = SimpleWebAuthnPasskeyVerifierLive;

    return Layer.mergeAll(
      PasskeyCredentialManagementLive.pipe(Layer.provide(credentialStoreLayer)),
      PasskeyOptionsLive.pipe(Layer.provide(credentialStoreLayer)),
      PasskeyVerificationLive().pipe(
        Layer.provide(credentialStoreLayer),
        Layer.provide(verifierLayer)
      ),
      verifierLayer
    );
  })
);
