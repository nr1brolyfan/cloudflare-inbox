import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { MailboxRepositoryError } from "../mailboxes/errors/mailbox-repository-error";
import {
  AttachmentId,
  DraftId,
  FolderId,
  MailboxId,
  MessageId,
  RuleId,
} from "../mailboxes/identifiers";
import { MailboxRepository } from "../mailboxes/mailbox-repository";
import * as Resources from "./resources";

const resolveError = (
  resource: Resources.ResolvableMailResourceRef,
  reason: "not-found" | "storage",
  cause?: unknown
) =>
  new Resources.MailResourceResolveError({
    cause,
    message:
      reason === "not-found"
        ? "Mail resource was not found"
        : "Mail resource storage is not available",
    reason,
    resource,
  });

const decode = <A>(
  schema: Schema.Decoder<A>,
  value: unknown,
  resource: Resources.ResolvableMailResourceRef
) =>
  Effect.try({
    try: () => Schema.decodeUnknownSync(schema)(value),
    catch: (cause) => resolveError(resource, "not-found", cause),
  });

/** Adapts trusted MailboxDO ancestry reads to authorization resource resolution. */
export const MailResourceResolverLive = Layer.effect(
  Resources.MailResourceResolver,
  Effect.gen(function* () {
    const repository = yield* MailboxRepository;
    const fromRepository = <A>(
      resource: Resources.ResolvableMailResourceRef,
      effect: Effect.Effect<Option.Option<A>, MailboxRepositoryError>
    ) =>
      effect.pipe(
        Effect.mapError((cause) => resolveError(resource, "storage", cause)),
        Effect.flatMap((result) =>
          Option.isNone(result)
            ? Effect.fail(resolveError(resource, "not-found"))
            : Effect.succeed(result.value)
        )
      );
    const mailboxId = (resource: Resources.ResolvableMailResourceRef) =>
      decode(MailboxId, resource.route.mailboxId, resource);

    return Resources.MailResourceResolver.of({
      resolveAttachment: (resource) =>
        Effect.all({
          mailboxId: mailboxId(resource),
          attachmentId: decode(AttachmentId, resource.attachmentId, resource),
        }).pipe(
          Effect.flatMap((input) =>
            fromRepository(resource, repository.findAttachmentLocation(input))
          ),
          Effect.map((location) => ({
            attachmentId: location.attachmentId,
            folderId: location.folderId,
            mailboxId: location.mailboxId,
            messageId: location.messageId,
          }))
        ),
      resolveDraft: (resource) =>
        Effect.all({
          mailboxId: mailboxId(resource),
          draftId: decode(DraftId, resource.draftId, resource),
        }).pipe(
          Effect.flatMap((input) =>
            fromRepository(resource, repository.findDraftLocation(input))
          ),
          Effect.map((location) => ({
            draftId: location.draftId,
            mailboxId: location.mailboxId,
          }))
        ),
      resolveFolder: (resource) =>
        Effect.all({
          mailboxId: mailboxId(resource),
          folderId: decode(FolderId, resource.folderId, resource),
        }).pipe(
          Effect.flatMap((input) =>
            fromRepository(resource, repository.findFolderLocation(input))
          ),
          Effect.map((location) => ({
            folderId: location.folderId,
            mailboxId: location.mailboxId,
          }))
        ),
      resolveMessage: (resource) =>
        Effect.all({
          mailboxId: mailboxId(resource),
          messageId: decode(MessageId, resource.messageId, resource),
        }).pipe(
          Effect.flatMap((input) =>
            fromRepository(resource, repository.findMessageLocation(input))
          ),
          Effect.map((location) => ({
            folderId: location.folderId,
            mailboxId: location.mailboxId,
            messageId: location.messageId,
          }))
        ),
      resolveRule: (resource) =>
        Effect.all({
          mailboxId: mailboxId(resource),
          ruleId: decode(RuleId, resource.ruleId, resource),
        }).pipe(
          Effect.flatMap((input) =>
            fromRepository(resource, repository.findRuleLocation(input))
          ),
          Effect.map((location) => ({
            mailboxId: location.mailboxId,
            ruleId: location.ruleId,
          }))
        ),
    });
  })
);
