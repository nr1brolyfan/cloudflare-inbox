import * as AuthPermission from "@effect-auth/core/Permission";
import {
  and,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  notExists,
  sql,
} from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import {
  EmailAddress,
  MailboxDisplayName,
  MailboxId,
  MailboxRecordSchema,
  normalizeEmailAddressDomain,
} from "#/modules/mailbox/domain/Mailbox";
import {
  MailboxAdministration,
  MailboxAdministrationError,
} from "#/modules/organization/application/MailboxAdministration";
import { UnixMillis } from "#/shared/Temporal";

import { AdministrativeAudit } from "../audit/administrative-audit";
import type { AdministrativeAuditError } from "../audit/administrative-audit-error";
import { authUserIdentity } from "../auth/schema/modules/core";
import {
  authRoleDefinition,
  authRoleGrant,
} from "../auth/schema/modules/permissions";
import type { CurrentRequestAuthShape } from "../auth/session";
import { CurrentRequestAuth } from "../auth/session";
import {
  requireSensitiveOperationStepUp,
  SensitiveOperationStepUpClock,
} from "../auth/step-up-policy";
import {
  MailPermission,
  MailRole,
  mailboxScope,
} from "../authorization/catalog";
import { MailAuthorization } from "../authorization/mail-authorization";
import * as ControlPlane from "../platform/control-plane-d1/ControlPlaneBatch";
import { ControlPlaneDatabase } from "../platform/control-plane-d1/ControlPlaneDatabase";
import {
  appAuthorizationGuard,
  appMailbox,
  appMailboxAddress,
  appMailboxMember,
} from "../platform/control-plane-d1/ControlPlaneSchema";
import { permissionPredicate } from "../platform/control-plane-d1/PermissionGuard";
import {
  sensitiveSessionPredicate,
  sessionPredicate,
  transactionalSessionPredicate,
} from "../platform/control-plane-d1/RequestAuthGuard";
import { administrativeAuditInsertStatement } from "./administrative-audit-d1";

export const MailboxAdministrationOwnerEmail = EmailAddress;
export type MailboxAdministrationOwnerEmail = Schema.Schema.Type<
  typeof MailboxAdministrationOwnerEmail
>;

export interface MailboxAdministrationConfigShape {
  readonly ownerEmail: MailboxAdministrationOwnerEmail;
}

/** Stable dependencies used by transactional mailbox administration. */
export const MailboxAdministrationConfig =
  Context.Service<MailboxAdministrationConfigShape>(
    "cloudflare-inbox/MailboxAdministrationConfig"
  );

export interface MailboxAdministrationRuntime {
  readonly now: () => number;
  readonly randomId: () => string;
}

/** Clock and identifier source captured by mailbox administration. */
export const MailboxAdministrationRuntime =
  Context.Service<MailboxAdministrationRuntime>(
    "cloudflare-inbox/MailboxAdministrationRuntime"
  );

export const MailboxAdministrationRuntimeLive = Layer.succeed(
  MailboxAdministrationRuntime,
  MailboxAdministrationRuntime.of({
    now: Date.now,
    randomId: () => crypto.randomUUID(),
  })
);

const activeOwnerRolePredicate = (database: ControlPlaneDatabase) =>
  exists(
    database
      .select({ value: sql`1` })
      .from(authRoleDefinition)
      .where(
        and(
          eq(authRoleDefinition.id, MailRole.owner),
          isNull(authRoleDefinition.disabledAt),
          isNull(authRoleDefinition.deletedAt)
        )
      )
  );

const ownerIdentityPredicate = (
  database: ControlPlaneDatabase,
  userId: string,
  normalizedEmail: string
) =>
  exists(
    database
      .select({ value: sql`1` })
      .from(authUserIdentity)
      .where(
        and(
          eq(authUserIdentity.userId, userId),
          eq(authUserIdentity.scopeType, "global"),
          inArray(authUserIdentity.scopeId, ["", "global"]),
          eq(authUserIdentity.kind, "email"),
          eq(authUserIdentity.normalizedValue, normalizedEmail),
          isNotNull(authUserIdentity.verifiedAt),
          isNull(authUserIdentity.revokedAt),
          isNull(authUserIdentity.replacedById)
        )
      )
  );

