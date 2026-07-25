import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as Cause from "effect/Cause";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { describe, expect, it } from "vitest";

import {
  MailboxArchiveConfigError,
  parseMailboxArchiveConfig,
} from "#/modules/mailbox/contracts/MailboxArchiveConfig";
import { mailDomainConfigPreflight } from "#/modules/organization/application/MailDomainConfigPreflight";
import {
  MailboxBootstrapConfigError,
  mailboxBootstrapConfig,
  parseMailboxBootstrapConfig,
} from "#/modules/organization/contracts/MailboxBootstrapConfig";

const root = fileURLToPath(new URL("../..", import.meta.url));
const script = path.join(root, "scripts/check-mail-domain-config.ts");

const runPreflight = (input?: {
  readonly allowlist?: string;
  readonly archiveRecipient?: string;
  readonly envFile?: boolean;
  readonly initialAddress?: string;
}) => {
  const workingDirectory = mkdtempSync(
    path.join(tmpdir(), "mail-domain-config-")
  );
  try {
    const env = {
      HOME: process.env.HOME,
      MAILBOX_BOOTSTRAP_OWNER_EMAIL_ALLOWLIST: input?.envFile
        ? undefined
        : input?.allowlist,
      MAILBOX_INITIAL_ADDRESS: input?.envFile
        ? undefined
        : input?.initialAddress,
      MAILBOX_ARCHIVE_RECIPIENT: input?.envFile
        ? undefined
        : input?.archiveRecipient,
      PATH: process.env.PATH,
    };
    const args = [script];
    if (input?.envFile) {
      const envFile = path.join(workingDirectory, "bootstrap.env");
      writeFileSync(
        envFile,
        `MAILBOX_BOOTSTRAP_OWNER_EMAIL_ALLOWLIST=${input.allowlist ?? ""}\nMAILBOX_INITIAL_ADDRESS=${input.initialAddress ?? ""}\nMAILBOX_ARCHIVE_RECIPIENT=${input.archiveRecipient ?? ""}\n`
      );
      args.unshift(`--env-file=${envFile}`);
    }
    return spawnSync("bun", args, {
      cwd: workingDirectory,
      encoding: "utf-8",
      env,
    });
  } finally {
    rmSync(workingDirectory, { recursive: true });
  }
};

