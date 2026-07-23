import * as AuthPermission from "@effect-auth/core/Permission";
import * as AuthPolicy from "@effect-auth/core/Policy";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  MailPermission,
  folderScope,
  mailboxScope,
} from "#/modules/authorization/domain/MailPermissionCatalog";
import { TrustedMailResourceResolver } from "#/modules/authorization/ports/TrustedMailResourceResolver";
import { MailboxAuthorization } from "#/modules/mailbox/ports/MailboxAuthorization";
import type { MailboxMessageReadAccess } from "#/modules/mailbox/ports/MailboxAuthorization";
import type * as MailboxPort from "#/modules/mailbox/ports/MailboxAuthorization";

const mailboxPermissionByAction = {
  "manage-members": MailPermission.mailboxManageMembers,
  "manage-settings": MailPermission.mailboxManageSettings,
  modify: MailPermission.mailboxModify,
  read: MailPermission.mailboxRead,
  send: MailPermission.mailboxSend,
} as const;

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
      const scope = mailboxScope(mailboxId);
      return AuthPolicy.all(
        requirePermission(MailPermission.draftSend, scope),
        requirePermission(MailPermission.mailboxSend, scope)
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
                  MailPermission.messageRead,
                  mailboxScope(location.mailboxId)
                ),
                requirePermission(
                  MailPermission.attachmentRead,
                  mailboxScope(location.mailboxId)
                )
              ),
              requirePermission(
                MailPermission.folderRead,
                folderScope(location.mailboxId, location.folderId)
              )
            ).pipe(Effect.as(location))
          )
        ),
      requireAttachmentUpload: ({ resource }) =>
        resolveDraft(resource).pipe(
          Effect.flatMap((location) =>
            AuthPolicy.all(
              requirePermission(
                MailPermission.draftCreate,
                mailboxScope(location.mailboxId)
              ),
              requirePermission(
                MailPermission.attachmentUpload,
                mailboxScope(location.mailboxId)
              )
            ).pipe(Effect.as(location))
          )
        ),
      requireDraft: ({ action, resource }) =>
        resolveDraft(resource).pipe(
          Effect.flatMap((location) => {
            const scope = mailboxScope(location.mailboxId);
            const policy =
              action === "edit"
                ? requirePermission(MailPermission.draftCreate, scope)
                : requireMailboxDraftSendPermissions(location.mailboxId);

            return policy.pipe(Effect.as(location));
          })
        ),
      requireDraftCreate: ({ resource }) => {
        const location = resource;
        return requirePermission(
          MailPermission.draftCreate,
          mailboxScope(location.mailboxId)
        ).pipe(Effect.as(location));
      },
      requireExport: ({ resource }) => {
        const location = resource;
        return requirePermission(
          MailPermission.mailboxExport,
          mailboxScope(location.mailboxId)
        ).pipe(Effect.as(location));
      },
      requireFolder: ({ action, resource }) =>
        resolveFolder(resource).pipe(
          Effect.flatMap((location) =>
            AuthPolicy.any(
              requirePermission(
                action === "read"
                  ? MailPermission.folderRead
                  : MailPermission.folderModify,
                folderScope(location.mailboxId, location.folderId)
              ),
              requirePermission(
                action === "read"
                  ? MailPermission.mailboxRead
                  : MailPermission.mailboxModify,
                mailboxScope(location.mailboxId)
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
              MailPermission.messageRead,
              mailboxScope(location.mailboxId)
            ).pipe(
              Effect.as(mailboxAccess),
              Effect.catchTag("AuthorizationError", () =>
                requirePermission(
                  MailPermission.folderRead,
                  folderScope(location.mailboxId, location.folderId)
                ).pipe(Effect.as(folderAccess))
              )
            );
          })
        ),
      requireMailbox: ({ action, resource }) => {
        const location = resource;
        return requirePermission(
          mailboxPermissionByAction[action],
          mailboxScope(location.mailboxId)
        ).pipe(Effect.as(location));
      },
      requireMailboxDraftSend: ({ resource }) =>
        requireMailboxDraftSendPermissions(resource.mailboxId).pipe(
          Effect.as(resource)
        ),
      requireMailboxMessageRead: ({ resource }) =>
        requirePermission(
          MailPermission.messageRead,
          mailboxScope(resource.mailboxId)
        ).pipe(Effect.as(resource)),
      requireMessage: ({ action, resource }) =>
        resolveMessage(resource).pipe(
          Effect.flatMap((location) =>
            AuthPolicy.any(
              requirePermission(
                action === "read"
                  ? MailPermission.messageRead
                  : MailPermission.messageModify,
                mailboxScope(location.mailboxId)
              ),
              requirePermission(
                action === "read"
                  ? MailPermission.folderRead
                  : MailPermission.folderModify,
                folderScope(location.mailboxId, location.folderId)
              )
            ).pipe(Effect.as(location))
          )
        ),
      requireRuleManage: ({ resource }) =>
        resolveRule(resource).pipe(
          Effect.flatMap((location) =>
            requirePermission(
              MailPermission.ruleManage,
              mailboxScope(location.mailboxId)
            ).pipe(Effect.as(location))
          )
        ),
    });
  })
);
