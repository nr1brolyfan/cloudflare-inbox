import { DatabaseSync } from "node:sqlite";

import type { D1EffectQbDatabaseLike } from "@effect-auth/core/EffectQbSqliteStorage";
import { D1EffectQbSqliteAuthStorageLive } from "@effect-auth/core/EffectQbSqliteStorage";
import {
  SessionId,
  SessionToken,
  UnixMillis,
  UserId,
} from "@effect-auth/core/Identifiers";
import * as AuthPermission from "@effect-auth/core/Permission";
import type { ValidatedSession } from "@effect-auth/core/Sessions";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import type { CurrentRequestAuthShape } from "#/auth/session";
import { CurrentRequestAuth } from "#/auth/session";
import {
  MailPermission,
  MailRole,
  mailboxScope,
} from "#/authorization/catalog";
import {
  MailAuthorization,
  MailAuthorizationLive,
} from "#/authorization/mail-authorization";
import { MailPermissionsLive } from "#/authorization/permissions-live";
import * as Resources from "#/authorization/resources";
import { ControlPlaneBatchLive } from "#/control-plane/batch";
import { ControlPlaneD1Binding } from "#/control-plane/database";
import {
  MailboxAdministrationConfig,
  MailboxAdministrationLive,
  MailboxAdministrationOwnerEmail,
  MailboxAdministrationRuntime,
} from "#/control-plane/mailbox-administration-live";
import {
  MailboxAdministration,
  MailboxAdministrationError,
} from "#/mailboxes/administration";
import { MailboxDisplayName, MailboxId } from "#/mailboxes/core";
import {
  AttachmentLocation,
  DraftLocation,
  FolderLocation,
  MessageLocation,
  RuleLocation,
} from "#/mailboxes/resource-location";

import { applyControlPlaneMigrations, makeTestD1Database } from "../support/d1";

const now = 2000;

const makeValidatedSession = (
  user: string,
  session: string,
  rotatedAt?: number
): ValidatedSession => {
  const userId = UserId(user);
  const sessionId = SessionId(session);
  const currentSession = {
    aal: "aal1" as const,
    amr: [],
    authenticationEvents: [],
    authTime: UnixMillis(1000),
    expiresAt: UnixMillis(10_000),
    sessionId,
    userId,
  };

  return {
    actor: { sessionId, userId },
    currentSession,
    issued: {
      ...currentSession,
      ...(rotatedAt === undefined ? {} : { rotatedAt: UnixMillis(rotatedAt) }),
      token: SessionToken(`${sessionId}.secret`),
    },
  };
};

const insertCurrentSession = (
  database: DatabaseSync,
  validated: ValidatedSession
) => {
  database
    .prepare(
      `insert into auth_user
        (id, created_at, updated_at)
       values (?, ?, ?)`
    )
    .run(validated.actor.userId, 1000, 1000);
  const email = `${validated.actor.userId}@example.test`;
  database
    .prepare(
      `insert into auth_user_identity
        (id, user_id, scope_type, scope_id, kind, value, normalized_value,
         verified_at, is_primary_login, created_at, updated_at)
       values (?, ?, 'global', 'global', 'email', ?, ?, ?, 1, ?, ?)`
    )
    .run(
      `identity-${validated.actor.userId}`,
      validated.actor.userId,
      email,
      email,
      1000,
      1000,
      1000
    );
  database
    .prepare(
      `insert into auth_session
        (id, user_id, secret_hash, created_at, expires_at, auth_time,
         authentication_events, aal, amr, rotated_at)
       values (?, ?, ?, ?, ?, ?, '[]', 'aal1', '[]', ?)`
    )
    .run(
      validated.actor.sessionId,
      validated.actor.userId,
      "hash",
      1000,
      validated.issued.expiresAt,
      validated.issued.authTime,
      validated.issued.rotatedAt ?? null
    );
};

