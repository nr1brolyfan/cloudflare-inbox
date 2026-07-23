import { AlchemyCloudflareMailer } from "@effect-auth/core/AlchemyCloudflareEmail";
import { RateLimitStoreDurableObject } from "@effect-auth/core/AlchemyCloudflareRateLimitDurableObject";
import { CustomEvidencePoliciesLive } from "@effect-auth/core/Assurance";
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

import { AuthRuntimeConfig } from "#/modules/account-security/adapters/cloudflare/AuthRuntimeConfigCloudflare";
import { PasskeyEffectAuthLayer } from "#/modules/account-security/adapters/effect-auth/PasskeyEffectAuth";
import { externalRecoveryLinkEvidence } from "#/modules/account-security/domain/AccountRecovery";
import { completionUrl } from "#/modules/account-security/domain/CompletionUrl";
import { meetsPasswordPolicy } from "#/modules/account-security/domain/PasswordPolicy";

export {
  AuthRuntimeConfig,
  AuthRuntimeConfigSchema,
} from "#/modules/account-security/adapters/cloudflare/AuthRuntimeConfigCloudflare";

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

const minimumPasswordRiskPolicyLayer = Layer.succeed(
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
export const AccountSecurityEffectAuthLayer = Layer.unwrap(
  Effect.gen(function* () {
    const options = yield* AuthRuntimeConfig;
    const publicOrigin = options.publicOrigin.origin;
    const defaultTemplates = makeDefaultAuthEmailTemplates();
    const emailTemplatesLayer = Layer.succeed(
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
    const authMailerLayer = (() => {
      if (options.delivery._tag === "development") {
        return AuthMailerFromDevEmailStoreLive({
          from: options.emailFrom,
        }).pipe(Layer.provide(emailTemplatesLayer));
      }

      const { emailSender } = options.delivery;
      return AuthMailerLive({ from: options.emailFrom }).pipe(
        Layer.provide(emailTemplatesLayer),
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
    const sessionLayer = AuthKernelLive.pipe(
      Layer.provide(
        CustomEvidencePoliciesLive([externalRecoveryLinkEvidence.policy]).pipe(
          Layer.orDie
        )
      ),
      Layer.provideMerge(WebCryptoLive()),
      Layer.provideMerge(AuthSecretsLive(options.secrets))
    );
    const baseLayer = sessionLayer.pipe(
      Layer.provideMerge(
        AuthDomainConfigLive({
          emailVerificationSessionPolicy: { mode: "limited-session" },
        })
      ),
      Layer.merge(IdentityKindRegistryDefaultLive),
      Layer.merge(authMailerLayer)
    );
    const passwordBaseLayer = PasswordDefaultLive(
      undefined,
      minimumPasswordRiskPolicyLayer
    ).pipe(Layer.provideMerge(baseLayer));
    const passwordLayer = PasswordResetLive({
      makeUrl: ({ challengeId, secret }) =>
        flowUrl(
          publicOrigin,
          "/auth-complete/password-reset",
          challengeId,
          secret
        ),
    }).pipe(Layer.provideMerge(passwordBaseLayer));
    const emailDeliveryLayer = EmailDeliveryFromAuthMailerLive.pipe(
      Layer.provideMerge(baseLayer)
    );
    const emailVerificationLayer = EmailVerificationDefaultLive().pipe(
      Layer.provideMerge(emailDeliveryLayer)
    );
    const emailOtpLayer = EmailOtpDefaultLive().pipe(
      Layer.provideMerge(baseLayer)
    );
    const magicLinkLayer = MagicLinkLoginLive({
      makeUrl: ({ challengeId, secret }) =>
        flowUrl(publicOrigin, "/auth-complete/magic-link", challengeId, secret),
    }).pipe(Layer.provideMerge(baseLayer));
    const loginApprovalLayer = LoginApprovalLive().pipe(
      Layer.provideMerge(baseLayer)
    );
    const authFlowStateLayer = AuthFlowStateLive().pipe(
      Layer.provideMerge(baseLayer)
    );
    const passkeyLayer = PasskeyEffectAuthLayer.pipe(Layer.provide(baseLayer));
    const rateLimiterLayer = RateLimiterLive.pipe(
      Layer.provide(PersistenceRateLimiter.layer),
      Layer.provide(
        RateLimitStoreDurableObject.layer({
          namespace: options.rateLimitNamespace,
        })
      )
    );
    const authRateLimitLayer = AuthRateLimitStandardLive().pipe(
      Layer.provideMerge(rateLimiterLayer),
      Layer.provideMerge(baseLayer)
    );
    const requirementsLayer = Layer.mergeAll(
      passwordLayer,
      emailVerificationLayer,
      emailOtpLayer,
      magicLinkLayer,
      loginApprovalLayer,
      authFlowStateLayer,
      passkeyLayer,
      authRateLimitLayer
    );

    return Layer.merge(sessionLayer, requirementsLayer);
  })
);
