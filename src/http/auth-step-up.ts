import { passwordEvidence } from "@effect-auth/core/Assurance";
import { AuthRateLimit } from "@effect-auth/core/AuthRateLimit";
import {
  AuthBadRequestError,
  AuthInternalError,
  AuthInvalidCredentialsError,
  AuthPolicyDeniedError,
  AuthRateLimitedError,
  StepUpHttpOperations,
  stepUpAuthenticatedHttpBody,
} from "@effect-auth/core/HttpApi";
import { PasswordHasher } from "@effect-auth/core/Password";
import { CurrentPrincipal } from "@effect-auth/core/Permission";
import type { PrivacyError } from "@effect-auth/core/Privacy";
import type { RateLimitError } from "@effect-auth/core/RateLimiter";
import { SessionCookie, Sessions } from "@effect-auth/core/Sessions";
import { CredentialStore } from "@effect-auth/core/Storage";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { PasskeyAuthentication } from "../auth/passkey-authentication";
import type { PasskeyAuthenticationError } from "../auth/passkey-authentication";
import {
  CurrentRequestAuth,
  RequestSessionAuthenticator,
} from "../auth/session";
import {
  SensitiveOperationStepUpClock,
  StepUpVerifiedAt,
} from "../auth/step-up-policy";
import { ApplicationAuthHttpApi } from "./auth-contract";

const stepUpInternalError = () =>
  new AuthInternalError({
    code: "internal_error",
    message: "Failed to complete step-up authentication",
  });

const stepUpUnavailable = () =>
  new AuthPolicyDeniedError({
    code: "policy_denied",
    message: "Step-up factor unavailable",
  });

const stepUpRestricted = () =>
  new AuthPolicyDeniedError({
    code: "policy_denied",
    message: "Complete pending account requirements before step-up",
  });

const stepUpBadRequest = () =>
  new AuthBadRequestError({
    code: "bad_request",
    message: "Invalid passkey step-up request",
  });

type PasskeyStepUpPublicError =
  | AuthBadRequestError
  | AuthInternalError
  | AuthPolicyDeniedError;

const mapPasskeyError = (
  error: PasskeyAuthenticationError
): Effect.Effect<never, PasskeyStepUpPublicError> => {
  switch (error.reason) {
    case "invalid-credential":
    case "invalid-input": {
      return Effect.fail(stepUpBadRequest());
    }
    case "policy-denied":
    case "restricted-session": {
      return Effect.fail(stepUpRestricted());
    }
    default: {
      return Effect.fail(stepUpInternalError());
    }
  }
};

const mapRateLimitError = (error: RateLimitError | PrivacyError) =>
  error._tag === "RateLimitExceededError"
    ? new AuthRateLimitedError({
        code: "rate_limited",
        message: "Too many step-up attempts",
        retryAfter: error.retryAfter,
      })
    : stepUpInternalError();

