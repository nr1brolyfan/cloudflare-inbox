import * as AuthPermission from "@effect-auth/core/Permission";
import * as AuthPolicy from "@effect-auth/core/Policy";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { MailPermission } from "#/authorization/catalog";
import type { MailboxAction } from "#/authorization/mail-authorization";
import {
  MailAuthorization,
  MailAuthorizationLive,
} from "#/authorization/mail-authorization";
import * as Resources from "#/authorization/resources";
import {
  AttachmentLookup,
  AttachmentLocation,
  DraftLookup,
  DraftLocation,
  FolderLookup,
  FolderLocation,
  MailboxLocation,
  MessageLookup,
  MessageLocation,
  RuleLookup,
  RuleLocation,
} from "#/mailboxes/resource-location";

const principal = AuthPermission.PermissionSubject.make("user", "user-a");
const mailboxRef: Resources.MailboxRef = Schema.decodeUnknownSync(
  MailboxLocation
)({
  _tag: "Mailbox",
  mailboxId: "mailbox-a",
});
const folderRef: Resources.FolderRef = Schema.decodeUnknownSync(FolderLookup)({
  _tag: "Folder",
  folderId: "folder-a",
  mailboxId: "mailbox-a",
});
const messageRef: Resources.MessageRef = Schema.decodeUnknownSync(
  MessageLookup
)({
  _tag: "Message",
  messageId: "message-a",
  mailboxId: "mailbox-a",
});
const draftRef: Resources.DraftRef = Schema.decodeUnknownSync(DraftLookup)({
  _tag: "Draft",
  draftId: "draft-a",
  mailboxId: "mailbox-a",
});
const ruleRef: Resources.RuleRef = Schema.decodeUnknownSync(RuleLookup)({
  _tag: "Rule",
  mailboxId: "mailbox-a",
  ruleId: "rule-a",
});
const attachmentRef: Resources.AttachmentRef = Schema.decodeUnknownSync(
  AttachmentLookup
)({
  _tag: "Attachment",
  attachmentId: "attachment-a",
  mailboxId: "mailbox-a",
});

const permissionKey = (
  permission: string,
  scopeType: string,
  scopeId: string
) => `${permission}@${scopeType}:${scopeId}`;

const mailboxPermission = (permission: string) =>
  permissionKey(permission, "mailbox", "mailbox-a");

const folderPermission = (
  permission: string,
  folderId = "folder-a",
  mailboxId = "mailbox-a"
) => permissionKey(permission, "folder", JSON.stringify([mailboxId, folderId]));

const makeResolver = (
  overrides: Partial<Resources.MailResourceResolver> = {}
) =>
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
    ...overrides,
  });

interface PermissionFixture {
  readonly checks: AuthPermission.PermissionCheckInput[];
  readonly service: AuthPermission.PermissionsService;
}

const makePermissions = (
  allowed: readonly string[],
  failing?: string
): PermissionFixture => {
  const checks: AuthPermission.PermissionCheckInput[] = [];
  const service = AuthPermission.Permissions.of({
    hasPermission: (input) => {
      checks.push(input);
      const key = permissionKey(
        input.permission,
        input.scope?.type ?? "global",
        input.scope?.id ?? ""
      );

      return key === failing
        ? Effect.fail(
            new AuthPermission.PermissionCheckError({
              message: "Permission store unavailable",
              operation: "has_permission",
            })
          )
        : Effect.succeed(allowed.includes(key));
    },
    hasRole: () => Effect.succeed(false),
  });

  return { checks, service };
};

const authorizationEffect = <A, E>(
  resolver: Resources.MailResourceResolver,
  permissions: AuthPermission.PermissionsService,
  use: (
    authorization: MailAuthorization
  ) => Effect.Effect<A, E, AuthPermission.CurrentPrincipal>
) => {
  const dependenciesLive = Layer.merge(
    Layer.succeed(Resources.MailResourceResolver, resolver),
    Layer.succeed(AuthPermission.Permissions, permissions)
  );

  return Effect.gen(function* () {
    const authorization = yield* MailAuthorization;
    return yield* use(authorization);
  }).pipe(
    Effect.provide(MailAuthorizationLive.pipe(Layer.provide(dependenciesLive))),
    Effect.provideService(
      AuthPermission.CurrentPrincipal,
      AuthPermission.CurrentPrincipal.of(principal)
    )
  );
};

