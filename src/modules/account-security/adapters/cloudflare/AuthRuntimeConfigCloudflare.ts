import type { AlchemyRateLimitDurableObjectNamespace } from "@effect-auth/core/AlchemyCloudflareRateLimitDurableObject";
import type { AuthSecretsShape } from "@effect-auth/core/AuthConfig";
import { EmailSchema } from "@effect-auth/core/Identifiers";
import type * as Cloudflare from "alchemy/Cloudflare";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

export type AuthEmailSendClient = Effect.Success<
  ReturnType<typeof Cloudflare.Email.Send>
>;

const PublicOriginSchema = Schema.URLFromString.pipe(
  Schema.refine(
    (url): url is URL =>
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "" &&
      url.href === `${url.origin}/`,
    { message: "Public origin must be an exact HTTP(S) root origin" }
  )
);

const AuthEmailSendClientSchema = Schema.declare<AuthEmailSendClient>(
  (value): value is AuthEmailSendClient =>
    typeof value === "object" && value !== null && "send" in value
);

const RateLimitNamespaceSchema =
  Schema.declare<AlchemyRateLimitDurableObjectNamespace>(
    (value): value is AlchemyRateLimitDurableObjectNamespace =>
      typeof value === "object" && value !== null
  );

const AuthSecretsSchema = Schema.declare<AuthSecretsShape>(
  (value): value is AuthSecretsShape => {
    if (
      typeof value !== "object" ||
      value === null ||
      !("challenge" in value) ||
      !("privacy" in value) ||
      !("session" in value)
    ) {
      return false;
    }
    try {
      const secrets = [value.challenge, value.privacy, value.session].map(
        (secret) => Redacted.value(secret as Redacted.Redacted<string>)
      );
      return (
        secrets.every((secret) =>
          /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u.test(secret)
        ) && new Set(secrets).size === secrets.length
      );
    } catch {
      return false;
    }
  },
  { message: "Auth secrets must satisfy the runtime secret policy" }
);

export const AuthRuntimeConfigSchema = Schema.Struct({
  emailFrom: EmailSchema,
  delivery: Schema.Union([
    Schema.Struct({ _tag: Schema.Literal("development") }),
    Schema.Struct({
      _tag: Schema.Literal("production"),
      emailSender: AuthEmailSendClientSchema,
    }),
  ]),
  publicOrigin: PublicOriginSchema,
  rateLimitNamespace: RateLimitNamespaceSchema,
  secrets: AuthSecretsSchema,
}).pipe(
  Schema.check(
    Schema.makeFilter((config) =>
      config.delivery._tag === "development" ||
      config.publicOrigin.protocol === "https:"
        ? undefined
        : "Production auth requires an HTTPS public origin"
    )
  )
);

export type AuthRuntimeConfigShape = Schema.Schema.Type<
  typeof AuthRuntimeConfigSchema
>;

/** Validated deployment config and Cloudflare handles required by auth. */
export class AuthRuntimeConfig extends Context.Service<
  AuthRuntimeConfig,
  AuthRuntimeConfigShape
>()("cloudflare-inbox/AuthRuntimeConfig") {}
