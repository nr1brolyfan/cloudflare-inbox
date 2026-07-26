/* oxlint-disable max-classes-per-file -- The production value and value-free error form one config boundary. */
import * as Config from "effect/Config";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import { parseMailboxArchiveConfig } from "#/modules/mailbox/contracts/MailboxArchiveConfig";
import { parseMailboxBootstrapConfig } from "#/modules/organization/contracts/MailboxBootstrapConfig";

export const JOB_MAIL_PRODUCTION_ORIGIN = "https://mail.szymondlugolecki.com";
export const JOB_MAIL_INITIAL_ADDRESS = "szymon@szymondlugolecki.com";
export const JOB_MAIL_AUTH_EMAIL_FROM = "auth@szymondlugolecki.com";
export const JOB_MAIL_SHARED_ROUTING_STATE_CONFIRMED = "disabled-drop-reviewed";

export const COMMITTED_AUTH_SECRET_PATTERNS: readonly string[] = [
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBA",
  "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCA",
  "<generate-32-byte-base64url-session-secret>",
  "<generate-32-byte-base64url-challenge-secret>",
  "<generate-32-byte-base64url-privacy-secret>",
  "<43-character-base64url-secret-1>",
  "<43-character-base64url-secret-2>",
  "<43-character-base64url-secret-3>",
];

export type JobMailProductionConfigReason =
  | "archive-recipient"
  | "auth-email-from"
  | "auth-secrets"
  | "deployment-mode"
  | "initial-address"
  | "owner-allowlist"
  | "public-origin"
  | "route-enabled"
  | "shared-routing-state";

export class JobMailProductionConfigError extends Data.TaggedError(
  "JobMailProductionConfigError"
)<{
  readonly reason: JobMailProductionConfigReason;
}> {}

export interface JobMailProductionConfigInput {
  readonly alchemyDev?: unknown;
  readonly alchemyState?: unknown;
  readonly archiveRecipient: unknown;
  readonly authEmailFrom: unknown;
  readonly challengeSecret: unknown;
  readonly initialAddress: unknown;
  readonly ownerAllowlist: unknown;
  readonly privacySecret: unknown;
  readonly publicOrigin: unknown;
  readonly routeEnabled: unknown;
  readonly sessionSecret: unknown;
  readonly sharedRoutingStateConfirmed: unknown;
}

export interface JobMailProductionConfigValue {
  readonly routeEnabled: boolean;
}

const secretValue = (value: unknown): string | undefined => {
  try {
    return Redacted.value(value as Redacted.Redacted<string>);
  } catch {
    return undefined;
  }
};

const hasDeploymentMode = (value: unknown): boolean =>
  typeof value === "string" ? value.trim() !== "" : value !== undefined;

