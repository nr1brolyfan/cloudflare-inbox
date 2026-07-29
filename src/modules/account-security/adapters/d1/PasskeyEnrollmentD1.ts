import { passkeyEvidence } from "@effect-auth/core/Assurance";
import { CustomAuditEventSchema } from "@effect-auth/core/AuditLog";
import { AuthSecrets } from "@effect-auth/core/AuthConfig";
import { AuthRateLimit } from "@effect-auth/core/AuthRateLimit";
import { Challenge } from "@effect-auth/core/Challenge";
import { Crypto } from "@effect-auth/core/Crypto";
import {
  CredentialId,
  UnixMillis as AuthUnixMillis,
} from "@effect-auth/core/Identifiers";
import {
  PasskeyOptions,
  PasskeyVerifier,
  passkeyRegistrationChallengeType,
} from "@effect-auth/core/Passkey";
import * as AuthPermission from "@effect-auth/core/Permission";
import { RecoveryCodes } from "@effect-auth/core/RecoveryCode";
import { Sessions } from "@effect-auth/core/Sessions";
import {
  and,
  eq,
  exists,
  gt,
  isNotNull,
  isNull,
  ne,
  notExists,
  sql,
} from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { authAuditLog } from "#/auth/schema/modules/audit-log";
import { authUserIdentity } from "#/auth/schema/modules/core";
import { authCredential } from "#/auth/schema/modules/credentials";
import { authPasskeyCredential } from "#/auth/schema/modules/passkeys";
import { authRecoveryCode } from "#/auth/schema/modules/recovery-codes";
import { authSession } from "#/auth/schema/modules/sessions";
import { authTotpFactor } from "#/auth/schema/modules/totp";
import { authVerification } from "#/auth/schema/modules/verification";
import {
  FinishPasskeyEnrollmentCommand,
  PasskeyEnrollment,
  PasskeyEnrollmentChallengeMetadata,
  PasskeyEnrollmentError,
  PasskeyEnrollmentReceiptSchema,
  ReadPasskeyEnrollmentCommand,
  ReadRecoveryPasskeyEnrollmentCommand,
  RecoveryPasskeyRemediationCompleted,
  StartPasskeyEnrollmentCommand,
  StartedPasskeyEnrollment,
} from "#/modules/account-security/application/PasskeyEnrollment";
import {
  ACCOUNT_RECOVERY_EVIDENCE_POLICY_ID,
  ACCOUNT_RECOVERY_EVIDENCE_POLICY_VERSION,
} from "#/modules/account-security/domain/AccountRecovery";
import {
  CONTROL_PLANE_STEP_UP_POLICY,
  requireSensitiveOperationStepUp,
} from "#/modules/account-security/domain/StepUpPolicy";
import {
  recoveryRemediationSessionPredicate,
  sensitiveSessionPredicate,
  transactionalSessionPredicate,
} from "#/modules/account-security/integration/AccountSecurityD1RequestGuard";
import { PasskeyEnrollmentTransaction } from "#/modules/account-security/ports/PasskeyEnrollmentTransaction";
import { PasskeyRuntimeConfig } from "#/modules/account-security/ports/PasskeyRuntimeConfig";
import { SensitiveOperationStepUpClock } from "#/modules/account-security/ports/SensitiveOperationStepUpClock";
import { appAuthorizationGuard } from "#/platform/control-plane-d1/AuthorizationGuardSchema";
import * as ControlPlane from "#/platform/control-plane-d1/ControlPlaneBatch";
import { ControlPlaneDatabase } from "#/platform/control-plane-d1/ControlPlaneDatabase";
import { controlPlaneDatabaseNow } from "#/platform/control-plane-d1/RequestAuthGuard";
import { CurrentRequestAuth } from "#/shared/RequestAuth";
import type { CurrentRequestAuthShape } from "#/shared/RequestAuth";
import { UnixMillis } from "#/shared/Temporal";

import {
  appExternalRecoveryIdentity,
  appPasskeyEnrollmentReceipt,
} from "./AccountSecuritySchema";
import { normalizedAuthAuditEvent } from "./NormalizedAuthAuditEvent";

export interface PasskeyEnrollmentRuntimeShape {
  readonly now: () => number;
  readonly randomId: () => string;
}

export class PasskeyEnrollmentRuntime extends Context.Service<
  PasskeyEnrollmentRuntime,
  PasskeyEnrollmentRuntimeShape
>()("cloudflare-inbox/PasskeyEnrollmentRuntime") {}

interface PasskeyEnrollmentRequestContext {
  readonly boundRecoveryIdentityId: unknown;
  readonly boundRecoveryIdentityVersion: unknown;
  readonly mode: "normal" | "recovery-remediation";
  readonly recoveryMode: boolean;
  readonly requestAuth: CurrentRequestAuthShape;
}

export const PasskeyEnrollmentRuntimeLayer = Layer.succeed(
  PasskeyEnrollmentRuntime,
  PasskeyEnrollmentRuntime.of({
    now: Date.now,
    randomId: () => crypto.randomUUID(),
  })
);

const error = (
  operation: "finish" | "start",
  reason: PasskeyEnrollmentError["reason"],
  cause?: unknown
) => new PasskeyEnrollmentError({ cause, operation, reason });

const ensureTrusted = (
  requestAuth: CurrentRequestAuthShape,
  principal: AuthPermission.PermissionSubject
) => {
  const { validated } = requestAuth;
  return principal.type === "user" &&
    principal.id === validated.actor.userId &&
    validated.actor.userId === validated.currentSession.userId &&
    validated.actor.userId === validated.issued.userId &&
    validated.actor.sessionId === validated.currentSession.sessionId &&
    validated.actor.sessionId === validated.issued.sessionId
    ? Effect.void
    : Effect.die(new Error("Current request auth contexts are inconsistent"));
};

const requireSession = (
  requestAuth: CurrentRequestAuthShape,
  operation: "finish" | "start"
) =>
  (requestAuth.validated.currentSession.claims?.requirements?.length ?? 0) === 0
    ? Effect.void
    : Effect.fail(error(operation, "restricted-session"));

const nullableJson = (value: unknown | undefined) =>
  value === undefined ? null : JSON.stringify(value);

const backedUpValue = (value: boolean | undefined) => {
  if (value === undefined) {
    return null;
  }
  return value ? 1 : 0;
};

const persistedJsonValue = (value: unknown | undefined): unknown => {
  if (value === undefined) {
    return null;
  }
  const encoded = JSON.stringify(value);
  return encoded === undefined ? null : (JSON.parse(encoded) as unknown);
};

