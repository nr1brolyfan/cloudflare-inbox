import { CustomAuditEventSchema } from "@effect-auth/core/AuditLog";
import { AuthRateLimit } from "@effect-auth/core/AuthRateLimit";
import * as AuthPermission from "@effect-auth/core/Permission";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

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
import { authPasskeyCredential } from "../auth/schema/modules/passkeys";
import type { CurrentRequestAuthShape } from "../auth/session";
import { CurrentRequestAuth } from "../auth/session";
import {
  requireSensitiveOperationStepUp,
  SensitiveOperationStepUpClock,
} from "../auth/step-up-policy";
import { UnixMillis } from "../mailboxes/core";
import * as ControlPlane from "./batch";
import { ControlPlaneDatabase } from "./database";
import {
  controlPlaneDatabaseNow,
  sensitiveSessionParams,
  sensitiveSessionPredicate,
  sessionParams,
  transactionalSessionPredicate,
} from "./request-auth-guard-d1";
import { appPasskeyCredentialRevocation } from "./schema";

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
          const sensitiveParams = sensitiveSessionParams(
            requestAuth,
            timestamp
          );
          const baseParams = sessionParams(requestAuth, timestamp);
          const recoveryPredicate = `exists (
            select 1 from app_external_recovery_identity
             where user_id = ? and status = 'verified'
          )`;
          const targetOwnedPredicate = `exists (
            select 1 from auth_passkey_credential
             where id = ? and user_id = ?
          )`;
          const targetActivePredicate = `exists (
            select 1 from auth_passkey_credential
             where id = ? and user_id = ? and credential_id = ?
               and revoked_at is null
          )`;
          const anotherFactorPredicate = `exists (
            select 1 from auth_passkey_credential
             where user_id = ? and id <> ? and revoked_at is null
          )`;
          const operationAvailablePredicate = `not exists (
            select 1 from app_passkey_credential_revocation
             where operation_id = ?
          )`;
          const { userId } = requestAuth.validated.actor;
          const statements: readonly ControlPlane.ControlPlaneStatement[] = [
            {
              sql: `insert into app_authorization_guard (nonce)
                    select ? where ${sensitiveSessionPredicate}
                      and ${recoveryPredicate}
                      and ${targetActivePredicate}
                      and ${anotherFactorPredicate}
                      and ${operationAvailablePredicate}`,
              params: [
                nonce,
                ...sensitiveParams,
                userId,
                command.id,
                userId,
                target.credentialId,
                userId,
                command.id,
                command.operationId,
              ],
            },
            {
              sql: `select cast(${transactionalSessionPredicate} as integer)
                              as session_valid,
                           cast(${sensitiveSessionPredicate} as integer)
                              as step_up_valid,
                           cast(${recoveryPredicate} as integer)
                              as recovery_valid,
                           cast(${targetOwnedPredicate} as integer)
                              as target_owned,
                           cast(${targetActivePredicate} as integer)
                              as target_active,
                           cast(${anotherFactorPredicate} as integer)
                              as another_factor_exists,
                           cast(${operationAvailablePredicate} as integer)
                              as operation_available,
                           cast(exists (select 1 from app_authorization_guard
                                        where nonce = ?) as integer)
                              as authorized`,
              params: [
                ...baseParams,
                ...sensitiveParams,
                userId,
                command.id,
                userId,
                command.id,
                userId,
                target.credentialId,
                userId,
                command.id,
                command.operationId,
                nonce,
              ],
            },
            {
              sql: `update auth_passkey_credential
                        set revoked_at = max(
                          ?, created_at, coalesce(last_used_at, 0),
                          ${controlPlaneDatabaseNow}
                        )
                     where id = ? and user_id = ? and credential_id = ?
                       and revoked_at is null
                       and exists (select 1 from app_authorization_guard
                                    where nonce = ?)
                     returning id, created_at, last_used_at, revoked_at`,
              params: [
                timestamp,
                command.id,
                userId,
                target.credentialId,
                nonce,
              ],
            },
            {
              sql: `insert into app_passkey_credential_revocation
                      (operation_id, user_id, credential_record_id,
                       credential_created_at, credential_last_used_at,
                       revoked_at)
                    select ?, ?, id, created_at, last_used_at, revoked_at
                      from auth_passkey_credential
                      where id = ? and user_id = ?
                        and exists (select 1 from app_authorization_guard
                                    where nonce = ?)`,
              params: [command.operationId, userId, command.id, userId, nonce],
            },
            {
              sql: `insert into auth_audit_log
                      (id, type, user_id, actor_user_id, occurred_at, event,
                       created_at)
                    select ?, ?, ?, ?, ?, ?, ?
                      from app_authorization_guard where nonce = ?`,
              params: [
                `passkey-revocation:${command.operationId}`,
                auditEvent.type,
                userId,
                userId,
                timestamp,
                JSON.stringify(auditEvent),
                timestamp,
                nonce,
              ],
            },
            {
              sql: "delete from app_authorization_guard where nonce = ?",
              params: [nonce],
            },
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
