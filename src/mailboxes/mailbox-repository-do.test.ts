import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { FolderId, MailboxId } from "./identifiers";
import { MailboxRepository } from "./mailbox-repository";
import {
  MailboxRepositoryDoConfig,
  MailboxRepositoryDoLive,
} from "./mailbox-repository-do";

const findFolder = (
  mailboxExists: boolean,
  resolveMailResource: (input: unknown) => Effect.Effect<unknown>
) => {
  const addressedNames: string[] = [];
  const live = MailboxRepositoryDoLive.pipe(
    Layer.provide(
      Layer.succeed(
        MailboxRepositoryDoConfig,
        MailboxRepositoryDoConfig.of({
          mailboxExists: () => Effect.succeed(mailboxExists),
          namespace: {
            getByName: (name) => {
              addressedNames.push(name);
              return { resolveMailResource };
            },
          },
        })
      )
    )
  );
  const effect = Effect.gen(function* () {
    const repository = yield* MailboxRepository;
    return yield* repository.findFolderLocation({
      mailboxId: Schema.decodeUnknownSync(MailboxId)("mailbox-a"),
      folderId: Schema.decodeUnknownSync(FolderId)("folder-a"),
    });
  }).pipe(Effect.provide(live));

  return { addressedNames, effect };
};

describe("MailboxDO repository RPC adapter", () => {
  it("does not materialize a Durable Object for a missing mailbox", async () => {
    const fixture = findFolder(false, () =>
      Effect.die(new Error("RPC should not be called"))
    );

    const result = await Effect.runPromise(fixture.effect);

    expect(Option.isNone(result)).toBeTruthy();
    expect(fixture.addressedNames).toStrictEqual([]);
  });

  it("validates a found response from the selected mailbox", async () => {
    const fixture = findFolder(true, () =>
      Effect.succeed({
        _tag: "Folder",
        mailboxId: "mailbox-a",
        folderId: "folder-a",
      })
    );

    const result = await Effect.runPromise(fixture.effect);

    expect(Option.getOrThrow(result)).toStrictEqual({
      _tag: "Folder",
      mailboxId: "mailbox-a",
      folderId: "folder-a",
    });
    expect(fixture.addressedNames).toStrictEqual(["mailbox-a"]);
  });

  it("preserves RPC interruption", async () => {
    const fixture = findFolder(true, () => Effect.interrupt);
    const exit = await Effect.runPromiseExit(fixture.effect);

    expect(Exit.isFailure(exit)).toBeTruthy();
    expect(
      Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)
    ).toBeTruthy();
  });
});
