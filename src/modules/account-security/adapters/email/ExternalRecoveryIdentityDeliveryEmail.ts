import { AlchemyCloudflareMailer } from "@effect-auth/core/AlchemyCloudflareEmail";
import { DevEmailStore } from "@effect-auth/core/DevEmail";
import { EmailSchema, UnixMillis } from "@effect-auth/core/Identifiers";
import { RuntimeContext } from "alchemy";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { AuthRuntimeConfig } from "#/modules/account-security/adapters/cloudflare/AuthRuntimeConfigCloudflare";
import { ExternalRecoveryIdentityManagementError } from "#/modules/account-security/application/ExternalRecoveryIdentityManagement";
import { completionUrl } from "#/modules/account-security/domain/CompletionUrl";
import { ExternalRecoveryIdentityDelivery } from "#/modules/account-security/ports/ExternalRecoveryIdentityDelivery";

const deliveryError = (cause: unknown) =>
  new ExternalRecoveryIdentityManagementError({
    cause,
    operation: "enroll",
    reason: "delivery",
  });

export const ExternalRecoveryIdentityDeliveryEmailLayer = Layer.effect(
  ExternalRecoveryIdentityDelivery,
  Effect.gen(function* () {
    const config = yield* AuthRuntimeConfig;
    const devEmailStore = yield* DevEmailStore;

    return ExternalRecoveryIdentityDelivery.of({
      sendVerification: ({ address, challenge }) =>
        Effect.gen(function* () {
          const recipient = yield* Schema.decodeUnknownEffect(EmailSchema)(
            address
          ).pipe(Effect.mapError(deliveryError));
          const url = completionUrl(
            config.publicOrigin.origin,
            "/auth-complete/external-recovery-identity",
            {
              challengeId: challenge.challengeId,
              secret: Redacted.value(challenge.secret),
            }
          );
          const subject = "Verify your external recovery address";
          const expiresAt = DateTime.formatIso(
            DateTime.makeUnsafe(challenge.expiresAt)
          );
          const text = `Verify this address for account recovery:\n\n${url}\n\nThis link expires at ${expiresAt}.`;

          if (config.delivery._tag === "development") {
            return yield* devEmailStore
              .save({
                createdAt: UnixMillis(yield* Clock.currentTimeMillis),
                expiresAt: UnixMillis(challenge.expiresAt),
                id: `external-recovery:${challenge.challengeId}`,
                kind: "EmailVerification",
                recipient,
                sender: config.emailFrom,
                subject,
                text,
              })
              .pipe(Effect.mapError(deliveryError));
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
          return yield* mailer
            .send({
              subject,
              text,
              to: recipient,
            })
            .pipe(Effect.mapError(deliveryError));
        }),
    });
  })
);