const canonicalJson = (value: unknown): string => {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? JSON.stringify(value) : "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries: [string, unknown][] = Object.entries(value);
    // The project lib predates toSorted; this local array is not shared.
    // oxlint-disable-next-line unicorn/no-array-sort
    entries.sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0
    );
    return `{${entries
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(",")}}`;
  }
  throw new TypeError("Credential intent contains an unsupported value");
};

const ReceiptRow = Schema.Struct({
  actorUserId: Schema.String,
  challengeId: Schema.String,
  clientIntentDigest: Schema.String,
  committedAt: Schema.Number,
  credentialRecordId: Schema.String,
  mode: Schema.String,
  operationId: Schema.String,
  readbackSecretHash: Schema.NullOr(Schema.String),
  recoveryCodeCount: Schema.NullOr(Schema.Number),
  recoveryCodeSetId: Schema.NullOr(Schema.String),
  recoveryIdentityId: Schema.String,
  recoveryIdentityVersion: Schema.Number,
  schemaVersion: Schema.Number,
  verifiedIntentDigest: Schema.String,
});
type ReceiptRow = Schema.Schema.Type<typeof ReceiptRow>;

const receiptFromRow = (row: ReceiptRow) =>
  Schema.decodeUnknownEffect(PasskeyEnrollmentReceiptSchema)({
    committedAt: row.committedAt,
    credentialRecordId: row.credentialRecordId,
    mode: row.mode,
    operationId: row.operationId,
    ...(row.recoveryCodeCount === null
      ? {}
      : { recoveryCodeCount: row.recoveryCodeCount }),
    ...(row.recoveryCodeSetId === null
      ? {}
      : { recoveryCodeSetId: row.recoveryCodeSetId }),
    schemaVersion: row.schemaVersion,
  });

const preliminaryReceiptIntent = (
  row: ReceiptRow,
  intent: {
    readonly actorUserId: string;
    readonly challengeId: string;
    readonly clientIntentDigest: string;
    readonly mode: "normal" | "recovery-remediation";
    readonly readbackSecretHash: string | null;
  }
) =>
  row.actorUserId === intent.actorUserId &&
  row.challengeId === intent.challengeId &&
  row.clientIntentDigest === intent.clientIntentDigest &&
  row.mode === intent.mode &&
  row.readbackSecretHash === intent.readbackSecretHash;

const exactReceiptIntent = (
  row: ReceiptRow,
  intent: Parameters<typeof preliminaryReceiptIntent>[1] & {
    readonly verifiedIntentDigest: string;
  }
) =>
  preliminaryReceiptIntent(row, intent) &&
  row.verifiedIntentDigest === intent.verifiedIntentDigest;

