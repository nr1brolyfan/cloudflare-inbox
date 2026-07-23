import type * as CloudflareWorkers from "@cloudflare/workers-types";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  MailboxEmailSendClient,
  OutboundEmailProviderCloudflareLayer,
} from "#/modules/mailbox/adapters/email/OutboundEmailProviderCloudflare";
import type { MailboxEmailSendClientService } from "#/modules/mailbox/adapters/email/OutboundEmailProviderCloudflare";
import {
  DeliveryProviderUnavailableError,
  OutboundEmailMessage,
  OutboundEmailProvider,
} from "#/modules/mailbox/ports/OutboundEmailProvider";
import type { OutboundEmailProviderService } from "#/modules/mailbox/ports/OutboundEmailProvider";

const baseMessage = Schema.decodeUnknownSync(OutboundEmailMessage)({
  attachments: [],
  bcc: [],
  cc: [],
  sender: { address: "sender@example.com" },
  subject: "Hello",
  text: "Hello",
  to: [{ address: "recipient@example.com" }],
});

const runProvider = <A>(
  client: MailboxEmailSendClientService,
  use: (provider: OutboundEmailProviderService) => Effect.Effect<A, unknown>
) =>
  Effect.runPromise(
    OutboundEmailProvider.pipe(
      Effect.flatMap(use),
      Effect.provide(
        OutboundEmailProviderCloudflareLayer.pipe(
          Layer.provide(
            Layer.succeed(
              MailboxEmailSendClient,
              MailboxEmailSendClient.of(client)
            )
          )
        )
      )
    )
  );

const failingClient = (code: unknown): MailboxEmailSendClientService =>
  MailboxEmailSendClient.of({
    send: () =>
      Effect.fail(
        new Cloudflare.Email.SendEmailError({
          cause: { code },
          message: "Cloudflare rejected the message",
        })
      ),
  });

