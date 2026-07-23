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
  ControlPlaneD1Binding,
  ControlPlaneDatabaseLayer,
} from "#/platform/control-plane-d1/ControlPlaneDatabase";

import {
  applyControlPlaneMigrations,
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
    requireAttachmentUpload: unusedAuthorization,
    requireDraft: unusedAuthorization,
    requireDraftCreate: unusedAuthorization,
    requireExport: unusedAuthorization,
    requireFolder: unusedAuthorization,
    requireFolderMessageRead: unusedAuthorization,
    requireMailbox,
    requireMailboxDraftSend: unusedAuthorization,
    requireMailboxMessageRead: unusedAuthorization,
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
};

describe("mailbox navigation", () => {
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
        },
      }).toStrictEqual({
        calls: ["read:primary", "folders:primary", "labels:primary"],
        folder: "inbox",
        label: "label-work",
        mailbox: { displayName: "Primary Inbox", id: "primary" },
      });
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
