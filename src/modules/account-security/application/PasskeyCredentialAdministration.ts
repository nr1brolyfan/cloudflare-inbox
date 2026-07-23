/* oxlint-disable max-classes-per-file -- Passkey administration projections and its error form one port contract. */
import type * as AuthPermission from "@effect-auth/core/Permission";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { CurrentRequestAuth } from "#/modules/account-security/ports/CurrentRequestAuth";
import type { BackendRequestContext } from "#/observability/request-context";
import { AdministrativeOperationId } from "#/shared/Operation";
import { UnixMillis } from "#/shared/Temporal";

import type { AccountSecurityCommitState } from "./AccountSecurityCommitState";

export const PasskeyManagementId = Schema.Trimmed.pipe(
  Schema.check(Schema.isLengthBetween(1, 256)),
  Schema.brand("cloudflare-inbox/PasskeyManagementId")
);

export class PasskeyCredentialSummary extends Schema.Class<PasskeyCredentialSummary>(
  "cloudflare-inbox/PasskeyCredentialSummary"
)({
  createdAt: UnixMillis,
  id: PasskeyManagementId,
  lastUsedAt: Schema.optional(UnixMillis),
}) {}

export class RevokedPasskeyCredential extends Schema.Class<RevokedPasskeyCredential>(
  "cloudflare-inbox/RevokedPasskeyCredential"
)({
  createdAt: UnixMillis,
  id: PasskeyManagementId,
  lastUsedAt: Schema.optional(UnixMillis),
  revokedAt: UnixMillis,
}) {}

export class PasskeyRevocationReceipt extends Schema.Class<PasskeyRevocationReceipt>(
  "cloudflare-inbox/PasskeyRevocationReceipt"
)({
  credential: RevokedPasskeyCredential,
  operationId: AdministrativeOperationId,
}) {}

export const PasskeyCredentialList = Schema.Struct({
  credentials: Schema.Array(PasskeyCredentialSummary),
});
export const ListPasskeyCredentialsQuery = Schema.Struct({});
export const RevokePasskeyCredentialCommand = Schema.Struct({
  id: PasskeyManagementId,
  operationId: AdministrativeOperationId,
});
export const ReadPasskeyRevocationQuery = Schema.Struct({
  operationId: AdministrativeOperationId,
});

export class PasskeyCredentialAdministrationError extends Data.TaggedError(
  "PasskeyCredentialAdministrationError"
)<{
  readonly cause?: unknown;
  readonly commitState?: AccountSecurityCommitState;
  readonly operation: "list" | "read-revocation" | "revoke";
  readonly reason:
    | "credential-changed"
    | "invalid-input"
    | "last-factor"
    | "not-found"
    | "operation-conflict"
    | "rate-limited"
    | "recovery-identity-required"
    | "restricted-session"
    | "step-up-required"
    | "storage"
    | "unauthenticated";
}> {}

type RequestEnvironment =
  | AuthPermission.CurrentPrincipal
  | BackendRequestContext
  | CurrentRequestAuth;

export interface PasskeyCredentialAdministrationShape {
  readonly list: (
    query: Schema.Schema.Type<typeof ListPasskeyCredentialsQuery>
  ) => Effect.Effect<
    Schema.Schema.Type<typeof PasskeyCredentialList>,
    PasskeyCredentialAdministrationError,
    RequestEnvironment
  >;
  readonly readRevocation: (
    query: Schema.Schema.Type<typeof ReadPasskeyRevocationQuery>
  ) => Effect.Effect<
    PasskeyRevocationReceipt,
    PasskeyCredentialAdministrationError,
    RequestEnvironment
  >;
  readonly revoke: (
    command: Schema.Schema.Type<typeof RevokePasskeyCredentialCommand>
  ) => Effect.Effect<
    PasskeyRevocationReceipt,
    PasskeyCredentialAdministrationError,
    RequestEnvironment
  >;
}

export class PasskeyCredentialAdministration extends Context.Service<
  PasskeyCredentialAdministration,
  PasskeyCredentialAdministrationShape
>()("cloudflare-inbox/PasskeyCredentialAdministration") {}
