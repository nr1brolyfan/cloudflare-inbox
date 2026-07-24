import * as AuthPermission from "@effect-auth/core/Permission";
import * as AuthPolicy from "@effect-auth/core/Policy";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  AuthorizationPermission,
  folderScope,
  makeFolderId,
  makeMailboxScopeId,
  mailboxScope,
} from "#/modules/authorization/contracts/AuthorizationCatalog";
import { TrustedMailResourceResolver } from "#/modules/authorization/ports/TrustedMailResourceResolver";
import type {
  FolderId as MailboxFolderId,
  MailboxId,
} from "#/modules/mailbox/domain/Mailbox";
import { MailboxAuthorization } from "#/modules/mailbox/ports/MailboxAuthorization";
import type { MailboxMessageReadAccess } from "#/modules/mailbox/ports/MailboxAuthorization";
import type * as MailboxPort from "#/modules/mailbox/ports/MailboxAuthorization";

const mailboxPermissionByAction = {
  "manage-members": AuthorizationPermission.mailboxManageMembers,
  "manage-settings": AuthorizationPermission.mailboxManageSettings,
  modify: AuthorizationPermission.mailboxModify,
  read: AuthorizationPermission.mailboxRead,
  send: AuthorizationPermission.mailboxSend,
} as const;

const mailboxResourceScope = (mailboxId: MailboxId) =>
  mailboxScope(makeMailboxScopeId(mailboxId));
const folderResourceScope = (mailboxId: MailboxId, folderId: MailboxFolderId) =>
  folderScope(makeMailboxScopeId(mailboxId), makeFolderId(folderId));

const ensureResolverInvariant = (
  valid: boolean,
  resource: MailboxPort.ResolvableMailResourceRef
) =>
  valid
    ? Effect.void
    : Effect.die(
        new Error(`Mail resource resolver violated ${resource._tag} invariant`)
      );

