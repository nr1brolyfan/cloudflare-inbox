import { CustomAuditEventSchema } from "@effect-auth/core/AuditLog";
import { AuthRateLimit } from "@effect-auth/core/AuthRateLimit";
import * as AuthPermission from "@effect-auth/core/Permission";
import { RecoveryCodes } from "@effect-auth/core/RecoveryCode";
import { and, eq, exists, isNull, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { UnixMillis } from "#/modules/mailbox/domain/Mailbox";

import {
  GeneratedRecoveryCodeSet,
  GenerateRecoveryCodesCommand,
  RecoveryCodeAdministration,
  RecoveryCodeAdministrationError,
  RecoveryCodeText,
} from "../auth/recovery-code-administration";
import { authAuditLog } from "../auth/schema/modules/audit-log";
import { authUser } from "../auth/schema/modules/core";
import { authRecoveryCode } from "../auth/schema/modules/recovery-codes";
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
import { appAuthorizationGuard, appExternalRecoveryIdentity } from "./schema";

const failure = (
  reason: RecoveryCodeAdministrationError["reason"],
  cause?: unknown
) =>
  new RecoveryCodeAdministrationError({ cause, operation: "generate", reason });

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

export const RecoveryCodeAdministrationLive = Layer.effect(
  RecoveryCodeAdministration,
  Effect.gen(function* () {
    const authRateLimit = yield* AuthRateLimit;
    const batch = yield* ControlPlane.ControlPlaneBatch;
    const database = yield* ControlPlaneDatabase;
    const recoveryCodes = yield* RecoveryCodes;
    const stepUpClock = yield* SensitiveOperationStepUpClock;

    return RecoveryCodeAdministration.of({
      generate: (untrusted) =>
        Effect.gen(function* () {
          yield* Schema.decodeUnknownEffect(GenerateRecoveryCodesCommand)(
            untrusted
          ).pipe(Effect.mapError((cause) => failure("invalid-input", cause)));
          const requestAuth = yield* CurrentRequestAuth;
          const principal = yield* AuthPermission.CurrentPrincipal;
          yield* ensureTrusted(requestAuth, principal);
          if (
            (requestAuth.validated.currentSession.claims?.requirements
              ?.length ?? 0) !== 0
          ) {
            return yield* failure("restricted-session");
          }
          yield* requireSensitiveOperationStepUp(
            requestAuth.validated.currentSession,
            stepUpClock.now()
          ).pipe(Effect.mapError(() => failure("step-up-required")));
          yield* authRateLimit
            .require({
              operation: "auth.recovery_code.generate",
              userId: requestAuth.validated.actor.userId,
            })
            .pipe(
              Effect.mapError((cause) =>
                failure(
                  cause._tag === "RateLimitExceededError"
                    ? "rate-limited"
                    : "storage",
                  cause
                )
              )
            );

          const generatedAt = Schema.decodeUnknownSync(UnixMillis)(Date.now());
          const plaintext = yield* recoveryCodes
            .generate({ count: 10, groupSize: 4, length: 16 })
            .pipe(Effect.mapError((cause) => failure("storage", cause)));
          const records = yield* Effect.all(
            plaintext.map((code) =>
              recoveryCodes.hash({ code }).pipe(
                Effect.map((codeHash) => ({
                  codeHash,
                  id: crypto.randomUUID(),
                })),
                Effect.mapError((cause) => failure("storage", cause))
              )
            )
          );
          const codes = yield* Schema.decodeUnknownEffect(
            Schema.Array(RecoveryCodeText).pipe(
              Schema.check(
                Schema.makeFilter((values) =>
                  values.length === 10
                    ? undefined
                    : "must contain exactly 10 codes"
                )
              )
            )
          )(plaintext.map((code) => Redacted.value(code))).pipe(
            Effect.mapError((cause) => failure("storage", cause))
          );
          const nonce = crypto.randomUUID();
          const setId = crypto.randomUUID();
          const { userId } = requestAuth.validated.actor;
          const trustedStepUpSession = sensitiveSessionPredicate(
            database,
            requestAuth,
            generatedAt
          );
          const trustedBaseSession = transactionalSessionPredicate(
            database,
            requestAuth,
            generatedAt
          );
          const activeUser = exists(
            database
              .select({ value: sql`1` })
              .from(authUser)
              .where(and(eq(authUser.id, userId), isNull(authUser.disabledAt)))
          );
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
          const authorized = exists(
            database
              .select({ value: sql`1` })
              .from(appAuthorizationGuard)
              .where(eq(appAuthorizationGuard.nonce, nonce))
          );
          const auditEvent = yield* Schema.decodeUnknownEffect(
            CustomAuditEventSchema
          )({
            actor: {
              sessionId: requestAuth.validated.actor.sessionId,
              type: "user",
              userId,
            },
            occurredAt: generatedAt,
            payload: { codeCount: 10, setId },
            subject: { type: "user", userId },
            type: "app.recovery_codes.generated",
            version: 1,
          }).pipe(Effect.mapError((cause) => failure("storage", cause)));
          const metadata = JSON.stringify({ setId });
          const statements: ControlPlane.ControlPlaneStatements = [
            database.insert(appAuthorizationGuard).select(
              sql`select ${nonce} where ${trustedStepUpSession}
                      and ${activeUser} and ${recoveryValid}`
            ),
            database.all(sql`select cast(${trustedBaseSession} as integer)
                                      as session_valid,
                                   cast(${trustedStepUpSession} as integer)
                                      as step_up_valid,
                                   cast(${activeUser} as integer)
                                      as user_active,
                                   cast(${recoveryValid} as integer)
                                      as recovery_valid,
                                   cast(${authorized} as integer) as authorized`),
            database
              .update(authRecoveryCode)
              .set({
                revokedAt: sql<number>`max(
                  ${generatedAt},
                  ${authRecoveryCode.createdAt},
                  ${controlPlaneDatabaseNow}
                )`,
              })
              .where(
                and(
                  eq(authRecoveryCode.userId, userId),
                  isNull(authRecoveryCode.usedAt),
                  isNull(authRecoveryCode.revokedAt),
                  authorized
                )
              ),
            ...records.map((record) =>
              database.insert(authRecoveryCode).select(
                sql`select ${record.id}, ${userId}, ${record.codeHash},
                           ${generatedAt}, null, null, ${metadata}
                    where ${authorized}`
              )
            ),
            database.insert(authAuditLog).select(
              database
                .select({
                  actorUserId: sql`${userId}`.as("actor_user_id"),
                  createdAt: sql`${generatedAt}`.as("created_at"),
                  event: sql`${JSON.stringify(auditEvent)}`.as("event"),
                  id: sql`${`recovery-code-set:${setId}`}`.as("id"),
                  occurredAt: sql`${generatedAt}`.as("occurred_at"),
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
            Effect.mapError(
              (cause) =>
                new RecoveryCodeAdministrationError({
                  cause: cause.cause,
                  commitState: cause.commitState,
                  operation: "generate",
                  reason:
                    cause.commitState === "unknown"
                      ? "indeterminate"
                      : "storage",
                })
            )
          );
          const [status] = yield* Schema.decodeUnknownEffect(
            Schema.Array(
              Schema.Struct({
                authorized: Schema.Number,
                recovery_valid: Schema.Number,
                session_valid: Schema.Number,
                step_up_valid: Schema.Number,
                user_active: Schema.Number,
              })
            )
          )(results[1]?.results).pipe(
            Effect.mapError((cause) => failure("storage", cause))
          );
          if (status?.authorized !== 1) {
            if (status?.session_valid !== 1 || status?.user_active !== 1) {
              return yield* failure("unauthenticated");
            }
            if (status.step_up_valid !== 1) {
              return yield* failure("step-up-required");
            }
            if (status.recovery_valid !== 1) {
              return yield* failure("recovery-identity-required");
            }
            return yield* failure("storage");
          }
          return GeneratedRecoveryCodeSet.make({ codes, generatedAt });
        }),
    });
  })
);