const makeResolverLive = () =>
  Layer.succeed(
    Resources.MailResourceResolver,
    Resources.MailResourceResolver.of({
      resolveAttachment: (resource) =>
        Effect.succeed(
          Schema.decodeUnknownSync(AttachmentLocation)({
            _tag: "Attachment",
            attachmentId: resource.attachmentId,
            folderId: "folder-a",
            mailboxId: resource.mailboxId,
            messageId: "message-a",
          })
        ),
      resolveDraft: (resource) =>
        Effect.succeed(
          Schema.decodeUnknownSync(DraftLocation)({
            _tag: "Draft",
            draftId: resource.draftId,
            mailboxId: resource.mailboxId,
          })
        ),
      resolveFolder: (resource) =>
        Effect.succeed(
          Schema.decodeUnknownSync(FolderLocation)({
            _tag: "Folder",
            folderId: resource.folderId,
            mailboxId: resource.mailboxId,
          })
        ),
      resolveMessage: (resource) =>
        Effect.succeed(
          Schema.decodeUnknownSync(MessageLocation)({
            _tag: "Message",
            folderId: "folder-a",
            mailboxId: resource.mailboxId,
            messageId: resource.messageId,
          })
        ),
      resolveRule: (resource) =>
        Effect.succeed(
          Schema.decodeUnknownSync(RuleLocation)({
            _tag: "Rule",
            mailboxId: resource.mailboxId,
            ruleId: resource.ruleId,
          })
        ),
    })
  );

const makePermissionRaceLive = (mutation: () => void) =>
  MailAuthorizationLive.pipe(
    Layer.provide(
      Layer.merge(
        Layer.succeed(
          AuthPermission.Permissions,
          AuthPermission.Permissions.of({
            hasPermission: () =>
              Effect.sync(() => {
                mutation();
                return true;
              }),
            hasRole: () => Effect.succeed(false),
          })
        ),
        makeResolverLive()
      )
    )
  );

const unavailableMailAuthorizationLive = Layer.succeed(
  MailAuthorization,
  MailAuthorization.of({} as MailAuthorization)
);

const controlPlaneBatchLive = (database: D1EffectQbDatabaseLike) =>
  ControlPlaneBatchLive.pipe(
    Layer.provide(
      Layer.succeed(
        ControlPlaneD1Binding,
        ControlPlaneD1Binding.of({
          database: database as unknown as D1Database,
        })
      )
    )
  );

const provideRequestAuth = <A, E, R>(
  effect: Effect.Effect<
    A,
    E,
    R | AuthPermission.CurrentPrincipal | CurrentRequestAuthShape
  >,
  validated: ValidatedSession
) =>
  effect.pipe(
    Effect.provideService(
      CurrentRequestAuth,
      CurrentRequestAuth.of({ sessionSecretHash: "hash", validated })
    ),
    Effect.provideService(
      AuthPermission.CurrentPrincipal,
      AuthPermission.CurrentPrincipal.of(
        AuthPermission.PermissionSubject.user(validated.actor.userId)
      )
    )
  );

const bootstrap = (
  database: D1EffectQbDatabaseLike,
  validated: ValidatedSession,
  nonce: string,
  ownerEmail = "user-a@example.test"
) =>
  provideRequestAuth(
    Effect.gen(function* () {
      const administration = yield* MailboxAdministration;
      return yield* administration.bootstrapOwner({
        displayName: Schema.decodeUnknownSync(MailboxDisplayName)("Inbox"),
      });
    }).pipe(
      Effect.provide(
        MailboxAdministrationLive.pipe(
          Layer.provide(unavailableMailAuthorizationLive),
          Layer.provide(
            Layer.merge(
              Layer.succeed(
                MailboxAdministrationConfig,
                MailboxAdministrationConfig.of({
                  ownerEmail: Schema.decodeUnknownSync(
                    MailboxAdministrationOwnerEmail
                  )(ownerEmail),
                })
              ),
              Layer.succeed(
                MailboxAdministrationRuntime,
                MailboxAdministrationRuntime.of({
                  now: () => now,
                  randomId: () => nonce,
                })
              )
            )
          ),
          Layer.provide(controlPlaneBatchLive(database))
        )
      )
    ),
    validated
  );

