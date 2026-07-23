import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import {
  InboxAiGateway,
  InboxAiGatewaySettings,
  MailboxEmailSender,
} from "#/platform/cloudflare/Resources";

describe("Cloudflare resources", () => {
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

  it("declares a private zero-retention AI gateway with caching disabled", () => {
    expect(InboxAiGateway).toBeDefined();
    expect(InboxAiGatewaySettings).toStrictEqual({
      cacheInvalidateOnUpdate: false,
      cacheTtl: null,
      collectLogs: false,
      zdr: true,
    });
  });
});
