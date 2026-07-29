import type { ChallengeService } from "@effect-auth/core/Challenge";
import { Challenge } from "@effect-auth/core/Challenge";
import { WebCryptoLive } from "@effect-auth/core/Crypto";
import {
  ChallengeId,
  CredentialId,
  UnixMillis,
  UserId,
} from "@effect-auth/core/Identifiers";
import {
  PasskeyCredentialId,
  PasskeyCredentialManagement,
  PasskeyCredentialStore,
  PasskeyCredentialStoreMemoryLive,
  PasskeyOptions,
  PasskeyVerification,
} from "@effect-auth/core/Passkey";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "vitest";

import { PasskeyEffectAuthLayer } from "#/modules/account-security/adapters/effect-auth/PasskeyEffectAuth";

const userId = UserId("user-a");
const credentialId = PasskeyCredentialId("passkey-a");
const challenge: ChallengeService = {
  consume: () => Effect.die("consume is not used"),
  inspect: () => Effect.die("inspect is not used"),
  issue: (input) =>
    Effect.succeed({
      expiresAt: UnixMillis(10_000),
      id: ChallengeId("challenge-a"),
      secret: input.secret,
      subject: input.subject,
      type: input.type,
    }),
  verify: () => Effect.die("verify is not used"),
};

const TestPasskeyServicesLive = PasskeyEffectAuthLayer.pipe(
  Layer.provideMerge(PasskeyCredentialStoreMemoryLive),
  Layer.provide(Layer.succeed(Challenge, challenge)),
  Layer.provide(WebCryptoLive())
);

describe("passkey services", () => {
  it("shares the credential store with options and management", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const credentialStore = yield* PasskeyCredentialStore;
        const management = yield* PasskeyCredentialManagement;
        const options = yield* PasskeyOptions;
        yield* PasskeyVerification;
        yield* credentialStore.insert({
          backedUp: false,
          createdAt: UnixMillis(1000),
          credentialId,
          id: CredentialId("credential-a"),
          publicKey: "public-key",
          signCount: 0,
          transports: ["internal"],
          userId,
        });

        const started = yield* options.startRegistration({
          authenticatorSelection: {
            requireResidentKey: true,
            residentKey: "required",
            userVerification: "required",
          },
          attestation: "none",
          expectedOrigins: ["https://example.test"],
          pubKeyCredParams: [{ alg: -7, type: "public-key" }],
          relyingParty: { id: "example.test", name: "Cloudflare Inbox" },
          requireUserVerification: true,
          userDisplayName: "Person",
          userId,
          userName: "person@example.test",
        });
        const listed = yield* management.listForUser({ userId });
        return { listed, started };
      }).pipe(Effect.provide(TestPasskeyServicesLive))
    );

    expect(result.started.publicKey.excludeCredentials).toStrictEqual([
      {
        id: credentialId,
        transports: ["internal"],
        type: "public-key",
      },
    ]);
    expect(result.listed).toHaveLength(1);
  });
});