/** Guarded first-passkey enrollment over the maintained effect-auth primitives. */
const PasskeyEnrollmentTransactionD1Layer = Layer.effect(
  PasskeyEnrollmentTransaction,
  Effect.gen(function* () {
    const batch = yield* ControlPlane.ControlPlaneBatch;
    const authSecrets = yield* AuthSecrets;
    const authRateLimit = yield* AuthRateLimit;
    const challenge = yield* Challenge;
    const crypto = yield* Crypto;
    const database = yield* ControlPlaneDatabase;
    const options = yield* PasskeyOptions;
    const passkeyConfig = yield* PasskeyRuntimeConfig;
    const runtime = yield* PasskeyEnrollmentRuntime;
    const recoveryCodes = yield* RecoveryCodes;
    const sessions = yield* Sessions;
    const stepUpClock = yield* SensitiveOperationStepUpClock;
    const verifier = yield* PasskeyVerifier;

    const readStoredReceipt = (
      operationId: string,
      operation: PasskeyEnrollmentError["operation"]
    ) =>
      database
        .select({
          actorUserId: appPasskeyEnrollmentReceipt.actorUserId,
          challengeId: appPasskeyEnrollmentReceipt.challengeId,
          clientIntentDigest: appPasskeyEnrollmentReceipt.clientIntentDigest,
          committedAt: appPasskeyEnrollmentReceipt.committedAt,
          credentialRecordId: appPasskeyEnrollmentReceipt.credentialRecordId,
          mode: appPasskeyEnrollmentReceipt.mode,
          operationId: appPasskeyEnrollmentReceipt.operationId,
          readbackSecretHash: appPasskeyEnrollmentReceipt.readbackSecretHash,
          recoveryCodeCount: appPasskeyEnrollmentReceipt.resultingCodeCount,
          recoveryCodeSetId: appPasskeyEnrollmentReceipt.resultingCodeSetId,
          recoveryIdentityId: appPasskeyEnrollmentReceipt.recoveryIdentityId,
          recoveryIdentityVersion:
            appPasskeyEnrollmentReceipt.recoveryIdentityVersion,
          schemaVersion: appPasskeyEnrollmentReceipt.schemaVersion,
          verifiedIntentDigest:
            appPasskeyEnrollmentReceipt.verifiedIntentDigest,
        })
        .from(appPasskeyEnrollmentReceipt)
        .where(eq(appPasskeyEnrollmentReceipt.operationId, operationId))
        .limit(1)
        .pipe(
          Effect.mapError((cause) => error(operation, "storage", cause)),
          Effect.flatMap(([row]) =>
            row === undefined
              ? Effect.succeed(null)
              : Schema.decodeUnknownEffect(ReceiptRow)(row).pipe(
                  Effect.mapError((cause) => error(operation, "storage", cause))
                )
          )
        );

    const hashReadbackSecret = (
      secret: string,
      operation: PasskeyEnrollmentError["operation"]
    ) =>
      crypto
        .hmacSha256({
          data: `passkey-enrollment-readback:${secret}`,
          key: authSecrets.privacy,
        })
        .pipe(Effect.mapError((cause) => error(operation, "storage", cause)));

    const hashClientIntent = (credential: unknown) =>
      Effect.try({
        try: () => canonicalJson(credential),
        catch: (cause) => error("finish", "invalid-input", cause),
      }).pipe(
        Effect.flatMap((intent) =>
          crypto.hmacSha256({
            data: `passkey-enrollment-client-intent:v1:${intent}`,
            key: authSecrets.privacy,
          })
        ),
        Effect.mapError((cause) =>
          cause instanceof PasskeyEnrollmentError
            ? cause
            : error("finish", "storage", cause)
        )
      );

    const hashVerifiedIntent = (verified: {
      readonly backedUp?: boolean;
      readonly credentialId: string;
      readonly metadata?: unknown;
      readonly publicKey: unknown;
      readonly signCount: number;
      readonly transports?: unknown;
    }) =>
      Effect.try({
        try: () =>
          canonicalJson({
            backedUp: verified.backedUp ?? null,
            credentialId: verified.credentialId,
            metadata: persistedJsonValue(verified.metadata),
            publicKey: verified.publicKey,
            signCount: verified.signCount,
            transports: persistedJsonValue(verified.transports),
          }),
        catch: (cause) => error("finish", "storage", cause),
      }).pipe(
        Effect.flatMap((intent) =>
          crypto.hmacSha256({
            data: `passkey-enrollment-verified-intent:v1:${intent}`,
            key: authSecrets.privacy,
          })
        ),
        Effect.mapError((cause) =>
          cause instanceof PasskeyEnrollmentError
            ? cause
            : error("finish", "storage", cause)
        )
      );

    const requestContext = (operation: "finish" | "start") =>
      Effect.gen(function* () {
        const requestAuth = yield* CurrentRequestAuth;
        const principal = yield* AuthPermission.CurrentPrincipal;
        yield* ensureTrusted(requestAuth, principal);
        const { claims } = requestAuth.validated.currentSession;
        const recoveryMode =
          claims?.requirements?.length === 1 &&
          claims.requirements[0] === "recovery_remediation" &&
          claims.recoveryRemediation?.allowed.length === 1 &&
          claims.recoveryRemediation.allowed[0] === "second-passkey" &&
          claims.recoveryEnrollment === undefined;
        if (!recoveryMode) {
          yield* requireSession(requestAuth, operation);
        }
        const recoveryEvidence = recoveryMode
          ? requestAuth.validated.currentSession.authenticationEvents.find(
              (event) =>
                event.type === "custom" &&
                event.policyId === ACCOUNT_RECOVERY_EVIDENCE_POLICY_ID &&
                event.policyVersion ===
                  ACCOUNT_RECOVERY_EVIDENCE_POLICY_VERSION &&
                event.kind === "external-recovery-link"
            )
          : undefined;
        const boundRecoveryIdentityId =
          recoveryEvidence?.type === "custom"
            ? recoveryEvidence.properties.externalRecoveryIdentityId
            : undefined;
        const boundRecoveryIdentityVersion =
          recoveryEvidence?.type === "custom"
            ? recoveryEvidence.properties.externalRecoveryIdentityVersion
            : undefined;
        if (
          recoveryMode &&
          (typeof boundRecoveryIdentityId !== "string" ||
            typeof boundRecoveryIdentityVersion !== "number" ||
            !Number.isSafeInteger(boundRecoveryIdentityVersion))
        ) {
          return yield* error(operation, "restricted-session");
        }
        return {
          boundRecoveryIdentityId,
          boundRecoveryIdentityVersion,
          mode: recoveryMode
            ? ("recovery-remediation" as const)
            : ("normal" as const),
          recoveryMode,
          requestAuth,
        };
      });

    const freshPrerequisites = (
      operation: "finish" | "start",
      context: PasskeyEnrollmentRequestContext
    ) =>
      Effect.gen(function* () {
        const {
          boundRecoveryIdentityId,
          boundRecoveryIdentityVersion,
          recoveryMode,
          requestAuth,
        } = context;
        if (!recoveryMode) {
          yield* requireSensitiveOperationStepUp(
            requestAuth.validated.currentSession,
            stepUpClock.now()
          ).pipe(Effect.mapError(() => error(operation, "step-up-required")));
        }
        yield* authRateLimit
          .require({
            operation:
              operation === "start"
                ? "auth.passkey.registration_start"
                : "auth.passkey.registration_finish",
            userId: requestAuth.validated.actor.userId,
          })
          .pipe(
            Effect.mapError((cause) =>
              error(
                operation,
                cause._tag === "RateLimitExceededError"
                  ? "rate-limited"
                  : "storage",
                cause
              )
            )
          );
        const [recovery] = yield* database
          .select({
            id: appExternalRecoveryIdentity.id,
            version: appExternalRecoveryIdentity.version,
          })
          .from(appExternalRecoveryIdentity)
          .where(
            and(
              eq(
                appExternalRecoveryIdentity.userId,
                requestAuth.validated.actor.userId
              ),
              eq(appExternalRecoveryIdentity.status, "verified"),
              recoveryMode
                ? eq(
                    appExternalRecoveryIdentity.id,
                    boundRecoveryIdentityId as string
                  )
                : undefined,
              recoveryMode
                ? eq(
                    appExternalRecoveryIdentity.version,
                    boundRecoveryIdentityVersion as number
                  )
                : undefined
            )
          )
          .limit(1)
          .pipe(Effect.mapError((cause) => error(operation, "storage", cause)));
        if (recovery === undefined) {
          return yield* error(operation, "recovery-identity-required");
        }
        return { recovery, recoveryMode, requestAuth };
      });

    return PasskeyEnrollmentTransaction.of({
      start: (untrusted) =>
        Effect.gen(function* () {
          const command = yield* Schema.decodeUnknownEffect(
            StartPasskeyEnrollmentCommand
          )(untrusted).pipe(
            Effect.mapError((cause) => error("start", "invalid-input", cause))
          );
          const context = yield* requestContext("start");
          if (
            (context.recoveryMode && command.readbackSecret === undefined) ||
            (!context.recoveryMode && command.readbackSecret !== undefined)
          ) {
            return yield* error("start", "invalid-input");
          }
          const { recovery, recoveryMode, requestAuth } =
            yield* freshPrerequisites("start", context);
          const readbackSecretHash =
            command.readbackSecret === undefined
              ? undefined
              : yield* hashReadbackSecret(command.readbackSecret, "start");
          const [identity] = yield* database
            .select({ value: authUserIdentity.value })
            .from(authUserIdentity)
            .where(
              and(
                eq(authUserIdentity.userId, requestAuth.validated.actor.userId),
                eq(authUserIdentity.kind, "email")
              )
            )
            .limit(1)
            .pipe(Effect.mapError((cause) => error("start", "storage", cause)));
          const userName =
            identity?.value ?? requestAuth.validated.actor.userId;
          const started = yield* options
            .startRegistration({
              attestation: passkeyConfig.attestation,
              authenticatorSelection: passkeyConfig.authenticatorSelection,
              expectedOrigins: passkeyConfig.expectedOrigins,
              metadata: {
                authorization: recoveryMode
                  ? "recovery-remediation"
                  : "step-up",
                operationId: command.operationId,
                purpose: "passkey-enrollment",
                ...(readbackSecretHash === undefined
                  ? {}
                  : { readbackSecretHash }),
                recoveryIdentityId: recovery.id,
                recoveryIdentityVersion: recovery.version,
                sessionId: requestAuth.validated.actor.sessionId,
                sessionSecretHash: requestAuth.sessionSecretHash,
                stepUpPolicyId: CONTROL_PLANE_STEP_UP_POLICY.id,
                stepUpPolicyVersion: CONTROL_PLANE_STEP_UP_POLICY.version,
              },
              pubKeyCredParams: passkeyConfig.pubKeyCredParams,
              relyingParty: passkeyConfig.relyingParty,
              requireUserVerification: passkeyConfig.requireUserVerification,
              userDisplayName: userName,
              userId: requestAuth.validated.actor.userId,
              userName,
            })
            .pipe(Effect.mapError((cause) => error("start", "storage", cause)));
          return yield* Schema.decodeUnknownEffect(StartedPasskeyEnrollment)({
            ...started,
            operationId: command.operationId,
          }).pipe(Effect.mapError((cause) => error("start", "storage", cause)));
        }),
      finish: (untrusted) =>
        // oxlint-disable-next-line eslint/complexity -- Authorization, credential insertion, and recovery rotation must share one atomic batch.
        Effect.gen(function* () {
          const command = yield* Schema.decodeUnknownEffect(
            FinishPasskeyEnrollmentCommand
          )(untrusted).pipe(
            Effect.mapError((cause) => error("finish", "invalid-input", cause))
          );
          const context = yield* requestContext("finish");
          const { recoveryMode, requestAuth } = context;
          if (
            (recoveryMode && command.readbackSecret === undefined) ||
            (!recoveryMode && command.readbackSecret !== undefined)
          ) {
            return yield* error("finish", "invalid-input");
          }
          const clientIntentDigest = yield* hashClientIntent(
            command.credential
          );
          const readbackSecretHash =
            command.readbackSecret === undefined
              ? null
              : yield* hashReadbackSecret(command.readbackSecret, "finish");
          const preliminaryIntent = {
            actorUserId: requestAuth.validated.actor.userId,
            challengeId: command.challengeId,
            clientIntentDigest,
            mode: context.mode,
            readbackSecretHash,
          } as const;
          const replay = yield* readStoredReceipt(
            command.operationId,
            "finish"
          );
          if (
            replay !== null &&
            !preliminaryReceiptIntent(replay, preliminaryIntent)
          ) {
            return yield* error("finish", "operation-conflict");
          }
          const fresh =
            replay === null
              ? yield* freshPrerequisites("finish", context)
              : undefined;
          const verified = yield* verifier
            .verifyRegistration({
              attestation: passkeyConfig.attestation,
              expectedOrigin: passkeyConfig.expectedOrigins,
              relyingPartyId: passkeyConfig.relyingParty.id,
              requireUserVerification: passkeyConfig.requireUserVerification,
              response: command.credential,
              supportedAlgorithmIDs: passkeyConfig.pubKeyCredParams.map(
                ({ alg }) => alg
              ),
              userId: requestAuth.validated.actor.userId,
            })
            .pipe(
              Effect.mapError((cause) =>
                error("finish", "verification-failed", cause)
              )
            );
          if (
            !Number.isSafeInteger(verified.signCount) ||
            verified.signCount < 0
          ) {
            return yield* error("finish", "verification-failed");
          }
          const verifiedIntentDigest = yield* hashVerifiedIntent(verified);
          const intent = {
            ...preliminaryIntent,
            verifiedIntentDigest,
          } as const;
          if (replay !== null) {
            if (!exactReceiptIntent(replay, intent)) {
              return yield* error("finish", "operation-conflict");
            }
            const receipt = yield* receiptFromRow(replay).pipe(
              Effect.mapError((cause) => error("finish", "storage", cause))
            );
            return { receipt, replayed: true };
          }
          if (fresh === undefined) {
            return yield* error("finish", "storage");
          }
          const { recovery } = fresh;
          const inspected = yield* challenge
            .inspect({
              challengeId: command.challengeId,
              secret: Redacted.make(verified.challenge),
              type: passkeyRegistrationChallengeType,
            })
            .pipe(
              Effect.mapError((cause) =>
                error("finish", "challenge-invalid", cause)
              )
            );
          const metadata = yield* Schema.decodeUnknownEffect(
            PasskeyEnrollmentChallengeMetadata
          )(inspected.metadata).pipe(
            Effect.mapError((cause) =>
              error("finish", "challenge-invalid", cause)
            )
          );
          if (
            inspected.subject !== requestAuth.validated.actor.userId ||
            metadata.operationId !== command.operationId ||
            metadata.authorization !==
              (recoveryMode ? "recovery-remediation" : "step-up") ||
            (metadata.readbackSecretHash ?? null) !== readbackSecretHash
          ) {
            return yield* error("finish", "operation-conflict");
          }
          if (
            metadata.sessionId !== requestAuth.validated.actor.sessionId ||
            metadata.sessionSecretHash !== requestAuth.sessionSecretHash ||
            metadata.recoveryIdentityId !== recovery.id ||
            metadata.recoveryIdentityVersion !== recovery.version
          ) {
            return yield* error("finish", "challenge-invalid");
          }

          const timestamp = Schema.decodeUnknownSync(UnixMillis)(runtime.now());
          const authTimestamp = AuthUnixMillis(timestamp);
          const nonce = runtime.randomId();
          const recordId = yield* crypto
            .randomToken(16)
            .pipe(
              Effect.mapError((cause) => error("finish", "storage", cause))
            );
          const remediation = recoveryMode
            ? yield* Effect.gen(function* () {
                const [identity] = yield* database
                  .select({ id: authUserIdentity.id })
                  .from(authUserIdentity)
                  .where(
                    and(
                      eq(
                        authUserIdentity.userId,
                        requestAuth.validated.actor.userId
                      ),
                      eq(authUserIdentity.isPrimaryLogin, 1),
                      isNotNull(authUserIdentity.verifiedAt),
                      isNull(authUserIdentity.revokedAt)
                    )
                  )
                  .limit(1)
                  .pipe(
                    Effect.mapError((cause) =>
                      error("finish", "storage", cause)
                    )
                  );
                if (
                  identity === undefined ||
                  sessions.prepareCreate === undefined
                ) {
                  return yield* error("finish", "storage");
                }
                const replacementIdentityId = yield* crypto
                  .randomToken(16)
                  .pipe(
                    Effect.mapError((cause) =>
                      error("finish", "storage", cause)
                    )
                  );
                const codeSetId = yield* crypto
                  .randomToken(16)
                  .pipe(
                    Effect.mapError((cause) =>
                      error("finish", "storage", cause)
                    )
                  );
                const plaintext = yield* recoveryCodes
                  .generate({ count: 10, groupSize: 4, length: 16 })
                  .pipe(
                    Effect.mapError((cause) =>
                      error("finish", "storage", cause)
                    )
                  );
                const codeRecords = yield* Effect.all(
                  plaintext.map((code) =>
                    Effect.gen(function* () {
                      const codeHash = yield* recoveryCodes
                        .hash({ code })
                        .pipe(
                          Effect.mapError((cause) =>
                            error("finish", "storage", cause)
                          )
                        );
                      const id = yield* crypto
                        .randomToken(16)
                        .pipe(
                          Effect.mapError((cause) =>
                            error("finish", "storage", cause)
                          )
                        );
                      return { codeHash, id };
                    })
                  )
                );
                const authenticationEvidence = passkeyEvidence({
                  backedUp: verified.backedUp,
                  credentialId: CredentialId(verified.credentialId),
                  signCount: verified.signCount,
                  userVerification: "verified",
                  verifiedAt: authTimestamp,
                });
                const prepared = yield* sessions
                  .prepareCreate({
                    authenticationEvents: [authenticationEvidence],
                    claims: {
                      verifiedIdentityKinds: ["email", "recovery-passkey"],
                    },
                    metadata: { purpose: "account-recovery-completed" },
                    now: authTimestamp,
                    userId: requestAuth.validated.actor.userId,
                  })
                  .pipe(
                    Effect.mapError((cause) =>
                      error("finish", "storage", cause)
                    )
                  );
                const body = yield* Schema.decodeUnknownEffect(
                  RecoveryPasskeyRemediationCompleted
                )({
                  codes: plaintext.map((code) => Redacted.value(code)),
                  receipt: {
                    committedAt: timestamp,
                    credentialRecordId: recordId,
                    mode: "recovery-remediation",
                    operationId: command.operationId,
                    recoveryCodeCount: 10,
                    recoveryCodeSetId: codeSetId,
                    schemaVersion: 1,
                  },
                  type: "recovery-remediation-completed",
                }).pipe(
                  Effect.mapError((cause) => error("finish", "storage", cause))
                );
                return {
                  body,
                  codeSetId,
                  codeRecords,
                  previousIdentityId: identity.id,
                  prepared,
                  replacementIdentityId,
                };
              })
            : undefined;
          const trustedStepUpSession = recoveryMode
            ? recoveryRemediationSessionPredicate(
                database,
                requestAuth,
                timestamp
              )
            : sensitiveSessionPredicate(database, requestAuth, timestamp);
          const trustedBaseSession = recoveryMode
            ? trustedStepUpSession
            : transactionalSessionPredicate(database, requestAuth, timestamp);
          const metadataJson = JSON.stringify(metadata);
          const auditEvent = yield* Schema.decodeUnknownEffect(
            CustomAuditEventSchema
          )({
            actor: {
              sessionId: requestAuth.validated.actor.sessionId,
              type: "user",
              userId: requestAuth.validated.actor.userId,
            },
            occurredAt: timestamp,
            payload: {
              credentialRecordId: recordId,
              operationId: metadata.operationId,
            },
            subject: {
              type: "user",
              userId: requestAuth.validated.actor.userId,
            },
            type: "app.passkey.enrolled",
            version: 1,
          }).pipe(
            Effect.mapError((cause) => error("finish", "storage", cause))
          );
          const normalizedAudit = normalizedAuthAuditEvent(auditEvent);
          const remediationAuditEvent =
            remediation === undefined
              ? undefined
              : yield* Schema.decodeUnknownEffect(CustomAuditEventSchema)({
                  actor: {
                    sessionId: requestAuth.validated.actor.sessionId,
                    type: "user",
                    userId: requestAuth.validated.actor.userId,
                  },
                  occurredAt: timestamp,
                  payload: {
                    codeCount: remediation.codeRecords.length,
                    credentialRecordId: recordId,
                    operationId: metadata.operationId,
                  },
                  subject: {
                    type: "user",
                    userId: requestAuth.validated.actor.userId,
                  },
                  type: "app.account_recovery.completed",
                  version: 1,
                }).pipe(
                  Effect.mapError((cause) => error("finish", "storage", cause))
                );
          const normalizedRemediationAudit =
            remediationAuditEvent === undefined
              ? undefined
              : normalizedAuthAuditEvent(remediationAuditEvent);
          const recoveryValid = exists(
            database
              .select({ value: sql`1` })
              .from(appExternalRecoveryIdentity)
              .where(
                and(
                  eq(appExternalRecoveryIdentity.id, recovery.id),
                  eq(
                    appExternalRecoveryIdentity.userId,
                    requestAuth.validated.actor.userId
                  ),
                  eq(appExternalRecoveryIdentity.status, "verified"),
                  eq(appExternalRecoveryIdentity.version, recovery.version)
                )
              )
          );
          const challengeValid = exists(
            database
              .select({ value: sql`1` })
              .from(authVerification)
              .where(
                and(
                  eq(authVerification.id, command.challengeId),
                  eq(authVerification.type, "passkey-registration"),
                  eq(
                    authVerification.subject,
                    requestAuth.validated.actor.userId
                  ),
                  isNull(authVerification.consumedAt),
                  gt(authVerification.expiresAt, controlPlaneDatabaseNow),
                  eq(authVerification.metadata, metadataJson)
                )
              )
          );
          const credentialAvailable = notExists(
            database
              .select({ value: sql`1` })
              .from(authPasskeyCredential)
              .where(
                eq(authPasskeyCredential.credentialId, verified.credentialId)
              )
          );
          const operationAvailable = notExists(
            database
              .select({ value: sql`1` })
              .from(appPasskeyEnrollmentReceipt)
              .where(
                eq(appPasskeyEnrollmentReceipt.operationId, command.operationId)
              )
          );
          const authorized = exists(
            database
              .select({ value: sql`1` })
              .from(appAuthorizationGuard)
              .where(eq(appAuthorizationGuard.nonce, nonce))
          );
          const remediationStatements: readonly ControlPlane.ControlPlaneStatement[] =
            remediation === undefined ||
            normalizedRemediationAudit === undefined
              ? []
              : [
                  database
                    .update(authSession)
                    .set({ revokedAt: timestamp })
                    .where(
                      and(
                        eq(
                          authSession.userId,
                          requestAuth.validated.actor.userId
                        ),
                        ne(authSession.id, remediation.prepared.row.id),
                        isNull(authSession.revokedAt),
                        authorized
                      )
                    ),
                  database
                    .update(authUserIdentity)
                    .set({
                      replacedById: remediation.replacementIdentityId,
                      revokedAt: sql<number>`max(
                        ${timestamp},
                        ${authUserIdentity.createdAt},
                        ${controlPlaneDatabaseNow}
                      )`,
                      updatedAt: sql<number>`max(
                        ${timestamp},
                        ${authUserIdentity.updatedAt},
                        ${controlPlaneDatabaseNow}
                      )`,
                    })
                    .where(
                      and(
                        eq(authUserIdentity.id, remediation.previousIdentityId),
                        eq(
                          authUserIdentity.userId,
                          requestAuth.validated.actor.userId
                        ),
                        eq(authUserIdentity.isPrimaryLogin, 1),
                        isNotNull(authUserIdentity.verifiedAt),
                        isNull(authUserIdentity.revokedAt),
                        authorized
                      )
                    ),
                  database.insert(authUserIdentity).select(
                    database
                      .select({
                        createdAt: sql`${timestamp}`.as("created_at"),
                        id: sql`${remediation.replacementIdentityId}`.as("id"),
                        isPrimaryLogin: sql`1`.as("is_primary_login"),
                        kind: sql`'recovery-passkey'`.as("kind"),
                        metadata: sql`${JSON.stringify({
                          purpose: "account-recovery-completed",
                        })}`.as("metadata"),
                        normalizedValue:
                          sql`${requestAuth.validated.actor.userId}`.as(
                            "normalized_value"
                          ),
                        replacedById: sql<null>`null`.as("replaced_by_id"),
                        revokedAt: sql<null>`null`.as("revoked_at"),
                        scopeId: sql`'global'`.as("scope_id"),
                        scopeType: sql`'global'`.as("scope_type"),
                        updatedAt: sql`${timestamp}`.as("updated_at"),
                        userId: sql`${requestAuth.validated.actor.userId}`.as(
                          "user_id"
                        ),
                        value: sql`${requestAuth.validated.actor.userId}`.as(
                          "value"
                        ),
                        verifiedAt: sql`${timestamp}`.as("verified_at"),
                      })
                      .from(appAuthorizationGuard)
                      .where(eq(appAuthorizationGuard.nonce, nonce))
                  ),
                  database
                    .update(authPasskeyCredential)
                    .set({
                      revokedAt: sql<number>`max(
                        ${timestamp},
                        ${authPasskeyCredential.createdAt},
                        ${controlPlaneDatabaseNow}
                      )`,
                    })
                    .where(
                      and(
                        eq(
                          authPasskeyCredential.userId,
                          requestAuth.validated.actor.userId
                        ),
                        ne(authPasskeyCredential.id, recordId),
                        isNull(authPasskeyCredential.revokedAt),
                        authorized
                      )
                    ),
                  database
                    .update(authCredential)
                    .set({
                      revokedAt: sql<number>`max(
                        ${timestamp},
                        ${authCredential.createdAt},
                        ${controlPlaneDatabaseNow}
                      )`,
                      updatedAt: sql<number>`max(
                        ${timestamp},
                        ${authCredential.updatedAt},
                        ${controlPlaneDatabaseNow}
                      )`,
                    })
                    .where(
                      and(
                        eq(
                          authCredential.userId,
                          requestAuth.validated.actor.userId
                        ),
                        isNull(authCredential.revokedAt),
                        authorized
                      )
                    ),
                  database
                    .update(authTotpFactor)
                    .set({
                      revokedAt: sql<number>`max(
                        ${timestamp},
                        ${authTotpFactor.createdAt},
                        ${controlPlaneDatabaseNow}
                      )`,
                    })
                    .where(
                      and(
                        eq(
                          authTotpFactor.userId,
                          requestAuth.validated.actor.userId
                        ),
                        isNull(authTotpFactor.revokedAt),
                        authorized
                      )
                    ),
                  database
                    .update(authRecoveryCode)
                    .set({
                      revokedAt: sql<number>`max(
                        ${timestamp},
                        ${authRecoveryCode.createdAt},
                        ${controlPlaneDatabaseNow}
                      )`,
                    })
                    .where(
                      and(
                        eq(
                          authRecoveryCode.userId,
                          requestAuth.validated.actor.userId
                        ),
                        isNull(authRecoveryCode.usedAt),
                        isNull(authRecoveryCode.revokedAt),
                        authorized
                      )
                    ),
                  ...remediation.codeRecords.map((code) =>
                    database.insert(authRecoveryCode).select(
                      sql`select ${code.id},
                                 ${requestAuth.validated.actor.userId},
                                 ${code.codeHash}, ${timestamp}, null, null,
                                  ${JSON.stringify({
                                    purpose: "account-recovery-completed",
                                    setId: remediation.codeSetId,
                                  })}
                          where ${authorized}`
                    )
                  ),
                  database.insert(authSession).select(
                    database
                      .select({
                        aal: sql`${remediation.prepared.row.aal}`.as("aal"),
                        amr: sql`${JSON.stringify(remediation.prepared.row.amr)}`.as(
                          "amr"
                        ),
                        authTime: sql`${remediation.prepared.row.authTime}`.as(
                          "auth_time"
                        ),
                        authenticationEvents:
                          sql`${JSON.stringify(remediation.prepared.row.authenticationEvents)}`.as(
                            "authentication_events"
                          ),
                        createdAt:
                          sql`${remediation.prepared.row.createdAt}`.as(
                            "created_at"
                          ),
                        expiresAt:
                          sql`${remediation.prepared.row.expiresAt}`.as(
                            "expires_at"
                          ),
                        id: sql`${remediation.prepared.row.id}`.as("id"),
                        lastSeenAt: sql<null>`null`.as("last_seen_at"),
                        metadata: sql`${JSON.stringify({
                          __effectAuthSession: {
                            claims: remediation.prepared.row.claims,
                            metadata: remediation.prepared.row.metadata,
                            version: 1,
                          },
                        })}`.as("metadata"),
                        mfaVerifiedAt:
                          remediation.prepared.row.mfaVerifiedAt === undefined
                            ? sql<null>`null`.as("mfa_verified_at")
                            : sql`${remediation.prepared.row.mfaVerifiedAt}`.as(
                                "mfa_verified_at"
                              ),
                        revokedAt: sql<null>`null`.as("revoked_at"),
                        rotatedAt: sql<null>`null`.as("rotated_at"),
                        secretHash:
                          sql`${remediation.prepared.row.secretHash}`.as(
                            "secret_hash"
                          ),
                        userId: sql`${remediation.prepared.row.userId}`.as(
                          "user_id"
                        ),
                      })
                      .from(appAuthorizationGuard)
                      .where(eq(appAuthorizationGuard.nonce, nonce))
                  ),
                  database.insert(authAuditLog).select(
                    database
                      .select({
                        actorUserId:
                          sql`${requestAuth.validated.actor.userId}`.as(
                            "actor_user_id"
                          ),
                        createdAt: sql`${timestamp}`.as("created_at"),
                        event: sql`${normalizedRemediationAudit.event}`.as(
                          "event"
                        ),
                        eventBytes:
                          sql`${normalizedRemediationAudit.eventBytes}`.as(
                            "event_bytes"
                          ),
                        id: sql`${`account-recovery-completed:${metadata.operationId}`}`.as(
                          "id"
                        ),
                        normalizationVersion:
                          sql`${normalizedRemediationAudit.normalizationVersion}`.as(
                            "normalization_version"
                          ),
                        occurredAt:
                          sql`${normalizedRemediationAudit.occurredAt}`.as(
                            "occurred_at"
                          ),
                        type: sql`${normalizedRemediationAudit.type}`.as(
                          "type"
                        ),
                        userId: sql`${requestAuth.validated.actor.userId}`.as(
                          "user_id"
                        ),
                      })
                      .from(appAuthorizationGuard)
                      .where(eq(appAuthorizationGuard.nonce, nonce))
                  ),
                ];
          const statements: ControlPlane.ControlPlaneStatements = [
            database.insert(appAuthorizationGuard).select(
              sql`select ${nonce} where ${trustedStepUpSession}
                      and ${recoveryValid}
                      and ${challengeValid}
                      and ${credentialAvailable}
                      and ${operationAvailable}`
            ),
            database.all(sql`select cast(${trustedStepUpSession} as integer)
                                      as step_up_valid,
                                   cast(${trustedBaseSession} as integer)
                                      as session_valid,
                                   cast(${recoveryValid} as integer)
                                      as recovery_valid,
                                   cast(${challengeValid} as integer)
                                      as challenge_valid,
                                   cast(${credentialAvailable} as integer)
                                      as credential_available,
                                   cast(${operationAvailable} as integer)
                                      as operation_available,
                                   cast(${authorized} as integer) as authorized`),
            database
              .update(authVerification)
              .set({ consumedAt: timestamp })
              .where(
                and(
                  eq(authVerification.id, command.challengeId),
                  eq(authVerification.type, "passkey-registration"),
                  isNull(authVerification.consumedAt),
                  authorized
                )
              ),
            database
              .insert(authPasskeyCredential)
              .select(
                database
                  .select({
                    backedUp: sql`${backedUpValue(verified.backedUp)}`.as(
                      "backed_up"
                    ),
                    createdAt: sql`${timestamp}`.as("created_at"),
                    credentialId: sql`${verified.credentialId}`.as(
                      "credential_id"
                    ),
                    id: sql`${recordId}`.as("id"),
                    metadata: sql`${nullableJson(verified.metadata)}`.as(
                      "metadata"
                    ),
                    publicKey: sql`${verified.publicKey}`.as("public_key"),
                    signCount: sql`${verified.signCount}`.as("sign_count"),
                    transports: sql`${nullableJson(verified.transports)}`.as(
                      "transports"
                    ),
                    userId: sql`${requestAuth.validated.actor.userId}`.as(
                      "user_id"
                    ),
                  })
                  .from(appAuthorizationGuard)
                  .where(eq(appAuthorizationGuard.nonce, nonce))
              )
              .returning({
                credential_record_id: authPasskeyCredential.id,
              }),
            ...remediationStatements,
            database.insert(authAuditLog).select(
              database
                .select({
                  actorUserId: sql`${requestAuth.validated.actor.userId}`.as(
                    "actor_user_id"
                  ),
                  createdAt: sql`${timestamp}`.as("created_at"),
                  event: sql`${normalizedAudit.event}`.as("event"),
                  eventBytes: sql`${normalizedAudit.eventBytes}`.as(
                    "event_bytes"
                  ),
                  id: sql`${`passkey-enrollment:${metadata.operationId}`}`.as(
                    "id"
                  ),
                  normalizationVersion:
                    sql`${normalizedAudit.normalizationVersion}`.as(
                      "normalization_version"
                    ),
                  occurredAt: sql`${normalizedAudit.occurredAt}`.as(
                    "occurred_at"
                  ),
                  type: sql`${normalizedAudit.type}`.as("type"),
                  userId: sql`${requestAuth.validated.actor.userId}`.as(
                    "user_id"
                  ),
                })
                .from(appAuthorizationGuard)
                .where(eq(appAuthorizationGuard.nonce, nonce))
            ),
            database
              .insert(appPasskeyEnrollmentReceipt)
              .select(
                database
                  .select({
                    actorUserId: sql`${requestAuth.validated.actor.userId}`.as(
                      "actor_user_id"
                    ),
                    challengeId: sql`${command.challengeId}`.as("challenge_id"),
                    clientIntentDigest: sql`${clientIntentDigest}`.as(
                      "client_intent_digest"
                    ),
                    committedAt: sql`${timestamp}`.as("committed_at"),
                    credentialRecordId: sql`${recordId}`.as(
                      "credential_record_id"
                    ),
                    mode: sql`${context.mode}`.as("mode"),
                    operationId: sql`${command.operationId}`.as("operation_id"),
                    readbackSecretHash:
                      readbackSecretHash === null
                        ? sql<null>`null`.as("readback_secret_hash")
                        : sql`${readbackSecretHash}`.as("readback_secret_hash"),
                    recoveryIdentityId: sql`${recovery.id}`.as(
                      "recovery_identity_id"
                    ),
                    recoveryIdentityVersion: sql`${recovery.version}`.as(
                      "recovery_identity_version"
                    ),
                    replacementIdentityId:
                      remediation === undefined
                        ? sql<null>`null`.as("replacement_identity_id")
                        : sql`${remediation.replacementIdentityId}`.as(
                            "replacement_identity_id"
                          ),
                    resultingCodeCount:
                      remediation === undefined
                        ? sql<null>`null`.as("resulting_code_count")
                        : sql`10`.as("resulting_code_count"),
                    resultingCodeSetId:
                      remediation === undefined
                        ? sql<null>`null`.as("resulting_code_set_id")
                        : sql`${remediation.codeSetId}`.as(
                            "resulting_code_set_id"
                          ),
                    resultingSessionId:
                      remediation === undefined
                        ? sql<null>`null`.as("resulting_session_id")
                        : sql`${remediation.prepared.row.id}`.as(
                            "resulting_session_id"
                          ),
                    schemaVersion: sql<1>`1`.as("schema_version"),
                    verifiedIntentDigest: sql`${verifiedIntentDigest}`.as(
                      "verified_intent_digest"
                    ),
                  })
                  .from(appAuthorizationGuard)
                  .where(eq(appAuthorizationGuard.nonce, nonce))
              )
              .returning({
                operation_id: appPasskeyEnrollmentReceipt.operationId,
              }),
            database
              .delete(appAuthorizationGuard)
              .where(eq(appAuthorizationGuard.nonce, nonce)),
          ];
          const results = yield* batch.execute(statements).pipe(
            Effect.catchTag("ControlPlaneBatchError", (cause) =>
              cause.commitState === "unknown"
                ? readStoredReceipt(command.operationId, "finish").pipe(
                    Effect.flatMap((stored) =>
                      stored === null
                        ? Effect.fail(
                            new PasskeyEnrollmentError({
                              cause: cause.cause,
                              commitState: "unknown",
                              operation: "finish",
                              reason: "indeterminate",
                            })
                          )
                        : exactReceiptIntent(stored, intent)
                          ? receiptFromRow(stored).pipe(
                              Effect.map((receipt) => ({
                                receipt,
                                replayed: true,
                              })),
                              Effect.mapError((decodeCause) =>
                                error("finish", "storage", decodeCause)
                              )
                            )
                          : Effect.fail(
                              error("finish", "operation-conflict", cause.cause)
                            )
                    )
                  )
                : Effect.fail(
                    new PasskeyEnrollmentError({
                      cause: cause.cause,
                      commitState: cause.commitState,
                      operation: "finish",
                      reason: "storage",
                    })
                  )
            )
          );
          if ("receipt" in results) {
            return results;
          }
          const [status] = yield* Schema.decodeUnknownEffect(
            Schema.Array(
              Schema.Struct({
                authorized: Schema.Number,
                challenge_valid: Schema.Number,
                credential_available: Schema.Number,
                operation_available: Schema.Number,
                recovery_valid: Schema.Number,
                session_valid: Schema.Number,
                step_up_valid: Schema.Number,
              })
            )
          )(results[1]?.results).pipe(
            Effect.mapError((cause) => error("finish", "indeterminate", cause))
          );
          if (status?.authorized !== 1) {
            if (status?.session_valid !== 1) {
              return yield* error("finish", "restricted-session");
            }
            if (status?.step_up_valid !== 1) {
              return yield* error("finish", "step-up-required");
            }
            if (status.recovery_valid !== 1) {
              return yield* error("finish", "recovery-identity-required");
            }
            if (status.operation_available !== 1) {
              const concurrentReplay = yield* readStoredReceipt(
                command.operationId,
                "finish"
              );
              if (
                concurrentReplay !== null &&
                exactReceiptIntent(concurrentReplay, intent)
              ) {
                const receipt = yield* receiptFromRow(concurrentReplay).pipe(
                  Effect.mapError((cause) => error("finish", "storage", cause))
                );
                return { receipt, replayed: true };
              }
              return yield* error("finish", "operation-conflict");
            }
            if (status.credential_available !== 1) {
              return yield* error("finish", "credential-conflict");
            }
            return yield* error("finish", "challenge-invalid");
          }
          const returned = yield* Schema.decodeUnknownEffect(
            Schema.Array(Schema.Struct({ id: Schema.String }))
          )(results[3]?.results).pipe(
            Effect.mapError((cause) => error("finish", "indeterminate", cause))
          );
          if (returned[0]?.id !== recordId) {
            return yield* error("finish", "indeterminate");
          }
          const receiptRows = yield* Schema.decodeUnknownEffect(
            Schema.Array(Schema.Struct({ operation_id: Schema.String }))
          )(results.at(-2)?.results).pipe(
            Effect.mapError((cause) => error("finish", "indeterminate", cause))
          );
          if (receiptRows[0]?.operation_id !== command.operationId) {
            return yield* error("finish", "indeterminate");
          }
          const receipt =
            remediation?.body.receipt ??
            (yield* Schema.decodeUnknownEffect(PasskeyEnrollmentReceiptSchema)({
              committedAt: timestamp,
              credentialRecordId: recordId,
              mode: "normal",
              operationId: command.operationId,
              schemaVersion: 1,
            }).pipe(
              Effect.mapError((cause) => error("finish", "storage", cause))
            ));
          return {
            receipt,
            replayed: false,
            ...(remediation === undefined
              ? {}
              : {
                  remediation: {
                    body: remediation.body,
                    session: remediation.prepared.session,
                  },
                }),
          };
        }),
      readOperation: (untrusted) =>
        Effect.gen(function* () {
          const command = yield* Schema.decodeUnknownEffect(
            ReadPasskeyEnrollmentCommand
          )(untrusted).pipe(
            Effect.mapError((cause) => error("finish", "invalid-input", cause))
          );
          const context = yield* requestContext("finish");
          if (context.recoveryMode) {
            return yield* error("finish", "restricted-session");
          }
          const clientIntentDigest = yield* hashClientIntent(
            command.credential
          );
          const stored = yield* readStoredReceipt(
            command.operationId,
            "finish"
          );
          if (
            stored === null ||
            !preliminaryReceiptIntent(stored, {
              actorUserId: context.requestAuth.validated.actor.userId,
              challengeId: command.challengeId,
              clientIntentDigest,
              mode: "normal",
              readbackSecretHash: null,
            })
          ) {
            return yield* error("finish", "operation-conflict");
          }
          return yield* receiptFromRow(stored).pipe(
            Effect.mapError((cause) => error("finish", "storage", cause))
          );
        }),
      readRecoveryOperation: (untrusted) =>
        Effect.gen(function* () {
          const command = yield* Schema.decodeUnknownEffect(
            ReadRecoveryPasskeyEnrollmentCommand
          )(untrusted).pipe(
            Effect.mapError((cause) => error("finish", "invalid-proof", cause))
          );
          const readbackSecretHash = yield* hashReadbackSecret(
            command.readbackSecret,
            "finish"
          );
          const clientIntentDigest = yield* hashClientIntent(
            command.credential
          );
          const stored = yield* readStoredReceipt(
            command.operationId,
            "finish"
          );
          if (
            stored === null ||
            !preliminaryReceiptIntent(stored, {
              actorUserId: stored.actorUserId,
              challengeId: command.challengeId,
              clientIntentDigest,
              mode: "recovery-remediation",
              readbackSecretHash,
            })
          ) {
            return yield* error("finish", "invalid-proof");
          }
          return yield* receiptFromRow(stored).pipe(
            Effect.mapError((cause) => error("finish", "storage", cause))
          );
        }),
    });
  })
);

export const PasskeyEnrollmentD1Layer = PasskeyEnrollment.layerNoDeps.pipe(
  Layer.provide(PasskeyEnrollmentTransactionD1Layer)
);
