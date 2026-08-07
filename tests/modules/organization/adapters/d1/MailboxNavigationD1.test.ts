import { DatabaseSync } from "node:sqlite";

import { SessionId, UserId } from "@effect-auth/core/Identifiers";
import {
  CurrentPrincipal,
  PermissionSubject,
} from "@effect-auth/core/Permission";
import * as AuthPolicy from "@effect-auth/core/Policy";
import { CurrentActor } from "@effect-auth/core/Sessions";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  FolderList,
  LabelList,
} from "#/modules/mailbox/domain/MailboxDirectory";
import { MailboxAuthorization } from "#/modules/mailbox/ports/MailboxAuthorization";
import type { MailboxAuthorizationService } from "#/modules/mailbox/ports/MailboxAuthorization";
import type { MailboxDirectoryRepositoryService } from "#/modules/mailbox/ports/MailboxDirectoryRepository";
import { MailboxDirectoryRepository } from "#/modules/mailbox/ports/MailboxDirectoryRepository";
import { MailboxNavigationD1Layer } from "#/modules/organization/adapters/d1/MailboxNavigationD1";
import { MailboxNavigation } from "#/modules/organization/application/MailboxNavigation";
import {
  MailboxBootstrapConfig,
  MailboxBootstrapConfigValue,
} from "#/modules/organization/contracts/MailboxBootstrapConfig";
import {
  ControlPlaneD1Binding,
  ControlPlaneDatabaseLayer,
} from "#/platform/control-plane-d1/ControlPlaneDatabase";

import {
  applyControlPlaneMigrations,
  insertFreshCutoverOrganization,
  insertOrganizationLifecycleAudit,
  makeTestD1Database,
} from "../../../../support/d1";

const folders = Schema.decodeUnknownSync(FolderList)({
  items: [
    {
      createdAt: 1000,
      id: "inbox",
      kind: "inbox",
      mailboxId: "primary",
      messageCount: 3,
      name: "Inbox",
      unreadCount: 1,
      updatedAt: 1000,
      version: 1,
    },
  ],
});
const labels = Schema.decodeUnknownSync(LabelList)({
  items: [
    {
      createdAt: 1000,
      id: "label-work",
      mailboxId: "primary",
      name: "Work",
      updatedAt: 1000,
      version: 1,
    },
  ],
});
const bootstrapConfig = Schema.decodeUnknownSync(MailboxBootstrapConfigValue)({
  initialAddress: "inbox@example.com",
  initialDomain: "example.com",
  ownerEmailAllowlist: ["owner@example.net"],
});
const unusedAuthorization = () =>
  Effect.die(new Error("Unexpected authorization operation"));

const repositoryWith = (
  listFolders: MailboxDirectoryRepositoryService["listFolders"],
  listLabels: MailboxDirectoryRepositoryService["listLabels"]
) =>
  MailboxDirectoryRepository.of({
    createFolder: unusedAuthorization,
    createLabel: unusedAuthorization,
    deleteFolder: unusedAuthorization,
    deleteLabel: unusedAuthorization,
    listFolders,
    listLabels,
    renameFolder: unusedAuthorization,
    renameLabel: unusedAuthorization,
  });

const authorizationWith = (
  requireMailbox: MailboxAuthorizationService["requireMailbox"]
) =>
  MailboxAuthorization.of({
    requireAttachmentRead: unusedAuthorization,
    requireInboundAttachmentDownload: unusedAuthorization,
    requireAttachmentUpload: unusedAuthorization,
    requireDraft: unusedAuthorization,
    requireDraftCreate: unusedAuthorization,
    requireExport: unusedAuthorization,
    requireFolder: unusedAuthorization,
    requireFolderMessageRead: unusedAuthorization,
    requireMailbox,
    requireMailboxDraftSend: unusedAuthorization,
    requireMailboxMessageRead: unusedAuthorization,
    requireMailboxMessageModify: unusedAuthorization,
    requireMessage: unusedAuthorization,
    requireRuleManage: unusedAuthorization,
  });

