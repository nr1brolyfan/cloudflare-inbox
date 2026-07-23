import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  MailboxDoHandler,
  MailboxDoHandlerLayer,
} from "#/modules/mailbox/adapters/durable-object/MailboxDoHandler";
import { MailboxId } from "#/modules/mailbox/domain/Mailbox";
import { MailboxDoStore } from "#/modules/mailbox/ports/MailboxDoStore";
import { MailboxIdentity } from "#/modules/mailbox/ports/MailboxIdentity";

describe("MailboxDO protocol identity", () => {
  it.each([
    [
      "executeDirectory",
      { _tag: "ListFolders", input: { mailboxId: "mailbox-b" } },
    ],
    [
      "executeMailData",
      { _tag: "ListMessages", input: { mailboxId: "mailbox-b" } },
    ],
    [
      "resolveMailResource",
      { _tag: "Folder", folderId: "folder-a", mailboxId: "mailbox-b" },
    ],
  ] as const)(
    "rejects forged mailbox identity for %s",
    async (method, input) => {
      const calls = {
        executeDirectory: 0,
        executeMailData: 0,
        resolveMailResource: 0,
      };
      const canonicalMailboxId =
        Schema.decodeUnknownSync(MailboxId)("mailbox-a");
      const exit = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const handler = yield* MailboxDoHandler;
          return yield* handler[method](input);
        }).pipe(
          Effect.provide(
            MailboxDoHandlerLayer.pipe(
              Layer.provide(
                Layer.merge(
                  Layer.succeed(
                    MailboxIdentity,
                    MailboxIdentity.of({ mailboxId: canonicalMailboxId })
                  ),
                  Layer.succeed(
                    MailboxDoStore,
                    MailboxDoStore.of({
                      executeDirectory: () =>
                        Effect.sync(() => {
                          calls.executeDirectory += 1;
                        }),
                      executeMailData: () =>
                        Effect.sync(() => {
                          calls.executeMailData += 1;
                        }),
                      resolveMailResource: () =>
                        Effect.sync(() => {
                          calls.resolveMailResource += 1;
                          return { _tag: "NotFound" } as const;
                        }),
                    })
                  )
                )
              )
            )
          )
        )
      );
      const defect = Exit.isFailure(exit)
        ? Cause.squash(exit.cause)
        : undefined;

      expect(Exit.isFailure(exit)).toBeTruthy();
      expect(String(defect)).toContain(
        "MailboxDO request mailboxId does not match its identity"
      );
      expect(calls).toStrictEqual({
        executeDirectory: 0,
        executeMailData: 0,
        resolveMailResource: 0,
      });
    }
  );
});
