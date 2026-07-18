import { BotProtectionNoopLive } from "@effect-auth/core/AbuseProtection";
import { AlchemyCloudflareMailer } from "@effect-auth/core/AlchemyCloudflareEmail";
import type { AlchemyRateLimitDurableObjectNamespace } from "@effect-auth/core/AlchemyCloudflareRateLimitDurableObject";
import { RateLimitStoreDurableObject } from "@effect-auth/core/AlchemyCloudflareRateLimitDurableObject";
import type { AuthSecretsShape } from "@effect-auth/core/AuthConfig";
import {
  AuthDomainConfigLive,
  AuthSecretsLive,
} from "@effect-auth/core/AuthConfig";
import { AuthFlowStateLive } from "@effect-auth/core/AuthFlow";
import { AuthKernelLive } from "@effect-auth/core/AuthKernel";
import { AuthRateLimitStandardLive } from "@effect-auth/core/AuthRateLimit";
import { WebCryptoLive } from "@effect-auth/core/Crypto";
import { AuthMailerFromDevEmailStoreLive } from "@effect-auth/core/DevEmail";
import type { D1EffectQbDatabaseLike } from "@effect-auth/core/EffectQbSqliteStorage";
import { D1EffectQbSqliteAuthStorageLive } from "@effect-auth/core/EffectQbSqliteStorage";
import { EmailOtpDefaultLive } from "@effect-auth/core/EmailOtp";
import {
  EmailDeliveryFromAuthMailerLive,
  EmailVerificationDefaultLive,
} from "@effect-auth/core/EmailVerification";
import { AuthHttpApiConfigLive } from "@effect-auth/core/HttpApi";
import type { Email } from "@effect-auth/core/Identifiers";
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
import type * as Cloudflare from "alchemy/Cloudflare";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { RateLimiter as PersistenceRateLimiter } from "effect/unstable/persistence";

import { completionUrl } from "./completion-url";
import { D1DevEmailStoreLive } from "./dev-email-store";
import { CoreAuthGroupHandlersLive } from "./http-api";

export type AuthEmailSendClient = Effect.Success<
  ReturnType<typeof Cloudflare.Email.Send>
>;

export interface AuthRuntimeConfigShape {
  readonly database: D1EffectQbDatabaseLike;
  readonly emailFrom: Email;
  readonly emailSender?: AuthEmailSendClient;
  readonly isDevelopment: boolean;
  readonly publicOrigin: string;
  readonly rateLimitNamespace: AlchemyRateLimitDurableObjectNamespace;
  readonly secrets: AuthSecretsShape;
}

/** Configuration and Cloudflare handles required to assemble the auth runtime. */
export const AuthRuntimeConfig = Context.Service<AuthRuntimeConfigShape>(
  "cloudflare-inbox/AuthRuntimeConfig"
);

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
        [...Redacted.value(password)].length >= 12
          ? { type: "Allow" as const }
          : { type: "Deny" as const }
      ),
  })
);

/** Core auth services and handlers consumed by the shared BackendHttpApi. */
export const AuthLive = Layer.unwrap(
  Effect.gen(function* () {
    const options = yield* AuthRuntimeConfig;
    const { database, emailSender } = options;
    const storageLive = D1EffectQbSqliteAuthStorageLive(database);
    const productionTransportLive =
      emailSender === undefined
        ? Layer.effect(
            Mailer,
            Effect.die("Auth email sender is not configured")
          )
        : Layer.succeed(
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
          );
    const defaultTemplates = makeDefaultAuthEmailTemplates();
    const emailTemplatesLive = Layer.succeed(
      AuthEmailTemplates,
      AuthEmailTemplates.of({
        render: (input) => {
          if (input._tag !== "EmailVerification") {
            return defaultTemplates.render(input);
          }

          const url = flowUrl(
            options.publicOrigin,
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
    const authMailerLive = options.isDevelopment
      ? AuthMailerFromDevEmailStoreLive({ from: options.emailFrom }).pipe(
          Layer.provide(emailTemplatesLive),
          Layer.provide(D1DevEmailStoreLive)
        )
      : AuthMailerLive({ from: options.emailFrom }).pipe(
          Layer.provide(emailTemplatesLive),
          Layer.provide(productionTransportLive)
        );
    const sessionLive = AuthKernelLive.pipe(
      Layer.provideMerge(storageLive),
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
          options.publicOrigin,
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
        flowUrl(
          options.publicOrigin,
          "/auth-complete/magic-link",
          challengeId,
          secret
        ),
    }).pipe(Layer.provideMerge(baseLive));
    const loginApprovalLive = LoginApprovalLive().pipe(
      Layer.provideMerge(baseLive)
    );
    const authFlowStateLive = AuthFlowStateLive().pipe(
      Layer.provideMerge(baseLive)
    );
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
      authRateLimitLive
    );

    const groupHandlersLive = CoreAuthGroupHandlersLive.pipe(
      Layer.provide(
        AuthHttpApiConfigLive({
          originCheck: {
            allowMissingOrigin: false,
            allowedOrigins: [options.publicOrigin],
          },
          requestMetadata: { trustProxyHeaders: true },
        })
      ),
      Layer.provide(requirementsLive),
      Layer.provide(BotProtectionNoopLive)
    );

    return Layer.merge(sessionLive, groupHandlersLive);
  })
);