describe("Cloudflare outbound email provider", () => {
  it("projects the neutral message into the structured Workers builder", async () => {
    let builder: CloudflareWorkers.EmailMessageBuilder | undefined;
    const message = Schema.decodeUnknownSync(OutboundEmailMessage)({
      attachments: [
        {
          content: new Uint8Array([1, 2]),
          contentId: "logo-1",
          disposition: "inline",
          fileName: "logo.png",
          mimeType: "image/png",
        },
        {
          content: new Uint8Array([3]),
          disposition: "attachment",
          fileName: "notes.txt",
          mimeType: "text/plain",
        },
      ],
      bcc: [{ address: "audit@example.com" }],
      cc: [],
      html: '<img src="cid:logo-1">',
      sender: { address: "sender@example.com", displayName: "Mailbox" },
      subject: "Hello",
      text: "Hello",
      to: [{ address: "recipient@example.com", displayName: "Recipient" }],
    });
    const acceptance = await runProvider(
      MailboxEmailSendClient.of({
        send: (input) => {
          builder = input;
          return Effect.succeed({ messageId: "provider-message-1" });
        },
      }),
      (provider) => provider.send(message)
    );

    expect(acceptance).toStrictEqual({
      providerMessageId: "provider-message-1",
    });
    expect(builder).toStrictEqual({
      attachments: [
        {
          content: new Uint8Array([1, 2]),
          contentId: "logo-1",
          disposition: "inline",
          filename: "logo.png",
          type: "image/png",
        },
        {
          content: new Uint8Array([3]),
          disposition: "attachment",
          filename: "notes.txt",
          type: "text/plain",
        },
      ],
      bcc: ["audit@example.com"],
      from: { email: "sender@example.com", name: "Mailbox" },
      html: '<img src="cid:logo-1">',
      subject: "Hello",
      text: "Hello",
      to: [{ email: "recipient@example.com", name: "Recipient" }],
    });
  });

  it("supports a message whose only recipients are CC", async () => {
    let builder: CloudflareWorkers.EmailMessageBuilder | undefined;
    const message = Schema.decodeUnknownSync(OutboundEmailMessage)({
      ...baseMessage,
      cc: [{ address: "copy@example.com" }],
      to: [],
    });

    await runProvider(
      MailboxEmailSendClient.of({
        send: (input) => {
          builder = input;
          return Effect.succeed({ messageId: "provider-message-1" });
        },
      }),
      (provider) => provider.send(message)
    );

    expect(builder).toMatchObject({ cc: ["copy@example.com"] });
    expect(builder).not.toHaveProperty("to");
  });

  it.each([
    ["E_VALIDATION_ERROR", "invalid-message"],
    ["E_FIELD_MISSING", "invalid-message"],
    ["E_TOO_MANY_RECIPIENTS", "invalid-message"],
    ["E_TOO_MANY_ATTACHMENTS", "invalid-message"],
    ["E_HEADER_NOT_ALLOWED", "invalid-message"],
    ["E_HEADER_USE_API_FIELD", "invalid-message"],
    ["E_HEADER_VALUE_INVALID", "invalid-message"],
    ["E_HEADER_VALUE_TOO_LONG", "invalid-message"],
    ["E_HEADER_NAME_INVALID", "invalid-message"],
    ["E_HEADERS_TOO_LARGE", "invalid-message"],
    ["E_HEADERS_TOO_MANY", "invalid-message"],
    ["E_CONTENT_TOO_LARGE", "message-too-large"],
    ["E_SENDER_NOT_VERIFIED", "invalid-sender"],
    ["E_SENDER_DOMAIN_NOT_AVAILABLE", "invalid-sender"],
    ["E_RECIPIENT_SUPPRESSED", "recipient-suppressed"],
    ["E_RECIPIENT_NOT_ALLOWED", "provider-rejected"],
    ["E_DELIVERY_FAILED", "provider-rejected"],
  ])("maps permanent error %s to rejection reason %s", async (code, reason) => {
    const error = await runProvider(failingClient(code), (provider) =>
      provider.send(baseMessage).pipe(Effect.flip)
    );

    expect(error).toMatchObject({
      _tag: "DeliveryRejectedError",
      reason,
    });
  });

  it.each(["E_RATE_LIMIT_EXCEEDED", "E_DAILY_LIMIT_EXCEEDED"])(
    "maps limit error %s to a temporary failure",
    async (code) => {
      const error = await runProvider(failingClient(code), (provider) =>
        provider.send(baseMessage).pipe(Effect.flip)
      );

      expect(error).toMatchObject({ _tag: "DeliveryTemporaryFailureError" });
    }
  );

  it.each([
    ["internal", "E_INTERNAL_SERVER_ERROR"],
    ["unknown", "E_NEW_ERROR"],
    ["malformed code", 42],
  ])("maps %s failures to an indeterminate outcome", async (_, code) => {
    const error = await runProvider(failingClient(code), (provider) =>
      provider.send(baseMessage).pipe(Effect.flip)
    );

    expect(error).toMatchObject({ _tag: "DeliveryIndeterminateError" });
  });

  it("maps an absent error code and malformed acceptance to indeterminate", async () => {
    const transportError = await runProvider(
      MailboxEmailSendClient.of({
        send: () =>
          Effect.fail(
            new Cloudflare.Email.SendEmailError({
              cause: new Error("Connection closed"),
              message: "Connection closed",
            })
          ),
      }),
      (provider) => provider.send(baseMessage).pipe(Effect.flip)
    );
    const malformedAcceptance = await runProvider(
      MailboxEmailSendClient.of({
        send: () => Effect.succeed({ messageId: "" }),
      }),
      (provider) => provider.send(baseMessage).pipe(Effect.flip)
    );

    expect(transportError).toMatchObject({
      _tag: "DeliveryIndeterminateError",
    });
    expect(malformedAcceptance).toMatchObject({
      _tag: "DeliveryIndeterminateError",
    });
  });

  it("preserves an explicitly unavailable provider as definite non-acceptance", async () => {
    const unavailable = new DeliveryProviderUnavailableError({
      cause: new Error("No binding"),
      message: "Provider unavailable",
    });
    const error = await runProvider(
      MailboxEmailSendClient.of({ send: () => Effect.fail(unavailable) }),
      (provider) => provider.send(baseMessage).pipe(Effect.flip)
    );

    expect(error).toBe(unavailable);
  });
});
