import type {
  D1EffectQbDatabaseLike,
  D1EffectQbResult,
} from "@effect-auth/core/EffectQbSqliteStorage";
import * as AuthPermission from "@effect-auth/core/Permission";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { CurrentRequestAuthShape } from "../auth/session";
import { CurrentRequestAuth } from "../auth/session";
import {
  MailPermission,
  MailRole,
  mailboxScope,
} from "../authorization/catalog";
import type { MailAuthorizationError } from "../authorization/mail-authorization";
import { MailAuthorization } from "../authorization/mail-authorization";

export interface MailboxRecord {
  readonly createdAt: number;
  readonly createdByUserId: string;
  readonly displayName: string;
  readonly id: string;
  readonly status: "active";
  readonly updatedAt: number;
  readonly version: number;
}

export type ControlPlaneCommitState = "not-committed" | "committed" | "unknown";

export class MailboxAdministrationError extends Data.TaggedError(
  "MailboxAdministrationError"
)<{
  readonly cause?: unknown;
  readonly commitState?: ControlPlaneCommitState;
  readonly message: string;
  readonly operation: "bootstrap-owner" | "rename";
  readonly permission?: AuthPermission.PermissionId;
  readonly reason:
    | "authorization-recheck"
    | "conflict"
    | "invalid-input"
    | "not-found"
    | "session-recheck"
    | "storage";
  readonly scope?: AuthPermission.PermissionScope;
}> {}

export interface MailboxAdministration {
  readonly bootstrapOwner: (input: {
    readonly displayName: string;
  }) => Effect.Effect<
    MailboxRecord,
    MailboxAdministrationError,
    CurrentRequestAuthShape
  >;
  readonly rename: (input: {
    readonly displayName: string;
    readonly mailboxId: string;
  }) => Effect.Effect<
    MailboxRecord,
    MailAuthorizationError | MailboxAdministrationError,
    | AuthPermission.CurrentPrincipal
    | CurrentRequestAuthShape
    | MailAuthorization
  >;
}

export const MailboxAdministration = Context.Service<MailboxAdministration>(
  "cloudflare-inbox/MailboxAdministration"
);

interface Statement {
  readonly params?: readonly unknown[];
  readonly sql: string;
}

interface ControlPlaneBatchError {
  readonly _tag: "ControlPlaneBatchError";
  readonly cause: unknown;
  readonly commitState: ControlPlaneCommitState;
  readonly statement?: number;
}

const controlPlaneBatchError = (
  input: Omit<ControlPlaneBatchError, "_tag">
): ControlPlaneBatchError => ({ _tag: "ControlPlaneBatchError", ...input });

const isControlPlaneBatchError = (
  error: unknown
): error is ControlPlaneBatchError =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  error._tag === "ControlPlaneBatchError";

interface LiveOptions {
  readonly now?: () => number;
  readonly randomId?: () => string;
}

const sessionPredicate = `exists (
  select 1
    from auth_session as session
    join auth_user as user on user.id = session.user_id
   where session.id = ?
     and session.user_id = ?
     and session.secret_hash = ?
     and session.revoked_at is null
     and session.expires_at > ?
     and user.disabled_at is null
     and session.auth_time = ?
     and session.authentication_events = ?
     and session.aal = ?
     and session.amr = ?
     and ((session.mfa_verified_at is null and ? is null) or session.mfa_verified_at = ?)
     and coalesce(json_array_length(
       json_extract(session.metadata, '$.__effectAuthSession.claims.requirements')
     ), 0) = 0
)`;

const activeOwnerRolePredicate = `exists (
  select 1
    from auth_role_definition
   where id = ?
     and disabled_at is null
     and deleted_at is null
)`;

