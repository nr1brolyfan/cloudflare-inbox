import { CustomAuditEventSchema } from "@effect-auth/core/AuditLog";
import { AuthRateLimit } from "@effect-auth/core/AuthRateLimit";
import * as AuthPermission from "@effect-auth/core/Permission";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  isNull,
  ne,
  notExists,
  sql,
} from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { UnixMillis } from "#/modules/mailbox/domain/Mailbox";

import {
  ListPasskeyCredentialsQuery,
  PasskeyCredentialAdministration,
  PasskeyCredentialAdministrationError,
  PasskeyCredentialList,
  PasskeyCredentialSummary,
  PasskeyManagementId,
  PasskeyRevocationReceipt,
  ReadPasskeyRevocationQuery,
  RevokePasskeyCredentialCommand,
  RevokedPasskeyCredential,
} from "../auth/passkey-credential-administration";
import { authAuditLog } from "../auth/schema/modules/audit-log";
import { authPasskeyCredential } from "../auth/schema/modules/passkeys";
import type { CurrentRequestAuthShape } from "../auth/session";
import { CurrentRequestAuth } from "../auth/session";
import {
  requireSensitiveOperationStepUp,
  SensitiveOperationStepUpClock,
} from "../auth/step-up-policy";
import * as ControlPlane from "./batch";
import { ControlPlaneDatabase } from "./database";
import {
  controlPlaneDatabaseNow,
  sensitiveSessionPredicate,
  transactionalSessionPredicate,
} from "./request-auth-guard-d1";
import {
  appAuthorizationGuard,
  appExternalRecoveryIdentity,
  appPasskeyCredentialRevocation,
} from "./schema";

export interface PasskeyCredentialAdministrationRuntime {
  readonly now: () => number;
  readonly randomId: () => string;
}

export const PasskeyCredentialAdministrationRuntime =
  Context.Service<PasskeyCredentialAdministrationRuntime>(
    "cloudflare-inbox/PasskeyCredentialAdministrationRuntime"
  );

export const PasskeyCredentialAdministrationRuntimeLive = Layer.succeed(
  PasskeyCredentialAdministrationRuntime,
  PasskeyCredentialAdministrationRuntime.of({
    now: Date.now,
    randomId: () => crypto.randomUUID(),
  })
);

const failure = (
  operation: PasskeyCredentialAdministrationError["operation"],
  reason: PasskeyCredentialAdministrationError["reason"],
  cause?: unknown
) => new PasskeyCredentialAdministrationError({ cause, operation, reason });

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

const requireUnrestricted = (
  requestAuth: CurrentRequestAuthShape,
  operation: PasskeyCredentialAdministrationError["operation"]
) =>
  (requestAuth.validated.currentSession.claims?.requirements?.length ?? 0) === 0
    ? Effect.void
    : Effect.fail(failure(operation, "restricted-session"));

