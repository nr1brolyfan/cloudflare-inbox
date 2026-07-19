import type * as CloudflareWorkers from "@cloudflare/workers-types";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "vitest";

import { InboundEmailRejected } from "#/mailboxes/inbound";
import type { InboundEmailRoutingMessage } from "#/mailboxes/inbound-email-routing";
import {
  handleCloudflareEmailRoutingMessage,
  InboundEmailIngress,
  InboundEmailIngressUnavailableLive,
} from "#/mailboxes/inbound-email-routing";

type ForwardableEmailMessage = CloudflareWorkers.ForwardableEmailMessage;

const rawStream = () =>
  new ReadableStream<Uint8Array>({
    start: (controller) => {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  }) as unknown as ForwardableEmailMessage["raw"];

const headers = (): ForwardableEmailMessage["headers"] => {
  const source = new Headers({ to: "header-recipient@example.com" });

  return Object.assign(source, {
    getAll: (name: string) => {
      const value = source.get(name);

      return value === null ? [] : [value];
    },
  }) as unknown as ForwardableEmailMessage["headers"];
};

const makeMessage = (
  overrides: Partial<ForwardableEmailMessage> = {}
): {
  readonly message: ForwardableEmailMessage;
  readonly rejected: string[];
} => {
  const rejected: string[] = [];
  const message: ForwardableEmailMessage = {
    forward: () => Promise.resolve({ messageId: "forwarded" }),
    from: "sender@example.com",
    headers: headers(),
    raw: rawStream(),
    rawSize: 3,
    reply: () => Promise.resolve({ messageId: "reply" }),
    setReject: (reason) => {
      rejected.push(reason);
    },
    to: "owner@example.com",
    ...overrides,
  };

  return { message, rejected };
};

const runWithIngress = (
  message: ForwardableEmailMessage,
  receive: (
    message: InboundEmailRoutingMessage
  ) => Effect.Effect<void, InboundEmailRejected>
) =>
  Effect.runPromise(
    handleCloudflareEmailRoutingMessage(message).pipe(
      Effect.provide(
        Layer.succeed(InboundEmailIngress, InboundEmailIngress.of({ receive }))
      )
    )
  );

describe("Cloudflare Email Routing inbound adapter", () => {
  it("passes the SMTP envelope recipient instead of the To header", async () => {
    const { message, rejected } = makeMessage();
    let delivered: InboundEmailRoutingMessage | undefined;

    await runWithIngress(message, (input) =>
      Effect.sync(() => {
        delivered = input;
      })
    );

    expect(rejected).toStrictEqual([]);
    expect(delivered?.envelope).toStrictEqual({
      envelopeFrom: "sender@example.com",
      envelopeTo: "owner@example.com",
      rawSize: 3,
    });
    expect(delivered?.headers.get("to")).toBe("header-recipient@example.com");
    expect(delivered?.raw).toBe(message.raw);
  });

  it("rejects malformed envelope recipients before ingress", async () => {
    const { message, rejected } = makeMessage({ to: "bad recipient" });
    let received = 0;

    await runWithIngress(message, () =>
      Effect.sync(() => {
        received += 1;
      })
    );

    expect(received).toBe(0);
    expect(rejected).toStrictEqual(["Invalid envelope recipient"]);
  });

  it("accepts null reverse-path senders", async () => {
    const { message, rejected } = makeMessage({ from: "" });
    let delivered: InboundEmailRoutingMessage | undefined;

    await runWithIngress(message, (input) =>
      Effect.sync(() => {
        delivered = input;
      })
    );

    expect(rejected).toStrictEqual([]);
    expect(delivered?.envelope).toStrictEqual({
      envelopeFrom: undefined,
      envelopeTo: "owner@example.com",
      rawSize: 3,
    });
  });

  it("maps ingress rejections to SMTP rejects", async () => {
    const { message, rejected } = makeMessage();

    await runWithIngress(message, () =>
      Effect.fail(
        new InboundEmailRejected({
          message: "Mailbox recipient is not configured",
          reason: "unknown-recipient",
        })
      )
    );

    expect(rejected).toStrictEqual(["Mailbox recipient is not configured"]);
  });

  it("uses a safe unavailable live layer until durable ingress exists", async () => {
    const { message, rejected } = makeMessage();

    await Effect.runPromise(
      handleCloudflareEmailRoutingMessage(message).pipe(
        Effect.provide(InboundEmailIngressUnavailableLive)
      )
    );

    expect(rejected).toStrictEqual([
      "Inbound email processing is not available",
    ]);
  });
});
