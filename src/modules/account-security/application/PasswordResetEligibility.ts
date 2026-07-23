/* oxlint-disable max-classes-per-file -- Eligibility error and service form one cohesive use case. */
import type { UserId } from "@effect-auth/core/Identifiers";
import type { LoginIdentityInput } from "@effect-auth/core/Identity";
import { IdentityKindRegistry } from "@effect-auth/core/Identity";
import { CredentialStore, IdentityStore } from "@effect-auth/core/Storage";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

export class PasswordResetEligibilityError extends Data.TaggedError(
  "PasswordResetEligibilityError"
)<{
  readonly cause: unknown;
}> {}

export interface PasswordResetEligibilityShape {
  readonly hasActivePassword: (
    identity: LoginIdentityInput
  ) => Effect.Effect<boolean, PasswordResetEligibilityError>;
  readonly hasActivePasswordForUserId: (
    userId: UserId
  ) => Effect.Effect<boolean, PasswordResetEligibilityError>;
}

const makePasswordResetEligibility = Effect.gen(function* () {
  const credentials = yield* CredentialStore;
  const identities = yield* IdentityStore;
  const identityKinds = yield* IdentityKindRegistry;
  const hasActivePasswordForUserId = (userId: UserId) =>
    credentials.findPasswordByUserId(userId).pipe(
      Effect.mapError((cause) => new PasswordResetEligibilityError({ cause })),
      Effect.map(
        (credential) =>
          Option.isSome(credential) && credential.value.revokedAt === undefined
      )
    );

  return {
    hasActivePassword: (input) =>
      Effect.gen(function* () {
        const normalized = yield* identityKinds
          .normalize(input)
          .pipe(Effect.option);
        if (Option.isNone(normalized)) {
          return false;
        }
        const identity = yield* identities
          .findByKindAndNormalizedValue(normalized.value)
          .pipe(
            Effect.mapError(
              (cause) => new PasswordResetEligibilityError({ cause })
            )
          );
        if (Option.isNone(identity)) {
          return false;
        }
        return yield* hasActivePasswordForUserId(identity.value.userId);
      }),
    hasActivePasswordForUserId,
  } satisfies PasswordResetEligibilityShape;
});

/** Keeps password reset from becoming an implicit first-factor enrollment. */
export class PasswordResetEligibility extends Context.Service<
  PasswordResetEligibility,
  PasswordResetEligibilityShape
>()("cloudflare-inbox/PasswordResetEligibility") {
  static readonly layerNoDeps = Layer.effect(
    this,
    makePasswordResetEligibility
  );
}
