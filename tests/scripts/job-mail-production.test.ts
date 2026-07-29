/* oxlint-disable vitest/max-expects -- Structural safety tests intentionally assert the complete deployment contract together. */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  globSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as TypeScript from "typescript";
import { describe, expect, it } from "vitest";

import {
  COMMITTED_AUTH_SECRET_PATTERNS,
  JobMailProductionConfigError,
  parseJobMailProductionConfig,
} from "#/modules/organization/application/JobMailProductionConfig";
import {
  JOB_MAIL_PRODUCTION_STAGE,
  JobMailProductionTopology,
  isJobMailProductionStage,
  jobMailInboundRuleProps,
} from "#/platform/cloudflare/JobMailProductionTopology";

import { validateProductionConfigFile } from "../../scripts/check-production-config";
import {
  PRODUCTION_APPLICATION_KEYS,
  ProductionEnvFileError,
  parseProductionEnv,
} from "../../scripts/production-env";
import {
  JOB_MAIL_PRODUCTION_CLOUDFLARE_ACCOUNT_ID,
  JOB_MAIL_PRODUCTION_ALCHEMY_PROFILE,
  PRODUCTION_OPERATIONAL_ENV_KEYS,
  alchemyCliInvocation,
  ensureProductionAlchemyProfile,
  productionAlchemyArgs,
  productionAlchemyChildEnv,
} from "../../scripts/run-production-alchemy";

const root = fileURLToPath(new URL("../..", import.meta.url));
const readRoot = (file: string) => readFileSync(path.join(root, file), "utf-8");
const validInput = {
  archiveRecipient: "archive@gmail.com",
  authEmailFrom: "auth@szymondlugolecki.com",
  challengeSecret: Redacted.make("DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDA"),
  initialAddress: "szymon@szymondlugolecki.com",
  ownerAllowlist: '["owner@example.com"]',
  privacySecret: Redacted.make("EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEA"),
  publicOrigin: "https://mail.szymondlugolecki.com",
  routeEnabled: false,
  sessionSecret: Redacted.make("FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFA"),
  sharedRoutingStateConfirmed: "disabled-drop-reviewed",
} as const;
const validProductionEnv = [
  'PUBLIC_ORIGIN="https://mail.szymondlugolecki.com"',
  "AUTH_EMAIL_FROM=auth@szymondlugolecki.com",
  'MAILBOX_BOOTSTRAP_OWNER_EMAIL_ALLOWLIST=[ "owner@example.com" ]',
  "MAILBOX_INITIAL_ADDRESS=szymon@szymondlugolecki.com",
  "MAILBOX_ARCHIVE_RECIPIENT=archive@gmail.com",
  "JOB_MAIL_INBOUND_ROUTE_ENABLED=false",
  "JOB_MAIL_SHARED_ROUTING_STATE_CONFIRMED=disabled-drop-reviewed",
  "AUTH_SESSION_SECRET=FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFA",
  "AUTH_CHALLENGE_SECRET=DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDA",
  "AUTH_PRIVACY_SECRET=EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEA",
].join("\n");

