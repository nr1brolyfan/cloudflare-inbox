import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "vitest";

import {
  MailboxDoBindings,
  MailboxDoBindingsLayer,
} from "#/apps/mailbox-do/MailboxDoBindings";

const bindingsLayer = (environment: Readonly<Record<string, unknown>>) =>
  MailboxDoBindingsLayer.pipe(
    Layer.provide(
      Layer.succeed(
        Cloudflare.WorkerEnvironment,
        Cloudflare.WorkerEnvironment.of(environment)
      )
    )
  );

describe("MailboxDO outbound binding adapter", () => {
  it("keeps the development provider unavailable without calling a binding", async () => {
    let sends = 0;
    const error = await Effect.runPromise(
      MailboxDoBindings.pipe(
        Effect.flatMap((bindings) => bindings.email.pipe(Effect.flip)),
        Effect.provide(
          bindingsLayer({
            MAILBOX_OUTBOUND_PROVIDER_DISABLED: "true",
            MailboxEmail: {
              send: () => {
                sends += 1;
                return Promise.resolve({ messageId: "must-not-send" });
              },
            },
            RawMessages: { get: () => Promise.resolve(null) },
          })
        )
      )
    );

    expect(error).toMatchObject({
      _tag: "DeliveryProviderUnavailableError",
    });
    expect(sends).toBe(0);
  });

  it("adapts explicitly present production R2 and email bindings", async () => {
    let sends = 0;
    const result = await Effect.runPromise(
      MailboxDoBindings.pipe(
        Effect.flatMap((bindings) =>
          Effect.all([bindings.rawMessages, bindings.email])
        ),
        Effect.provide(
          bindingsLayer({
            MAILBOX_OUTBOUND_PROVIDER_DISABLED: false,
            MailboxEmail: {
              send: () => {
                sends += 1;
                return Promise.resolve({ messageId: "provider-1" });
              },
            },
            RawMessages: { get: () => Promise.resolve(null) },
          })
        )
      )
    );
    const [, email] = result;

    await expect(
      email.send({
        from: "sender@example.com",
        subject: "Hi",
        to: "to@example.com",
      })
    ).resolves.toStrictEqual({
      messageId: "provider-1",
    });
    expect(sends).toBe(1);
  });
});
