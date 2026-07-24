import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as Cause from "effect/Cause";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { describe, expect, it } from "vitest";

import {
  MailDomainConfigError,
  checkMailDomainConfig,
  mailDomainConfigPreflight,
} from "#/modules/organization/application/MailDomainConfigPreflight";

const root = fileURLToPath(new URL("../..", import.meta.url));
const script = path.join(root, "scripts/check-mail-domain-config.ts");

const runPreflight = (ownerEmail?: string) => {
  const workingDirectory = mkdtempSync(
    path.join(tmpdir(), "mail-domain-config-")
  );
  try {
    return spawnSync("bun", [script], {
      cwd: workingDirectory,
      encoding: "utf-8",
      env: {
        HOME: process.env.HOME,
        MAILBOX_OWNER_EMAIL: ownerEmail,
        PATH: process.env.PATH,
      },
    });
  } finally {
    rmSync(workingDirectory, { recursive: true });
  }
};

describe("mail domain configuration preflight", () => {
  it("returns a typed failure for missing and invalid configuration", () => {
    for (const configured of [
      undefined,
      "",
      "not-an-email",
      "owner@localhost",
    ]) {
      const exit = Effect.runSyncExit(checkMailDomainConfig(configured));
      expect(Exit.isFailure(exit)).toBeTruthy();
    }
    const error = Effect.runSync(
      Effect.flip(checkMailDomainConfig("owner@example.123"))
    );
    expect(error).toBeInstanceOf(MailDomainConfigError);
    expect(error).toMatchObject({ reason: "invalid-domain" });
  });

  it("reports only bounded profile metadata on success", () => {
    const secretEmail = "Sensitive.Owner@EXAMPLE.COM";
    const result = runPreflight(secretEmail);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe(
      "mail-domain-config ok profile=mail-domain/ascii-alabel-input/uts46-nontransitional-std3/unicode-17/v1 version=1"
    );
    expect(`${result.stdout}${result.stderr}`).not.toContain(secretEmail);
    expect(`${result.stdout}${result.stderr}`).not.toContain("example.com");
  });

  it("fails without leaking missing or invalid configured values", () => {
    for (const configured of [undefined, "Private.Owner@example.123"]) {
      const result = runPreflight(configured);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr.trim()).toBe("mail-domain-config failed");
      expect(result.stderr).not.toContain(configured ?? "MAILBOX_OWNER_EMAIL");
      expect(result.stderr).not.toContain("example.123");
    }
  });

  it("keeps the deploy gate separate from generic checks", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(root, "package.json"), "utf-8")
    ) as { readonly scripts: Readonly<Record<string, string>> };
    expect(packageJson.scripts["check:mail-domain-config"]).toBe(
      "bun scripts/check-mail-domain-config.ts"
    );
    expect(packageJson.scripts.deploy).toBe("alchemy deploy");
    expect(packageJson.scripts.check).not.toContain("mail-domain-config");
    expect(packageJson.scripts.dev).toBe("ALCHEMY_STATE=local alchemy dev");
  });

  it("validates the documented example through the same preflight", () => {
    const source = readFileSync(path.join(root, ".env.example"), "utf-8");
    const ownerLine = source
      .split(/\r?\n/u)
      .find((line) => line.startsWith("MAILBOX_OWNER_EMAIL="));
    expect(ownerLine).toBeDefined();
    const configured = ownerLine?.slice("MAILBOX_OWNER_EMAIL=".length);
    const exit = Effect.runSyncExit(checkMailDomainConfig(configured));
    expect(Exit.isSuccess(exit)).toBeTruthy();
  });

  it("uses the Alchemy ConfigProvider precedence and sanitizes defects", () => {
    const primary = ConfigProvider.fromUnknown({
      MAILBOX_OWNER_EMAIL: "Primary.Owner@EXAMPLE.COM",
    });
    const fallback = ConfigProvider.fromUnknown({
      MAILBOX_OWNER_EMAIL: "Fallback.Owner@example.123",
    });
    const success = Effect.runSyncExit(
      mailDomainConfigPreflight.pipe(
        Effect.provide(
          ConfigProvider.layer(ConfigProvider.orElse(primary, fallback))
        )
      )
    );
    expect(Exit.isSuccess(success)).toBeTruthy();

    const secret = "Private.Owner@example.123";
    const failure = Effect.runSyncExit(
      mailDomainConfigPreflight.pipe(
        Effect.provide(
          ConfigProvider.layer(
            ConfigProvider.orElse(
              ConfigProvider.fromUnknown({ MAILBOX_OWNER_EMAIL: secret }),
              ConfigProvider.fromUnknown({
                MAILBOX_OWNER_EMAIL: "Fallback.Owner@example.com",
              })
            )
          )
        )
      )
    );
    expect(Exit.isFailure(failure)).toBeTruthy();
    const rendered = Exit.isFailure(failure) ? Cause.pretty(failure.cause) : "";
    expect(rendered).not.toContain(secret);
    expect(rendered).not.toContain("example.123");
  });

  it("runs the preflight before either Alchemy resource effect", () => {
    const source = readFileSync(path.join(root, "alchemy.run.ts"), "utf-8");
    const preflight = source.indexOf("yield* mailDomainConfigPreflight");
    const backend = source.indexOf("yield* Backend");
    const website = source.indexOf("yield* Website");
    expect(preflight).toBeGreaterThan(-1);
    expect(preflight).toBeLessThan(backend);
    expect(preflight).toBeLessThan(website);
  });
});
