import { AlchemyCloudflareMailer } from "@effect-auth/core/AlchemyCloudflareEmail";
import { RateLimitStoreDurableObject } from "@effect-auth/core/AlchemyCloudflareRateLimitDurableObject";
import {
  AuthDomainConfigLive,
  AuthSecretsLive,
} from "@effect-auth/core/AuthConfig";
import { AuthFlowStateLive } from "@effect-auth/core/AuthFlow";
import { AuthKernelLive } from "@effect-auth/core/AuthKernel";
import { AuthRateLimitStandardLive } from "@effect-auth/core/AuthRateLimit";
import { WebCryptoLive } from "@effect-auth/core/Crypto";
import { AuthMailerFromDevEmailStoreLive } from "@effect-auth/core/DevEmail";
import { EmailOtpDefaultLive } from "@effect-auth/core/EmailOtp";
import {
  EmailDeliveryFromAuthMailerLive,
  EmailVerificationDefaultLive,
} from "@effect-auth/core/EmailVerification";
import { IdentityKindRegistryDefaultLive } from "@effect-auth/core/Identity";
import { LoginApprovalLive } from "@effect-auth/core/LoginApproval";
import { MagicLinkLoginLive } from "@effect-auth/core/MagicLink";
import {
  AuthEmailTemplates,
  AuthMailerLive,
  Mailer,
  makeDefaultAuthEmailTemplates,
} from "@effect-auth/core/Mailer";
import {
  PasswordDefaultLive,
  PasswordResetLive,
} from "@effect-auth/core/Password";
import { PasswordRiskPolicy } from "@effect-auth/core/PasswordRisk";
import { RateLimiterLive } from "@effect-auth/core/RateLimiter";
import { RuntimeContext } from "alchemy";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { RateLimiter as PersistenceRateLimiter } from "effect/unstable/persistence";

import { completionUrl } from "./completion-url";
import { PasskeyServicesLive } from "./passkey-live";
import { meetsPasswordPolicy } from "./password-policy";
import { AuthRuntimeConfig } from "./runtime-config";

export { AuthRuntimeConfig, AuthRuntimeConfigSchema } from "./runtime-config";

const flowUrl = (
  publicOrigin: string,
  path: string,
  challengeId: string,
  secret?: Redacted.Redacted<string>
) =>
  completionUrl(publicOrigin, path, {
    challengeId,
    ...(secret === undefined ? {} : { secret: Redacted.value(secret) }),
  });

const MinimumPasswordRiskPolicyLive = Layer.succeed(
  PasswordRiskPolicy,
  PasswordRiskPolicy.of({
    decide: ({ password }) =>
      Effect.succeed(
        meetsPasswordPolicy(Redacted.value(password))
          ? { type: "Allow" as const }
          : { type: "Deny" as const }
      ),
  })
);

/** Auth domain and feature services; HTTP policy is owned by the Backend root. */
export const AuthServicesLive = Layer.unwrap(
  Effect.gen(function* () {
    const options = yield* AuthRuntimeConfig;
    const publicOrigin = options.publicOrigin.origin;
    const defaultTemplates = makeDefaultAuthEmailTemplates();
    const emailTemplatesLive = Layer.succeed(
      AuthEmailTemplates,
      AuthEmailTemplates.of({
        render: (input) => {
          if (input._tag !== "EmailVerification") {
            return defaultTemplates.render(input);
          }

          const url = flowUrl(
            publicOrigin,
            "/auth-complete/email-verification",
            input.challengeId,
            input.secret
          );

          return Effect.succeed({
            subject: "Verify your email",
            text: `Verify your email:\n\n${url}\n\nThis link expires at ${new Date(Number(input.expiresAt)).toISOString()}.`,
          });
        },
      })
    );
    const authMailerLive = (() => {
      if (options.delivery._tag === "development") {
        return AuthMailerFromDevEmailStoreLive({
          from: options.emailFrom,
        }).pipe(Layer.provide(emailTemplatesLive));
      }

      const { emailSender } = options.delivery;
      return AuthMailerLive({ from: options.emailFrom }).pipe(
        Layer.provide(emailTemplatesLive),
        Layer.provide(
          Layer.succeed(
            Mailer,
            AlchemyCloudflareMailer.make({
              email: {
                send: (message) =>
                  emailSender
                    .send(message)
                    .pipe(Effect.provide(RuntimeContext.phantom)),
              },
              from: options.emailFrom,
              provider: "cloudflare-email-routing",
            })
          )
        )
      );
    })();
    const sessionLive = AuthKernelLive.pipe(
      Layer.provideMerge(WebCryptoLive()),
      Layer.provideMerge(AuthSecretsLive(options.secrets))
    );
    const baseLive = sessionLive.pipe(
      Layer.provideMerge(
        AuthDomainConfigLive({
          emailVerificationSessionPolicy: { mode: "limited-session" },
        })
      ),
      Layer.merge(IdentityKindRegistryDefaultLive),
      Layer.merge(authMailerLive)
    );
    const passwordBaseLive = PasswordDefaultLive(
      undefined,
      MinimumPasswordRiskPolicyLive
    ).pipe(Layer.provideMerge(baseLive));
    const passwordLive = PasswordResetLive({
      makeUrl: ({ challengeId, secret }) =>
        flowUrl(
          publicOrigin,
          "/auth-complete/password-reset",
          challengeId,
          secret
        ),
    }).pipe(Layer.provideMerge(passwordBaseLive));
    const emailDeliveryLive = EmailDeliveryFromAuthMailerLive.pipe(
      Layer.provideMerge(baseLive)
    );
    const emailVerificationLive = EmailVerificationDefaultLive().pipe(
      Layer.provideMerge(emailDeliveryLive)
    );
    const emailOtpLive = EmailOtpDefaultLive().pipe(
      Layer.provideMerge(baseLive)
    );
    const magicLinkLive = MagicLinkLoginLive({
      makeUrl: ({ challengeId, secret }) =>
        flowUrl(publicOrigin, "/auth-complete/magic-link", challengeId, secret),
    }).pipe(Layer.provideMerge(baseLive));
    const loginApprovalLive = LoginApprovalLive().pipe(
      Layer.provideMerge(baseLive)
    );
    const authFlowStateLive = AuthFlowStateLive().pipe(
      Layer.provideMerge(baseLive)
    );
    const passkeyLive = PasskeyServicesLive.pipe(Layer.provide(baseLive));
    const rateLimiterLive = RateLimiterLive.pipe(
      Layer.provide(PersistenceRateLimiter.layer),
      Layer.provide(
        RateLimitStoreDurableObject.layer({
          namespace: options.rateLimitNamespace,
        })
      )
    );
    const authRateLimitLive = AuthRateLimitStandardLive().pipe(
      Layer.provideMerge(rateLimiterLive),
      Layer.provideMerge(baseLive)
    );
    const requirementsLive = Layer.mergeAll(
      passwordLive,
      emailVerificationLive,
      emailOtpLive,
      magicLinkLive,
      loginApprovalLive,
      authFlowStateLive,
      passkeyLive,
      authRateLimitLive
    );

    return Layer.merge(sessionLive, requirementsLive);
  })
);
