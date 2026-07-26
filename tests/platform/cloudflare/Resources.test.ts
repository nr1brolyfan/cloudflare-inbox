import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import {
  AuthEmailSender,
  InboxAiGateway,
  InboxAiGatewaySettings,
  MailboxEmailSender,
} from "#/platform/cloudflare/Resources";

describe("Cloudflare resources", () => {
  it("restricts each email binding to its exact sender", async () => {
    const [auth, mailbox] = await Effect.runPromise(
      Effect.all([AuthEmailSender, MailboxEmailSender])
    );

    expect(auth).toStrictEqual({
      allowedDestinationAddresses: undefined,
      allowedSenderAddresses: ["auth@szymondlugolecki.com"],
      destinationAddress: undefined,
      kind: "Cloudflare.Email.SendEmail",
      name: "AuthEmail",
    });
    expect(mailbox).toStrictEqual({
      allowedDestinationAddresses: undefined,
      allowedSenderAddresses: ["szymon@szymondlugolecki.com"],
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
