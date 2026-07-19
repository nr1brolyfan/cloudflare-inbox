import * as AuthPermission from "@effect-auth/core/Permission";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import type { CurrentRequestAuthShape } from "../auth/session";
import { CurrentRequestAuth } from "../auth/session";
import {
  MailPermission,
  MailRole,
  mailboxScope,
} from "../authorization/catalog";
import { MailAuthorization } from "../authorization/mail-authorization";
import {
  MailboxAdministration,
  MailboxAdministrationError,
} from "../mailboxes/administration";
import {
  EmailAddress,
  MailboxDisplayName,
  MailboxRecordSchema,
} from "../mailboxes/core";
import * as ControlPlane from "./batch";

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

const ownerIdentityPredicate = `exists (
  select 1
    from auth_user_identity
   where user_id = ?
     and scope_type = 'global'
     and scope_id in ('', 'global')
     and kind = 'email'
     and normalized_value = ?
     and verified_at is not null
     and revoked_at is null
     and replaced_by_id is null
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
  catalog_valid: Schema.Number,
  owner_eligible: Schema.Number,
  session_valid: Schema.Number,
});

const RenameStatusRow = Schema.Struct({
  authorized: Schema.Number,
  permission_valid: Schema.Number,
  session_valid: Schema.Number,
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
    const batch = yield* ControlPlane.ControlPlaneBatch;
    const authorization = yield* MailAuthorization;
    const { ownerEmail: configuredOwnerEmail } = options;
    const { now, randomId } = runtime;
    const separator = configuredOwnerEmail.lastIndexOf("@");
    const ownerEmail = `${configuredOwnerEmail.slice(0, separator)}${configuredOwnerEmail.slice(separator).toLowerCase()}`;

    return MailboxAdministration.of({
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
          const statements: readonly ControlPlane.ControlPlaneStatement[] = [
            {
              sql: `insert into app_authorization_guard (nonce)
                    select ?
                     where ${sessionPredicate}
                       and ${activeOwnerRolePredicate}
                       and ${ownerIdentityPredicate}`,
              params: [
                nonce,
                ...trustedSessionParams,
                MailRole.owner,
                validated.actor.userId,
                ownerEmail,
              ],
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
                           cast(${ownerIdentityPredicate} as integer) as owner_eligible,
                           cast(exists (
                             select 1 from app_authorization_guard where nonce = ?
                           ) as integer) as authorized`,
              params: [
                ...trustedSessionParams,
                MailRole.owner,
                validated.actor.userId,
                ownerEmail,
                nonce,
              ],
            },
            {
              sql: "delete from app_authorization_guard where nonce = ?",
              params: [nonce],
            },
          ];
          const results = yield* batch
            .execute(statements)
            .pipe(
              Effect.mapError((error) => storageError("bootstrap-owner", error))
            );
          const [status] = yield* decodeResultRows(
            BootstrapStatusRow,
            results,
            4,
            "bootstrap-owner"
          );
          const created = yield* decodeResultRows(
            CreatedMailboxRow,
            results,
            1,
            "bootstrap-owner"
          );

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
          if (status.owner_eligible !== 1) {
            return yield* new MailboxAdministrationError({
              message: "Current user is not eligible to own the mailbox",
              operation: "bootstrap-owner",
              reason: "owner-not-eligible",
            });
          }
          if (status.authorized !== 1) {
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
          const statements: readonly ControlPlane.ControlPlaneStatement[] = [
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
          const results = yield* batch
            .execute(statements)
            .pipe(Effect.mapError((error) => storageError("rename", error)));
          const [status] = yield* decodeResultRows(
            RenameStatusRow,
            results,
            2,
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
