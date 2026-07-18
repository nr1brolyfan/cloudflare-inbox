import {
  AuthBadRequestError,
  CoreAuthEmailVerificationGroupLive,
  CoreAuthHttpApi,
  CoreAuthLoginApprovalGroupLive,
  CoreAuthLoginNotificationGroupLive,
  CoreAuthMagicLinkGroupLive,
  CoreAuthPasswordGroupLive,
  CoreAuthSessionGroupLive,
  EmailOtpHttpOperations,
  EmailOtpHttpOperationsLive,
  EmailVerificationHttpOperationsLive,
  LoginApprovalHttpOperationsLive,
  LoginNotificationHttpOperationsLive,
  MagicLinkHttpOperationsLive,
  PasswordHttpOperationsLive,
  SessionHttpOperationsLive,
} from "@effect-auth/core/HttpApi";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpApiBuilder } from "effect/unstable/httpapi";

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

/** Group handlers for CoreAuthHttpApi; domain operations are provided separately. */
export const CoreAuthGroupHandlersLive = Layer.mergeAll(
  CoreAuthPasswordGroupLive,
  CoreAuthSessionGroupLive,
  CoreAuthEmailVerificationGroupLive,
  RestrictedEmailOtpGroupLive,
  CoreAuthMagicLinkGroupLive,
  CoreAuthLoginApprovalGroupLive,
  CoreAuthLoginNotificationGroupLive
).pipe(
  Layer.provide(PasswordHttpOperationsLive),
  Layer.provide(SessionHttpOperationsLive),
  Layer.provide(EmailVerificationHttpOperationsLive),
  Layer.provide(EmailOtpHttpOperationsLive),
  Layer.provide(MagicLinkHttpOperationsLive),
  Layer.provide(LoginApprovalHttpOperationsLive),
  Layer.provide(LoginNotificationHttpOperationsLive)
);