describe("job mail production configuration", () => {
  it("accepts the exact commissioning configuration with routing disabled", () => {
    expect(
      Effect.runSync(parseJobMailProductionConfig(validInput))
    ).toStrictEqual({ routeEnabled: false });
  });

  it.each([
    ["publicOrigin", "https://mail.szymondlugolecki.com/path", "public-origin"],
    ["initialAddress", "other@szymondlugolecki.com", "initial-address"],
    ["authEmailFrom", "other@szymondlugolecki.com", "auth-email-from"],
    ["ownerAllowlist", "[]", "owner-allowlist"],
    [
      "ownerAllowlist",
      '["one@example.com","two@example.net"]',
      "owner-allowlist",
    ],
    ["ownerAllowlist", '["owner@szymondlugolecki.com"]', "owner-allowlist"],
    ["archiveRecipient", "archive@szymondlugolecki.com", "archive-recipient"],
    ["archiveRecipient", "archive@outlook.com", "archive-recipient"],
    ["routeEnabled", undefined, "route-enabled"],
    ["routeEnabled", "false", "route-enabled"],
    ["sharedRoutingStateConfirmed", undefined, "shared-routing-state"],
    ["sessionSecret", Redacted.make("private-invalid-secret"), "auth-secrets"],
    ["privacySecret", validInput.sessionSecret, "auth-secrets"],
  ] as const)(
    "rejects %s with a bounded reason and no private value",
    (field, value, reason) => {
      const error = Effect.runSync(
        Effect.flip(
          parseJobMailProductionConfig({ ...validInput, [field]: value })
        )
      );
      expect(error).toBeInstanceOf(JobMailProductionConfigError);
      expect(error).toStrictEqual(expect.objectContaining({ reason }));
      expect(new Set(Object.keys(error))).toStrictEqual(
        new Set(["_tag", "reason"])
      );
      expect(JSON.stringify(error)).not.toContain("archive@gmail.com");
      expect(JSON.stringify(error)).not.toContain("owner@example.com");
      expect(JSON.stringify(error)).not.toContain("private-invalid-secret");
    }
  );

  it.each(["1", "yes", "on", "random"])(
    "rejects every present development/local mode representation: %s",
    (value) => {
      for (const field of ["alchemyDev", "alchemyState"] as const) {
        expect(
          Effect.runSync(
            Effect.flip(
              parseJobMailProductionConfig({
                ...validInput,
                [field]: value,
              })
            )
          )
        ).toStrictEqual(expect.objectContaining({ reason: "deployment-mode" }));
      }
    }
  );

  it("explicitly rejects every committed example/default secret pattern", () => {
    for (const secret of COMMITTED_AUTH_SECRET_PATTERNS) {
      const error = Effect.runSync(
        Effect.flip(
          parseJobMailProductionConfig({
            ...validInput,
            sessionSecret: Redacted.make(secret),
          })
        )
      );
      expect(error).toStrictEqual(
        expect.objectContaining({ reason: "auth-secrets" })
      );
    }
  });
});