const ensureTrustedAuthInvariant = (
  requestAuth: CurrentRequestAuthShape,
  principal?: AuthPermission.PermissionSubject
) => {
  const { validated } = requestAuth;
  const validSession =
    validated.actor.sessionId === validated.currentSession.sessionId &&
    validated.actor.sessionId === validated.issued.sessionId &&
    validated.actor.userId === validated.currentSession.userId &&
    validated.actor.userId === validated.issued.userId;
  const validPrincipal =
    principal === undefined ||
    (principal.type === "user" && principal.id === validated.actor.userId);

  return validSession && validPrincipal
    ? Effect.void
    : Effect.die(new Error("Current request auth contexts are inconsistent"));
};

const requireUnrestrictedSession = (
  requestAuth: CurrentRequestAuthShape,
  operation: "bootstrap-owner" | "rename"
) =>
  (requestAuth.validated.currentSession.claims?.requirements?.length ?? 0) === 0
    ? Effect.void
    : Effect.fail(
        new MailboxAdministrationError({
          message: "Session requirements must be completed first",
          operation,
          reason: "session-recheck",
        })
      );

const validateDisplayName = (
  displayName: unknown,
  operation: "bootstrap-owner" | "rename"
) =>
  Schema.decodeUnknownEffect(MailboxDisplayName)(displayName).pipe(
    Effect.mapError(
      () =>
        new MailboxAdministrationError({
          message: "Mailbox display name must contain 1 to 200 characters",
          operation,
          reason: "invalid-input",
        })
    )
  );

const storageError = (
  operation: "bootstrap-owner" | "rename",
  error: ControlPlane.ControlPlaneBatchError
) =>
  new MailboxAdministrationError({
    cause: error.cause,
    commitState: error.commitState,
    message: "Control-plane mutation failed",
    operation,
    reason: "storage",
  });

const auditError = (
  operation: "bootstrap-owner" | "rename",
  error: AdministrativeAuditError
) =>
  new MailboxAdministrationError({
    cause: error,
    commitState: "not-committed",
    message: "Failed to prepare administrative audit",
    operation,
    reason: "storage",
  });

const decodeResultRows = <Row>(
  schema: Schema.Decoder<Row>,
  results: readonly ControlPlane.ControlPlaneBatchResult[],
  statement: number,
  operation: "bootstrap-owner" | "rename"
) =>
  Schema.decodeUnknownEffect(Schema.Array(schema))(
    results[statement]?.results
  ).pipe(
    Effect.mapError(
      (cause) =>
        new MailboxAdministrationError({
          cause,
          commitState: "unknown",
          message: "Control-plane returned invalid mutation data",
          operation,
          reason: "storage",
        })
    )
  );

const BootstrapStatusRow = Schema.Struct({
  authorized: Schema.Number,
  base_session_valid: Schema.Number,
  catalog_valid: Schema.Number,
  mailbox_available: Schema.Number,
  owner_eligible: Schema.Number,
  step_up_valid: Schema.Number,
});

const RenameStatusRow = Schema.Struct({
  authorized: Schema.Number,
  mailbox_exists: Schema.Number,
  permission_valid: Schema.Number,
  session_valid: Schema.Number,
  version_valid: Schema.Number,
});

const RenamedMailboxRow = Schema.Struct({
  created_at: Schema.Number,
  created_by_user_id: Schema.String,
  display_name: Schema.String,
  id: Schema.String,
  updated_at: Schema.Number,
  version: Schema.Number,
});

const CreatedMailboxRow = Schema.Struct({ id: Schema.String });

