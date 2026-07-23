import type { ChallengeId, UserIdSchema } from "@effect-auth/core/Identifiers";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Redacted from "effect/Redacted";
import type * as Schema from "effect/Schema";

import type {
  ExternalRecoveryChallengeSecret,
  ExternalRecoveryIdentityManagementError,
} from "#/modules/account-security/application/ExternalRecoveryIdentityManagement";

export interface IssuedExternalRecoveryChallenge {
  readonly challengeId: ChallengeId;
  readonly expiresAt: number;
  readonly secret: Redacted.Redacted<ExternalRecoveryChallengeSecret>;
}

export interface ExternalRecoveryIdentityChallengeShape {
  readonly consume: (challengeId: ChallengeId) => Effect.Effect<void>;
  readonly inspect: (input: {
    readonly challengeId: ChallengeId;
    readonly identityId: string;
    readonly secret: ExternalRecoveryChallengeSecret;
    readonly userId: Schema.Schema.Type<typeof UserIdSchema>;
  }) => Effect.Effect<void, ExternalRecoveryIdentityManagementError>;
  readonly issue: (input: {
    readonly identityId: string;
    readonly userId: Schema.Schema.Type<typeof UserIdSchema>;
  }) => Effect.Effect<
    IssuedExternalRecoveryChallenge,
    ExternalRecoveryIdentityManagementError
  >;
}

export class ExternalRecoveryIdentityChallenge extends Context.Service<
  ExternalRecoveryIdentityChallenge,
  ExternalRecoveryIdentityChallengeShape
>()("cloudflare-inbox/ExternalRecoveryIdentityChallenge") {}
