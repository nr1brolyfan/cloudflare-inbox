import * as Context from "effect/Context";
import * as Schema from "effect/Schema";

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
  expectedOrigins: Schema.Array(PasskeyExpectedOrigin).pipe(
    Schema.check(
      Schema.makeFilter((origins) =>
        origins.length === 1
          ? undefined
          : "must contain exactly one production origin"
      )
    )
  ),
  pubKeyCredParams: Schema.Array(
    Schema.Struct({
      alg: Schema.Literals([-8, -7, -36, -37, -38, -39, -257, -258, -259]),
      type: Schema.Literal("public-key"),
    })
  ),
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

/** Trusted WebAuthn policy supplied by the runtime adapter. */
export class PasskeyRuntimeConfig extends Context.Service<
  PasskeyRuntimeConfig,
  PasskeyRuntimeConfigShape
>()("cloudflare-inbox/PasskeyRuntimeConfig") {}