const permissionPredicate = `(
  exists (
    select 1
      from auth_permission_grant as permission_grant
     where permission_grant.subject_type = ?
       and permission_grant.subject_id = ?
       and permission_grant.permission_id = ?
       and permission_grant.revoked_at is null
       and (permission_grant.expires_at is null or permission_grant.expires_at > ?)
       and (
         (permission_grant.scope_type = 'global' and permission_grant.scope_id_present = 0)
         or (
           permission_grant.scope_type = ?
           and permission_grant.scope_id_present = ?
           and permission_grant.scope_id = ?
         )
       )
  )
  or exists (
    select 1
      from auth_role_grant as role_grant
     where role_grant.subject_type = ?
       and role_grant.subject_id = ?
       and role_grant.revoked_at is null
       and (role_grant.expires_at is null or role_grant.expires_at > ?)
       and (
         (role_grant.scope_type = 'global' and role_grant.scope_id_present = 0)
         or (
           role_grant.scope_type = ?
           and role_grant.scope_id_present = ?
           and role_grant.scope_id = ?
         )
       )
       and exists (
         select 1
           from auth_role_permission as role_permission
          where role_permission.role_id = role_grant.role_id
            and role_permission.permission_id = ?
            and (
              role_permission.scope_type_present = 0
              or (
                role_permission.scope_type_present = 1
                and role_permission.scope_type = ?
              )
            )
       )
  )
)`;

const executeBatch = (
  database: D1EffectQbDatabaseLike,
  statements: readonly Statement[]
) =>
  Effect.tryPromise({
    try: async () => {
      let prepared;

      try {
        prepared = statements.map(({ params = [], sql }, statement) => {
          try {
            return database.prepare(sql).bind(...params);
          } catch (error) {
            throw controlPlaneBatchError({
              cause: error,
              commitState: "not-committed",
              statement,
            });
          }
        });
      } catch (error) {
        throw isControlPlaneBatchError(error)
          ? error
          : controlPlaneBatchError({
              cause: error,
              commitState: "not-committed",
            });
      }

      let results: readonly D1EffectQbResult[];

      try {
        results = await database.batch(prepared);
      } catch (error) {
        throw controlPlaneBatchError({
          cause: error,
          commitState: "unknown",
        });
      }

      const failed = results.findIndex(
        (result) => result.success === false || result.error !== undefined
      );
      if (failed !== -1) {
        throw controlPlaneBatchError({
          cause: results[failed]?.error ?? "D1 batch statement failed",
          commitState: "not-committed",
          statement: failed,
        });
      }
      if (results.length !== statements.length) {
        throw controlPlaneBatchError({
          cause: new Error(
            `D1 batch returned ${results.length} results for ${statements.length} statements`
          ),
          commitState: "unknown",
        });
      }

      return results;
    },
    catch: (error) =>
      isControlPlaneBatchError(error)
        ? error
        : controlPlaneBatchError({
            cause: error,
            commitState: "unknown",
          }),
  });

const sessionParams = (
  requestAuth: CurrentRequestAuthShape,
  now: number
): readonly unknown[] => {
  const { validated } = requestAuth;
  const mfaVerifiedAt = validated.issued.mfaVerifiedAt ?? null;
  return [
    validated.issued.sessionId,
    validated.issued.userId,
    requestAuth.sessionSecretHash,
    now,
    validated.issued.authTime,
    JSON.stringify(validated.issued.authenticationEvents),
    validated.issued.aal,
    JSON.stringify(validated.issued.amr),
    mfaVerifiedAt,
    mfaVerifiedAt,
  ];
};

const permissionParams = (
  principal: AuthPermission.PermissionSubject,
  permission: AuthPermission.PermissionId,
  scope: AuthPermission.PermissionScope,
  now: number
): readonly unknown[] => {
  const scopeIdPresent = scope.id === undefined ? 0 : 1;
  const scopeId = scope.id ?? "";

  return [
    principal.type,
    principal.id,
    permission,
    now,
    scope.type,
    scopeIdPresent,
    scopeId,
    principal.type,
    principal.id,
    now,
    scope.type,
    scopeIdPresent,
    scopeId,
    permission,
    scope.type,
  ];
};

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
  displayName: string,
  operation: "bootstrap-owner" | "rename"
) => {
  const normalized = displayName.trim();
  return normalized.length > 0 && [...normalized].length <= 200
    ? Effect.succeed(normalized)
    : Effect.fail(
        new MailboxAdministrationError({
          message: "Mailbox display name must contain 1 to 200 characters",
          operation,
          reason: "invalid-input",
        })
      );
};