const navigationEffect = (
  database: DatabaseSync,
  authorization: MailboxAuthorizationService,
  repository: MailboxDirectoryRepositoryService
) => {
  const bindingLive = Layer.succeed(
    ControlPlaneD1Binding,
    ControlPlaneD1Binding.of({
      database: makeTestD1Database(database) as unknown as D1Database,
    })
  );
  const databaseLive = ControlPlaneDatabaseLayer.pipe(
    Layer.provide(bindingLive)
  );
  const navigationLive = MailboxNavigationD1Layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        databaseLive,
        Layer.succeed(
          MailboxBootstrapConfig,
          MailboxBootstrapConfig.of(bootstrapConfig)
        ),
        Layer.succeed(MailboxAuthorization, authorization),
        Layer.succeed(MailboxDirectoryRepository, repository)
      )
    )
  );
  const userId = UserId("user-a");

  return MailboxNavigation.pipe(
    Effect.flatMap((navigation) => navigation.getCurrent),
    Effect.provideService(
      CurrentActor,
      CurrentActor.of({ sessionId: SessionId("session-a"), userId })
    ),
    Effect.provideService(
      CurrentPrincipal,
      CurrentPrincipal.of(PermissionSubject.user(userId))
    ),
    Effect.provide(navigationLive)
  );
};

const insertMailboxMembership = (
  database: DatabaseSync,
  options: { readonly revoked?: boolean } = {}
) => {
  insertFreshCutoverOrganization(database, 1000);
  database
    .prepare(
      `insert into app_mailbox
        (id, display_name, status, created_by_user_id, created_at, updated_at)
       values ('primary', 'Primary Inbox', 'active', 'user-a', 1000, 1000)`
    )
    .run();
  database
    .prepare(
      `insert into app_mailbox_member
        (mailbox_id, user_id, created_at, updated_at, revoked_at)
       values ('primary', 'user-a', 1000, 1000, ?)`
    )
    .run(options.revoked ? 1000 : null);
  database
    .prepare(
      `insert into app_mailbox_address
        (mailbox_id, id, address, normalized_address, is_primary, enabled,
         created_at, updated_at)
       values ('primary', 'primary', 'inbox@example.com', 'inbox@example.com',
               1, 1, 1000, 1000)`
    )
    .run();
};

