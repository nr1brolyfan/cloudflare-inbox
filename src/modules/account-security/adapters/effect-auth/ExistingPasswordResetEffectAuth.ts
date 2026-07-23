import { Challenge } from "@effect-auth/core/Challenge";
import {
  EmailSchema,
  UnixMillisSchema,
  UserIdSchema,
} from "@effect-auth/core/Identifiers";
import {
  PasswordReset,
  PasswordResetStartError,
  PasswordResetVerifyError,
} from "@effect-auth/core/Password";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { PasswordResetEligibility } from "#/modules/account-security/application/PasswordResetEligibility";

/** Refuses legacy or raced reset challenges that would create a first password. */
export const ExistingPasswordResetEffectAuthLayer = Layer.effect(
  PasswordReset,
  Effect.gen(function* () {
    const challenge = yield* Challenge;
    const eligibility = yield* PasswordResetEligibility;
    const passwordReset = yield* PasswordReset;

    return PasswordReset.of({
      start: (input) =>
        Effect.gen(function* () {
          const eligible = yield* eligibility
            .hasActivePassword(input.identity)
            .pipe(
              Effect.mapError(
                (cause) =>
                  new PasswordResetStartError({
                    cause,
                    message: "Failed to verify password reset eligibility",
                  })
              )
            );
          if (eligible) {
            return yield* passwordReset.start(input);
          }
          const email = yield* Schema.decodeUnknownEffect(EmailSchema)(
            input.identity.value
          ).pipe(
            Effect.mapError(
              (cause) =>
                new PasswordResetStartError({
                  cause,
                  message: "Invalid password reset identity",
                })
            )
          );
          const expiresAt = yield* Schema.decodeUnknownEffect(UnixMillisSchema)(
            0
          ).pipe(
            Effect.mapError(
              (cause) =>
                new PasswordResetStartError({
                  cause,
                  message: "Invalid password reset suppression result",
                })
            )
          );
          return { email, expiresAt };
        }),
      verify: (input) =>
        Effect.gen(function* () {
          const inspected = yield* challenge
            .inspect({
              challengeId: input.challengeId,
              secret: input.secret,
              type: "reset-password",
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new PasswordResetVerifyError({
                    cause,
                    message: "Invalid password reset challenge",
                  })
              )
            );
          const userId = yield* Schema.decodeUnknownEffect(UserIdSchema)(
            inspected.metadata?.userId
          ).pipe(
            Effect.mapError(
              (cause) =>
                new PasswordResetVerifyError({
                  cause,
                  message: "Invalid password reset challenge",
                })
            )
          );
          const eligible = yield* eligibility
            .hasActivePasswordForUserId(userId)
            .pipe(
              Effect.mapError(
                (cause) =>
                  new PasswordResetVerifyError({
                    cause,
                    message: "Failed to verify password reset eligibility",
                  })
              )
            );
          if (!eligible) {
            return yield* new PasswordResetVerifyError({
              message: "Invalid password reset challenge",
            });
          }
          // CredentialStore has no delete operation; password rows are revoked in place.
          return yield* passwordReset.verify(input);
        }),
    });
  })
);