/** Transactional mailbox service built from explicit Effect configuration. */
export const MailboxAdministrationLive = Layer.effect(
  MailboxAdministration,
  Effect.gen(function* () {
    const options = yield* MailboxAdministrationConfig;
    const runtime = yield* MailboxAdministrationRuntime;
    const stepUpClock = yield* SensitiveOperationStepUpClock;
    const batch = yield* ControlPlane.ControlPlaneBatch;
    const database = yield* ControlPlaneDatabase;
    const authorization = yield* MailAuthorization;
    const audit = yield* AdministrativeAudit;
    const { ownerEmail: configuredOwnerEmail } = options;
    const { now, randomId } = runtime;
    const ownerEmail = normalizeEmailAddressDomain(configuredOwnerEmail);

    return MailboxAdministration.of({
      bootstrapOwner: (input) =>
        Effect.gen(function* () {
          const requestAuth = yield* CurrentRequestAuth;
          const { validated } = requestAuth;
          yield* ensureTrustedAuthInvariant(requestAuth);
          yield* requireUnrestrictedSession(requestAuth, "bootstrap-owner");
          const stepUpTimestamp = stepUpClock.now();
          yield* requireSensitiveOperationStepUp(
            validated.currentSession,
            stepUpTimestamp
          ).pipe(
            Effect.mapError(
              (error) =>
                new MailboxAdministrationError({
                  cause: error,
                  message: "Recent authentication is required",
                  operation: "bootstrap-owner",
                  reason: "step-up-required",
                })
            )
          );
          const displayName = yield* validateDisplayName(
            input.displayName,
            "bootstrap-owner"
          );
          const timestamp = Schema.decodeUnknownSync(UnixMillis)(now());
          const mailboxId = Schema.decodeUnknownSync(MailboxId)("primary");
          const nonce = randomId();
          const auditEvent = yield* audit
            .prepare({
              _tag: "MailboxBootstrapped",
              mailboxId,
              occurredAt: timestamp,
              operationId: input.operationId,
            })
            .pipe(
              Effect.mapError((error) => auditError("bootstrap-owner", error))
            );
          const trustedSession = sensitiveSessionPredicate(
            database,
            requestAuth,
            timestamp
          );
          const trustedBaseSession = transactionalSessionPredicate(
            database,
            requestAuth,
            timestamp
          );
          const ownerRoleActive = activeOwnerRolePredicate(database);
          const ownerIdentityValid = ownerIdentityPredicate(
            database,
            validated.actor.userId,
            ownerEmail
          );
          const mailboxAvailable = notExists(
            database.select({ value: sql`1` }).from(appMailbox)
          );
          const authorized = exists(
            database
              .select({ value: sql`1` })
              .from(appAuthorizationGuard)
              .where(eq(appAuthorizationGuard.nonce, nonce))
          );
          const createdMailbox = and(
            eq(appMailbox.id, mailboxId),
            eq(appMailbox.createdByUserId, validated.actor.userId),
            eq(appMailbox.createdAt, timestamp)
          );
          const statements: ControlPlane.ControlPlaneStatements = [
            database.insert(appAuthorizationGuard).select(
              sql`select ${nonce}
                      where ${trustedSession}
                        and ${ownerRoleActive}
                        and ${ownerIdentityValid}
                        and ${mailboxAvailable}`
            ),
            database.all(sql`select cast(${trustedBaseSession} as integer)
                                      as base_session_valid,
                                   cast(${trustedSession} as integer)
                                      as step_up_valid,
                                   cast(${ownerRoleActive} as integer)
                                      as catalog_valid,
                                   cast(${ownerIdentityValid} as integer)
                                      as owner_eligible,
                                   cast(${mailboxAvailable} as integer)
                                      as mailbox_available,
                                   cast(${authorized} as integer) as authorized`),
            database
              .insert(appMailbox)
              .select(
                database
                  .select({
                    createdAt: sql`${timestamp}`.as("created_at"),
                    createdByUserId: sql`${validated.actor.userId}`.as(
                      "created_by_user_id"
                    ),
                    displayName: sql`${displayName}`.as("display_name"),
                    id: sql`${mailboxId}`.as("id"),
                    updatedAt: sql`${timestamp}`.as("updated_at"),
                  })
                  .from(appAuthorizationGuard)
                  .where(
                    and(
                      eq(appAuthorizationGuard.nonce, nonce),
                      mailboxAvailable
                    )
                  )
              )
              .returning({ id: appMailbox.id }),
            database.insert(appMailboxAddress).select(
              database
                .select({
                  address: sql`${configuredOwnerEmail}`.as("address"),
                  createdAt: sql`${timestamp}`.as("created_at"),
                  enabled: sql<boolean>`1`.as("enabled"),
                  id: sql`${"primary"}`.as("id"),
                  isPrimary: sql<boolean>`1`.as("is_primary"),
                  mailboxId: sql`${mailboxId}`.as("mailbox_id"),
                  normalizedAddress: sql`${ownerEmail}`.as(
                    "normalized_address"
                  ),
                  updatedAt: sql`${timestamp}`.as("updated_at"),
                })
                .from(appAuthorizationGuard)
                .innerJoin(appMailbox, createdMailbox)
                .where(eq(appAuthorizationGuard.nonce, nonce))
            ),
            database
              .insert(appMailboxMember)
              .select(
                database
                  .select({
                    createdAt: sql`${timestamp}`.as("created_at"),
                    mailboxId: sql`${mailboxId}`.as("mailbox_id"),
                    updatedAt: sql`${timestamp}`.as("updated_at"),
                    userId: sql`${validated.actor.userId}`.as("user_id"),
                  })
                  .from(appAuthorizationGuard)
                  .innerJoin(appMailbox, createdMailbox)
                  .where(eq(appAuthorizationGuard.nonce, nonce))
              )
              .onConflictDoNothing(),
            database
              .insert(authRoleGrant)
              .select(
                database
                  .select({
                    expiresAt: sql<null>`null`.as("expires_at"),
                    metadata: sql<null>`null`.as("metadata"),
                    revokedAt: sql<null>`null`.as("revoked_at"),
                    roleId: sql`${MailRole.owner}`.as("role_id"),
                    scopeId: sql`${mailboxId}`.as("scope_id"),
                    scopeIdPresent: sql<number>`1`.as("scope_id_present"),
                    scopeType: sql`${"mailbox"}`.as("scope_type"),
                    subjectId: sql`${validated.actor.userId}`.as("subject_id"),
                    subjectType: sql`${"user"}`.as("subject_type"),
                  })
                  .from(appAuthorizationGuard)
                  .innerJoin(appMailbox, createdMailbox)
                  .where(eq(appAuthorizationGuard.nonce, nonce))
              )
              .onConflictDoNothing(),
            administrativeAuditInsertStatement(database, auditEvent, nonce),
            database
              .delete(appAuthorizationGuard)
              .where(eq(appAuthorizationGuard.nonce, nonce)),
          ];
          const results = yield* batch
            .execute(statements)
            .pipe(
              Effect.mapError((error) => storageError("bootstrap-owner", error))
            );
          const [status] = yield* decodeResultRows(
            BootstrapStatusRow,
            results,
            1,
            "bootstrap-owner"
          );
          const created = yield* decodeResultRows(
            CreatedMailboxRow,
            results,
            2,
            "bootstrap-owner"
          );

          if (status?.authorized !== 1) {
            if (status?.base_session_valid !== 1) {
              return yield* new MailboxAdministrationError({
                message: "Session changed before mailbox creation",
                operation: "bootstrap-owner",
                reason: "session-recheck",
              });
            }
            if (status.step_up_valid !== 1) {
              return yield* new MailboxAdministrationError({
                message: "Recent authentication is required",
                operation: "bootstrap-owner",
                reason: "step-up-required",
              });
            }
            if (status.catalog_valid !== 1) {
              return yield* Effect.die(
                new Error("Owner role catalog is not active")
              );
            }
            if (status.owner_eligible !== 1) {
              return yield* new MailboxAdministrationError({
                message: "Current user is not eligible to own the mailbox",
                operation: "bootstrap-owner",
                reason: "owner-not-eligible",
              });
            }
            if (status.mailbox_available !== 1) {
              return yield* new MailboxAdministrationError({
                message: "Primary mailbox already exists",
                operation: "bootstrap-owner",
                reason: "conflict",
              });
            }
            return yield* Effect.die(
              new Error("Owner bootstrap authorization guard is inconsistent")
            );
          }
          if (created.length !== 1) {
            return yield* new MailboxAdministrationError({
              message: "Primary mailbox already exists",
              operation: "bootstrap-owner",
              reason: "conflict",
            });
          }

          return yield* Schema.decodeUnknownEffect(MailboxRecordSchema)({
            createdAt: timestamp,
            createdByUserId: validated.actor.userId,
            displayName,
            id: mailboxId,
            status: "active",
            updatedAt: timestamp,
            version: 1,
          }).pipe(
            Effect.mapError(
              (cause) =>
                new MailboxAdministrationError({
                  cause,
                  commitState: "committed",
                  message: "Created mailbox data was invalid",
                  operation: "bootstrap-owner",
                  reason: "storage",
                })
            )
          );
        }),
      rename: (input) =>
        Effect.gen(function* () {
          const requestAuth = yield* CurrentRequestAuth;
          const principal = yield* AuthPermission.CurrentPrincipal;
          yield* ensureTrustedAuthInvariant(requestAuth, principal);
          yield* requireUnrestrictedSession(requestAuth, "rename");
          const displayName = yield* validateDisplayName(
            input.displayName,
            "rename"
          );
          const location = yield* authorization.requireMailbox({
            action: "manage-settings",
            resource: { _tag: "Mailbox", mailboxId: input.mailboxId },
          });
          const timestamp = Schema.decodeUnknownSync(UnixMillis)(now());
          const nonce = randomId();
          const scope = mailboxScope(location.mailboxId);
          const trustedSession = sessionPredicate(
            database,
            requestAuth,
            timestamp
          );
          const trustedPermission = permissionPredicate(
            database,
            principal,
            MailPermission.mailboxManageSettings,
            scope,
            timestamp
          );
          const auditEvent = yield* audit
            .prepare({
              _tag: "MailboxRenamed",
              beforeVersion: input.expectedVersion,
              mailboxId: location.mailboxId,
              occurredAt: timestamp,
              operationId: input.operationId,
            })
            .pipe(Effect.mapError((error) => auditError("rename", error)));
          const mailboxExists = exists(
            database
              .select({ value: sql`1` })
              .from(appMailbox)
              .where(
                and(
                  eq(appMailbox.id, location.mailboxId),
                  eq(appMailbox.status, "active")
                )
              )
          );
          const mailboxAtVersion = exists(
            database
              .select({ value: sql`1` })
              .from(appMailbox)
              .where(
                and(
                  eq(appMailbox.id, location.mailboxId),
                  eq(appMailbox.status, "active"),
                  eq(appMailbox.version, input.expectedVersion)
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
              sql`select ${nonce}
                      where ${trustedSession}
                        and ${trustedPermission}
                        and ${mailboxAtVersion}`
            ),
            database
              .update(appMailbox)
              .set({
                displayName,
                updatedAt: timestamp,
                version: sql`${appMailbox.version} + 1`,
              })
              .where(
                and(
                  eq(appMailbox.id, location.mailboxId),
                  eq(appMailbox.status, "active"),
                  eq(appMailbox.version, input.expectedVersion),
                  authorized
                )
              )
              .returning({
                created_at: appMailbox.createdAt,
                created_by_user_id: appMailbox.createdByUserId,
                display_name: appMailbox.displayName,
                id: appMailbox.id,
                updated_at: appMailbox.updatedAt,
                version: appMailbox.version,
              }),
            administrativeAuditInsertStatement(database, auditEvent, nonce),
            database.all(sql`select cast(${trustedSession} as integer)
                                      as session_valid,
                                   cast(${trustedPermission} as integer)
                                      as permission_valid,
                                   cast(${mailboxExists} as integer)
                                      as mailbox_exists,
                                   cast(${mailboxAtVersion} as integer)
                                      as version_valid,
                                   cast(${authorized} as integer) as authorized`),
            database
              .delete(appAuthorizationGuard)
              .where(eq(appAuthorizationGuard.nonce, nonce)),
          ];
          const results = yield* batch
            .execute(statements)
            .pipe(Effect.mapError((error) => storageError("rename", error)));
          const [status] = yield* decodeResultRows(
            RenameStatusRow,
            results,
            3,
            "rename"
          );

          if (status?.session_valid !== 1) {
            return yield* new MailboxAdministrationError({
              message: "Session changed before mailbox mutation",
              operation: "rename",
              reason: "session-recheck",
            });
          }
          if (status.permission_valid !== 1 || status.authorized !== 1) {
            if (status.mailbox_exists !== 1) {
              return yield* new MailboxAdministrationError({
                message: "Mailbox not found",
                operation: "rename",
                reason: "not-found",
              });
            }
            if (status.version_valid !== 1) {
              return yield* new MailboxAdministrationError({
                message: "Mailbox changed before mutation",
                operation: "rename",
                reason: "conflict",
              });
            }
            return yield* new MailboxAdministrationError({
              message: "Permission changed before mailbox mutation",
              operation: "rename",
              permission: MailPermission.mailboxManageSettings,
              reason: "authorization-recheck",
              scope,
            });
          }

          const [row] = yield* decodeResultRows(
            RenamedMailboxRow,
            results,
            1,
            "rename"
          );
          if (row === undefined) {
            return yield* new MailboxAdministrationError({
              message: "Mailbox not found",
              operation: "rename",
              reason: "not-found",
            });
          }

          return yield* Schema.decodeUnknownEffect(MailboxRecordSchema)({
            createdAt: row.created_at,
            createdByUserId: row.created_by_user_id,
            displayName: row.display_name,
            id: row.id,
            status: "active",
            updatedAt: row.updated_at,
            version: row.version,
          }).pipe(
            Effect.mapError(
              (cause) =>
                new MailboxAdministrationError({
                  cause,
                  commitState: "committed",
                  message: "Renamed mailbox data was invalid",
                  operation: "rename",
                  reason: "storage",
                })
            )
          );
        }),
    });
  })
);
