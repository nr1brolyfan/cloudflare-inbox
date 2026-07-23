/* oxlint-disable promise/avoid-new, vitest/max-expects -- A controllable pending Promise models the Worker sender while detachment, envelope, and rejection are verified together. */
import type { ExecutionContext } from "@cloudflare/workers-types";
import { DevEmailStoreMemoryLive } from "@effect-auth/core/DevEmail";
import {
  WorkerExecutionContext,
  fromExecutionContext,
} from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  AuthRuntimeConfig,
  AuthRuntimeConfigSchema,
} from "#/modules/account-security/adapters/cloudflare/AuthRuntimeConfigCloudflare";
import { AccountRecoveryDeliveryEmailLayer } from "#/modules/account-security/adapters/email/AccountRecoveryDeliveryEmail";
import { AccountRecoveryDelivery } from "#/modules/account-security/ports/AccountRecoveryDelivery";
import { EmailAddress } from "#/shared/EmailAddress";

describe("production account recovery email delivery", () => {
  it("registers one detached send and swallows its eventual rejection", async () => {
    const registered: Promise<unknown>[] = [];
    const sent: unknown[] = [];
    let rejectSender: (() => void) | undefined;
    let senderStartedResolve: ((value: null) => void) | undefined;
    const senderStarted = new Promise<null>((resolve) => {
      senderStartedResolve = resolve;
    });
    const executionContext = fromExecutionContext({
      passThroughOnException: () => {},
      waitUntil: (promise: Promise<unknown>) => {
        registered.push(promise);
      },
    } as unknown as ExecutionContext);
    const config = Schema.decodeUnknownSync(AuthRuntimeConfigSchema)({
      delivery: {
        _tag: "production",
        emailSender: {
          send: (message: unknown) =>
            Effect.callback<unknown, Error>((resume) => {
              sent.push(message);
              senderStartedResolve?.(null);
              rejectSender = () =>
                resume(Effect.fail(new Error("provider unavailable")));
            }),
        },
      },
      emailFrom: "auth@inbox.test",
      publicOrigin: "https://inbox.test/deployment-path",
      rateLimitNamespace: {},
      secrets: {
        challenge: Redacted.make("challenge"),
        privacy: Redacted.make("privacy"),
        session: Redacted.make("session"),
      },
    });
    const layer = AccountRecoveryDeliveryEmailLayer.pipe(
      Layer.provide([
        Layer.succeed(AuthRuntimeConfig, config),
        DevEmailStoreMemoryLive,
        Layer.succeed(WorkerExecutionContext, executionContext),
      ])
    );
    const expiresAt = Date.UTC(2026, 6, 23, 12, 0, 0);
    const secret = "s".repeat(32);

    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const delivery = yield* AccountRecoveryDelivery;
          yield* delivery.send({
            address: Schema.decodeUnknownSync(EmailAddress)(
              "recovery@external.test"
            ),
            expiresAt,
            flowId: "account-recovery-flow-a",
            secret: Redacted.make(secret),
          });
        }).pipe(Effect.provide(layer))
      )
    ).resolves.toBeUndefined();

    expect(registered).toHaveLength(1);
    await senderStarted;
    expect(sent).toStrictEqual([
      {
        from: "auth@inbox.test",
        subject: "Recover your Cloudflare Inbox account",
        text: `Continue account recovery:\n\nhttps://inbox.test/auth-complete/account-recovery#challengeId=account-recovery-flow-a&secret=${secret}\n\nYou will also need one unused recovery code. This link expires at 2026-07-23T12:00:00.000Z.`,
        to: "recovery@external.test",
      },
    ]);
    expect(rejectSender).toBeTypeOf("function");
    let backgroundSettled = false;
    const background = registered[0]?.then(() => {
      backgroundSettled = true;
    });
    await Promise.resolve();
    expect(backgroundSettled).toBeFalsy();

    rejectSender?.();

    await expect(background).resolves.toBeUndefined();
    expect(backgroundSettled).toBeTruthy();
  });
});
