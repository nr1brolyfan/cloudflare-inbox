import { BotProtection } from "@effect-auth/core/AbuseProtection";
import { AuthRateLimit } from "@effect-auth/core/AuthRateLimit";
import { EmailOtpLogin } from "@effect-auth/core/EmailOtp";
import {
  EmailVerificationCode,
  EmailVerificationCodeStartError,
} from "@effect-auth/core/EmailVerificationCode";
import {
  AuthBadRequestError,
  AuthInternalError,
  AuthPolicyDeniedError,
  CoreAuthHttpApi,
  EmailGuards,
} from "@effect-auth/core/HttpApi";
import {
  EmailAuthProcessCookie,
  EmailOtpHttpOperations,
} from "@effect-auth/core/HttpApi/EmailOtp";
import { EmailVerificationHttpOperations } from "@effect-auth/core/HttpApi/EmailVerification";
import { HttpAuthenticationCapabilities } from "@effect-auth/core/HttpApi/HttpAuthenticationCapabilities";
import { MagicLinkHttpOperations } from "@effect-auth/core/HttpApi/MagicLink";
import {
  PasswordGuards,
  PasswordHttpOperations,
} from "@effect-auth/core/HttpApi/Password";
import { IdentityKindRegistry } from "@effect-auth/core/Identity";
import { MagicLinkLogin } from "@effect-auth/core/MagicLink";
import { PasswordReset } from "@effect-auth/core/Password";
import { SessionCookie, Sessions } from "@effect-auth/core/Sessions";
import { IdentityStore } from "@effect-auth/core/Storage";
import * as Effect from "effect/Effect";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { isRecoverySafeEmailInitiationDenied } from "#/modules/account-security/adapters/effect-auth/RecoverySafeEmailInitiationEffectAuth";

const passwordEnrollmentUnavailable = () =>
  new AuthPolicyDeniedError({
    code: "policy_denied",
    message: "Password enrollment unavailable",
  });

const passwordSignUpUnavailable = () =>
  new AuthPolicyDeniedError({
    code: "policy_denied",
    message: "Password sign-up unavailable",
  });

const emailInitiationFailure = (
  error: Parameters<typeof isRecoverySafeEmailInitiationDenied>[0],
  flow: string
) =>
  isRecoverySafeEmailInitiationDenied(error)
    ? new AuthPolicyDeniedError({
        code: "policy_denied",
        message: "Email initiation denied",
      })
    : new AuthInternalError({
        code: "internal_error",
        message: `Failed to start ${flow}`,
      });

const emailVerificationInitiationFailure = (error: unknown) => {
  if (isRecoverySafeEmailInitiationDenied(error)) {
    return new AuthPolicyDeniedError({
      code: "policy_denied",
      message: "Email initiation denied",
    });
  }
  if (
    error instanceof EmailVerificationCodeStartError ||
    (typeof error === "object" &&
      error !== null &&
      "cause" in error &&
      error.cause instanceof EmailVerificationCodeStartError)
  ) {
    return new AuthInternalError({
      code: "internal_error",
      message: "Failed to start email verification",
    });
  }
  return new AuthInternalError({
    code: "internal_error",
    message: "Failed to start email verification",
  });
};

/** Keeps first-password enrollment unavailable until a recovery-safe flow exists. */
export const PasswordEnrollmentUnavailableHttpHandlersLayer =
  HttpApiBuilder.group(
    CoreAuthHttpApi,
    "password",
    Effect.fn("auth.http.password.restricted_group")(function* (handlers) {
      const operations = yield* PasswordHttpOperations;
      const passwordReset = yield* PasswordReset;
      const authRateLimit = yield* AuthRateLimit;
      const botProtection = yield* BotProtection;
      const httpAuthenticationCapabilities =
        yield* HttpAuthenticationCapabilities;
      const identityKinds = yield* IdentityKindRegistry;

      return handlers
        .handle("signIn", operations.signIn)
        .handle("signUp", () => Effect.fail(passwordSignUpUnavailable()))
        .handle("resetStart", (request) =>
          Effect.gen(function* () {
            const guarded = yield* PasswordGuards.resetStart(request).pipe(
              Effect.provideService(AuthRateLimit, authRateLimit),
              Effect.provideService(BotProtection, botProtection),
              Effect.provideService(
                HttpAuthenticationCapabilities,
                httpAuthenticationCapabilities
              ),
              Effect.provideService(IdentityKindRegistry, identityKinds)
            );
            yield* passwordReset
              .start(guarded.input)
              .pipe(
                Effect.mapError((error) =>
                  emailInitiationFailure(error, "password reset")
                )
              );
            return HttpServerResponse.empty({ status: 204 });
          })
        )
        .handle("resetVerify", operations.resetVerify)
        .handle("set", () => Effect.fail(passwordEnrollmentUnavailable()))
        .handle("change", operations.change);
    })
  );

