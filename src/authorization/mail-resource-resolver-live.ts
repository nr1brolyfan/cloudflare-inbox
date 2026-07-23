import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import type { MailboxRepositoryError } from "#/modules/mailbox/ports/MailboxRepositoryError";

import { MailboxRepository } from "../mailboxes/repository";
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
    return Resources.MailResourceResolver.of({
      resolveAttachment: (resource) =>
        fromRepository(
          resource,
          repository.findAttachmentLocation({
            attachmentId: resource.attachmentId,
            mailboxId: resource.mailboxId,
          })
        ),
      resolveDraft: (resource) =>
        fromRepository(
          resource,
          repository.findDraftLocation({
            draftId: resource.draftId,
            mailboxId: resource.mailboxId,
          })
        ),
      resolveFolder: (resource) =>
        fromRepository(
          resource,
          repository.findFolderLocation({
            folderId: resource.folderId,
            mailboxId: resource.mailboxId,
          })
        ),
      resolveMessage: (resource) =>
        fromRepository(
          resource,
          repository.findMessageLocation({
            mailboxId: resource.mailboxId,
            messageId: resource.messageId,
          })
        ),
      resolveRule: (resource) =>
        fromRepository(
          resource,
          repository.findRuleLocation({
            mailboxId: resource.mailboxId,
            ruleId: resource.ruleId,
          })
        ),
    });
  })
);
