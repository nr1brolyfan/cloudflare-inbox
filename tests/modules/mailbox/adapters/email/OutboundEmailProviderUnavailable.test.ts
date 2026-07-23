import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { OutboundEmailProviderUnavailableLayer } from "#/modules/mailbox/adapters/email/OutboundEmailProviderUnavailable";
import {
  OutboundEmailMessage,
  OutboundEmailProvider,
} from "#/modules/mailbox/ports/OutboundEmailProvider";

const address = (value: string) => ({ address: value });

describe("unavailable outbound email provider", () => {
  it("fails explicitly when the provider is unavailable", async () => {
    const message = Schema.decodeUnknownSync(OutboundEmailMessage)({
      attachments: [],
      bcc: [],
      cc: [],
      sender: address("sender@example.com"),
      subject: "Hello",
      text: "Hello",
      to: [address("recipient@example.com")],
    });
    const error = await Effect.runPromise(
      OutboundEmailProvider.pipe(
        Effect.flatMap((provider) => provider.send(message)),
        Effect.provide(OutboundEmailProviderUnavailableLayer),
        Effect.flip
      )
    );

    expect(error).toMatchObject({ _tag: "DeliveryProviderUnavailableError" });
  });
});
