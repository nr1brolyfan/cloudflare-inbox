import * as Cloudflare from "alchemy/Cloudflare";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "vitest";

import { MailboxIdentityDoLayer } from "#/modules/mailbox/adapters/durable-object/MailboxIdentityDo";
import { MailboxIdentity } from "#/modules/mailbox/ports/MailboxIdentity";

const identityLayer = (name: string | undefined) =>
  MailboxIdentityDoLayer.pipe(
    Layer.provide(
      Layer.succeed(
        Cloudflare.DurableObjectState,
        Cloudflare.DurableObjectState.of({ id: { name } } as never)
      )
    )
  );

const readMailboxId = (name: string | undefined) =>
  MailboxIdentity.pipe(
    Effect.map(({ mailboxId }) => mailboxId),
    Effect.provide(identityLayer(name))
  );

describe("MailboxDO canonical identity", () => {
  it("derives the mailbox ID from the Durable Object name", async () => {
    await expect(Effect.runPromise(readMailboxId("mailbox-a"))).resolves.toBe(
      "mailbox-a"
    );
  });

  it.each([
    ["an unnamed Durable Object", undefined],
    ["a schema-invalid Durable Object name", " "],
  ] as const)("rejects %s", async (_, name) => {
    const exit = await Effect.runPromiseExit(readMailboxId(name));
    const defect = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

    expect(Exit.isFailure(exit)).toBeTruthy();
    expect(defect).toBeInstanceOf(Error);
  });
});