const runAuthorization = <A, E>(
  resolver: Resources.MailResourceResolver,
  permissions: AuthPermission.PermissionsService,
  use: (
    authorization: MailAuthorization
  ) => Effect.Effect<A, E, AuthPermission.CurrentPrincipal>
) => Effect.runPromise(authorizationEffect(resolver, permissions, use));

const mailboxCases = [
  ["read", MailPermission.mailboxRead],
  ["modify", MailPermission.mailboxModify],
  ["send", MailPermission.mailboxSend],
  ["manage-settings", MailPermission.mailboxManageSettings],
  ["manage-members", MailPermission.mailboxManageMembers],
] as const satisfies readonly (readonly [MailboxAction, string])[];

describe("mail authorization policies", () => {
  it.each(mailboxCases)(
    "maps mailbox %s to its scoped permission",
    async (action, permission) => {
      const fixture = makePermissions([mailboxPermission(permission)]);
      const location = await runAuthorization(
        makeResolver(),
        fixture.service,
        (authorization) =>
          authorization.requireMailbox({ action, resource: mailboxRef })
      );

      expect(location).toStrictEqual({
        _tag: "Mailbox",
        mailboxId: "mailbox-a",
      });
      expect(fixture.checks).toMatchObject([
        {
          permission,
          scope: { id: "mailbox-a", type: "mailbox" },
          subject: principal,
        },
      ]);
    }
  );

  it("requires mailbox-scoped message read for collection and thread access", async () => {
    const fixture = makePermissions([
      mailboxPermission(MailPermission.messageRead),
    ]);
    const location = await runAuthorization(
      makeResolver(),
      fixture.service,
      (authorization) =>
        authorization.requireMailboxMessageRead({ resource: mailboxRef })
    );

    expect(location).toStrictEqual({
      _tag: "Mailbox",
      mailboxId: "mailbox-a",
    });
    expect(fixture.checks).toMatchObject([
      {
        permission: MailPermission.messageRead,
        scope: { id: "mailbox-a", type: "mailbox" },
        subject: principal,
      },
    ]);
  });

  it("allows a message collection through its trusted folder scope", async () => {
    const fixture = makePermissions([
      folderPermission(MailPermission.folderRead),
    ]);
    const access = await runAuthorization(
      makeResolver(),
      fixture.service,
      (authorization) =>
        authorization.requireFolderMessageRead({ resource: folderRef })
    );

    expect(access).toStrictEqual({
      _tag: "FolderMessageRead",
      folderId: "folder-a",
      mailboxId: "mailbox-a",
    });
    expect(fixture.checks.map(({ permission }) => permission)).toStrictEqual([
      MailPermission.messageRead,
      MailPermission.folderRead,
    ]);
  });

  it("uses resolved mailbox authority as a folder fallback", async () => {
    const fixture = makePermissions([
      mailboxPermission(MailPermission.mailboxModify),
    ]);
    const location = await runAuthorization(
      makeResolver(),
      fixture.service,
      (authorization) =>
        authorization.requireFolder({ action: "modify", resource: folderRef })
    );

    expect(location).toStrictEqual({
      _tag: "Folder",
      folderId: "folder-a",
      mailboxId: "mailbox-a",
    });
    expect(
      fixture.checks.map(({ permission, scope }) =>
        permissionKey(permission, scope?.type ?? "", scope?.id ?? "")
      )
    ).toStrictEqual([
      folderPermission(MailPermission.folderModify),
      mailboxPermission(MailPermission.mailboxModify),
    ]);
  });

  it("allows direct folder, message, and draft policies at trusted scopes", async () => {
    const fixture = makePermissions([
      folderPermission(MailPermission.folderRead),
      folderPermission(MailPermission.folderModify),
      mailboxPermission(MailPermission.messageRead),
      mailboxPermission(MailPermission.messageModify),
      mailboxPermission(MailPermission.draftCreate),
    ]);
    const locations = await runAuthorization(
      makeResolver(),
      fixture.service,
      (authorization) =>
        Effect.all([
          authorization.requireFolder({ action: "read", resource: folderRef }),
          authorization.requireFolder({
            action: "modify",
            resource: folderRef,
          }),
          authorization.requireMessage({
            action: "read",
            resource: messageRef,
          }),
          authorization.requireMessage({
            action: "modify",
            resource: messageRef,
          }),
          authorization.requireDraft({ action: "edit", resource: draftRef }),
        ])
    );

    expect(locations).toHaveLength(5);
    expect(fixture.checks.map(({ permission }) => permission)).toStrictEqual([
      MailPermission.folderRead,
      MailPermission.folderModify,
      MailPermission.messageRead,
      MailPermission.messageModify,
      MailPermission.draftCreate,
    ]);
  });

  it("uses the resolver folder for message fallback and ignores extra request parents", async () => {
    const fixture = makePermissions([
      folderPermission(MailPermission.folderRead, "trusted-folder"),
    ]);
    const resource = {
      ...messageRef,
      folderId: "attacker-folder",
    };
    const location = await runAuthorization(
      makeResolver({
        resolveMessage: (input) =>
          Effect.succeed(
            Schema.decodeUnknownSync(MessageLocation)({
              _tag: "Message",
              folderId: "trusted-folder",
              mailboxId: input.mailboxId,
              messageId: input.messageId,
            })
          ),
      }),
      fixture.service,
      (authorization) =>
        authorization.requireMessage({ action: "read", resource })
    );

    expect(location.folderId).toBe("trusted-folder");
    expect(fixture.checks.map(({ scope }) => scope?.id)).toStrictEqual([
      "mailbox-a",
      '["mailbox-a","trusted-folder"]',
    ]);
    expect(
      fixture.checks.some(
        ({ scope }) => scope?.id === '["mailbox-a","attacker-folder"]'
      )
    ).toBeFalsy();
  });

  it("does not reuse a folder grant across mailboxes with the same folder id", async () => {
    const fixture = makePermissions([
      folderPermission(MailPermission.folderRead, "folder-a", "mailbox-a"),
    ]);
    const error = await runAuthorization(
      makeResolver(),
      fixture.service,
      (authorization) =>
        authorization
          .requireMessage({
            action: "read",
            resource: {
              ...messageRef,
              mailboxId: Schema.decodeUnknownSync(MailboxLocation)({
                _tag: "Mailbox",
                mailboxId: "mailbox-b",
              }).mailboxId,
            },
          })
          .pipe(Effect.flip)
    );

    expect(error).toBeInstanceOf(AuthPolicy.AuthorizationError);
    expect(fixture.checks.map(({ scope }) => scope?.id)).toStrictEqual([
      "mailbox-b",
      '["mailbox-b","folder-a"]',
    ]);
  });

  it("returns typed denial when no hierarchical branch allows access", async () => {
    const fixture = makePermissions([]);
    const error = await runAuthorization(
      makeResolver(),
      fixture.service,
      (authorization) =>
        authorization
          .requireMessage({ action: "read", resource: messageRef })
          .pipe(Effect.flip)
    );

    expect(error).toBeInstanceOf(AuthPolicy.AuthorizationError);
    expect(error).toMatchObject({ reason: "missing-permission" });
  });

  it("does not turn a permission store failure into fallback authorization", async () => {
    const direct = mailboxPermission(MailPermission.messageRead);
    const fixture = makePermissions(
      [folderPermission(MailPermission.folderRead)],
      direct
    );
    const error = await runAuthorization(
      makeResolver(),
      fixture.service,
      (authorization) =>
        authorization
          .requireMessage({ action: "read", resource: messageRef })
          .pipe(Effect.flip)
    );

    expect(error).toBeInstanceOf(AuthPermission.PermissionCheckError);
    expect(fixture.checks).toHaveLength(1);
  });

  it("preserves resolver errors without checking permissions", async () => {
    const fixture = makePermissions([]);
    const resolutionError = new Resources.MailResourceResolveError({
      message: "Message was not found",
      reason: "not-found",
      resource: messageRef,
    });
    const error = await runAuthorization(
      makeResolver({ resolveMessage: () => Effect.fail(resolutionError) }),
      fixture.service,
      (authorization) =>
        authorization
          .requireMessage({ action: "read", resource: messageRef })
          .pipe(Effect.flip)
    );

    expect(error).toBe(resolutionError);
    expect(fixture.checks).toHaveLength(0);
  });

  it("defects when the trusted resolver violates its resource invariant", async () => {
    const fixture = makePermissions([]);
    const exit = await Effect.runPromiseExit(
      authorizationEffect(
        makeResolver({
          resolveMessage: () =>
            Effect.succeed(
              Schema.decodeUnknownSync(MessageLocation)({
                _tag: "Message",
                folderId: "folder-a",
                mailboxId: "another-mailbox",
                messageId: "message-a",
              })
            ),
        }),
        fixture.service,
        (authorization) =>
          authorization.requireMessage({
            action: "read",
            resource: messageRef,
          })
      )
    );

    const defect = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;
    expect(Exit.isFailure(exit)).toBeTruthy();
    expect(defect).toBeInstanceOf(Error);
    expect(String(defect)).toContain("resolver violated Message invariant");
  });

  it("requires draft and mailbox send permissions together", async () => {
    const fixture = makePermissions([
      mailboxPermission(MailPermission.draftSend),
    ]);
    const error = await runAuthorization(
      makeResolver(),
      fixture.service,
      (authorization) =>
        authorization
          .requireDraft({ action: "send", resource: draftRef })
          .pipe(Effect.flip)
    );

    expect(error).toBeInstanceOf(AuthPolicy.AuthorizationError);
    expect(fixture.checks.map(({ permission }) => permission)).toStrictEqual([
      MailPermission.draftSend,
      MailPermission.mailboxSend,
    ]);
  });

  it("requires the same mailbox-scoped permissions for outbound cancellation", async () => {
    const fixture = makePermissions([
      mailboxPermission(MailPermission.draftSend),
    ]);
    const error = await runAuthorization(
      makeResolver(),
      fixture.service,
      (authorization) =>
        authorization
          .requireMailboxDraftSend({ resource: mailboxRef })
          .pipe(Effect.flip)
    );

    expect(error).toBeInstanceOf(AuthPolicy.AuthorizationError);
    expect(fixture.checks.map(({ permission }) => permission)).toStrictEqual([
      MailPermission.draftSend,
      MailPermission.mailboxSend,
    ]);
  });

  it("allows attachment reads through direct capabilities or folder access", async () => {
    const direct = makePermissions([
      mailboxPermission(MailPermission.messageRead),
      mailboxPermission(MailPermission.attachmentRead),
    ]);
    const fallback = makePermissions([
      folderPermission(MailPermission.folderRead),
    ]);

    const [directLocation, fallbackLocation] = await Promise.all([
      runAuthorization(makeResolver(), direct.service, (authorization) =>
        authorization.requireAttachmentRead({ resource: attachmentRef })
      ),
      runAuthorization(makeResolver(), fallback.service, (authorization) =>
        authorization.requireAttachmentRead({ resource: attachmentRef })
      ),
    ]);

    expect([
      directLocation.attachmentId,
      fallbackLocation.attachmentId,
    ]).toStrictEqual(["attachment-a", "attachment-a"]);
    expect(fallback.checks.at(-1)?.scope).toStrictEqual({
      id: '["mailbox-a","folder-a"]',
      type: "folder",
    });
  });

  it("enforces draft upload, rule, draft-create, and export capabilities", async () => {
    const fixture = makePermissions([
      mailboxPermission(MailPermission.draftCreate),
      mailboxPermission(MailPermission.attachmentUpload),
      mailboxPermission(MailPermission.ruleManage),
      mailboxPermission(MailPermission.mailboxExport),
    ]);
    const locations = await runAuthorization(
      makeResolver(),
      fixture.service,
      (authorization) =>
        Effect.all([
          authorization.requireAttachmentUpload({ resource: draftRef }),
          authorization.requireRuleManage({ resource: ruleRef }),
          authorization.requireDraftCreate({ resource: mailboxRef }),
          authorization.requireExport({ resource: mailboxRef }),
        ])
    );

    expect(locations).toHaveLength(4);
    expect(fixture.checks.map(({ permission }) => permission)).toStrictEqual([
      MailPermission.draftCreate,
      MailPermission.attachmentUpload,
      MailPermission.ruleManage,
      MailPermission.draftCreate,
      MailPermission.mailboxExport,
    ]);
  });
});