/** Enforces the application policy contract around generic email OTP starts. */
export const RestrictedEmailOtpHttpHandlersLayer = HttpApiBuilder.group(
  CoreAuthHttpApi,
  "emailOtp",
  Effect.fn("auth.http.email_otp.restricted_group")(function* (handlers) {
    const operations = yield* EmailOtpHttpOperations;
    const emailOtp = yield* EmailOtpLogin;
    const emailAuthProcessCookie = yield* EmailAuthProcessCookie;
    const authRateLimit = yield* AuthRateLimit;
    const botProtection = yield* BotProtection;
    const httpAuthenticationCapabilities =
      yield* HttpAuthenticationCapabilities;

    return handlers
      .handle("start", (request) =>
        Effect.gen(function* () {
          const guarded = yield* EmailGuards.emailOtp
            .start(request)
            .pipe(
              Effect.provideService(AuthRateLimit, authRateLimit),
              Effect.provideService(BotProtection, botProtection),
              Effect.provideService(
                HttpAuthenticationCapabilities,
                httpAuthenticationCapabilities
              )
            );
          const started = yield* emailOtp
            .start(guarded.input)
            .pipe(
              Effect.mapError((error) =>
                emailInitiationFailure(error, "email OTP")
              )
            );
          const cookie = yield* emailAuthProcessCookie
            .commit(started.authProcess)
            .pipe(
              Effect.mapError(
                () =>
                  new AuthInternalError({
                    code: "internal_error",
                    message: "Failed to commit email process cookie",
                  })
              )
            );
          return yield* HttpServerResponse.json(
            {
              challengeId: started.challengeId,
              expiresAt: started.expiresAt,
              identity: request.payload.identity,
            },
            { headers: { "set-cookie": cookie } }
          ).pipe(
            Effect.mapError(
              () =>
                new AuthInternalError({
                  code: "internal_error",
                  message: "Failed to encode email OTP response",
                })
            )
          );
        })
      )
      .handle("verify", operations.verify);
  })
);

/** Enforces the application policy contract around generic magic-link starts. */
export const RestrictedMagicLinkHttpHandlersLayer = HttpApiBuilder.group(
  CoreAuthHttpApi,
  "magicLink",
  Effect.fn("auth.http.magic_link.restricted_group")(function* (handlers) {
    const operations = yield* MagicLinkHttpOperations;
    const magicLink = yield* MagicLinkLogin;
    const authRateLimit = yield* AuthRateLimit;
    const botProtection = yield* BotProtection;
    const httpAuthenticationCapabilities =
      yield* HttpAuthenticationCapabilities;

    return handlers
      .handle("start", (request) =>
        Effect.gen(function* () {
          const guarded = yield* EmailGuards.magicLink
            .start(request)
            .pipe(
              Effect.provideService(AuthRateLimit, authRateLimit),
              Effect.provideService(BotProtection, botProtection),
              Effect.provideService(
                HttpAuthenticationCapabilities,
                httpAuthenticationCapabilities
              )
            );
          const started = yield* magicLink
            .start(guarded.input)
            .pipe(
              Effect.mapError((error) =>
                emailInitiationFailure(error, "magic link")
              )
            );
          return {
            expiresAt: started.expiresAt,
            identity: request.payload.identity,
          };
        })
      )
      .handle("verify", operations.verify);
  })
);

/** Enforces the application policy contract around email-verification starts. */
export const RestrictedEmailVerificationHttpHandlersLayer =
  HttpApiBuilder.group(
    CoreAuthHttpApi,
    "emailVerification",
    Effect.fn("auth.http.email_verification.restricted_group")(
      function* (handlers) {
        const operations = yield* EmailVerificationHttpOperations;
        const verification = yield* EmailVerificationCode;
        const authRateLimit = yield* AuthRateLimit;
        const botProtection = yield* BotProtection;
        const identities = yield* IdentityStore;
        const httpAuthenticationCapabilities =
          yield* HttpAuthenticationCapabilities;
        const sessions = yield* Sessions;
        const sessionCookie = yield* SessionCookie;

        return handlers
          .handle("start", (request) =>
            Effect.gen(function* () {
              const guarded = yield* EmailGuards.emailVerification
                .start(request)
                .pipe(
                  Effect.catchTag("AuthInvalidCredentialsError", () =>
                    Effect.fail(
                      new AuthBadRequestError({
                        code: "bad_request",
                        message: "Invalid email verification request",
                      })
                    )
                  ),
                  Effect.provideService(AuthRateLimit, authRateLimit),
                  Effect.provideService(BotProtection, botProtection),
                  Effect.provideService(IdentityStore, identities),
                  Effect.provideService(
                    HttpAuthenticationCapabilities,
                    httpAuthenticationCapabilities
                  ),
                  Effect.provideService(Sessions, sessions),
                  Effect.provideService(SessionCookie, sessionCookie)
                );
              const started = yield* verification
                .start(guarded.input)
                .pipe(Effect.mapError(emailVerificationInitiationFailure));
              return {
                challengeId: started.challengeId,
                expiresAt: started.expiresAt,
              };
            })
          )
          .handle("verify", operations.verify);
      }
    )
  );