describe("mailbox bootstrap configuration preflight", () => {
  it("parses a bounded canonical allowlist and distinct initial address", () => {
    const config = Effect.runSync(
      parseMailboxBootstrapConfig(
        '["owner@example.com","admin@example.com"]',
        "inbox@example.com"
      )
    );
    expect(config).toMatchObject({
      initialAddress: "inbox@example.com",
      ownerEmailAllowlist: ["owner@example.com", "admin@example.com"],
    });
  });

  it.each([
    [undefined, "inbox@example.com", "missing"],
    ["[]", "inbox@example.com", "invalid-owner-allowlist"],
    ["not-json", "inbox@example.com", "invalid-owner-allowlist"],
    [
      '["owner@example.com","owner@example.com"]',
      "inbox@example.com",
      "invalid-owner-allowlist",
    ],
    ['["owner@EXAMPLE.COM"]', "inbox@example.com", "invalid-owner-allowlist"],
    ['["owner@example.123"]', "inbox@example.com", "invalid-owner-allowlist"],
    ['["owner@example.com"]', "inbox@EXAMPLE.COM", "invalid-initial-address"],
    ['["owner@example.com"]', "inbox@example.123", "invalid-initial-address"],
  ] as const)(
    "rejects invalid split config %# without exposing values",
    (allowlist, initialAddress, reason) => {
      const error = Effect.runSync(
        Effect.flip(parseMailboxBootstrapConfig(allowlist, initialAddress))
      );
      expect(error).toBeInstanceOf(MailboxBootstrapConfigError);
      expect(error).toMatchObject({ reason });
      expect(JSON.stringify(error)).not.toContain(initialAddress);
      expect(JSON.stringify(error)).not.toContain(allowlist);
    }
  );

  it("reports only bounded profile metadata on success", () => {
    const allowlist = '["Sensitive.Owner@example.com"]';
    const initialAddress = "private-inbox@example.com";
    const archiveRecipient = "Private.Archive@example.net";
    const result = runPreflight({
      allowlist,
      archiveRecipient,
      initialAddress,
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe(
      "mail-domain-config ok profile=mail-domain/ascii-alabel-input/uts46-nontransitional-std3/unicode-17/v1 version=1"
    );
    expect(
      [allowlist, initialAddress, archiveRecipient].every(
        (value) => !`${result.stdout}${result.stderr}`.includes(value)
      )
    ).toBeTruthy();
  });

  it.each([
    [undefined, "missing"],
    ["archive@EXAMPLE.NET", "invalid-recipient"],
    ["archive@example.123", "invalid-recipient"],
    ["archive@example.com", "managed-domain"],
  ] as const)(
    "rejects invalid private archive config %# without retaining its value",
    (recipient, reason) => {
      const bootstrap = Effect.runSync(
        parseMailboxBootstrapConfig(
          '["owner@example.com"]',
          "inbox@example.com"
        )
      );
      const error = Effect.runSync(
        Effect.flip(
          parseMailboxArchiveConfig(recipient, bootstrap.initialDomain)
        )
      );
      expect(error).toBeInstanceOf(MailboxArchiveConfigError);
      expect(error).toMatchObject({ reason });
      expect(JSON.stringify(error)).not.toContain(recipient);
    }
  );

  it("rejects oversized allowlists and provides no old-name fallback", () => {
    const oversized = JSON.stringify(
      Array.from({ length: 33 }, (_, index) => `owner-${index}@example.com`)
    );
    expect(
      Effect.runSync(
        Effect.flip(parseMailboxBootstrapConfig(oversized, "inbox@example.com"))
      )
    ).toMatchObject({ reason: "invalid-owner-allowlist" });

    const oldNameOnly = Effect.runSyncExit(
      mailboxBootstrapConfig.pipe(
        Effect.provide(
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({
              MAILBOX_INITIAL_ADDRESS: "inbox@example.com",
              MAILBOX_OWNER_EMAIL: "owner@example.com",
            })
          )
        )
      )
    );
    expect(Exit.isFailure(oldNameOnly)).toBeTruthy();
  });

  it("loads the same contract through Bun --env-file", () => {
    const result = runPreflight({
      allowlist: '["owner@example.com"]',
      archiveRecipient: "archive@example.net",
      envFile: true,
      initialAddress: "inbox@example.com",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("mail-domain-config ok");
  });

  it("uses provider precedence and sanitizes config defects", () => {
    const primary = ConfigProvider.fromUnknown({
      MAILBOX_BOOTSTRAP_OWNER_EMAIL_ALLOWLIST: '["owner@example.com"]',
      MAILBOX_INITIAL_ADDRESS: "inbox@example.com",
    });
    const fallback = ConfigProvider.fromUnknown({
      MAILBOX_BOOTSTRAP_OWNER_EMAIL_ALLOWLIST: '["fallback@example.com"]',
      MAILBOX_INITIAL_ADDRESS: "fallback@example.123",
    });
    const success = Effect.runSyncExit(
      mailboxBootstrapConfig.pipe(
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
            ConfigProvider.fromUnknown({
              MAILBOX_BOOTSTRAP_OWNER_EMAIL_ALLOWLIST: `["${secret}"]`,
              MAILBOX_INITIAL_ADDRESS: "inbox@example.com",
              MAILBOX_ARCHIVE_RECIPIENT: "archive@example.net",
            })
          )
        )
      )
    );
    expect(Exit.isFailure(failure)).toBeTruthy();
    const rendered = Exit.isFailure(failure) ? Cause.pretty(failure.cause) : "";
    expect(rendered).not.toContain(secret);
    expect(rendered).not.toContain("example.123");
  });

  it("validates the documented example and preflights before resources", () => {
    const source = readFileSync(path.join(root, ".env.example"), "utf-8");
    const values = Object.fromEntries(
      source
        .split(/\r?\n/u)
        .filter((line) => line.includes("=") && !line.startsWith("#"))
        .map((line) => {
          const separator = line.indexOf("=");
          return [line.slice(0, separator), line.slice(separator + 1)];
        })
    );
    expect(
      Exit.isSuccess(
        Effect.runSyncExit(
          parseMailboxBootstrapConfig(
            values.MAILBOX_BOOTSTRAP_OWNER_EMAIL_ALLOWLIST,
            values.MAILBOX_INITIAL_ADDRESS
          )
        )
      )
    ).toBeTruthy();
    expect(
      Exit.isSuccess(
        Effect.runSyncExit(
          parseMailboxArchiveConfig(
            values.MAILBOX_ARCHIVE_RECIPIENT,
            Effect.runSync(
              parseMailboxBootstrapConfig(
                values.MAILBOX_BOOTSTRAP_OWNER_EMAIL_ALLOWLIST,
                values.MAILBOX_INITIAL_ADDRESS
              )
            ).initialDomain
          )
        )
      )
    ).toBeTruthy();

    const alchemy = readFileSync(path.join(root, "alchemy.run.ts"), "utf-8");
    const preflight = alchemy.indexOf("yield* mailDomainConfigPreflight");
    expect(preflight).toBeGreaterThan(-1);
    expect(preflight).toBeLessThan(alchemy.indexOf("yield* Backend"));
    expect(preflight).toBeLessThan(alchemy.indexOf("yield* Website"));
  });
});
