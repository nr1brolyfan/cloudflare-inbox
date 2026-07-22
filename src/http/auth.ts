import {
  AuthBadRequestError,
  AuthPolicyDeniedError,
  CoreAuthHttpApi,
  EmailOtpHttpOperations,
  PasswordHttpOperations,
} from "@effect-auth/core/HttpApi";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

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

/** Keeps first-password enrollment unavailable until a recovery-safe flow exists. */
export const PasswordEnrollmentUnavailableGroupLive = HttpApiBuilder.group(
  CoreAuthHttpApi,
  "password",
  Effect.fn("auth.http.password.restricted_group")(function* (handlers) {
    const operations = yield* PasswordHttpOperations;

    return handlers
      .handle("signIn", operations.signIn)
      .handle("signUp", () => Effect.fail(passwordSignUpUnavailable()))
      .handle("resetStart", operations.resetStart)
      .handle("resetVerify", operations.resetVerify)
      .handle("set", () => Effect.fail(passwordEnrollmentUnavailable()))
      .handle("change", operations.change);
  })
);

/** Disables the secret-bearing email OTP start variant for this application. */
export const RestrictedEmailOtpGroupLive = HttpApiBuilder.group(
  CoreAuthHttpApi,
  "emailOtp",
  Effect.fn("auth.http.email_otp.restricted_group")(function* (handlers) {
    const operations = yield* EmailOtpHttpOperations;

    return handlers
      .handle("start", (request) =>
        request.payload.secret === undefined
          ? operations.start(request)
          : Effect.fail(
              new AuthBadRequestError({
                code: "bad_request",
                message: "Invalid email OTP request",
              })
            )
      )
      .handle("verify", operations.verify);
  })
);