/** Privacy-safe passkey inventory and replay-safe destructive administration. */
export const PasskeyCredentialAdministrationLive = Layer.effect(
  PasskeyCredentialAdministration,
  Effect.gen(function* () {
    const authRateLimit = yield* AuthRateLimit;
    const batch = yield* ControlPlane.ControlPlaneBatch;
    const database = yield* ControlPlaneDatabase;
    const runtime = yield* PasskeyCredentialAdministrationRuntime;
    const stepUpClock = yield* SensitiveOperationStepUpClock;

    const requestContext = (
      operation: PasskeyCredentialAdministrationError["operation"]
    ) =>
      Effect.gen(function* () {
        const requestAuth = yield* CurrentRequestAuth;
        const principal = yield* AuthPermission.CurrentPrincipal;
        yield* ensureTrusted(requestAuth, principal);
        yield* requireUnrestricted(requestAuth, operation);
        return requestAuth;
      });

    const readReceipt = (
      operationId: string,
      userId: string,
      operation: PasskeyCredentialAdministrationError["operation"]
    ) =>
      database
        .select({
          credentialCreatedAt:
            appPasskeyCredentialRevocation.credentialCreatedAt,
          credentialLastUsedAt:
            appPasskeyCredentialRevocation.credentialLastUsedAt,
          credentialRecordId: appPasskeyCredentialRevocation.credentialRecordId,
          operationId: appPasskeyCredentialRevocation.operationId,
          revokedAt: appPasskeyCredentialRevocation.revokedAt,
        })
        .from(appPasskeyCredentialRevocation)
        .where(
          and(
            eq(appPasskeyCredentialRevocation.operationId, operationId),
            eq(appPasskeyCredentialRevocation.userId, userId)
          )
        )
        .limit(1)
        .pipe(
          Effect.mapError((cause) => failure(operation, "storage", cause)),
          Effect.flatMap(([row]) =>
            row === undefined
              ? Effect.succeed(null)
              : Schema.decodeUnknownEffect(PasskeyRevocationReceipt)({
                  credential: {
                    createdAt: row.credentialCreatedAt,
                    id: row.credentialRecordId,
                    ...(row.credentialLastUsedAt === null
                      ? {}
                      : { lastUsedAt: row.credentialLastUsedAt }),
                    revokedAt: row.revokedAt,
                  },
                  operationId: row.operationId,
                }).pipe(
                  Effect.mapError((cause) =>
                    failure(operation, "storage", cause)
                  )
                )
          )
        );

    return PasskeyCredentialAdministration.of({
      list: (untrusted) =>
        Effect.gen(function* () {
          yield* Schema.decodeUnknownEffect(ListPasskeyCredentialsQuery)(
            untrusted
          ).pipe(
            Effect.mapError((cause) => failure("list", "invalid-input", cause))
          );
          const requestAuth = yield* requestContext("list");
          yield* authRateLimit
            .require({
              operation: "auth.passkey.credentials.list",
              userId: requestAuth.validated.actor.userId,
            })
            .pipe(
              Effect.mapError((cause) =>
                failure(
                  "list",
                  cause._tag === "RateLimitExceededError"
                    ? "rate-limited"
                    : "storage",
                  cause
                )
              )
            );
          const rows = yield* database
            .select({
              createdAt: authPasskeyCredential.createdAt,
              id: authPasskeyCredential.id,
              lastUsedAt: authPasskeyCredential.lastUsedAt,
            })
            .from(authPasskeyCredential)
            .where(
              and(
                eq(
                  authPasskeyCredential.userId,
                  requestAuth.validated.actor.userId
                ),
                isNull(authPasskeyCredential.revokedAt)
              )
            )
            .orderBy(
              desc(authPasskeyCredential.createdAt),
              asc(authPasskeyCredential.id)
            )
            .limit(100)
            .pipe(
              Effect.mapError((cause) => failure("list", "storage", cause))
            );
          return yield* Schema.decodeUnknownEffect(PasskeyCredentialList)({
            credentials: rows.map((row) =>
              PasskeyCredentialSummary.make({
                createdAt: Schema.decodeUnknownSync(UnixMillis)(row.createdAt),
                id: Schema.decodeUnknownSync(PasskeyManagementId)(row.id),
                ...(row.lastUsedAt === null
                  ? {}
                  : {
                      lastUsedAt: Schema.decodeUnknownSync(UnixMillis)(
                        row.lastUsedAt
                      ),
                    }),
              })
            ),
          }).pipe(
            Effect.mapError((cause) => failure("list", "storage", cause))
          );
        }),
      readRevocation: (untrusted) =>
        Effect.gen(function* () {
          const query = yield* Schema.decodeUnknownEffect(
            ReadPasskeyRevocationQuery
          )(untrusted).pipe(
            Effect.mapError((cause) =>
              failure("read-revocation", "invalid-input", cause)
            )
          );
          const requestAuth = yield* requestContext("read-revocation");
          const receipt = yield* readReceipt(
            query.operationId,
            requestAuth.validated.actor.userId,
            "read-revocation"
          );
          if (receipt === null) {
            return yield* failure("read-revocation", "not-found");
          }
          return receipt;
        }),
      revoke: (untrusted) =>
        Effect.gen(function* () {
          const command = yield* Schema.decodeUnknownEffect(
            RevokePasskeyCredentialCommand
          )(untrusted).pipe(
            Effect.mapError((cause) =>
              failure("revoke", "invalid-input", cause)
            )
          );
          const requestAuth = yield* requestContext("revoke");
          const replay = yield* readReceipt(
            command.operationId,
            requestAuth.validated.actor.userId,
            "revoke"
          );
          if (replay !== null) {
            if (replay.credential.id !== command.id) {
              return yield* failure("revoke", "operation-conflict");
            }
            return replay;
          }
          yield* requireSensitiveOperationStepUp(
            requestAuth.validated.currentSession,
            stepUpClock.now()
          ).pipe(Effect.mapError(() => failure("revoke", "step-up-required")));
          yield* authRateLimit
            .require({
              operation: "auth.passkey.credentials.revoke",
              userId: requestAuth.validated.actor.userId,
            })
            .pipe(
              Effect.mapError((cause) =>
                failure(
                  "revoke",
                  cause._tag === "RateLimitExceededError"
                    ? "rate-limited"
                    : "storage",
                  cause
                )
              )
            );
          const [target] = yield* database
            .select({
              credentialId: authPasskeyCredential.credentialId,
              createdAt: authPasskeyCredential.createdAt,
              id: authPasskeyCredential.id,
              lastUsedAt: authPasskeyCredential.lastUsedAt,
            })
            .from(authPasskeyCredential)
            .where(
              and(
                eq(authPasskeyCredential.id, command.id),
                eq(
                  authPasskeyCredential.userId,
                  requestAuth.validated.actor.userId
                ),
                isNull(authPasskeyCredential.revokedAt)
              )
            )
            .limit(1)
            .pipe(
              Effect.mapError((cause) => failure("revoke", "storage", cause))
            );
          if (target === undefined) {
            return yield* failure("revoke", "not-found");
          }

          const timestamp = Schema.decodeUnknownSync(UnixMillis)(runtime.now());
          const nonce = runtime.randomId();
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
              credentialRecordId: command.id,
              operationId: command.operationId,
            },
            subject: {
              type: "user",
              userId: requestAuth.validated.actor.userId,
            },
            type: "app.passkey.credential.revoked",
            version: 1,
          }).pipe(
            Effect.mapError((cause) => failure("revoke", "storage", cause))
          );
          const trustedStepUpSession = sensitiveSessionPredicate(
            database,
            requestAuth,
            timestamp
          );
          const trustedBaseSession = transactionalSessionPredicate(
            database,
            requestAuth,
            timestamp
          );
          const { userId } = requestAuth.validated.actor;
          const recoveryValid = exists(
            database
              .select({ value: sql`1` })
              .from(appExternalRecoveryIdentity)
              .where(
                and(
                  eq(appExternalRecoveryIdentity.userId, userId),
                  eq(appExternalRecoveryIdentity.status, "verified")
                )
              )
          );
          const targetOwned = exists(
            database
              .select({ value: sql`1` })
              .from(authPasskeyCredential)
              .where(
                and(
                  eq(authPasskeyCredential.id, command.id),
                  eq(authPasskeyCredential.userId, userId)
                )
              )
          );
          const targetActive = exists(
            database
              .select({ value: sql`1` })
              .from(authPasskeyCredential)
              .where(
                and(
                  eq(authPasskeyCredential.id, command.id),
                  eq(authPasskeyCredential.userId, userId),
                  eq(authPasskeyCredential.credentialId, target.credentialId),
                  isNull(authPasskeyCredential.revokedAt)
                )
              )
          );
          const anotherFactorExists = exists(
            database
              .select({ value: sql`1` })
              .from(authPasskeyCredential)
              .where(
                and(
                  eq(authPasskeyCredential.userId, userId),
                  ne(authPasskeyCredential.id, command.id),
                  isNull(authPasskeyCredential.revokedAt)
                )
              )
          );
          const operationAvailable = notExists(
            database
              .select({ value: sql`1` })
              .from(appPasskeyCredentialRevocation)
              .where(
                eq(
                  appPasskeyCredentialRevocation.operationId,
                  command.operationId
                )
              )
          );
          const authorized = exists(
            database
              .select({ value: sql`1` })
              .from(appAuthorizationGuard)
              .where(eq(appAuthorizationGuard.nonce, nonce))
          );
          const statements: ControlPlane.ControlPlaneStatements = [
            database.insert(appAuthorizationGuard).select(
              sql`select ${nonce} where ${trustedStepUpSession}
                      and ${recoveryValid}
                      and ${targetActive}
                      and ${anotherFactorExists}
                      and ${operationAvailable}`
            ),
            database.all(sql`select cast(${trustedBaseSession} as integer)
                                      as session_valid,
                                   cast(${trustedStepUpSession} as integer)
                                      as step_up_valid,
                                   cast(${recoveryValid} as integer)
                                      as recovery_valid,
                                   cast(${targetOwned} as integer)
                                      as target_owned,
                                   cast(${targetActive} as integer)
                                      as target_active,
                                   cast(${anotherFactorExists} as integer)
                                      as another_factor_exists,
                                   cast(${operationAvailable} as integer)
                                      as operation_available,
                                   cast(${authorized} as integer) as authorized`),
            database
              .update(authPasskeyCredential)
              .set({
                revokedAt: sql<number>`max(
                  ${timestamp},
                  ${authPasskeyCredential.createdAt},
                  coalesce(${authPasskeyCredential.lastUsedAt}, 0),
                  ${controlPlaneDatabaseNow}
                )`,
              })
              .where(
                and(
                  eq(authPasskeyCredential.id, command.id),
                  eq(authPasskeyCredential.userId, userId),
                  eq(authPasskeyCredential.credentialId, target.credentialId),
                  isNull(authPasskeyCredential.revokedAt),
                  authorized
                )
              )
              .returning({
                created_at: authPasskeyCredential.createdAt,
                id: authPasskeyCredential.id,
                last_used_at: authPasskeyCredential.lastUsedAt,
                revoked_at: authPasskeyCredential.revokedAt,
              }),
            database.insert(appPasskeyCredentialRevocation).select(
              database
                .select({
                  credentialCreatedAt: authPasskeyCredential.createdAt,
                  credentialLastUsedAt: authPasskeyCredential.lastUsedAt,
                  credentialRecordId: authPasskeyCredential.id,
                  operationId: sql`${command.operationId}`.as("operation_id"),
                  revokedAt: authPasskeyCredential.revokedAt,
                  userId: sql`${userId}`.as("user_id"),
                })
                .from(authPasskeyCredential)
                .where(
                  and(
                    eq(authPasskeyCredential.id, command.id),
                    eq(authPasskeyCredential.userId, userId),
                    authorized
                  )
                )
            ),
            database.insert(authAuditLog).select(
              database
                .select({
                  actorUserId: sql`${userId}`.as("actor_user_id"),
                  createdAt: sql`${timestamp}`.as("created_at"),
                  event: sql`${JSON.stringify(auditEvent)}`.as("event"),
                  id: sql`${`passkey-revocation:${command.operationId}`}`.as(
                    "id"
                  ),
                  occurredAt: sql`${timestamp}`.as("occurred_at"),
                  type: sql`${auditEvent.type}`.as("type"),
                  userId: sql`${userId}`.as("user_id"),
                })
                .from(appAuthorizationGuard)
                .where(eq(appAuthorizationGuard.nonce, nonce))
            ),
            database
              .delete(appAuthorizationGuard)
              .where(eq(appAuthorizationGuard.nonce, nonce)),
          ];
          const results = yield* batch.execute(statements).pipe(
            Effect.catchTag("ControlPlaneBatchError", (cause) =>
              cause.commitState === "unknown"
                ? readReceipt(command.operationId, userId, "revoke").pipe(
                    Effect.flatMap((receipt) =>
                      receipt === null
                        ? Effect.fail(
                            new PasskeyCredentialAdministrationError({
                              cause: cause.cause,
                              commitState: "unknown",
                              operation: "revoke",
                              reason: "storage",
                            })
                          )
                        : receipt.credential.id === command.id
                          ? Effect.succeed(receipt)
                          : Effect.fail(failure("revoke", "operation-conflict"))
                    )
                  )
                : Effect.fail(
                    new PasskeyCredentialAdministrationError({
                      cause: cause.cause,
                      commitState: cause.commitState,
                      operation: "revoke",
                      reason: "storage",
                    })
                  )
            )
          );
          if (results instanceof PasskeyRevocationReceipt) {
            return results;
          }
          const [status] = yield* Schema.decodeUnknownEffect(
            Schema.Array(
              Schema.Struct({
                another_factor_exists: Schema.Number,
                authorized: Schema.Number,
                operation_available: Schema.Number,
                recovery_valid: Schema.Number,
                session_valid: Schema.Number,
                step_up_valid: Schema.Number,
                target_active: Schema.Number,
                target_owned: Schema.Number,
              })
            )
          )(results[1]?.results).pipe(
            Effect.mapError((cause) => failure("revoke", "storage", cause))
          );
          if (status?.authorized !== 1) {
            if (status?.session_valid !== 1) {
              return yield* failure("revoke", "unauthenticated");
            }
            if (status.step_up_valid !== 1) {
              return yield* failure("revoke", "step-up-required");
            }
            if (status.recovery_valid !== 1) {
              return yield* failure("revoke", "recovery-identity-required");
            }
            if (status.target_owned !== 1) {
              return yield* failure("revoke", "not-found");
            }
            if (status.target_active !== 1) {
              return yield* failure("revoke", "credential-changed");
            }
            if (status.another_factor_exists !== 1) {
              return yield* failure("revoke", "last-factor");
            }
            const concurrentReplay = yield* readReceipt(
              command.operationId,
              userId,
              "revoke"
            );
            if (concurrentReplay === null) {
              return yield* failure("revoke", "operation-conflict");
            }
            if (concurrentReplay.credential.id !== command.id) {
              return yield* failure("revoke", "operation-conflict");
            }
            return concurrentReplay;
          }
          const revokedRows = yield* Schema.decodeUnknownEffect(
            Schema.Array(
              Schema.Struct({
                created_at: Schema.Number,
                id: Schema.String,
                last_used_at: Schema.NullOr(Schema.Number),
                revoked_at: Schema.Number,
              })
            )
          )(results[2]?.results).pipe(
            Effect.mapError((cause) => failure("revoke", "storage", cause))
          );
          const [revoked] = revokedRows;
          if (revoked === undefined) {
            return yield* failure("revoke", "storage");
          }
          return yield* Schema.decodeUnknownEffect(PasskeyRevocationReceipt)({
            credential: RevokedPasskeyCredential.make({
              createdAt: Schema.decodeUnknownSync(UnixMillis)(
                revoked.created_at
              ),
              id: Schema.decodeUnknownSync(PasskeyManagementId)(revoked.id),
              ...(revoked.last_used_at === null
                ? {}
                : {
                    lastUsedAt: Schema.decodeUnknownSync(UnixMillis)(
                      revoked.last_used_at
                    ),
                  }),
              revokedAt: Schema.decodeUnknownSync(UnixMillis)(
                revoked.revoked_at
              ),
            }),
            operationId: command.operationId,
          }).pipe(
            Effect.mapError((cause) => failure("revoke", "storage", cause))
          );
        }),
    });
  })
);
