import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "vitest";

import {
  MailboxDoBindings,
  MailboxDoBindingsLayer,
  mailboxDoBindingsFromClients,
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
  it("keeps supported client raw bindings lazy until runtime", async () => {
    let materializations = 0;
    const raw = (binding: object) =>
      Effect.sync(() => {
        materializations += 1;
        return binding;
      });
    const controlPlane = { prepare: () => null };
    const rawMessages = { get: () => Promise.resolve(null) };
    const email = { send: () => Promise.resolve() };
    const bindings = mailboxDoBindingsFromClients(
      { raw: raw(controlPlane) } as never,
      { raw: raw(rawMessages) } as never,
      { raw: raw(email) } as never
    );

    expect(materializations).toBe(0);
    await expect(
      Effect.runPromise(
        Effect.all([
          bindings.controlPlane,
          bindings.rawMessages,
          bindings.email,
        ])
      )
    ).resolves.toStrictEqual([controlPlane, rawMessages, email]);
    expect(materializations).toBe(3);
  });

  it("keeps email unavailable when the supported client is disabled", async () => {
    let emailMaterializations = 0;
    const discoveredEmail = {
      raw: Effect.sync(() => {
        emailMaterializations += 1;
        return { send: () => Promise.resolve() };
      }),
    } as never;
    const providerDisabled = true;
    const bindings = mailboxDoBindingsFromClients(
      { raw: Effect.succeed({}) } as never,
      { raw: Effect.succeed({}) } as never,
      providerDisabled ? undefined : discoveredEmail
    );

    const error = await Effect.runPromise(bindings.email.pipe(Effect.flip));

    expect(error).toMatchObject({
      _tag: "DeliveryProviderUnavailableError",
    });
    expect(emailMaterializations).toBe(0);
  });

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
