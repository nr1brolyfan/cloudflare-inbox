/* oxlint-disable max-classes-per-file -- The denial marker and three cohesive service decorators share one boundary. */
import { EmailOtpLogin, EmailOtpStartError } from "@effect-auth/core/EmailOtp";
import {
  EmailVerificationCode,
  EmailVerificationCodeStartError,
} from "@effect-auth/core/EmailVerificationCode";
import {
  MagicLinkLogin,
  MagicLinkStartError,
} from "@effect-auth/core/MagicLink";
import { IdentityStore } from "@effect-auth/core/Storage";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { RecoverySafeIdentityRejected } from "#/modules/account-security/domain/RecoverySafeIdentityError";
import type { RecoverySafeIdentityPolicyShape } from "#/modules/account-security/ports/RecoverySafeIdentityPolicy";
import { RecoverySafeIdentityPolicy } from "#/modules/account-security/ports/RecoverySafeIdentityPolicy";
import { EmailAddress } from "#/shared/EmailAddress";

export class RecoverySafeEmailInitiationDenied extends Data.TaggedError(
  "RecoverySafeEmailInitiationDenied"
) {}

export const isRecoverySafeEmailInitiationDenied = (error: unknown): boolean =>
  error instanceof RecoverySafeEmailInitiationDenied ||
  (typeof error === "object" &&
    error !== null &&
    "cause" in error &&
    error.cause instanceof RecoverySafeEmailInitiationDenied);

const denied = () => new RecoverySafeEmailInitiationDenied();

const sanitizePolicyError = (
  error: RecoverySafeIdentityRejected | RecoverySafeEmailInitiationDenied
) =>
  error instanceof RecoverySafeEmailInitiationDenied ||
  error.reason === "storage"
    ? error
    : denied();

const requireSafeLoginAddress = (
  policy: RecoverySafeIdentityPolicyShape,
  value: string
) =>
  Schema.decodeUnknownEffect(EmailAddress)(value).pipe(
    Effect.mapError(denied),
    Effect.flatMap((address) =>
      policy.requireSafeAddress({
        address,
        purpose: "login-email-initiation",
      })
    ),
    Effect.mapError(sanitizePolicyError)
  );

const initiationMessage = (
  cause: RecoverySafeIdentityRejected | RecoverySafeEmailInitiationDenied
) =>
  cause instanceof RecoverySafeEmailInitiationDenied
    ? "Email initiation denied"
    : "Failed to evaluate email initiation policy";

/** Enforces recovery-safe destinations before generic effect-auth email starts. */
export const RecoverySafeEmailInitiationEffectAuthLayer = Layer.mergeAll(
  Layer.effect(
    EmailOtpLogin,
    Effect.gen(function* () {
      const policy = yield* RecoverySafeIdentityPolicy;
      const emailOtp = yield* EmailOtpLogin;

      return EmailOtpLogin.of({
        start: (input) =>
          requireSafeLoginAddress(policy, input.identity.value).pipe(
            Effect.mapError(
              (cause) =>
                new EmailOtpStartError({
                  cause,
                  message: initiationMessage(cause),
                })
            ),
            Effect.flatMap(() => emailOtp.start(input))
          ),
        verify: emailOtp.verify,
      });
    })
  ),
  Layer.effect(
    MagicLinkLogin,
    Effect.gen(function* () {
      const policy = yield* RecoverySafeIdentityPolicy;
      const magicLink = yield* MagicLinkLogin;

      return MagicLinkLogin.of({
        start: (input) =>
          requireSafeLoginAddress(policy, input.identity.value).pipe(
            Effect.mapError(
              (cause) =>
                new MagicLinkStartError({
                  cause,
                  message: initiationMessage(cause),
                })
            ),
            Effect.flatMap(() => magicLink.start(input))
          ),
        verify: magicLink.verify,
      });
    })
  ),
  Layer.effect(
    EmailVerificationCode,
    Effect.gen(function* () {
      const policy = yield* RecoverySafeIdentityPolicy;
      const identities = yield* IdentityStore;
      const verification = yield* EmailVerificationCode;

      return EmailVerificationCode.of({
        start: (input) =>
          Effect.gen(function* () {
            const identity = yield* identities.findById(input.identityId).pipe(
              Effect.mapError(
                (cause) =>
                  new EmailVerificationCodeStartError({
                    cause,
                    message: "Failed to resolve email verification identity",
                  })
              )
            );
            if (
              Option.isNone(identity) ||
              identity.value.kind !== "email" ||
              identity.value.revokedAt !== undefined
            ) {
              return yield* new EmailVerificationCodeStartError({
                cause: denied(),
                message: "Email initiation denied",
              });
            }
            yield* requireSafeLoginAddress(
              policy,
              identity.value.normalizedValue
            ).pipe(
              Effect.mapError(
                (cause) =>
                  new EmailVerificationCodeStartError({
                    cause,
                    message: initiationMessage(cause),
                  })
              )
            );
            return yield* verification.start(input);
          }),
        verify: verification.verify,
      });
    })
  )
);