describe("mailbox navigation", () => {
  it("does not treat exact retained ancestry as discovery or authority", async () => {
    const database = new DatabaseSync(":memory:");
    let authorizationCalls = 0;

    try {
      await applyControlPlaneMigrations(database);
      insertFreshCutoverOrganization(database, 1000);
      database.exec(`
        insert into auth_user (id, created_at, updated_at)
        values ('user-a', 1000, 1000);
        insert into app_mailbox
          (id, display_name, status, created_by_user_id, created_at, updated_at)
        values ('primary', 'Primary Inbox', 'active', 'user-a', 1000, 1000);
        insert into app_user_organization_preference
          (organization_id, user_id, default_mailbox_id, settings_json,
           created_at, updated_at)
        values ('legacy_default_v1', 'user-a', 'primary', '{}', 1000, 1000);
      `);

      await expect(
        Effect.runPromise(
          navigationEffect(
            database,
            authorizationWith(({ resource }) => {
              authorizationCalls += 1;
              return Effect.succeed(resource);
            }),
            repositoryWith(
              () => Effect.succeed(folders),
              () => Effect.succeed(labels)
            )
          )
        )
      ).rejects.toMatchObject({
        _tag: "MailboxNavigationError",
        reason: "not-found",
      });
      expect({
        ancestry: {
          ...database
            .prepare(
              "select count(*) as count from app_mailbox_legacy_organization_assignment"
            )
            .get(),
        },
        authorizationCalls,
        grants: {
          ...database
            .prepare("select count(*) as count from auth_role_grant")
            .get(),
        },
        memberships: {
          ...database
            .prepare("select count(*) as count from app_mailbox_member")
            .get(),
        },
        preferences: {
          ...database
            .prepare(
              "select count(*) as count from app_user_organization_preference"
            )
            .get(),
        },
      }).toStrictEqual({
        ancestry: { count: 1 },
        authorizationCalls: 0,
        grants: { count: 0 },
        memberships: { count: 0 },
        preferences: { count: 1 },
      });
    } finally {
      database.close();
    }
  });

  it("authorizes and reads both directory projections for the discovered mailbox", async () => {
    const database = new DatabaseSync(":memory:");
    const calls: string[] = [];

    try {
      await applyControlPlaneMigrations(database);
      insertMailboxMembership(database);
      const result = await Effect.runPromise(
        navigationEffect(
          database,
          authorizationWith(({ action, resource }) => {
            calls.push(`${action}:${resource.mailboxId}`);
            return Effect.succeed(resource);
          }),
          repositoryWith(
            ({ mailboxId }) => {
              calls.push(`folders:${mailboxId}`);
              return Effect.succeed(folders);
            },
            ({ mailboxId }) => {
              calls.push(`labels:${mailboxId}`);
              return Effect.succeed(labels);
            }
          )
        )
      );

      expect({
        calls,
        folder: result.folders[0]?.id,
        label: result.labels[0]?.id,
        mailbox: {
          displayName: result.mailbox.displayName,
          id: result.mailbox.id,
          primaryAddress: result.mailbox.primaryAddress,
        },
      }).toStrictEqual({
        calls: ["read:primary", "folders:primary", "labels:primary"],
        folder: "inbox",
        label: "label-work",
        mailbox: {
          displayName: "Primary Inbox",
          id: "primary",
          primaryAddress: "inbox@example.com",
        },
      });
    } finally {
      database.close();
    }
  });

  it("does not discover mailboxes while their organization is suspended", async () => {
    const database = new DatabaseSync(":memory:");
    let authorizationCalls = 0;

    try {
      await applyControlPlaneMigrations(database);
      insertMailboxMembership(database);
      insertOrganizationLifecycleAudit(database, {
        action: "suspend",
        afterVersion: 2,
        beforeVersion: 1,
        occurredAt: 2000,
        organizationId: "legacy_default_v1",
      });
      database.exec(`
        update app_organization
           set status = 'suspended', updated_at = 2000, version = 2
         where id = 'legacy_default_v1';
      `);

      await expect(
        Effect.runPromise(
          navigationEffect(
            database,
            authorizationWith(({ resource }) => {
              authorizationCalls += 1;
              return Effect.succeed(resource);
            }),
            repositoryWith(
              () => Effect.succeed(folders),
              () => Effect.succeed(labels)
            )
          )
        )
      ).rejects.toMatchObject({
        _tag: "MailboxNavigationError",
        reason: "not-found",
      });
      expect(authorizationCalls).toBe(0);
    } finally {
      database.close();
    }
  });

  it("does not discover a revoked membership", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      insertMailboxMembership(database, { revoked: true });

      await expect(
        Effect.runPromise(
          navigationEffect(
            database,
            authorizationWith(({ resource }) => Effect.succeed(resource)),
            repositoryWith(
              () => Effect.succeed(folders),
              () => Effect.succeed(labels)
            )
          )
        )
      ).rejects.toMatchObject({
        _tag: "MailboxNavigationError",
        reason: "not-found",
      });
    } finally {
      database.close();
    }
  });

  it("does not treat membership as mailbox read permission", async () => {
    const database = new DatabaseSync(":memory:");
    let directoryReads = 0;

    try {
      await applyControlPlaneMigrations(database);
      insertMailboxMembership(database);

      await expect(
        Effect.runPromise(
          navigationEffect(
            database,
            authorizationWith(() =>
              Effect.fail(
                new AuthPolicy.AuthorizationError({
                  reason: "missing-permission",
                })
              )
            ),
            repositoryWith(
              () => {
                directoryReads += 1;
                return Effect.succeed(folders);
              },
              () => {
                directoryReads += 1;
                return Effect.succeed(labels);
              }
            )
          )
        )
      ).rejects.toMatchObject({
        _tag: "AuthorizationError",
        reason: "missing-permission",
      });
      expect(directoryReads).toBe(0);
    } finally {
      database.close();
    }
  });

  it("rejects directory data belonging to a different mailbox", async () => {
    const database = new DatabaseSync(":memory:");
    const mismatchedFolders = Schema.decodeUnknownSync(FolderList)({
      items: [{ ...folders.items[0], mailboxId: "other" }],
    });

    try {
      await applyControlPlaneMigrations(database);
      insertMailboxMembership(database);

      await expect(
        Effect.runPromise(
          navigationEffect(
            database,
            authorizationWith(({ resource }) => Effect.succeed(resource)),
            repositoryWith(
              () => Effect.succeed(mismatchedFolders),
              () => Effect.succeed(labels)
            )
          )
        )
      ).rejects.toMatchObject({
        _tag: "MailboxNavigationError",
        reason: "storage",
      });
    } finally {
      database.close();
    }
  });
});
