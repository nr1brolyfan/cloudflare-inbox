import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  AuthRuntimeConfig,
  AuthRuntimeConfigSchema,
} from "#/modules/account-security/adapters/cloudflare/AuthRuntimeConfigCloudflare";
import { PasskeyRuntimeConfigEffectAuthLayer } from "#/modules/account-security/adapters/effect-auth/PasskeyConfigEffectAuth";
import {
  PasskeyRelyingPartyId,
  PasskeyRuntimeConfig,
} from "#/modules/account-security/ports/PasskeyRuntimeConfig";

const authConfig = Schema.decodeUnknownSync(AuthRuntimeConfigSchema)({
  delivery: { _tag: "development" },
  emailFrom: "auth@example.test",
  publicOrigin: "http://localhost:3000",
  rateLimitNamespace: {},
  secrets: {
    challenge: Redacted.make("BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBA"),
    privacy: Redacted.make("CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCA"),
    session: Redacted.make("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
  },
});

describe("passkey runtime config", () => {
  it("derives an exact origin and hostname-only RP ID", async () => {
    const config = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* PasskeyRuntimeConfig;
      }).pipe(
        Effect.provide(PasskeyRuntimeConfigEffectAuthLayer),
        Effect.provide(
          Layer.succeed(AuthRuntimeConfig, AuthRuntimeConfig.of(authConfig))
        )
      )
    );

    expect(config).toMatchObject({
      attestation: "none",
      authenticatorSelection: {
        requireResidentKey: true,
        residentKey: "required",
        userVerification: "required",
      },
      expectedOrigins: ["http://localhost:3000"],
      relyingParty: {
        id: "localhost",
        name: "Cloudflare Inbox",
      },
      requireUserVerification: true,
      userVerification: "required",
    });
  });

  it("rejects IP addresses as relying-party IDs", () => {
    expect(() =>
      Schema.decodeUnknownSync(PasskeyRelyingPartyId)("127.0.0.1")
    ).toThrow(/DNS relying-party hostname/u);
    expect(() =>
      Schema.decodeUnknownSync(PasskeyRelyingPartyId)("[::1]")
    ).toThrow(/DNS relying-party hostname/u);
  });
});
