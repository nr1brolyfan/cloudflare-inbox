import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MailboxChangePublisherDoLayer } from "#/modules/mailbox/adapters/durable-object/MailboxChangePublisherDo";
import { MailboxChangePublisher } from "#/modules/mailbox/ports/MailboxChangePublisher";

const socket = (leaseExpiresAt: number) => ({
  close: vi.fn<(code: number, reason: string) => void>(),
  deserializeAttachment: vi.fn<() => unknown>(() => ({
    formatVersion: 1,
    leaseExpiresAt,
  })),
  send: vi.fn<(data: string) => void>(),
});

describe("MailboxChangePublisherDo", () => {
  beforeEach(() => vi.setSystemTime(1000));

  it("broadcasts content-free events and closes expired leases", async () => {
    const active = socket(2000);
    const expired = socket(1000);
    const state = {
      raw: { getWebSockets: () => [active, expired] },
    } as unknown as Cloudflare.DurableObjectState["Service"];

    await Effect.runPromise(
      MailboxChangePublisher.pipe(
        Effect.flatMap((publisher) =>
          publisher.publish(["messages", "navigation"])
        ),
        Effect.provide(
          MailboxChangePublisherDoLayer.pipe(
            Layer.provide(Layer.succeed(Cloudflare.DurableObjectState, state))
          )
        )
      )
    );

    expect(JSON.parse(String(active.send.mock.calls[0]?.[0]))).toStrictEqual({
      _tag: "MailboxChanged",
      formatVersion: 1,
      scopes: ["messages", "navigation"],
    });
    expect(expired.close).toHaveBeenCalledWith(1000, "Socket lease expired");
    expect(expired.send).not.toHaveBeenCalled();
  });
});