const rename = (
  database: D1EffectQbDatabaseLike,
  validated: ValidatedSession,
  mailAuthorizationLive: Layer.Layer<MailAuthorization>,
  mailboxId: string,
  displayName: string
) =>
  provideRequestAuth(
    Effect.gen(function* () {
      const administration = yield* MailboxAdministration;
      return yield* administration.rename({
        displayName: Schema.decodeUnknownSync(MailboxDisplayName)(displayName),
        mailboxId: Schema.decodeUnknownSync(MailboxId)(mailboxId),
      });
    }).pipe(
      Effect.provide(
        MailboxAdministrationLive.pipe(
          Layer.provide(
            Layer.merge(
              Layer.succeed(
                MailboxAdministrationConfig,
                MailboxAdministrationConfig.of({
                  ownerEmail: Schema.decodeUnknownSync(
                    MailboxAdministrationOwnerEmail
                  )("user-a@example.test"),
                })
              ),
              Layer.succeed(
                MailboxAdministrationRuntime,
                MailboxAdministrationRuntime.of({
                  now: () => now + 1000,
                  randomId: () => "rename-guard",
                })
              )
            )
          ),
          Layer.provide(controlPlaneBatchLive(database))
        )
      ),
      Effect.provide(mailAuthorizationLive)
    ),
    validated
  );

const countRows = (database: DatabaseSync, table: string) =>
  (
    database.prepare(`select count(*) as count from ${table}`).get() as {
      count: number;
    }
  ).count;

