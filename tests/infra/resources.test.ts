import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { MailboxEmailSender } from "#/infra/resources";

describe("infrastructure resources", () => {
  it("declares an unrestricted mailbox email binding", async () => {
    const descriptor = await Effect.runPromise(MailboxEmailSender);

    expect(descriptor).toStrictEqual({
      allowedDestinationAddresses: undefined,
      allowedSenderAddresses: undefined,
      destinationAddress: undefined,
      kind: "Cloudflare.Email.SendEmail",
      name: "MailboxEmail",
    });
  });
});
