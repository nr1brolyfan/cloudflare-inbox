import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { TrustedMailResourceResolver } from "#/modules/authorization/ports/TrustedMailResourceResolver";
import { MailboxDoClient } from "#/modules/mailbox/adapters/durable-object/MailboxDoClient";
import type { MailboxResourceLookupResult } from "#/modules/mailbox/domain/MailboxResource";
import { MailResourceResolveError } from "#/modules/mailbox/ports/MailboxAuthorization";
import type { ResolvableMailResourceRef } from "#/modules/mailbox/ports/MailboxAuthorization";

const resolveError = (
  resource: ResolvableMailResourceRef,
  reason: "not-found" | "storage",
  cause?: unknown
) =>
  new MailResourceResolveError({
    cause,
    message:
      reason === "not-found"
        ? "Mail resource was not found"
        : "Mail resource storage is not available",
    reason,
    resource,
  });

/** Adapts trusted MailboxDO ancestry reads to authorization resource resolution. */
export const TrustedMailResourceResolverDurableObjectLayer = Layer.effect(
  TrustedMailResourceResolver,
  Effect.gen(function* () {
    const client = yield* MailboxDoClient;
    const resolve = <
      A extends Exclude<MailboxResourceLookupResult, { _tag: "NotFound" }>,
    >(
      resource: ResolvableMailResourceRef,
      expectedTag: A["_tag"]
    ): Effect.Effect<A, MailResourceResolveError> =>
      client.resolveMailResource(resource).pipe(
        Effect.mapError((cause) => resolveError(resource, "storage", cause)),
        Effect.flatMap((result) =>
          result._tag === "NotFound"
            ? Effect.fail(resolveError(resource, "not-found"))
            : result._tag === expectedTag
              ? Effect.succeed(result as A)
              : Effect.fail(resolveError(resource, "storage", result))
        )
      );
    return TrustedMailResourceResolver.of({
      resolveAttachment: (resource) => resolve(resource, "Attachment"),
      resolveDraft: (resource) => resolve(resource, "Draft"),
      resolveFolder: (resource) => resolve(resource, "Folder"),
      resolveMessage: (resource) => resolve(resource, "Message"),
      resolveRule: (resource) => resolve(resource, "Rule"),
    });
  })
);