describe("mailbox administration", () => {
  it("atomically creates the mailbox, discovery member, and owner grant", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, validated);

      const mailbox = await Effect.runPromise(
        bootstrap(d1, validated, "bootstrap-guard")
      );
      const canManage = await Effect.runPromise(
        Effect.gen(function* () {
          const permissions = yield* AuthPermission.Permissions;
          return yield* permissions.hasPermission({
            permission: MailPermission.mailboxManageSettings,
            scope: mailboxScope(mailbox.id),
            subject: AuthPermission.PermissionSubject.user(
              validated.actor.userId
            ),
          });
        }).pipe(
          Effect.provide(
            MailPermissionsLive.pipe(
              Layer.provide(D1EffectQbSqliteAuthStorageLive(d1))
            )
          )
        )
      );

      expect(mailbox).toMatchObject({
        createdByUserId: "user-a",
        displayName: "Inbox",
        id: "primary",
        status: "active",
        version: 1,
      });
      expect(canManage).toBeTruthy();
      expect({
        addresses: countRows(database, "app_mailbox_address"),
        guards: countRows(database, "app_authorization_guard"),
        mailboxes: countRows(database, "app_mailbox"),
        members: countRows(database, "app_mailbox_member"),
      }).toStrictEqual({ addresses: 1, guards: 0, mailboxes: 1, members: 1 });
      expect(
        database
          .prepare(
            `select mailbox_id, id, address, normalized_address, is_primary,
                    enabled, created_at, updated_at, version
               from app_mailbox_address`
          )
          .get()
      ).toMatchObject({
        address: "user-a@example.test",
        created_at: now,
        enabled: 1,
        id: "primary",
        is_primary: 1,
        mailbox_id: "primary",
        normalized_address: "user-a@example.test",
        updated_at: now,
        version: 1,
      });
      expect(
        database
          .prepare(
            `select role_id, scope_type, scope_id
               from auth_role_grant
              where subject_id = ?`
          )
          .get("user-a")
      ).toMatchObject({
        role_id: MailRole.owner,
        scope_id: "primary",
        scope_type: "mailbox",
      });
    } finally {
      database.close();
    }
  });

  it("normalizes only the primary address domain during bootstrap", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, validated);

      await Effect.runPromise(
        bootstrap(d1, validated, "bootstrap-guard", "user-a@EXAMPLE.TEST")
      );

      expect(
        database
          .prepare(
            `select address, normalized_address
               from app_mailbox_address
              where mailbox_id = 'primary'`
          )
          .get()
      ).toMatchObject({
        address: "user-a@EXAMPLE.TEST",
        normalized_address: "user-a@example.test",
      });
    } finally {
      database.close();
    }
  });

  it("rolls back every bootstrap write after a middle-statement failure", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      database.exec(`create trigger fail_mailbox_member
        before insert on app_mailbox_member
        begin
          select raise(abort, 'member insert failed');
        end`);
      const d1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, validated);

      const error = await Effect.runPromise(
        bootstrap(d1, validated, "bootstrap-guard").pipe(Effect.flip)
      );

      expect(error).toBeInstanceOf(MailboxAdministrationError);
      expect(error).toMatchObject({
        commitState: "unknown",
        reason: "storage",
      });
      expect({
        addresses: countRows(database, "app_mailbox_address"),
        grants: countRows(database, "auth_role_grant"),
        guards: countRows(database, "app_authorization_guard"),
        mailboxes: countRows(database, "app_mailbox"),
        members: countRows(database, "app_mailbox_member"),
      }).toStrictEqual({
        addresses: 0,
        grants: 0,
        guards: 0,
        mailboxes: 0,
        members: 0,
      });
    } finally {
      database.close();
    }
  });

  it("accepts semantically equivalent authentication event JSON", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, validated);
      database
        .prepare(
          "update auth_session set authentication_events = '[ ]' where id = ?"
        )
        .run(validated.actor.sessionId);

      const mailbox = await Effect.runPromise(
        bootstrap(d1, validated, "bootstrap-guard")
      );

      expect(mailbox.id).toBe("primary");
    } finally {
      database.close();
    }
  });

  it("rejects owner bootstrap from a session with unmet requirements", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      const claims = { requirements: ["email_verification"] } as const;
      const limited = {
        ...validated,
        currentSession: { ...validated.currentSession, claims },
        issued: { ...validated.issued, claims },
      } satisfies ValidatedSession;
      insertCurrentSession(database, limited);

      const error = await Effect.runPromise(
        bootstrap(d1, limited, "bootstrap-guard").pipe(Effect.flip)
      );

      expect(error).toMatchObject({
        operation: "bootstrap-owner",
        reason: "session-recheck",
      });
      expect({
        grants: countRows(database, "auth_role_grant"),
        mailboxes: countRows(database, "app_mailbox"),
        members: countRows(database, "app_mailbox_member"),
      }).toStrictEqual({ grants: 0, mailboxes: 0, members: 0 });
    } finally {
      database.close();
    }
  });

  it("does not let an unconfigured actor take ownership", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const first = makeValidatedSession("user-a", "session-a");
      const second = makeValidatedSession("user-b", "session-b");
      insertCurrentSession(database, first);
      insertCurrentSession(database, second);

      const error = await Effect.runPromise(
        bootstrap(d1, second, "bootstrap-guard-b").pipe(Effect.flip)
      );

      expect(error).toMatchObject({ reason: "owner-not-eligible" });
      expect(countRows(database, "app_mailbox")).toBe(0);
      await Effect.runPromise(bootstrap(d1, first, "bootstrap-guard-a"));
      expect(
        database
          .prepare("select created_by_user_id from app_mailbox where id = ?")
          .get("primary")
      ).toMatchObject({ created_by_user_id: "user-a" });
      expect(
        database
          .prepare(
            `select count(*) as count
               from auth_role_grant
              where subject_id = 'user-b'`
          )
          .get()
      ).toMatchObject({ count: 0 });
      expect(
        database
          .prepare(
            `select count(*) as count
               from app_mailbox_member
              where user_id = 'user-b'`
          )
          .get()
      ).toMatchObject({ count: 0 });
    } finally {
      database.close();
    }
  });

  it.each([
    ["unverified", "verified_at = null"],
    ["revoked", "revoked_at = 1500"],
    ["replaced", "replaced_by_id = 'replacement-identity'"],
  ] as const)(
    "rejects a configured but %s owner identity",
    async (_, update) => {
      const database = new DatabaseSync(":memory:");

      try {
        await applyControlPlaneMigrations(database);
        const d1 = makeTestD1Database(database);
        const validated = makeValidatedSession("user-a", "session-a");
        insertCurrentSession(database, validated);
        database.exec(`update auth_user_identity set ${update}`);

        const error = await Effect.runPromise(
          bootstrap(d1, validated, "bootstrap-guard").pipe(Effect.flip)
        );

        expect(error).toMatchObject({ reason: "owner-not-eligible" });
        expect(countRows(database, "app_mailbox")).toBe(0);
      } finally {
        database.close();
      }
    }
  );

  it("renames only after policy and transactional permission checks succeed", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, validated);
      await Effect.runPromise(bootstrap(d1, validated, "bootstrap-guard"));
      const mailAuthorizationLive = MailAuthorizationLive.pipe(
        Layer.provide(
          Layer.merge(
            MailPermissionsLive.pipe(
              Layer.provide(D1EffectQbSqliteAuthStorageLive(d1))
            ),
            makeResolverLive()
          )
        )
      );

      const mailbox = await Effect.runPromise(
        rename(d1, validated, mailAuthorizationLive, "primary", "Recruiting")
      );

      expect(mailbox).toMatchObject({
        displayName: "Recruiting",
        id: "primary",
        version: 2,
      });
      expect(countRows(database, "app_authorization_guard")).toBe(0);
    } finally {
      database.close();
    }
  });

  it("denies a mutation when its role is revoked after the policy check", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, validated);
      await Effect.runPromise(bootstrap(d1, validated, "bootstrap-guard"));
      const mailAuthorizationLive = makePermissionRaceLive(() => {
        database
          .prepare(
            `update auth_role_grant
                set revoked_at = ?
              where subject_id = ? and role_id = ?`
          )
          .run(now + 500, "user-a", MailRole.owner);
      });

      const error = await Effect.runPromise(
        rename(
          d1,
          validated,
          mailAuthorizationLive,
          "primary",
          "Attacker Name"
        ).pipe(Effect.flip)
      );

      expect(error).toMatchObject({
        operation: "rename",
        reason: "authorization-recheck",
      });
      expect(
        database
          .prepare("select display_name from app_mailbox where id = ?")
          .get("primary")
      ).toMatchObject({ display_name: "Inbox" });
    } finally {
      database.close();
    }
  });

  it("denies a mutation when its session is revoked after the policy check", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, validated);
      await Effect.runPromise(bootstrap(d1, validated, "bootstrap-guard"));
      const mailAuthorizationLive = makePermissionRaceLive(() => {
        database
          .prepare("update auth_session set revoked_at = ? where id = ?")
          .run(now + 500, "session-a");
      });

      const error = await Effect.runPromise(
        rename(
          d1,
          validated,
          mailAuthorizationLive,
          "primary",
          "Attacker Name"
        ).pipe(Effect.flip)
      );

      expect(error).toMatchObject({
        operation: "rename",
        reason: "session-recheck",
      });
      expect(
        database
          .prepare("select display_name from app_mailbox where id = ?")
          .get("primary")
      ).toMatchObject({ display_name: "Inbox" });
    } finally {
      database.close();
    }
  });

  it("denies a same-millisecond session rotation after the policy check", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a", 1500);
      insertCurrentSession(database, validated);
      await Effect.runPromise(bootstrap(d1, validated, "bootstrap-guard"));
      const mailAuthorizationLive = makePermissionRaceLive(() => {
        database
          .prepare(
            `update auth_session
                set secret_hash = 'rotated-hash', rotated_at = ?
              where id = ?`
          )
          .run(1500, "session-a");
      });

      const error = await Effect.runPromise(
        rename(
          d1,
          validated,
          mailAuthorizationLive,
          "primary",
          "Attacker Name"
        ).pipe(Effect.flip)
      );

      expect(error).toMatchObject({
        operation: "rename",
        reason: "session-recheck",
      });
      expect(
        database
          .prepare("select display_name from app_mailbox where id = ?")
          .get("primary")
      ).toMatchObject({ display_name: "Inbox" });
    } finally {
      database.close();
    }
  });

  it("denies new session requirements added after the policy check", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, validated);
      await Effect.runPromise(bootstrap(d1, validated, "bootstrap-guard"));
      const mailAuthorizationLive = makePermissionRaceLive(() => {
        database
          .prepare("update auth_session set metadata = ? where id = ?")
          .run(
            JSON.stringify({
              __effectAuthSession: {
                claims: { requirements: ["email_verification"] },
                version: 1,
              },
            }),
            "session-a"
          );
      });

      const error = await Effect.runPromise(
        rename(
          d1,
          validated,
          mailAuthorizationLive,
          "primary",
          "Attacker Name"
        ).pipe(Effect.flip)
      );

      expect(error).toMatchObject({
        operation: "rename",
        reason: "session-recheck",
      });
      expect(
        database
          .prepare("select display_name from app_mailbox where id = ?")
          .get("primary")
      ).toMatchObject({ display_name: "Inbox" });
    } finally {
      database.close();
    }
  });

  it("does not retry when D1 reports an unknown commit state", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      const baseD1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, validated);
      let batches = 0;
      const ambiguousD1: D1EffectQbDatabaseLike = {
        batch: async (statements) => {
          batches += 1;
          await baseD1.batch(statements);
          throw new Error("Response lost after commit");
        },
        prepare: baseD1.prepare,
      };

      const error = await Effect.runPromise(
        bootstrap(ambiguousD1, validated, "bootstrap-guard").pipe(Effect.flip)
      );

      expect(error).toMatchObject({
        commitState: "unknown",
        reason: "storage",
      });
      expect(batches).toBe(1);
      expect({
        addresses: countRows(database, "app_mailbox_address"),
        grants: countRows(database, "auth_role_grant"),
        guards: countRows(database, "app_authorization_guard"),
        mailboxes: countRows(database, "app_mailbox"),
        members: countRows(database, "app_mailbox_member"),
      }).toStrictEqual({
        addresses: 1,
        grants: 1,
        guards: 0,
        mailboxes: 1,
        members: 1,
      });
    } finally {
      database.close();
    }
  });

  it("reports missing required batch rows as storage failure after commit", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      const baseD1 = makeTestD1Database(database);
      const validated = makeValidatedSession("user-a", "session-a");
      insertCurrentSession(database, validated);
      const missingStatusD1: D1EffectQbDatabaseLike = {
        batch: async (statements) => {
          const results = await baseD1.batch(statements);
          return results.map((result, index) =>
            index === 5 ? { ...result, results: undefined } : result
          );
        },
        prepare: baseD1.prepare,
      };

      const error = await Effect.runPromise(
        bootstrap(missingStatusD1, validated, "bootstrap-guard").pipe(
          Effect.flip
        )
      );

      expect(error).toMatchObject({
        commitState: "unknown",
        operation: "bootstrap-owner",
        reason: "storage",
      });
      expect({
        addresses: countRows(database, "app_mailbox_address"),
        grants: countRows(database, "auth_role_grant"),
        mailboxes: countRows(database, "app_mailbox"),
        members: countRows(database, "app_mailbox_member"),
      }).toStrictEqual({ addresses: 1, grants: 1, mailboxes: 1, members: 1 });
    } finally {
      database.close();
    }
  });
});
