import * as Config from "effect/Config";
import type * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import {
  AuthRuntimeConfig,
  AuthRuntimeConfigSchema,
} from "#/modules/account-security/adapters/cloudflare/AuthRuntimeConfigCloudflare";
import type { AuthRuntimeConfigShape } from "#/modules/account-security/adapters/cloudflare/AuthRuntimeConfigCloudflare";

export const authRuntimeEnvironmentConfig = Config.all({
  challengeSecret: Config.redacted("AUTH_CHALLENGE_SECRET"),
  emailFrom: Config.string("AUTH_EMAIL_FROM"),
  otlpExporterOtlpEndpoint: Config.option(
    Config.string("OTEL_EXPORTER_OTLP_ENDPOINT")
  ),
  privacySecret: Config.redacted("AUTH_PRIVACY_SECRET"),
  publicOrigin: Config.string("PUBLIC_ORIGIN"),
  sessionSecret: Config.redacted("AUTH_SESSION_SECRET"),
});

export type AuthRuntimeEnvironmentConfig = Config.Success<
  typeof authRuntimeEnvironmentConfig
>;

export interface AuthRuntimeHandles {
  readonly delivery: AuthRuntimeConfigShape["delivery"];
  readonly rateLimitNamespace: AuthRuntimeConfigShape["rateLimitNamespace"];
}

export const makeAuthRuntimeConfig = (
  environment: AuthRuntimeEnvironmentConfig,
  handles: AuthRuntimeHandles
): Effect.Effect<AuthRuntimeConfigShape, Schema.SchemaError> =>
  Schema.decodeUnknownEffect(AuthRuntimeConfigSchema)({
    delivery: handles.delivery,
    emailFrom: environment.emailFrom,
    publicOrigin: environment.publicOrigin,
    rateLimitNamespace: handles.rateLimitNamespace,
    secrets: {
      challenge: environment.challengeSecret,
      privacy: environment.privacySecret,
      session: environment.sessionSecret,
    },
  });

export const authRuntimeConfigLayer = (config: AuthRuntimeConfigShape) =>
  Layer.succeed(AuthRuntimeConfig, AuthRuntimeConfig.of(config));
