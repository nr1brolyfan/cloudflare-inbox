import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { TrustedMailResourceResolverDurableObjectLayer } from "#/modules/authorization/adapters/durable-object/TrustedMailResourceResolverDurableObject";
import { TrustedMailResourceResolver } from "#/modules/authorization/ports/TrustedMailResourceResolver";
import { MailboxDoClient } from "#/modules/mailbox/adapters/durable-object/MailboxDoClient";
import type { MailboxDoClientService } from "#/modules/mailbox/adapters/durable-object/MailboxDoClient";
import {
  MessageLocation,
  MessageLookup,
} from "#/modules/mailbox/domain/MailboxResource";
import { MailboxRepositoryError } from "#/modules/mailbox/ports/MailboxRepositoryError";

const unused = () => Effect.die(new Error("RPC is unused"));
const resolverWith = (
  resolveMailResource: MailboxDoClientService["resolveMailResource"]
) =>
  Effect.gen(function* () {
    const resolver = yield* TrustedMailResourceResolver;
    return yield* resolver.resolveMessage(
      Schema.decodeUnknownSync(MessageLookup)({
        _tag: "Message",
        mailboxId: "mailbox-a",
        messageId: "message-1",
      })
    );
  }).pipe(
    Effect.provide(
      TrustedMailResourceResolverDurableObjectLayer.pipe(
        Layer.provide(
          Layer.succeed(
            MailboxDoClient,
            MailboxDoClient.of({
              executeDirectory: unused,
              executeMailData: unused,
              resolveMailResource,
            })
          )
        )
      )
    )
  );

describe("MailboxDO mail resource resolver", () => {
  it("returns ancestry supplied by the trusted repository", async () => {
    const location = Schema.decodeUnknownSync(MessageLocation)({
      _tag: "Message",
      mailboxId: "mailbox-a",
      folderId: "archive",
      messageId: "message-1",
    });

    await expect(
      Effect.runPromise(resolverWith(() => Effect.succeed(location)))
    ).resolves.toStrictEqual({
      _tag: "Message",
      mailboxId: "mailbox-a",
      folderId: "archive",
      messageId: "message-1",
    });
  });

  it("distinguishes missing resources from repository failures", async () => {
    const missing = await Effect.runPromise(
      resolverWith(() => Effect.succeed({ _tag: "NotFound" })).pipe(Effect.flip)
    );
    const storage = await Effect.runPromise(
      resolverWith(() =>
        Effect.fail(
          new MailboxRepositoryError({
            cause: new Error("database unavailable"),
            commitState: "not-committed",
            message: "Lookup failed",
            operation: "read",
          })
        )
      ).pipe(Effect.flip)
    );

    expect(missing.reason).toBe("not-found");
    expect(storage.reason).toBe("storage");
    expect(storage.message).not.toContain("database unavailable");
  });
});
