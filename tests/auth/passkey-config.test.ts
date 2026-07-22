import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  PasskeyRelyingPartyId,
  PasskeyRuntimeConfig,
  PasskeyRuntimeConfigLive,
} from "#/auth/passkey-config";
import {
  AuthRuntimeConfig,
  AuthRuntimeConfigSchema,
} from "#/auth/runtime-config";

const authConfig = Schema.decodeUnknownSync(AuthRuntimeConfigSchema)({
  delivery: { _tag: "development" },
  emailFrom: "auth@example.test",
  publicOrigin: "http://localhost:3000/path-is-normalized",
  rateLimitNamespace: {},
  secrets: {
    challenge: Redacted.make("challenge"),
    privacy: Redacted.make("privacy"),
    session: Redacted.make("session"),
  },
});

describe("passkey runtime config", () => {
  it("derives an exact origin and hostname-only RP ID", async () => {
    const config = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* PasskeyRuntimeConfig;
      }).pipe(
        Effect.provide(PasskeyRuntimeConfigLive),
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
      expectedOrigin: "http://localhost:3000",
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
