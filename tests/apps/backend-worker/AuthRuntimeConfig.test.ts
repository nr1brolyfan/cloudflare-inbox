import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import { describe, expect, it } from "vitest";

import {
  authRuntimeConfigLayer,
  authRuntimeEnvironmentConfig,
  makeAuthRuntimeConfig,
} from "#/apps/backend-worker/AuthRuntimeConfig";
import { AuthRuntimeConfig } from "#/modules/account-security/adapters/cloudflare/AuthRuntimeConfigCloudflare";

const environment = {
  AUTH_CHALLENGE_SECRET: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBA",
  AUTH_EMAIL_FROM: "auth@example.com",
  AUTH_PRIVACY_SECRET: "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCA",
  AUTH_SESSION_SECRET: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
  PUBLIC_ORIGIN: "https://example.com",
};

const rateLimitNamespace = {
  getByName: () => {
    throw new Error("not used");
  },
};

const loadEnvironment = authRuntimeEnvironmentConfig.pipe(
  Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(environment)))
);

describe("Backend auth runtime config", () => {
  it("loads environment values together and keeps secrets redacted", async () => {
    const loaded = await Effect.runPromise(loadEnvironment);

    expect(loaded.emailFrom).toBe(environment.AUTH_EMAIL_FROM);
    expect(loaded.publicOrigin).toBe(environment.PUBLIC_ORIGIN);
    expect(Option.getOrUndefined(loaded.otlpExporterOtlpEndpoint)).toBe(
      environment.OTEL_EXPORTER_OTLP_ENDPOINT
    );
    expect(Redacted.value(loaded.challengeSecret)).toBe(
      environment.AUTH_CHALLENGE_SECRET
    );
    expect(String(loaded.challengeSecret)).not.toContain(
      environment.AUTH_CHALLENGE_SECRET
    );
  });

  it("validates environment values with runtime handles and builds the service layer", async () => {
    const loaded = await Effect.runPromise(loadEnvironment);
    const config = await Effect.runPromise(
      makeAuthRuntimeConfig(loaded, {
        delivery: { _tag: "development" },
        rateLimitNamespace,
      })
    );
    const service = await Effect.runPromise(
      AuthRuntimeConfig.pipe(Effect.provide(authRuntimeConfigLayer(config)))
    );

    expect(config.publicOrigin).toStrictEqual(new URL("https://example.com"));
    expect(service).toBe(config);
  });

  it("leaves schema validation failures in the Effect error channel", async () => {
    const loaded = await Effect.runPromise(loadEnvironment);
    const result = await Effect.runPromise(
      makeAuthRuntimeConfig(
        { ...loaded, publicOrigin: "https://example.com/auth" },
        {
          delivery: { _tag: "development" },
          rateLimitNamespace,
        }
      ).pipe(Effect.exit)
    );

    expect(Exit.isFailure(result)).toBeTruthy();
  });
});
