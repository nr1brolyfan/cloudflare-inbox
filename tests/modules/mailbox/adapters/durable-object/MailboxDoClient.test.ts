import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  MailboxDoClient,
  MailboxDoClientLayer,
  MailboxDoNamespace,
} from "#/modules/mailbox/adapters/durable-object/MailboxDoClient";
import { DirectoryRpcRequest } from "#/modules/mailbox/adapters/durable-object/MailboxDoProtocol";
import { MailboxRegistry } from "#/modules/organization/ports/MailboxRegistry";

const request = Schema.decodeUnknownSync(DirectoryRpcRequest)({
  _tag: "ListFolders",
  input: { mailboxId: "mailbox-a" },
});

const run = (
  mailboxExists: boolean,
  executeDirectory: () => Effect.Effect<unknown>,
  onAddress?: () => void
) =>
  MailboxDoClient.pipe(
    Effect.flatMap((client) => client.executeDirectory(request)),
    Effect.provide(
      MailboxDoClientLayer.pipe(
        Layer.provide(
          Layer.merge(
            Layer.succeed(
              MailboxRegistry,
              MailboxRegistry.of({
                exists: () => Effect.succeed(mailboxExists),
              })
            ),
            Layer.succeed(
              MailboxDoNamespace,
              MailboxDoNamespace.of({
                getByName: () => {
                  onAddress?.();
                  return {
                    executeDirectory,
                    executeMailData: () => Effect.die("Unexpected mail RPC"),
                    resolveMailResource: () =>
                      Effect.die("Unexpected resource RPC"),
                  };
                },
              })
            )
          )
        )
      )
    )
  );

describe("Mailbox DO client transport", () => {
  it("checks the registry before addressing a Durable Object", async () => {
    let addressed = false;
    const error = await Effect.runPromise(
      run(
        false,
        () => Effect.die("RPC must not run"),
        () => {
          addressed = true;
        }
      ).pipe(Effect.flip)
    );

    expect(error).toMatchObject({
      _tag: "MailboxDomainError",
      operation: "list-folders",
      reason: "not-found",
    });
    expect(addressed).toBeFalsy();
  });

  it("rejects a domain response for another operation", async () => {
    const error = await Effect.runPromise(
      run(true, () =>
        Effect.succeed({
          _tag: "DomainError",
          message: "Wrong operation",
          operation: "create-folder",
          reason: "validation",
        })
      ).pipe(Effect.flip)
    );

    expect(error).toMatchObject({
      _tag: "MailboxRepositoryError",
      commitState: "not-committed",
      operation: "read",
    });
  });

  it("preserves interruption from the RPC call", async () => {
    const exit = await Effect.runPromiseExit(run(true, () => Effect.interrupt));

    expect(Exit.isFailure(exit)).toBeTruthy();
    expect(
      Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)
    ).toBeTruthy();
  });
});
