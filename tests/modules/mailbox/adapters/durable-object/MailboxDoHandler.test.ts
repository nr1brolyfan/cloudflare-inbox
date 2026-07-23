import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { validateMailboxDoRequestIdentity } from "#/modules/mailbox/adapters/durable-object/MailboxDoHandler";
import { MailboxId } from "#/modules/mailbox/domain/Mailbox";

describe("MailboxDO protocol identity", () => {
  it("rejects a request for a mailbox other than the addressed DO", async () => {
    const canonical = Schema.decodeUnknownSync(MailboxId)("mailbox-a");
    const requested = Schema.decodeUnknownSync(MailboxId)("mailbox-b");
    const exit = await Effect.runPromiseExit(
      validateMailboxDoRequestIdentity(canonical, requested)
    );

    expect(Exit.isFailure(exit)).toBeTruthy();
    expect(Exit.isFailure(exit) && Cause.pretty(exit.cause)).toContain(
      "MailboxDO request mailboxId does not match its identity"
    );
  });
});
