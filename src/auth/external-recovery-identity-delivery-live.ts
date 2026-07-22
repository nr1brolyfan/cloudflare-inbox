import { AlchemyCloudflareMailer } from "@effect-auth/core/AlchemyCloudflareEmail";
import { DevEmailStore } from "@effect-auth/core/DevEmail";
import { EmailSchema, UnixMillis } from "@effect-auth/core/Identifiers";
import { RuntimeContext } from "alchemy";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { completionUrl } from "./completion-url";
import {
  ExternalRecoveryIdentityDelivery,
  ExternalRecoveryIdentityManagementError,
} from "./external-recovery-identity-management";
import { AuthRuntimeConfig } from "./runtime-config";

const deliveryError = (cause: unknown) =>
  new ExternalRecoveryIdentityManagementError({
    cause,
    operation: "enroll",
    reason: "delivery",
  });

export const ExternalRecoveryIdentityDeliveryLive = Layer.effect(
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
          const text = `Verify this address for account recovery:\n\n${url}\n\nThis link expires at ${new Date(challenge.expiresAt).toISOString()}.`;

          if (config.delivery._tag === "development") {
            return yield* devEmailStore
              .save({
                createdAt: UnixMillis(Date.now()),
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