/** Adapts the mailbox capability to permission checks and trusted ancestry. */
export const MailboxAuthorizationApplicationLayer = Layer.effect(
  MailboxAuthorization,
  Effect.gen(function* () {
    const permissions = yield* AuthPermission.Permissions;
    const resolver = yield* TrustedMailResourceResolver;
    const requirePermission = (
      permission: AuthPermission.PermissionId,
      scope: AuthPermission.PermissionScope
    ) =>
      AuthPolicy.requirePermission(permission, { scope }).pipe(
        Effect.provideService(AuthPermission.Permissions, permissions)
      );
    const requireMailboxDraftSendPermissions = (
      mailboxId: MailboxPort.TrustedMailboxLocation["mailboxId"]
    ) => {
      const scope = mailboxResourceScope(mailboxId);
      return AuthPolicy.all(
        requirePermission(AuthorizationPermission.draftSend, scope),
        requirePermission(AuthorizationPermission.mailboxSend, scope)
      );
    };
    const resolveFolder = (resource: MailboxPort.FolderRef) =>
      resolver
        .resolveFolder(resource)
        .pipe(
          Effect.tap((location) =>
            ensureResolverInvariant(
              location.mailboxId === resource.mailboxId &&
                location.folderId === resource.folderId,
              resource
            )
          )
        );
    const resolveMessage = (resource: MailboxPort.MessageRef) =>
      resolver
        .resolveMessage(resource)
        .pipe(
          Effect.tap((location) =>
            ensureResolverInvariant(
              location.mailboxId === resource.mailboxId &&
                location.messageId === resource.messageId,
              resource
            )
          )
        );
    const resolveDraft = (resource: MailboxPort.DraftRef) =>
      resolver
        .resolveDraft(resource)
        .pipe(
          Effect.tap((location) =>
            ensureResolverInvariant(
              location.mailboxId === resource.mailboxId &&
                location.draftId === resource.draftId,
              resource
            )
          )
        );
    const resolveRule = (resource: MailboxPort.RuleRef) =>
      resolver
        .resolveRule(resource)
        .pipe(
          Effect.tap((location) =>
            ensureResolverInvariant(
              location.mailboxId === resource.mailboxId &&
                location.ruleId === resource.ruleId,
              resource
            )
          )
        );
    const resolveAttachment = (resource: MailboxPort.AttachmentRef) =>
      resolver
        .resolveAttachment(resource)
        .pipe(
          Effect.tap((location) =>
            ensureResolverInvariant(
              location.mailboxId === resource.mailboxId &&
                location.attachmentId === resource.attachmentId,
              resource
            )
          )
        );

    return MailboxAuthorization.of({
      requireAttachmentRead: ({ resource }) =>
        resolveAttachment(resource).pipe(
          Effect.flatMap((location) =>
            AuthPolicy.any(
              AuthPolicy.all(
                requirePermission(
                  AuthorizationPermission.messageRead,
                  mailboxResourceScope(location.mailboxId)
                ),
                requirePermission(
                  AuthorizationPermission.attachmentRead,
                  mailboxResourceScope(location.mailboxId)
                )
              ),
              requirePermission(
                AuthorizationPermission.folderRead,
                folderResourceScope(location.mailboxId, location.folderId)
              )
            ).pipe(Effect.as(location))
          )
        ),
      requireAttachmentUpload: ({ resource }) =>
        resolveDraft(resource).pipe(
          Effect.flatMap((location) =>
            AuthPolicy.all(
              requirePermission(
                AuthorizationPermission.draftCreate,
                mailboxResourceScope(location.mailboxId)
              ),
              requirePermission(
                AuthorizationPermission.attachmentUpload,
                mailboxResourceScope(location.mailboxId)
              )
            ).pipe(Effect.as(location))
          )
        ),
      requireDraft: ({ action, resource }) =>
        resolveDraft(resource).pipe(
          Effect.flatMap((location) => {
            const scope = mailboxResourceScope(location.mailboxId);
            const policy =
              action === "edit"
                ? requirePermission(AuthorizationPermission.draftCreate, scope)
                : requireMailboxDraftSendPermissions(location.mailboxId);

            return policy.pipe(Effect.as(location));
          })
        ),
      requireDraftCreate: ({ resource }) => {
        const location = resource;
        return requirePermission(
          AuthorizationPermission.draftCreate,
          mailboxResourceScope(location.mailboxId)
        ).pipe(Effect.as(location));
      },
      requireExport: ({ resource }) => {
        const location = resource;
        return requirePermission(
          AuthorizationPermission.mailboxExport,
          mailboxResourceScope(location.mailboxId)
        ).pipe(Effect.as(location));
      },
      requireFolder: ({ action, resource }) =>
        resolveFolder(resource).pipe(
          Effect.flatMap((location) =>
            AuthPolicy.any(
              requirePermission(
                action === "read"
                  ? AuthorizationPermission.folderRead
                  : AuthorizationPermission.folderModify,
                folderResourceScope(location.mailboxId, location.folderId)
              ),
              requirePermission(
                action === "read"
                  ? AuthorizationPermission.mailboxRead
                  : AuthorizationPermission.mailboxModify,
                mailboxResourceScope(location.mailboxId)
              )
            ).pipe(Effect.as(location))
          )
        ),
      requireFolderMessageRead: ({ resource }) =>
        resolveFolder(resource).pipe(
          Effect.flatMap((location) => {
            const mailboxAccess: MailboxMessageReadAccess = {
              _tag: "MailboxMessageRead",
              mailboxId: location.mailboxId,
            };
            const folderAccess: MailboxMessageReadAccess = {
              _tag: "FolderMessageRead",
              folderId: location.folderId,
              mailboxId: location.mailboxId,
            };
            return requirePermission(
              AuthorizationPermission.messageRead,
              mailboxResourceScope(location.mailboxId)
            ).pipe(
              Effect.as(mailboxAccess),
              Effect.catchTag("AuthorizationError", () =>
                requirePermission(
                  AuthorizationPermission.folderRead,
                  folderResourceScope(location.mailboxId, location.folderId)
                ).pipe(Effect.as(folderAccess))
              )
            );
          })
        ),
      requireMailbox: ({ action, resource }) => {
        const location = resource;
        return requirePermission(
          mailboxPermissionByAction[action],
          mailboxResourceScope(location.mailboxId)
        ).pipe(Effect.as(location));
      },
      requireMailboxDraftSend: ({ resource }) =>
        requireMailboxDraftSendPermissions(resource.mailboxId).pipe(
          Effect.as(resource)
        ),
      requireMailboxMessageRead: ({ resource }) =>
        requirePermission(
          AuthorizationPermission.messageRead,
          mailboxResourceScope(resource.mailboxId)
        ).pipe(Effect.as(resource)),
      requireMessage: ({ action, resource }) =>
        resolveMessage(resource).pipe(
          Effect.flatMap((location) =>
            AuthPolicy.any(
              requirePermission(
                action === "read"
                  ? AuthorizationPermission.messageRead
                  : AuthorizationPermission.messageModify,
                mailboxResourceScope(location.mailboxId)
              ),
              requirePermission(
                action === "read"
                  ? AuthorizationPermission.folderRead
                  : AuthorizationPermission.folderModify,
                folderResourceScope(location.mailboxId, location.folderId)
              )
            ).pipe(Effect.as(location))
          )
        ),
      requireRuleManage: ({ resource }) =>
        resolveRule(resource).pipe(
          Effect.flatMap((location) =>
            requirePermission(
              AuthorizationPermission.ruleManage,
              mailboxResourceScope(location.mailboxId)
            ).pipe(Effect.as(location))
          )
        ),
    });
  })
);
