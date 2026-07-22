import type { AlchemyRateLimitDurableObjectNamespace } from "@effect-auth/core/AlchemyCloudflareRateLimitDurableObject";
import type { AuthSecretsShape } from "@effect-auth/core/AuthConfig";
import { EmailSchema } from "@effect-auth/core/Identifiers";
import type * as Cloudflare from "alchemy/Cloudflare";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";

export type AuthEmailSendClient = Effect.Success<
  ReturnType<typeof Cloudflare.Email.Send>
>;

const PublicOriginSchema = Schema.URLFromString.pipe(
  Schema.refine(
    (url): url is URL => url.protocol === "https:" || url.protocol === "http:",
    { message: "Public origin must be an absolute HTTP(S) URL" }
  ),
  Schema.decode({
    decode: SchemaGetter.transform((url) => new URL(url.origin)),
    encode: SchemaGetter.transform((url) => new URL(url.origin)),
  })
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
  (value): value is AuthSecretsShape =>
    typeof value === "object" &&
    value !== null &&
    "challenge" in value &&
    "privacy" in value &&
    "session" in value
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
export const AuthRuntimeConfig = Context.Service<AuthRuntimeConfigShape>(
  "cloudflare-inbox/AuthRuntimeConfig"
);
