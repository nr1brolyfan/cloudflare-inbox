import * as AuthPermission from "@effect-auth/core/Permission";
import * as AuthPolicy from "@effect-auth/core/Policy";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { MailPermission, folderScope, mailboxScope } from "./catalog";
import * as Resources from "./resources";

export type MailboxAction =
  | "read"
  | "modify"
  | "send"
  | "manage-settings"
  | "manage-members";
export type FolderAction = "read" | "modify";
export type MessageAction = "read" | "modify";
export type DraftAction = "edit" | "send";

export type MailAuthorizationError =
  | AuthPolicy.AuthorizationError
  | AuthPermission.PermissionCheckError
  | Resources.MailResourceResolveError;

type MailPolicy<A, E = never> = Effect.Effect<
  A,
  AuthPolicy.AuthorizationError | AuthPermission.PermissionCheckError | E,
  AuthPermission.CurrentPrincipal
>;

export interface MailAuthorization {
  readonly requireAttachmentRead: (input: {
    readonly resource: Resources.AttachmentRef;
  }) => MailPolicy<
    Resources.TrustedAttachmentLocation,
    Resources.MailResourceResolveError
  >;
  readonly requireAttachmentUpload: (input: {
    readonly resource: Resources.DraftRef;
  }) => MailPolicy<
    Resources.TrustedDraftLocation,
    Resources.MailResourceResolveError
  >;
  readonly requireDraft: (input: {
    readonly action: DraftAction;
    readonly resource: Resources.DraftRef;
  }) => MailPolicy<
    Resources.TrustedDraftLocation,
    Resources.MailResourceResolveError
  >;
  readonly requireDraftCreate: (input: {
    readonly resource: Resources.MailboxRef;
  }) => MailPolicy<Resources.TrustedMailboxLocation>;
  readonly requireExport: (input: {
    readonly resource: Resources.MailboxRef;
  }) => MailPolicy<Resources.TrustedMailboxLocation>;
  readonly requireFolder: (input: {
    readonly action: FolderAction;
    readonly resource: Resources.FolderRef;
  }) => MailPolicy<
    Resources.TrustedFolderLocation,
    Resources.MailResourceResolveError
  >;
  readonly requireMailbox: (input: {
    readonly action: MailboxAction;
    readonly resource: Resources.MailboxRef;
  }) => MailPolicy<Resources.TrustedMailboxLocation>;
  readonly requireMessage: (input: {
    readonly action: MessageAction;
    readonly resource: Resources.MessageRef;
  }) => MailPolicy<
    Resources.TrustedMessageLocation,
    Resources.MailResourceResolveError
  >;
  readonly requireRuleManage: (input: {
    readonly resource: Resources.RuleRef;
  }) => MailPolicy<
    Resources.TrustedRuleLocation,
    Resources.MailResourceResolveError
  >;
}

/** Resolves resource ownership and enforces the matching mail permission. */
export const MailAuthorization = Context.Service<MailAuthorization>(
  "cloudflare-inbox/MailAuthorization"
);

const mailboxPermissionByAction = {
  "manage-members": MailPermission.mailboxManageMembers,
  "manage-settings": MailPermission.mailboxManageSettings,
  modify: MailPermission.mailboxModify,
  read: MailPermission.mailboxRead,
  send: MailPermission.mailboxSend,
} as const;

const ensureResolverInvariant = (
  valid: boolean,
  resource: Resources.ResolvableMailResourceRef
) =>
  valid
    ? Effect.void
    : Effect.die(
        new Error(`Mail resource resolver violated ${resource._tag} invariant`)
      );

/** Policy implementation backed by effect-auth permissions and resource resolution. */
export const MailAuthorizationLive = Layer.effect(
  MailAuthorization,
  Effect.gen(function* () {
    const permissions = yield* AuthPermission.Permissions;
    const resolver = yield* Resources.MailResourceResolver;
    const requirePermission = (
      permission: AuthPermission.PermissionId,
      scope: AuthPermission.PermissionScope
    ) =>
      AuthPolicy.requirePermission(permission, { scope }).pipe(
        Effect.provideService(AuthPermission.Permissions, permissions)
      );
    const resolveFolder = (resource: Resources.FolderRef) =>
      resolver
        .resolveFolder(resource)
        .pipe(
          Effect.tap((location) =>
            ensureResolverInvariant(
              location.mailboxId === resource.route.mailboxId &&
                location.folderId === resource.folderId,
              resource
            )
          )
        );
    const resolveMessage = (resource: Resources.MessageRef) =>
      resolver
        .resolveMessage(resource)
        .pipe(
          Effect.tap((location) =>
            ensureResolverInvariant(
              location.mailboxId === resource.route.mailboxId &&
                location.messageId === resource.messageId,
              resource
            )
          )
        );
    const resolveDraft = (resource: Resources.DraftRef) =>
      resolver
        .resolveDraft(resource)
        .pipe(
          Effect.tap((location) =>
            ensureResolverInvariant(
              location.mailboxId === resource.route.mailboxId &&
                location.draftId === resource.draftId,
              resource
            )
          )
        );
    const resolveRule = (resource: Resources.RuleRef) =>
      resolver
        .resolveRule(resource)
        .pipe(
          Effect.tap((location) =>
            ensureResolverInvariant(
              location.mailboxId === resource.route.mailboxId &&
                location.ruleId === resource.ruleId,
              resource
            )
          )
        );
    const resolveAttachment = (resource: Resources.AttachmentRef) =>
      resolver
        .resolveAttachment(resource)
        .pipe(
          Effect.tap((location) =>
            ensureResolverInvariant(
              location.mailboxId === resource.route.mailboxId &&
                location.attachmentId === resource.attachmentId,
              resource
            )
          )
        );

    return MailAuthorization.of({
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
                folderScope(location.folderId)
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
                : AuthPolicy.all(
                    requirePermission(MailPermission.draftSend, scope),
                    requirePermission(MailPermission.mailboxSend, scope)
                  );

            return policy.pipe(Effect.as(location));
          })
        ),
      requireDraftCreate: ({ resource }) => {
        const location = { mailboxId: resource.mailboxId };
        return requirePermission(
          MailPermission.draftCreate,
          mailboxScope(location.mailboxId)
        ).pipe(Effect.as(location));
      },
      requireExport: ({ resource }) => {
        const location = { mailboxId: resource.mailboxId };
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
                folderScope(location.folderId)
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
      requireMailbox: ({ action, resource }) => {
        const location = { mailboxId: resource.mailboxId };
        return requirePermission(
          mailboxPermissionByAction[action],
          mailboxScope(location.mailboxId)
        ).pipe(Effect.as(location));
      },
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
                folderScope(location.folderId)
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
