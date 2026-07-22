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
export const PasskeyServicesLive = Layer.unwrap(
  Effect.gen(function* () {
    const credentialStore = yield* PasskeyCredentialStore;
    const credentialStoreLive = Layer.succeed(
      PasskeyCredentialStore,
      PasskeyCredentialStore.of(credentialStore)
    );
    const verifierLive = SimpleWebAuthnPasskeyVerifierLive;

    return Layer.mergeAll(
      PasskeyCredentialManagementLive.pipe(Layer.provide(credentialStoreLive)),
      PasskeyOptionsLive.pipe(Layer.provide(credentialStoreLive)),
      PasskeyVerificationLive().pipe(
        Layer.provide(credentialStoreLive),
        Layer.provide(verifierLive)
      ),
      verifierLive
    );
  })
);