export const parseJobMailProductionConfig = (
  input: JobMailProductionConfigInput
): Effect.Effect<JobMailProductionConfigValue, JobMailProductionConfigError> =>
  Effect.gen(function* () {
    if (input.publicOrigin !== JOB_MAIL_PRODUCTION_ORIGIN) {
      return yield* new JobMailProductionConfigError({
        reason: "public-origin",
      });
    }
    if (input.initialAddress !== JOB_MAIL_INITIAL_ADDRESS) {
      return yield* new JobMailProductionConfigError({
        reason: "initial-address",
      });
    }
    if (input.authEmailFrom !== JOB_MAIL_AUTH_EMAIL_FROM) {
      return yield* new JobMailProductionConfigError({
        reason: "auth-email-from",
      });
    }
    if (
      hasDeploymentMode(input.alchemyState) ||
      hasDeploymentMode(input.alchemyDev)
    ) {
      return yield* new JobMailProductionConfigError({
        reason: "deployment-mode",
      });
    }
    if (
      input.sharedRoutingStateConfirmed !==
      JOB_MAIL_SHARED_ROUTING_STATE_CONFIRMED
    ) {
      return yield* new JobMailProductionConfigError({
        reason: "shared-routing-state",
      });
    }

    const bootstrap = yield* parseMailboxBootstrapConfig(
      input.ownerAllowlist,
      input.initialAddress
    ).pipe(
      Effect.mapError(
        () => new JobMailProductionConfigError({ reason: "owner-allowlist" })
      )
    );
    if (
      bootstrap.ownerEmailAllowlist.length !== 1 ||
      bootstrap.ownerEmailAllowlist[0]?.endsWith(`@${bootstrap.initialDomain}`)
    ) {
      return yield* new JobMailProductionConfigError({
        reason: "owner-allowlist",
      });
    }
    const archive = yield* parseMailboxArchiveConfig(
      input.archiveRecipient,
      bootstrap.initialDomain
    ).pipe(
      Effect.mapError(
        () => new JobMailProductionConfigError({ reason: "archive-recipient" })
      )
    );
    if (
      archive.recipient.slice(archive.recipient.lastIndexOf("@") + 1) !==
      "gmail.com"
    ) {
      return yield* new JobMailProductionConfigError({
        reason: "archive-recipient",
      });
    }

    if (typeof input.routeEnabled !== "boolean") {
      return yield* new JobMailProductionConfigError({
        reason: "route-enabled",
      });
    }

    const secrets = [
      secretValue(input.sessionSecret),
      secretValue(input.challengeSecret),
      secretValue(input.privacySecret),
    ];
    if (
      !secrets.every(
        (secret): secret is string =>
          secret !== undefined &&
          !COMMITTED_AUTH_SECRET_PATTERNS.includes(secret) &&
          /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u.test(secret)
      ) ||
      new Set(secrets).size !== secrets.length
    ) {
      return yield* new JobMailProductionConfigError({
        reason: "auth-secrets",
      });
    }

    return { routeEnabled: input.routeEnabled };
  });

const requiredString = (name: string, reason: JobMailProductionConfigReason) =>
  Config.string(name).pipe(
    Effect.mapError(() => new JobMailProductionConfigError({ reason }))
  );

const requiredSecret = (name: string) =>
  Config.redacted(name).pipe(
    Effect.mapError(
      () => new JobMailProductionConfigError({ reason: "auth-secrets" })
    )
  );

export const jobMailProductionConfig = Effect.gen(function* () {
  const alchemyDev = Option.getOrUndefined(
    yield* Config.option(Config.string("ALCHEMY_DEV"))
  );
  const alchemyState = Option.getOrUndefined(
    yield* Config.option(Config.string("ALCHEMY_STATE"))
  );
  const routeEnabledText = yield* requiredString(
    "JOB_MAIL_INBOUND_ROUTE_ENABLED",
    "route-enabled"
  );
  const routeEnabled =
    routeEnabledText === "true"
      ? true
      : routeEnabledText === "false"
        ? false
        : undefined;

  return yield* parseJobMailProductionConfig({
    alchemyDev,
    alchemyState,
    archiveRecipient: yield* requiredString(
      "MAILBOX_ARCHIVE_RECIPIENT",
      "archive-recipient"
    ),
    authEmailFrom: yield* requiredString("AUTH_EMAIL_FROM", "auth-email-from"),
    challengeSecret: yield* requiredSecret("AUTH_CHALLENGE_SECRET"),
    initialAddress: yield* requiredString(
      "MAILBOX_INITIAL_ADDRESS",
      "initial-address"
    ),
    ownerAllowlist: yield* requiredString(
      "MAILBOX_BOOTSTRAP_OWNER_EMAIL_ALLOWLIST",
      "owner-allowlist"
    ),
    privacySecret: yield* requiredSecret("AUTH_PRIVACY_SECRET"),
    publicOrigin: yield* requiredString("PUBLIC_ORIGIN", "public-origin"),
    routeEnabled,
    sessionSecret: yield* requiredSecret("AUTH_SESSION_SECRET"),
    sharedRoutingStateConfirmed: yield* requiredString(
      "JOB_MAIL_SHARED_ROUTING_STATE_CONFIRMED",
      "shared-routing-state"
    ),
  });
}).pipe(Effect.orDie);
