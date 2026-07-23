/* oxlint-disable max-classes-per-file -- Store error and port form one persistence boundary. */
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";

export class PasskeyAuthenticationIdentityStoreError extends Data.TaggedError(
  "PasskeyAuthenticationIdentityStoreError"
)<{ readonly cause: unknown }> {}

export interface PasskeyAuthenticationIdentity {
  readonly id: string;
  readonly kind: string;
  readonly value: string;
}

export interface PasskeyAuthenticationIdentityStoreShape {
  readonly eligible: (
    userId: string
  ) => Effect.Effect<boolean, PasskeyAuthenticationIdentityStoreError>;
  readonly verifiedIdentity: (
    userId: string
  ) => Effect.Effect<
    PasskeyAuthenticationIdentity | undefined,
    PasskeyAuthenticationIdentityStoreError
  >;
}

/** Identity projections required by passkey authentication. */
export class PasskeyAuthenticationIdentityStore extends Context.Service<
  PasskeyAuthenticationIdentityStore,
  PasskeyAuthenticationIdentityStoreShape
>()("cloudflare-inbox/PasskeyAuthenticationIdentityStore") {}
