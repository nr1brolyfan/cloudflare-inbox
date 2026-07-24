import { BotProtection } from "@effect-auth/core/AbuseProtection";
import { AuthRateLimit } from "@effect-auth/core/AuthRateLimit";
import { EmailOtpLogin } from "@effect-auth/core/EmailOtp";
import {
  EmailVerificationFlow,
  EmailVerificationIssueError,
} from "@effect-auth/core/EmailVerification";
import {
  AuthBadRequestError,
  AuthInternalError,
  AuthPolicyDeniedError,
  CoreAuthHttpApi,
  EmailGuards,
  EmailOtpHttpOperations,
  EmailVerificationHttpOperations,
  MagicLinkHttpOperations,
  PasswordGuards,
  PasswordHttpOperations,
} from "@effect-auth/core/HttpApi";
import { MagicLinkLogin } from "@effect-auth/core/MagicLink";
import { PasswordReset } from "@effect-auth/core/Password";
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

const invalidInitiationSecret = (flow: string) =>
  new AuthBadRequestError({
    code: "bad_request",
    message: `Invalid ${flow} request`,
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
    error instanceof EmailVerificationIssueError ||
    (typeof error === "object" &&
      error !== null &&
      "cause" in error &&
      error.cause instanceof EmailVerificationIssueError)
  ) {
    return new AuthBadRequestError({
      code: "bad_request",
      message: "Invalid email verification request",
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

      return handlers
        .handle("signIn", operations.signIn)
        .handle("signUp", () => Effect.fail(passwordSignUpUnavailable()))
        .handle("resetStart", (request) =>
          Effect.gen(function* () {
            const guarded = yield* PasswordGuards.resetStart(request).pipe(
              Effect.provideService(AuthRateLimit, authRateLimit),
              Effect.provideService(BotProtection, botProtection)
            );
            if (request.payload.secret !== undefined) {
              return yield* invalidInitiationSecret("password reset");
            }
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
    const authRateLimit = yield* AuthRateLimit;
    const botProtection = yield* BotProtection;

    return handlers
      .handle("start", (request) =>
        Effect.gen(function* () {
          const guarded = yield* EmailGuards.emailOtp
            .start(request)
            .pipe(
              Effect.provideService(AuthRateLimit, authRateLimit),
              Effect.provideService(BotProtection, botProtection)
            );
          if (request.payload.secret !== undefined) {
            return yield* invalidInitiationSecret("email OTP");
          }
          const started = yield* emailOtp
            .start(guarded.input)
            .pipe(
              Effect.mapError((error) =>
                emailInitiationFailure(error, "email OTP")
              )
            );
          return {
            challengeId: started.challengeId,
            expiresAt: started.expiresAt,
            identity: request.payload.identity,
          };
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

    return handlers
      .handle("start", (request) =>
        Effect.gen(function* () {
          const guarded = yield* EmailGuards.magicLink
            .start(request)
            .pipe(
              Effect.provideService(AuthRateLimit, authRateLimit),
              Effect.provideService(BotProtection, botProtection)
            );
          if (request.payload.secret !== undefined) {
            return yield* invalidInitiationSecret("magic link");
          }
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
        const verification = yield* EmailVerificationFlow;
        const authRateLimit = yield* AuthRateLimit;
        const botProtection = yield* BotProtection;
        const identities = yield* IdentityStore;

        return handlers
          .handle("start", (request) =>
            Effect.gen(function* () {
              const guarded = yield* EmailGuards.emailVerification
                .start(request)
                .pipe(
                  Effect.provideService(AuthRateLimit, authRateLimit),
                  Effect.provideService(BotProtection, botProtection),
                  Effect.provideService(IdentityStore, identities)
                );
              if (request.payload.secret !== undefined) {
                return yield* invalidInitiationSecret("email verification");
              }
              yield* verification
                .start(guarded.input)
                .pipe(Effect.mapError(emailVerificationInitiationFailure));
              return HttpServerResponse.empty({ status: 204 });
            })
          )
          .handle("verify", operations.verify);
      }
    )
  );