describe("job mail production resource structure", () => {
  it("branches on the actual stack stage before production preflight/resources", () => {
    const source = readRoot("alchemy.run.ts");
    const stage = source.indexOf("const stack = yield* Alchemy.Stack");
    const preflight = source.indexOf("yield* jobMailProductionConfig");
    const backend = source.indexOf("const backend = yield* Backend");
    expect(source).toContain("isJobMailProductionStage(stack.stage)");
    expect(stage).toBeLessThan(preflight);
    expect(preflight).toBeLessThan(backend);
    expect(source).not.toContain("backendUrl:");
  });

  it("maps extensionless source aliases to Node ESM module files", () => {
    const packageJson = JSON.parse(readRoot("package.json")) as {
      imports: Record<string, string>;
    };
    const mappings = Object.entries(packageJson.imports);
    const specifiers = new Set<string>();
    for (const file of globSync("{src,tests}/**/*.{ts,tsx}", { cwd: root })) {
      const source = readRoot(file);
      const sourceFile = TypeScript.createSourceFile(
        file,
        source,
        TypeScript.ScriptTarget.Latest,
        false,
        file.endsWith(".tsx")
          ? TypeScript.ScriptKind.TSX
          : TypeScript.ScriptKind.TS
      );
      const visit = (node: TypeScript.Node): void => {
        const [dynamicImportArgument] = TypeScript.isCallExpression(node)
          ? node.arguments
          : [];
        if (
          TypeScript.isImportDeclaration(node) &&
          TypeScript.isStringLiteral(node.moduleSpecifier) &&
          node.moduleSpecifier.text.startsWith("#/")
        ) {
          specifiers.add(node.moduleSpecifier.text);
        } else if (
          TypeScript.isCallExpression(node) &&
          node.expression.kind === TypeScript.SyntaxKind.ImportKeyword &&
          node.arguments.length === 1 &&
          dynamicImportArgument !== undefined &&
          TypeScript.isStringLiteral(dynamicImportArgument) &&
          dynamicImportArgument.text.startsWith("#/")
        ) {
          specifiers.add(dynamicImportArgument.text);
        }
        TypeScript.forEachChild(node, visit);
      };
      visit(sourceFile);
    }

    expect(specifiers.size).toBeGreaterThan(100);
    for (const specifier of specifiers) {
      let mapping: [string, string] | undefined;
      for (const current of mappings) {
        const [key] = current;
        const wildcard = key.indexOf("*");
        const matches =
          wildcard === -1
            ? key === specifier
            : specifier.startsWith(key.slice(0, wildcard)) &&
              specifier.endsWith(key.slice(wildcard + 1));
        if (
          matches &&
          (mapping === undefined || key.length > mapping[0].length)
        ) {
          mapping = current;
        }
      }
      if (mapping === undefined) {
        throw new Error(`Missing package import mapping for ${specifier}`);
      }
      const [key, target] = mapping;
      const wildcard = key.indexOf("*");
      const replacement =
        wildcard === -1
          ? ""
          : specifier.slice(
              wildcard,
              specifier.length - (key.length - wildcard - 1)
            );
      const resolved = target.replace("*", replacement).replace(/^\.\//u, "");
      expect(resolved).toMatch(/\.tsx?$/u);
      expect(existsSync(path.join(root, resolved))).toBeTruthy();
    }
  });

  it("defines one exact production topology consumed by Alchemy", () => {
    expect(JOB_MAIL_PRODUCTION_STAGE).toBe("production");
    expect(isJobMailProductionStage("production")).toBeTruthy();
    expect(isJobMailProductionStage("development")).toBeFalsy();
    expect(JobMailProductionTopology).toStrictEqual({
      catchAll: {
        actions: [{ type: "drop" }],
        enabled: false,
        name: "Drop unmatched job mail",
      },
      routes: [
        {
          action: { type: "worker" },
          matcher: {
            field: "to",
            type: "literal",
            value: "szymon@szymondlugolecki.com",
          },
          name: "Inbound job mail",
        },
      ],
      routing: { zone: "szymondlugolecki.com" },
      senders: {
        auth: ["auth@szymondlugolecki.com"],
        mailbox: ["szymon@szymondlugolecki.com"],
      },
      website: { domain: "mail.szymondlugolecki.com" },
    });
    expect(jobMailInboundRuleProps("exact-worker", false)).toStrictEqual({
      actions: [{ type: "worker", value: ["exact-worker"] }],
      enabled: false,
      matchers: [JobMailProductionTopology.routes[0]?.matcher],
      name: "Inbound job mail",
    });
  });

  it("does not declare account-level address or subdomain sending resources", () => {
    const source = readRoot("alchemy.run.ts");
    expect(source).not.toContain("Cloudflare.Email.Routing");
    expect(source).not.toContain("Email.Address");
    expect(source).not.toContain("SendingSubdomain");
  });

  it("serves hashed assets before the SSR Website worker", () => {
    const source = readRoot("alchemy.run.ts");
    expect(source).toContain('runWorkerFirst: ["/*", "!/assets/*"]');
    expect(source).not.toContain("runWorkerFirst: true");
  });

  it("inspects production state through the deployment credential boundary", () => {
    const source = readRoot("scripts/check-production-state.ts");
    expect(source).toContain("readProductionEnvFile");
    expect(source).toContain("productionAlchemyChildEnv");
    expect(source).toContain('"scripts/cloudflare-state-inspection.ts"');
    expect(source).toContain('"CloudflareInbox"');
    expect(source).toContain('"production"');
    expect(source).toContain('".env.production"');
    expect(source).not.toContain('".env"');
  });

  it("keeps the Backend private", () => {
    const backend = readRoot("src/apps/backend-worker/BackendWorker.ts");
    expect(backend).toContain("url: false");
    expect(backend).toContain(
      "MAILBOX_OUTBOUND_PROVIDER_DISABLED: ALCHEMY_DEV"
    );
    expect(backend).not.toContain(
      "MAILBOX_OUTBOUND_PROVIDER_DISABLED: process.env.ALCHEMY_DEV"
    );
  });

  it("keeps health startup separate from the complete Backend graph", () => {
    const backend = readRoot("src/apps/backend-worker/BackendWorker.ts");
    const dispatch = readRoot("src/apps/backend-worker/BackendHttpDispatch.ts");
    const health = readRoot(
      "src/apps/backend-worker/BackendHealthApplicationLayer.ts"
    );
    expect(backend).not.toContain(
      'import { BackendApplicationLayer } from "./BackendApplicationLayer"'
    );
    expect(backend).toContain("backendFeatureFor(");
    expect(dispatch).toContain('path: "/api/health"');
    expect(dispatch).toContain("import type { BackendHttpApi }");
    expect(backend).toContain('import("./BackendHealthApplicationLayer")');
    expect(backend).toContain('import("./BackendApplicationLayer")');
    expect(backend).toContain("Layer.provide(MailboxBootstrapConfigLayer)");
    expect(health).toContain("BackendHealthHttpApi");
    expect(health).toContain("BackendHealthHttpHandlersLayer");
    expect(health).toContain("BackendHealthLayer");
    expect(health).toContain("MailPermissionsEffectAuthLayer");
    expect(health).toContain("EffectAuthStorageD1Layer");
  });

  it("keeps current-session startup separate from the complete auth graph", () => {
    const backend = readRoot("src/apps/backend-worker/BackendWorker.ts");
    const dispatch = readRoot("src/apps/backend-worker/BackendHttpDispatch.ts");
    const application = readRoot(
      "src/apps/backend-worker/BackendAuthSessionApplicationLayer.ts"
    );
    const route = readRoot(
      "src/modules/account-security/adapters/http/AuthCurrentSessionHttpRoute.ts"
    );
    const storage = readRoot(
      "src/modules/account-security/adapters/d1/AuthSessionStoreD1.ts"
    );

    expect(dispatch).toContain('path: "/auth/session"');
    expect(backend).toContain('import("./BackendAuthSessionApplicationLayer")');
    expect(application).toContain("AuthCurrentSessionHttpRouteLayer");
    expect(application).toContain("EffectAuthSessionStoreD1Layer");
    expect(application).toContain("SessionsLive");
    expect(application).toContain("externalRecoveryLinkEvidence.policy");
    expect(route).toContain("router.add(");
    expect(route).toContain('"GET"');
    expect(route).toContain('"/auth/session"');
    expect(storage).toContain("makeDrizzleEffectSqliteSessionStore");
    expect(storage).toContain("makeD1SqlitePasswordSessionCommitStore");
    expect(application).not.toContain("AccountSecurityLayer");
    expect(application).not.toContain("AccountSecurityHttpLayer");
    expect(application).not.toContain("EffectAuthStorageD1Layer");
    expect(application).not.toContain("SessionHttpOperationsLive");
    expect(route).not.toContain("@effect-auth/core/HttpApi");
  });

  it("keeps magic-link start separate from the complete auth graph", () => {
    const backend = readRoot("src/apps/backend-worker/BackendWorker.ts");
    const dispatch = readRoot("src/apps/backend-worker/BackendHttpDispatch.ts");
    const application = readRoot(
      "src/apps/backend-worker/BackendMagicLinkStartApplicationLayer.ts"
    );
    const route = readRoot(
      "src/modules/account-security/adapters/http/AuthMagicLinkStartHttpRoute.ts"
    );
    const starter = readRoot(
      "src/modules/account-security/adapters/effect-auth/MagicLinkStartEffectAuth.ts"
    );

    expect(dispatch).toContain('path: "/auth/magic-link/start"');
    expect(backend).toContain(
      'import("./BackendMagicLinkStartApplicationLayer")'
    );
    expect(application).toContain("AuthMagicLinkStartHttpRouteLayer");
    expect(application).toContain("MagicLinkStarterLayer");
    expect(application).toContain("AuthRateLimitStandardLive");
    expect(application).toContain("RecoverySafeIdentityD1Layer");
    expect(route).toContain('"/auth/magic-link/start"');
    expect(starter).toContain('type: "magic-link"');
    expect(starter).toContain('"/auth-complete/magic-link"');
    expect(application).not.toContain("AccountSecurityLayer");
    expect(application).not.toContain("AccountSecurityHttpLayer");
    expect(application).not.toContain("EffectAuthStorageD1Layer");
    expect(route).not.toContain("@effect-auth/core/HttpApi");
  });

  it("keeps magic-link verify separate from the complete Backend graph", () => {
    const backend = readRoot("src/apps/backend-worker/BackendWorker.ts");
    const dispatch = readRoot("src/apps/backend-worker/BackendHttpDispatch.ts");
    const application = readRoot(
      "src/apps/backend-worker/BackendMagicLinkVerifyApplicationLayer.ts"
    );
    const route = readRoot(
      "src/modules/account-security/adapters/http/AuthMagicLinkVerifyHttpRoute.ts"
    );

    expect(dispatch).toContain('path: "/auth/magic-link/verify"');
    expect(backend).toContain(
      'import("./BackendMagicLinkVerifyApplicationLayer")'
    );
    expect(application).toContain("AuthMagicLinkVerifyHttpRouteLayer");
    expect(application).toContain("AccountSecurityEffectAuthLayer");
    expect(application).not.toContain("BackendApplicationLayer");
    expect(application).not.toContain("AccountSecurityHttpLayer");
    expect(route).toContain('"/auth/magic-link/verify"');
    expect(route).not.toContain("@effect-auth/core/HttpApi");
  });

  it("keeps step-up options separate from the complete Backend graph", () => {
    const backend = readRoot("src/apps/backend-worker/BackendWorker.ts");
    const dispatch = readRoot("src/apps/backend-worker/BackendHttpDispatch.ts");
    const application = readRoot(
      "src/apps/backend-worker/BackendStepUpOptionsApplicationLayer.ts"
    );
    const route = readRoot(
      "src/modules/account-security/adapters/http/AuthStepUpOptionsHttpRoute.ts"
    );

    expect(dispatch).toContain('path: "/auth/step-up/options"');
    expect(backend).toContain(
      'import("./BackendStepUpOptionsApplicationLayer")'
    );
    expect(application).toContain("AuthStepUpOptionsHttpRouteLayer");
    expect(application).toContain("PasskeyAuthenticationIdentityD1Layer");
    expect(application).toContain("StepUpFactorReaderD1Layer");
    expect(application).not.toContain("PasskeyAuthentication.layerNoDeps");
    expect(application).not.toContain("AccountSecurityEffectAuthLayer");
    expect(application).not.toContain("EffectAuthStorageD1Layer");
    expect(application).not.toContain("BackendApplicationLayer");
    expect(application).not.toContain("AccountSecurityHttpLayer");
    expect(route).toContain('"/auth/step-up/options"');
    expect(route).not.toContain("@effect-auth/core/HttpApi");
  });

  it("keeps effect-qb and its PostgreSQL parser out of production storage", () => {
    const packageJson = JSON.parse(readRoot("package.json")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const storage = readRoot(
      "src/modules/account-security/adapters/d1/AccountSecurityStorageD1.ts"
    );

    expect(storage).toContain("PasskeyCredentialStoreD1Layer");
    expect(storage).toContain("PermissionStoreD1Layer");
    expect(storage).toContain("RecoveryCodeStoreD1Layer");
    expect(storage).not.toContain("EffectQb");
    expect(packageJson.dependencies["effect-qb"]).toBeUndefined();
    expect(packageJson.devDependencies["effect-qb"]).toBe("4.0.0-beta.98");
  });
});

describe("production command and environment safety", () => {
  it("uses explicit fixed stages and has no ambiguous deploy or production destroy", () => {
    const packageJson = JSON.parse(readRoot("package.json")) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts.deploy).toBeUndefined();
    expect(packageJson.scripts.destroy).toBeUndefined();
    expect(packageJson.scripts["deploy:development"]).toBeUndefined();
    expect(packageJson.scripts["destroy:development"]).toBeUndefined();
    expect(packageJson.scripts["deploy:production:dry-run"]).toBe(
      "bun run release:check && bun run config:production && bun scripts/run-production-alchemy.ts plan"
    );
    expect(packageJson.scripts["deploy:production"]).toBe(
      "bun run release:check && bun run config:production && bun scripts/run-production-alchemy.ts deploy"
    );
    expect(packageJson.scripts["config:production"]).toBe(
      "bun scripts/check-production-config.ts"
    );
    expect(packageJson.scripts["state:production"]).toBe(
      "bun scripts/check-production-state.ts"
    );
    expect(packageJson.scripts["deploy:production"]).not.toContain("--yes");
    expect(
      Object.entries(packageJson.scripts).some(
        ([name, command]) =>
          name.includes("destroy") && command.includes("production")
      )
    ).toBeFalsy();
  });

  it("parses only the strict production application contract", () => {
    const parsed = parseProductionEnv(validProductionEnv);
    expect([...parsed.keys()]).toStrictEqual(PRODUCTION_APPLICATION_KEYS);
    expect(parsed.get("PUBLIC_ORIGIN")).toBe(
      "https://mail.szymondlugolecki.com"
    );
    expect(parsed.get("MAILBOX_BOOTSTRAP_OWNER_EMAIL_ALLOWLIST")).toBe(
      '["owner@example.com"]'
    );
  });

  it.each([
    [
      `${validProductionEnv}\nAUTH_EMAIL_FROM=private-duplicate`,
      "duplicate-key",
    ],
    [
      validProductionEnv.replace(
        "AUTH_EMAIL_FROM=",
        "ALCHEMY_DEV=1\nAUTH_EMAIL_FROM="
      ),
      "forbidden-key",
    ],
    [
      validProductionEnv.replace(
        "AUTH_EMAIL_FROM=",
        "ALCHEMY_STATE=local\nAUTH_EMAIL_FROM="
      ),
      "forbidden-key",
    ],
    [
      `${validProductionEnv}\nUNEXPECTED_APPLICATION_KEY=private`,
      "unexpected-key",
    ],
    [
      validProductionEnv.replace(
        "AUTH_EMAIL_FROM=",
        "malformed-private-line\nAUTH_EMAIL_FROM="
      ),
      "malformed-line",
    ],
    [
      validProductionEnv.replace(
        'MAILBOX_BOOTSTRAP_OWNER_EMAIL_ALLOWLIST=[ "owner@example.com" ]\n',
        ""
      ),
      "missing-key",
    ],
    [
      validProductionEnv.replace('[ "owner@example.com" ]', "private-not-json"),
      "invalid-json",
    ],
  ] as const)(
    "rejects strict env defect %# without leaking values",
    (source, reason) => {
      let thrown: unknown;
      try {
        parseProductionEnv(source);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(ProductionEnvFileError);
      expect(thrown).toStrictEqual(expect.objectContaining({ reason }));
      expect(String(thrown)).not.toContain("private");
      expect(JSON.stringify(thrown)).not.toContain("private");
    }
  );

  it("uses only file values and never fills a missing key from ambient env", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "production-env-"));
    const file = path.join(directory, ".env.production");
    const previousOrigin = process.env.PUBLIC_ORIGIN;
    const previousSecret = process.env.AUTH_SESSION_SECRET;
    try {
      process.env.PUBLIC_ORIGIN = "https://ambient.invalid";
      process.env.AUTH_SESSION_SECRET =
        "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGA";
      writeFileSync(file, validProductionEnv);
      await expect(validateProductionConfigFile(file)).resolves.toBeTruthy();

      writeFileSync(
        file,
        validProductionEnv.replace(/^AUTH_SESSION_SECRET=.*\n/mu, "")
      );
      await expect(validateProductionConfigFile(file)).resolves.toBeFalsy();
    } finally {
      if (previousOrigin === undefined) {
        delete process.env.PUBLIC_ORIGIN;
      } else {
        process.env.PUBLIC_ORIGIN = previousOrigin;
      }
      if (previousSecret === undefined) {
        delete process.env.AUTH_SESSION_SECRET;
      } else {
        process.env.AUTH_SESSION_SECRET = previousSecret;
      }
      rmSync(directory, { recursive: true });
    }
  });

  it("scrubs the Alchemy child environment and fixes interactive arguments", () => {
    const parsed = parseProductionEnv(validProductionEnv);
    const child = productionAlchemyChildEnv(parsed, {
      ALCHEMY_DEV: "private-dev",
      ALCHEMY_PROFILE: "reviewed-profile",
      ALCHEMY_STATE: "private-state",
      CLOUDFLARE_ACCOUNT_ID: JOB_MAIL_PRODUCTION_CLOUDFLARE_ACCOUNT_ID,
      CLOUDFLARE_API_TOKEN: "reviewed-token",
      CLOUDFLARE_API_KEY: "must-not-pass",
      CLOUDFLARE_EMAIL: "must-not-pass",
      HOME: "/operator/home",
      PATH: "/operator/bin",
      PUBLIC_ORIGIN: "https://ambient.invalid",
      RANDOM_APPLICATION_SECRET: "private-random",
      USER: "operator",
    });
    expect(new Set(Object.keys(child))).toStrictEqual(
      new Set([
        ...PRODUCTION_APPLICATION_KEYS,
        "ALCHEMY_PROFILE",
        "CLOUDFLARE_ACCOUNT_ID",
        "CLOUDFLARE_API_TOKEN",
        "HOME",
        "PATH",
        "USER",
      ])
    );
    expect(child.PUBLIC_ORIGIN).toBe("https://mail.szymondlugolecki.com");
    expect(child.ALCHEMY_PROFILE).toBe(JOB_MAIL_PRODUCTION_ALCHEMY_PROFILE);
    expect(child.ALCHEMY_PROFILE).not.toBe("reviewed-profile");
    expect(child.CI).toBeUndefined();
    expect(child.CLOUDFLARE_API_KEY).toBeUndefined();
    expect(child.CLOUDFLARE_EMAIL).toBeUndefined();
    expect(child.ALCHEMY_DEV).toBeUndefined();
    expect(child.ALCHEMY_STATE).toBeUndefined();
    expect(child.RANDOM_APPLICATION_SECRET).toBeUndefined();
    expect(PRODUCTION_OPERATIONAL_ENV_KEYS).not.toContain("ALCHEMY_DEV");
    expect(PRODUCTION_OPERATIONAL_ENV_KEYS).not.toContain("ALCHEMY_PROFILE");
    expect(productionAlchemyArgs("plan")).toStrictEqual([
      "deploy",
      "--stage",
      "production",
      "--env-file",
      ".env.production",
      "--dry-run",
    ]);
    expect(productionAlchemyArgs("deploy")).toStrictEqual([
      "deploy",
      "--stage",
      "production",
      "--env-file",
      ".env.production",
    ]);
    expect(productionAlchemyArgs("deploy")).not.toContain("--yes");
    const invocation = alchemyCliInvocation(productionAlchemyArgs("plan"), {
      command: "/reviewed/bun",
      isBun: true,
    });
    expect(invocation.command).toBe("/reviewed/bun");
    const [cliPath] = invocation.args;
    if (cliPath === undefined) {
      throw new Error("Alchemy CLI path is missing");
    }
    expect(
      path
        .normalize(cliPath)
        .endsWith(path.join("node_modules", "alchemy", "bin", "alchemy.js"))
    ).toBeTruthy();
    expect(invocation.args.slice(1)).toStrictEqual(
      productionAlchemyArgs("plan")
    );
    expect(() =>
      alchemyCliInvocation(productionAlchemyArgs("plan"), {
        command: process.execPath,
        isBun: false,
      })
    ).toThrow("production Alchemy requires Bun");

    const bunImport = spawnSync(
      "bun",
      [
        "--eval",
        'await import("./src/modules/mailbox/domain/MailboxResource.ts")',
      ],
      {
        cwd: root,
        encoding: "utf-8",
        env: { HOME: process.env.HOME, PATH: process.env.PATH },
      }
    );
    expect(bunImport.status).toBe(0);
  });

  it("fails closed on wrong Cloudflare auth or production profile drift", () => {
    const parsed = parseProductionEnv(validProductionEnv);
    expect(() =>
      productionAlchemyChildEnv(parsed, {
        CLOUDFLARE_ACCOUNT_ID: "00000000000000000000000000000000",
        CLOUDFLARE_API_TOKEN: "reviewed-token",
      })
    ).toThrow("production Cloudflare authentication is invalid");
    expect(() =>
      productionAlchemyChildEnv(parsed, {
        CLOUDFLARE_ACCOUNT_ID: JOB_MAIL_PRODUCTION_CLOUDFLARE_ACCOUNT_ID,
        CLOUDFLARE_API_KEY: "global-key-must-not-fallback",
        CLOUDFLARE_EMAIL: "operator@example.com",
      })
    ).toThrow("production Cloudflare authentication is invalid");

    const home = mkdtempSync(path.join(tmpdir(), "production-profile-"));
    try {
      const directory = path.join(home, ".alchemy");
      ensureProductionAlchemyProfile(home);
      expect(
        JSON.parse(readFileSync(path.join(directory, "profiles.json"), "utf-8"))
          .profiles[JOB_MAIL_PRODUCTION_ALCHEMY_PROFILE]
      ).toStrictEqual({ Cloudflare: { method: "env" } });
      writeFileSync(
        path.join(directory, "profiles.json"),
        JSON.stringify({
          version: 0,
          profiles: {
            [JOB_MAIL_PRODUCTION_ALCHEMY_PROFILE]: {
              Cloudflare: { method: "oauth" },
            },
          },
        })
      );
      expect(() => ensureProductionAlchemyProfile(home)).toThrow(
        "production Alchemy profile is invalid"
      );
      writeFileSync(
        path.join(directory, "profiles.json"),
        JSON.stringify({
          version: 0,
          profiles: {
            [JOB_MAIL_PRODUCTION_ALCHEMY_PROFILE]: {
              Cloudflare: { method: "env" },
            },
          },
        })
      );
      chmodSync(path.join(directory, "profiles.json"), 0o644);
      expect(() => ensureProductionAlchemyProfile(home)).not.toThrow();
      expect(
        statSync(path.join(directory, "profiles.json")).mode % 0o1000
      ).toBe(0o600);
      writeFileSync(
        path.join(directory, "profiles.json"),
        JSON.stringify({ version: 1, profiles: {} })
      );
      expect(() => ensureProductionAlchemyProfile(home)).toThrow(
        "production Alchemy profile is invalid"
      );
      writeFileSync(
        path.join(directory, "profiles.json"),
        JSON.stringify({ version: 0, profiles: [] })
      );
      expect(() => ensureProductionAlchemyProfile(home)).toThrow(
        "production Alchemy profile is invalid"
      );
    } finally {
      rmSync(home, { recursive: true });
    }
  });

  it("ignores the real production env and tracks only placeholder instructions", () => {
    expect(readRoot(".gitignore").split(/\r?\n/u)).toContain(".env.production");
    const productionExample = readRoot(".env.production.example");
    expect(productionExample).toContain("JOB_MAIL_INBOUND_ROUTE_ENABLED=false");
    expect(productionExample).toContain(
      "JOB_MAIL_SHARED_ROUTING_STATE_CONFIRMED=<set-to-disabled-drop-reviewed-after-manual-inventory>"
    );
    expect(productionExample).toContain("<external-owner-address>");
    expect(productionExample).toContain(
      "<verified-external-gmail-archive-address>"
    );
    expect(productionExample).not.toContain("@gmail.com");
    const secretLines = [readRoot(".env.example"), productionExample].flatMap(
      (example) =>
        example
          .split(/\r?\n/u)
          .filter(
            (value) => value.startsWith("AUTH_") && value.includes("SECRET")
          )
    );
    expect(secretLines).toHaveLength(6);
    for (const line of secretLines) {
      expect(line.split("=")[1]).not.toMatch(
        /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u
      );
    }
  });

  it("makes release check a clean-tree full gate that records HEAD", () => {
    const source = readRoot("scripts/release-check.ts");
    expect(source).toContain(
      '"status", "--porcelain=v1", "--untracked-files=all"'
    );
    expect(source).toContain('run("bun", ["run", "check"])');
    expect(source).toContain('run("bun", ["run", "typecheck"])');
    expect(source).toContain('run("bun", ["run", "test"])');
    expect(source).toContain('run("bun", ["run", "test:mailbox-restore"])');
    expect(source).toContain('run("bun", ["run", "build"])');
    expect(source).toContain('run("git", ["diff", "--check"])');
    expect(source).toContain("release-check ok head=");
  });
});
