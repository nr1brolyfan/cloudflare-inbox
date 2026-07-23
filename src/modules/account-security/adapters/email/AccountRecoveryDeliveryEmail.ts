import { AlchemyCloudflareMailer } from "@effect-auth/core/AlchemyCloudflareEmail";
import { DevEmailStore } from "@effect-auth/core/DevEmail";
import { EmailSchema, UnixMillis } from "@effect-auth/core/Identifiers";
import { RuntimeContext } from "alchemy";
import { WorkerExecutionContext } from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { AuthRuntimeConfig } from "#/modules/account-security/adapters/cloudflare/AuthRuntimeConfigCloudflare";
import { AccountRecoveryError } from "#/modules/account-security/domain/AccountRecovery";
import { completionUrl } from "#/modules/account-security/domain/CompletionUrl";
import { AccountRecoveryDelivery } from "#/modules/account-security/ports/AccountRecoveryDelivery";

const failure = (cause: unknown) =>
  new AccountRecoveryError({ cause, operation: "start", reason: "delivery" });

export const AccountRecoveryDeliveryEmailLayer = Layer.effect(
  AccountRecoveryDelivery,
  Effect.gen(function* () {
    const config = yield* AuthRuntimeConfig;
    const devEmailStore = yield* DevEmailStore;
    const executionContext = yield* WorkerExecutionContext;

    return AccountRecoveryDelivery.of({
      send: ({ address, expiresAt, flowId, secret }) =>
        Effect.gen(function* () {
          const recipient = yield* Schema.decodeUnknownEffect(EmailSchema)(
            address
          ).pipe(Effect.mapError(failure));
          const url = completionUrl(
            config.publicOrigin.origin,
            "/auth-complete/account-recovery",
            { challengeId: flowId, secret: Redacted.value(secret) }
          );
          const subject = "Recover your Cloudflare Inbox account";
          const text = `Continue account recovery:\n\n${url}\n\nYou will also need one unused recovery code. This link expires at ${new Date(expiresAt).toISOString()}.`;

          if (config.delivery._tag === "development") {
            return yield* devEmailStore
              .save({
                createdAt: UnixMillis(Date.now()),
                expiresAt: UnixMillis(expiresAt),
                id: `account-recovery:${flowId}`,
                kind: "MagicLink",
                recipient,
                sender: config.emailFrom,
                subject,
                text,
              })
              .pipe(Effect.mapError(failure));
          }
          const production = config.delivery;
          const mailer = AlchemyCloudflareMailer.make({
            email: {
              send: (message) =>
                production.emailSender
                  .send(message)
                  .pipe(Effect.provide(RuntimeContext.phantom)),
            },
            from: config.emailFrom,
            provider: "cloudflare-email-routing",
          });
          yield* executionContext
            .waitUntil(
              mailer
                .send({ subject, text, to: recipient })
                .pipe(Effect.catch(() => Effect.void))
            )
            .pipe(Effect.provide(RuntimeContext.phantom));
        }),
    });
  })
);