const storageError = (
  operation: "bootstrap-owner" | "rename",
  error: ControlPlaneBatchError
) =>
  new MailboxAdministrationError({
    cause: error.cause,
    commitState: error.commitState,
    message: "Control-plane mutation failed",
    operation,
    reason: "storage",
  });

const resultRows = <Row extends Readonly<Record<string, unknown>>>(
  results: readonly D1EffectQbResult[],
  statement: number
) => (results[statement]?.results ?? []) as readonly Row[];

export const makeMailboxAdministrationLive = (
  database: D1EffectQbDatabaseLike,
  options: LiveOptions = {}
) => {
  const now = options.now ?? Date.now;
  const randomId = options.randomId ?? (() => crypto.randomUUID());

  return Layer.succeed(
    MailboxAdministration,
    MailboxAdministration.of({
      bootstrapOwner: (input) =>
        Effect.gen(function* () {
          const requestAuth = yield* CurrentRequestAuth;
          const { validated } = requestAuth;
          yield* ensureTrustedAuthInvariant(requestAuth);
          yield* requireUnrestrictedSession(requestAuth, "bootstrap-owner");
          const displayName = yield* validateDisplayName(
            input.displayName,
            "bootstrap-owner"
          );
          const timestamp = now();
          const mailboxId = "primary";
          const nonce = randomId();
          const trustedSessionParams = sessionParams(requestAuth, timestamp);
          const statements: readonly Statement[] = [
            {
              sql: `insert into app_authorization_guard (nonce)
                    select ?
                     where ${sessionPredicate}
                       and ${activeOwnerRolePredicate}`,
              params: [nonce, ...trustedSessionParams, MailRole.owner],
            },
            {
              sql: `insert into app_mailbox
                      (id, display_name, created_by_user_id, created_at, updated_at)
                     select ?, ?, ?, ?, ?
                       from app_authorization_guard
                      where nonce = ?
                        and not exists (select 1 from app_mailbox)
                     returning id`,
              params: [
                mailboxId,
                displayName,
                validated.actor.userId,
                timestamp,
                timestamp,
                nonce,
              ],
            },
            {
              sql: `insert or ignore into app_mailbox_member
                      (mailbox_id, user_id, created_at, updated_at)
                     select ?, ?, ?, ?
                       from app_authorization_guard as authorization_guard
                       join app_mailbox as mailbox
                         on mailbox.id = ?
                        and mailbox.created_by_user_id = ?
                        and mailbox.created_at = ?
                      where authorization_guard.nonce = ?`,
              params: [
                mailboxId,
                validated.actor.userId,
                timestamp,
                timestamp,
                mailboxId,
                validated.actor.userId,
                timestamp,
                nonce,
              ],
            },
            {
              sql: `insert or ignore into auth_role_grant
                      (subject_type, subject_id, role_id, scope_type,
                       scope_id_present, scope_id, expires_at, metadata, revoked_at)
                     select 'user', ?, ?, 'mailbox', 1, ?, null, null, null
                       from app_authorization_guard as authorization_guard
                       join app_mailbox as mailbox
                         on mailbox.id = ?
                        and mailbox.created_by_user_id = ?
                        and mailbox.created_at = ?
                      where authorization_guard.nonce = ?`,
              params: [
                validated.actor.userId,
                MailRole.owner,
                mailboxId,
                mailboxId,
                validated.actor.userId,
                timestamp,
                nonce,
              ],
            },
            {
              sql: `select cast(${sessionPredicate} as integer) as session_valid,
                           cast(${activeOwnerRolePredicate} as integer) as catalog_valid,
                           cast(exists (
                             select 1 from app_authorization_guard where nonce = ?
                           ) as integer) as authorized`,
              params: [...trustedSessionParams, MailRole.owner, nonce],
            },
            {
              sql: "delete from app_authorization_guard where nonce = ?",
              params: [nonce],
            },
          ];
          const results = yield* executeBatch(database, statements).pipe(
            Effect.mapError((error) => storageError("bootstrap-owner", error))
          );
          const [status] = resultRows<{
            readonly authorized: number;
            readonly catalog_valid: number;
            readonly session_valid: number;
          }>(results, 4);

          if (status?.session_valid !== 1) {
            return yield* new MailboxAdministrationError({
              message: "Session changed before mailbox creation",
              operation: "bootstrap-owner",
              reason: "session-recheck",
            });
          }
          if (status.catalog_valid !== 1) {
            return yield* Effect.die(
              new Error("Owner role catalog is not active")
            );
          }
          if (status.authorized !== 1) {
            return yield* Effect.die(
              new Error("Owner bootstrap authorization guard is inconsistent")
            );
          }
          if (resultRows(results, 1).length !== 1) {
            return yield* new MailboxAdministrationError({
              message: "Primary mailbox already exists",
              operation: "bootstrap-owner",
              reason: "conflict",
            });
          }

          return {
            createdAt: timestamp,
            createdByUserId: validated.actor.userId,
            displayName,
            id: mailboxId,
            status: "active" as const,
            updatedAt: timestamp,
            version: 1,
          };
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
          const authorization = yield* MailAuthorization;
          const location = yield* authorization.requireMailbox({
            action: "manage-settings",
            resource: { _tag: "Mailbox", mailboxId: input.mailboxId },
          });
          const timestamp = now();
          const nonce = randomId();
          const scope = mailboxScope(location.mailboxId);
          const trustedSessionParams = sessionParams(requestAuth, timestamp);
          const trustedPermissionParams = permissionParams(
            principal,
            MailPermission.mailboxManageSettings,
            scope,
            timestamp
          );
          const statements: readonly Statement[] = [
            {
              sql: `insert into app_authorization_guard (nonce)
                    select ?
                     where ${sessionPredicate}
                       and ${permissionPredicate}`,
              params: [
                nonce,
                ...trustedSessionParams,
                ...trustedPermissionParams,
              ],
            },
            {
              sql: `update app_mailbox
                       set display_name = ?, updated_at = ?, version = version + 1
                     where id = ?
                       and status = 'active'
                       and exists (
                         select 1 from app_authorization_guard where nonce = ?
                       )
                    returning id, display_name, created_by_user_id,
                              created_at, updated_at, version`,
              params: [displayName, timestamp, location.mailboxId, nonce],
            },
            {
              sql: `select cast(${sessionPredicate} as integer) as session_valid,
                           cast(${permissionPredicate} as integer) as permission_valid,
                           cast(exists (
                             select 1 from app_authorization_guard where nonce = ?
                           ) as integer) as authorized`,
              params: [
                ...trustedSessionParams,
                ...trustedPermissionParams,
                nonce,
              ],
            },
            {
              sql: "delete from app_authorization_guard where nonce = ?",
              params: [nonce],
            },
          ];
          const results = yield* executeBatch(database, statements).pipe(
            Effect.mapError((error) => storageError("rename", error))
          );
          const [status] = resultRows<{
            readonly authorized: number;
            readonly permission_valid: number;
            readonly session_valid: number;
          }>(results, 2);

          if (status?.session_valid !== 1) {
            return yield* new MailboxAdministrationError({
              message: "Session changed before mailbox mutation",
              operation: "rename",
              reason: "session-recheck",
            });
          }
          if (status.permission_valid !== 1 || status.authorized !== 1) {
            return yield* new MailboxAdministrationError({
              message: "Permission changed before mailbox mutation",
              operation: "rename",
              permission: MailPermission.mailboxManageSettings,
              reason: "authorization-recheck",
              scope,
            });
          }

          const [row] = resultRows<{
            readonly created_at: number;
            readonly created_by_user_id: string;
            readonly display_name: string;
            readonly id: string;
            readonly updated_at: number;
            readonly version: number;
          }>(results, 1);
          if (row === undefined) {
            return yield* new MailboxAdministrationError({
              message: "Mailbox not found",
              operation: "rename",
              reason: "not-found",
            });
          }

          return {
            createdAt: row.created_at,
            createdByUserId: row.created_by_user_id,
            displayName: row.display_name,
            id: row.id,
            status: "active" as const,
            updatedAt: row.updated_at,
            version: row.version,
          };
        }),
    })
  );
};