/** Application policy adapter for password and purpose-bound passkey step-up. */
export const ApplicationStepUpHttpOperationsLayer = Layer.effect(
  StepUpHttpOperations,
  Effect.gen(function* () {
    const authenticator = yield* RequestSessionAuthenticator;
    const authRateLimit = yield* AuthRateLimit;
    const clock = yield* SensitiveOperationStepUpClock;
    const credentials = yield* CredentialStore;
    const hasher = yield* PasswordHasher;
    const passkeyAuthentication = yield* PasskeyAuthentication;
    const sessionCookie = yield* SessionCookie;
    const sessions = yield* Sessions;

    const authenticate = (request: HttpServerRequest.HttpServerRequest) =>
      HttpServerRequest.toWeb(request).pipe(
        Effect.mapError(stepUpInternalError),
        Effect.flatMap(authenticator.authenticate)
      );
    const requireRateLimit = (
      operation:
        | "auth.step_up.options"
        | "auth.step_up.passkey_start"
        | "auth.step_up.passkey_verify"
        | "auth.step_up.password_verify",
      userId: Parameters<typeof credentials.findPasswordByUserId>[0]
    ) =>
      authRateLimit
        .require({ operation, userId })
        .pipe(Effect.mapError(mapRateLimitError));
    const unavailable = () => Effect.fail(stepUpUnavailable());
    const requireUnrestricted = (session: {
      readonly claims?: { readonly requirements?: readonly string[] };
    }) =>
      (session.claims?.requirements?.length ?? 0) === 0
        ? Effect.void
        : Effect.fail(stepUpRestricted());

    return StepUpHttpOperations.of({
      options: ({ request }) =>
        Effect.gen(function* () {
          const authenticated = yield* authenticate(request);
          yield* requireUnrestricted(authenticated.session);
          const { userId } = authenticated.session;
          yield* requireRateLimit("auth.step_up.options", userId);
          const credential = yield* credentials
            .findPasswordByUserId(userId)
            .pipe(Effect.mapError(stepUpInternalError));
          const passkeyAvailable =
            yield* passkeyAuthentication.stepUpAvailable.pipe(
              Effect.provideService(
                CurrentRequestAuth,
                authenticated.requestAuth
              ),
              Effect.provideService(CurrentPrincipal, authenticated.principal),
              Effect.catchTag("PasskeyAuthenticationError", (error) =>
                error.reason === "storage"
                  ? Effect.fail(stepUpInternalError())
                  : Effect.succeed(false)
              )
            );

          return {
            factors: [
              ...(Option.isSome(credential) &&
              credential.value.revokedAt === undefined
                ? ([{ type: "password" }] as const)
                : []),
              ...(passkeyAvailable ? ([{ type: "passkey" }] as const) : []),
            ],
          };
        }),
      startPasskey: ({ request }) =>
        Effect.gen(function* () {
          const authenticated = yield* authenticate(request);
          yield* requireUnrestricted(authenticated.session);
          yield* requireRateLimit(
            "auth.step_up.passkey_start",
            authenticated.session.userId
          );
          return yield* passkeyAuthentication
            .startStepUp({})
            .pipe(
              Effect.provideService(
                CurrentRequestAuth,
                authenticated.requestAuth
              ),
              Effect.provideService(CurrentPrincipal, authenticated.principal),
              Effect.catchTag("PasskeyAuthenticationError", mapPasskeyError)
            );
        }),
      verifyPasskey: ({ payload, request }) =>
        Effect.gen(function* () {
          const authenticated = yield* authenticate(request);
          yield* requireUnrestricted(authenticated.session);
          yield* requireRateLimit(
            "auth.step_up.passkey_verify",
            authenticated.session.userId
          );
          const issued = yield* passkeyAuthentication
            .finishStepUp({
              challengeId: payload.challengeId,
              credential: payload.credential,
            })
            .pipe(
              Effect.provideService(
                CurrentRequestAuth,
                authenticated.requestAuth
              ),
              Effect.provideService(CurrentPrincipal, authenticated.principal),
              Effect.catchTag("PasskeyAuthenticationError", mapPasskeyError)
            );
          const cookie = yield* sessionCookie
            .commit(issued)
            .pipe(Effect.mapError(stepUpInternalError));
          return yield* HttpServerResponse.json(
            stepUpAuthenticatedHttpBody(issued),
            {
              headers: { "set-cookie": cookie },
              status: 200,
            }
          ).pipe(Effect.mapError(stepUpInternalError));
        }),
      verifyPassword: ({ payload, request }) =>
        Effect.gen(function* () {
          const authenticated = yield* authenticate(request);
          yield* requireUnrestricted(authenticated.session);
          const { userId } = authenticated.session;
          yield* requireRateLimit("auth.step_up.password_verify", userId);
          const credential = yield* credentials
            .findPasswordByUserId(userId)
            .pipe(Effect.mapError(stepUpInternalError));
          if (
            Option.isNone(credential) ||
            credential.value.revokedAt !== undefined
          ) {
            return yield* new AuthInvalidCredentialsError({
              code: "invalid_credentials",
              message: "Invalid credentials",
            });
          }

          const verified = yield* hasher
            .verify({
              hash: credential.value.passwordHash,
              password: Redacted.make(payload.password),
            })
            .pipe(Effect.mapError(stepUpInternalError));
          if (!verified) {
            return yield* new AuthInvalidCredentialsError({
              code: "invalid_credentials",
              message: "Invalid credentials",
            });
          }

          const verifiedAt = yield* Schema.decodeUnknownEffect(
            StepUpVerifiedAt
          )(clock.now()).pipe(Effect.mapError(stepUpInternalError));
          const issued = yield* sessions
            .assureAndRotate({
              evidence: passwordEvidence({
                credentialId: credential.value.id,
                verifiedAt,
              }),
              reason: "step_up",
              token: authenticated.requestAuth.validated.issued.token,
            })
            .pipe(Effect.mapError(stepUpInternalError));
          const cookie = yield* sessionCookie
            .commit(issued)
            .pipe(Effect.mapError(stepUpInternalError));

          return yield* HttpServerResponse.json(
            stepUpAuthenticatedHttpBody(issued),
            {
              headers: { "set-cookie": cookie },
              status: 200,
            }
          ).pipe(Effect.mapError(stepUpInternalError));
        }),
      verifyRecoveryCode: unavailable,
      verifyTotp: unavailable,
    });
  })
);

/** Thin transport binding for the application step-up operations. */
export const StepUpApiLayer = HttpApiBuilder.group(
  ApplicationAuthHttpApi,
  "stepUp",
  Effect.fn("auth.http.step_up.password_group")(function* (handlers) {
    const operations = yield* StepUpHttpOperations;

    return handlers
      .handle("options", operations.options)
      .handle("verifyPassword", operations.verifyPassword)
      .handle("verifyTotp", operations.verifyTotp)
      .handle("verifyRecoveryCode", operations.verifyRecoveryCode)
      .handle("startPasskey", operations.startPasskey)
      .handle("verifyPasskey", operations.verifyPasskey);
  })
);
