import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { AuthRuntimeConfigSchema } from "#/modules/account-security/adapters/cloudflare/AuthRuntimeConfigCloudflare";

const baseConfig = {
  delivery: { _tag: "development" },
  emailFrom: "auth@example.test",
  publicOrigin: "https://inbox.test/some/deployment/path?ignored=true",
  rateLimitNamespace: {},
  secrets: {
    challenge: Redacted.make("challenge"),
    privacy: Redacted.make("privacy"),
    session: Redacted.make("session"),
  },
} as const;

describe("auth runtime config", () => {
  it("decodes an absolute origin whose origin is normalized", () => {
    const config = Schema.decodeUnknownSync(AuthRuntimeConfigSchema)(
      baseConfig
    );

    expect(config.publicOrigin.origin).toBe("https://inbox.test");
    expect(config.publicOrigin.href).toBe("https://inbox.test/");
  });

  it("rejects relative and non-HTTP public origins", () => {
    expect(() =>
      Schema.decodeUnknownSync(AuthRuntimeConfigSchema)({
        ...baseConfig,
        publicOrigin: "/relative",
      })
    ).toThrow(/.+/u);
    expect(() =>
      Schema.decodeUnknownSync(AuthRuntimeConfigSchema)({
        ...baseConfig,
        publicOrigin: "ftp://inbox.test",
      })
    ).toThrow(/.+/u);
  });

  it("requires an email sender in production delivery mode", () => {
    expect(() =>
      Schema.decodeUnknownSync(AuthRuntimeConfigSchema)({
        ...baseConfig,
        delivery: { _tag: "production" },
      })
    ).toThrow(/.+/u);
  });

  it("requires HTTPS in production but permits local HTTP development", () => {
    expect(() =>
      Schema.decodeUnknownSync(AuthRuntimeConfigSchema)({
        ...baseConfig,
        delivery: {
          _tag: "production",
          emailSender: { send: () => null },
        },
        publicOrigin: "http://inbox.test",
      })
    ).toThrow(/Production auth requires an HTTPS public origin/u);

    const development = Schema.decodeUnknownSync(AuthRuntimeConfigSchema)({
      ...baseConfig,
      publicOrigin: "http://localhost:3000",
    });
    expect(development.publicOrigin.origin).toBe("http://localhost:3000");
  });
});
