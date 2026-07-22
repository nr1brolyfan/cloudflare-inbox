import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { AuthRuntimeConfig } from "./runtime-config";

export const PasskeyRelyingPartyId = Schema.Trimmed.pipe(
  Schema.check(
    Schema.makeFilter<string>((value) => {
      const dnsName =
        /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
      const ipv4 = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/u;
      return value.length <= 253 && dnsName.test(value) && !ipv4.test(value)
        ? undefined
        : "must be a DNS relying-party hostname or localhost";
    })
  ),
  Schema.brand("cloudflare-inbox/PasskeyRelyingPartyId")
);
export type PasskeyRelyingPartyId = Schema.Schema.Type<
  typeof PasskeyRelyingPartyId
>;

export const PasskeyExpectedOrigin = Schema.Trimmed.pipe(
  Schema.check(
    Schema.makeFilter<string>((value) => {
      try {
        const url = new URL(value);
        return (url.protocol === "https:" || url.protocol === "http:") &&
          url.origin === value
          ? undefined
          : "must be an exact HTTP(S) origin without a path";
      } catch {
        return "must be an absolute HTTP(S) origin";
      }
    })
  ),
  Schema.brand("cloudflare-inbox/PasskeyExpectedOrigin")
);
export type PasskeyExpectedOrigin = Schema.Schema.Type<
  typeof PasskeyExpectedOrigin
>;

export const PasskeyRuntimeConfigSchema = Schema.Struct({
  attestation: Schema.Literal("none"),
  authenticatorSelection: Schema.Struct({
    requireResidentKey: Schema.Literal(true),
    residentKey: Schema.Literal("required"),
    userVerification: Schema.Literal("required"),
  }),
  expectedOrigin: PasskeyExpectedOrigin,
  relyingParty: Schema.Struct({
    id: PasskeyRelyingPartyId,
    name: Schema.Literal("Cloudflare Inbox"),
  }),
  requireUserVerification: Schema.Literal(true),
  userVerification: Schema.Literal("required"),
});
export type PasskeyRuntimeConfigShape = Schema.Schema.Type<
  typeof PasskeyRuntimeConfigSchema
>;

/** Trusted WebAuthn policy derived only from validated deployment config. */
export const PasskeyRuntimeConfig = Context.Service<PasskeyRuntimeConfigShape>(
  "cloudflare-inbox/PasskeyRuntimeConfig"
);

export const PasskeyRuntimeConfigLive = Layer.effect(
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
      expectedOrigin: auth.publicOrigin.origin,
      relyingParty: {
        id: auth.publicOrigin.hostname,
        name: "Cloudflare Inbox",
      },
      requireUserVerification: true,
      userVerification: "required",
    }).pipe(Effect.orDie);
  })
);
