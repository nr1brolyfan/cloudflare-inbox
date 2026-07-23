import { AuthSecrets } from "@effect-auth/core/AuthConfig";
import { Challenge } from "@effect-auth/core/Challenge";
import { Crypto } from "@effect-auth/core/Crypto";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import {
  ExternalRecoveryChallengeSecret,
  ExternalRecoveryIdentityManagementError,
} from "#/modules/account-security/application/ExternalRecoveryIdentityManagement";
import { ExternalRecoveryIdentityChallenge } from "#/modules/account-security/ports/ExternalRecoveryIdentityChallenge";

export const EXTERNAL_RECOVERY_CHALLENGE_TYPE =
  "external-recovery-identity-verification";
export const EXTERNAL_RECOVERY_CHALLENGE_TTL = Duration.minutes(30);

const challengeError = (operation: "enroll" | "verify", cause: unknown) =>
  new ExternalRecoveryIdentityManagementError({
    cause,
    operation,
    reason: operation === "enroll" ? "storage" : "challenge-invalid",
  });

export const ExternalRecoveryIdentityChallengeEffectAuthLayer = Layer.effect(
  ExternalRecoveryIdentityChallenge,
  Effect.gen(function* () {
    const challenge = yield* Challenge;
    const crypto = yield* Crypto;
    const secrets = yield* AuthSecrets;

    return ExternalRecoveryIdentityChallenge.of({
      consume: (challengeId) =>
        challenge.consume(challengeId).pipe(Effect.ignore),
      hashSecret: (secret) =>
        crypto
          .hmacSha256({ data: secret, key: secrets.challenge })
          .pipe(Effect.mapError((cause) => challengeError("verify", cause))),
      inspect: ({ challengeId, identityId, secret, userId }) =>
        challenge
          .inspect({
            challengeId,
            secret: Redacted.make(secret),
            type: EXTERNAL_RECOVERY_CHALLENGE_TYPE,
          })
          .pipe(
            Effect.flatMap((inspected) =>
              inspected.subject === identityId &&
              inspected.metadata?.userId === userId
                ? Effect.void
                : Effect.fail(
                    challengeError("verify", "Challenge subject mismatch")
                  )
            ),
            Effect.mapError((cause) =>
              cause instanceof ExternalRecoveryIdentityManagementError
                ? cause
                : challengeError("verify", cause)
            )
          ),
      issue: ({ identityId, userId }) =>
        Effect.gen(function* () {
          const secret = yield* crypto.randomToken(32).pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(ExternalRecoveryChallengeSecret)
            ),
            Effect.mapError((cause) => challengeError("enroll", cause))
          );
          const issued = yield* challenge
            .issue({
              metadata: { userId },
              secret: Redacted.make(secret),
              subject: identityId,
              ttl: EXTERNAL_RECOVERY_CHALLENGE_TTL,
              type: EXTERNAL_RECOVERY_CHALLENGE_TYPE,
            })
            .pipe(Effect.mapError((cause) => challengeError("enroll", cause)));

          return {
            challengeId: issued.id,
            expiresAt: Number(issued.expiresAt),
            secret: Redacted.make(secret),
          };
        }),
    });
  })
);
