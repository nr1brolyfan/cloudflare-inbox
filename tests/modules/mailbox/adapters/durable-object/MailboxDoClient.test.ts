import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import { describe, expect, it } from "vitest";

import {
  MailboxDoClient,
  MailboxDoClientLayer,
  MailboxDoNamespace,
  mailboxDoSubscriptionRequest,
} from "#/modules/mailbox/adapters/durable-object/MailboxDoClient";
import { DirectoryRpcRequest } from "#/modules/mailbox/ports/MailboxDoProtocol";
import { MailboxRegistry } from "#/modules/mailbox/ports/MailboxRegistry";

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
  it("rebuilds a subscription request with the internal lease header", async () => {
    const original = HttpServerRequest.fromWeb(
      new Request("https://backend.test/api/mailboxes/mailbox-a/events", {
        headers: {
          cookie: "session=secret",
          host: "backend.test",
          origin: "https://inbox.test",
          upgrade: "websocket",
          "x-forwarded-proto": "https",
        },
      })
    );

    const forwarded = await Effect.runPromise(
      HttpServerRequest.toWeb(mailboxDoSubscriptionRequest(original, 123_456))
    );

    expect({
      cookie: forwarded.headers.get("cookie"),
      lease: forwarded.headers.get("x-mailbox-lease-expires-at"),
      origin: forwarded.headers.get("origin"),
      pathname: new URL(forwarded.url).pathname,
      upgrade: forwarded.headers.get("upgrade"),
    }).toStrictEqual({
      cookie: "session=secret",
      lease: "123456",
      origin: "https://inbox.test",
      pathname: "/events",
      upgrade: "websocket",
    });
  });

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
