import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { MailboxRepositoryError } from "../mailboxes/errors";
import { MailboxRepository, MessageLocation } from "../mailboxes/repository";
import { MailResourceResolverLive } from "./mail-resource-resolver-live";
import { MailResourceResolver } from "./resources";

const unused = () => Effect.succeed(Option.none());
const unusedDirectory = () => Effect.die(new Error("Directory RPC is unused"));

const resolverWith = (
  findMessageLocation: MailboxRepository["findMessageLocation"]
) =>
  Effect.gen(function* () {
    const resolver = yield* MailResourceResolver;
    return yield* resolver.resolveMessage({
      _tag: "Message",
      messageId: "message-1",
      route: { mailboxId: "mailbox-a" },
    });
  }).pipe(
    Effect.provide(
      MailResourceResolverLive.pipe(
        Layer.provide(
          Layer.succeed(
            MailboxRepository,
            MailboxRepository.of({
              addMessageLabel: unusedDirectory,
              cancelOutboundDelivery: unusedDirectory,
              createDraft: unusedDirectory,
              createFolder: unusedDirectory,
              createLabel: unusedDirectory,
              deleteFolder: unusedDirectory,
              deleteLabel: unusedDirectory,
              findAttachmentLocation: unused,
              findDraftLocation: unused,
              findFolderLocation: unused,
              findMessageLocation,
              findRuleLocation: unused,
              getDraft: unusedDirectory,
              getMessage: unusedDirectory,
              getOutboundDelivery: unusedDirectory,
              getThread: unusedDirectory,
              listFolders: unusedDirectory,
              listLabels: unusedDirectory,
              listMessages: unusedDirectory,
              moveMessage: unusedDirectory,
              removeMessageLabel: unusedDirectory,
              renameFolder: unusedDirectory,
              renameLabel: unusedDirectory,
              resendOutbound: unusedDirectory,
              scheduleOutbound: unusedDirectory,
              setMessageRead: unusedDirectory,
              setMessageStarred: unusedDirectory,
              updateDraft: unusedDirectory,
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
      Effect.runPromise(
        resolverWith(() => Effect.succeed(Option.some(location)))
      )
    ).resolves.toStrictEqual({
      mailboxId: "mailbox-a",
      folderId: "archive",
      messageId: "message-1",
    });
  });

  it("distinguishes missing resources from repository failures", async () => {
    const missing = await Effect.runPromise(
      resolverWith(() => Effect.succeed(Option.none())).pipe(Effect.flip)
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
