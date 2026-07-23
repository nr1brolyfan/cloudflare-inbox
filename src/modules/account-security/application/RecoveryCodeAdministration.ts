import { UserIdSchema } from "@effect-auth/core/Identifiers";
/* oxlint-disable max-classes-per-file -- Recovery-code command, result, error, and service form one security boundary. */
import type * as AuthPermission from "@effect-auth/core/Permission";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { RecoveryCodeAdministrationTransaction } from "#/modules/account-security/ports/RecoveryCodeAdministrationTransaction";
import { AdministrativeOperationId } from "#/shared/Operation";
import type { CurrentRequestAuth } from "#/shared/RequestAuth";
import { UnixMillis } from "#/shared/Temporal";

import type { AccountSecurityCommitState } from "./AccountSecurityCommitState";

export const GenerateRecoveryCodesCommand = Schema.Struct({
  operationId: AdministrativeOperationId,
});
export type GenerateRecoveryCodesCommand = Schema.Schema.Type<
  typeof GenerateRecoveryCodesCommand
>;

export const ReadRecoveryCodeRotationQuery = Schema.Struct({
  operationId: AdministrativeOperationId,
});
export type ReadRecoveryCodeRotationQuery = Schema.Schema.Type<
  typeof ReadRecoveryCodeRotationQuery
>;

export const RecoveryCodeSetId = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    )
  ),
  Schema.brand("cloudflare-inbox/RecoveryCodeSetId")
);
export type RecoveryCodeSetId = Schema.Schema.Type<typeof RecoveryCodeSetId>;

export const RecoveryCodeText = Schema.Trimmed.pipe(
  Schema.check(
    Schema.makeFilter((value) =>
      /^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){3}$/u.test(value)
        ? undefined
        : "must be a grouped 16-symbol recovery code"
    )
  )
);

export class RecoveryCodeRotationReceipt extends Schema.Class<RecoveryCodeRotationReceipt>(
  "cloudflare-inbox/RecoveryCodeRotationReceipt"
)({
  codeCount: Schema.Literal(10),
  committedAt: UnixMillis,
  expectedPreviousSetId: Schema.optional(RecoveryCodeSetId),
  generatedAt: UnixMillis,
  operationId: AdministrativeOperationId,
  schemaVersion: Schema.Literal(1),
  setId: RecoveryCodeSetId,
  userId: UserIdSchema,
}) {}

export const RecoveryCodeRotationReceiptSchema =
  RecoveryCodeRotationReceipt.check(
    Schema.makeFilter((receipt) =>
      receipt.committedAt >= receipt.generatedAt &&
      receipt.expectedPreviousSetId !== receipt.setId
        ? undefined
        : "recovery-code rotation receipt state and result must agree"
    )
  );

export class RecoveryCodesGenerated extends Schema.Class<RecoveryCodesGenerated>(
  "cloudflare-inbox/RecoveryCodesGenerated"
)({
  _tag: Schema.Literal("RecoveryCodesGenerated"),
  codes: Schema.Array(RecoveryCodeText).pipe(
    Schema.check(
      Schema.makeFilter((codes) =>
        codes.length === 10 ? undefined : "must contain exactly 10 codes"
      )
    )
  ),
  receipt: RecoveryCodeRotationReceiptSchema,
}) {}

export class RecoveryCodesAlreadyGenerated extends Schema.Class<RecoveryCodesAlreadyGenerated>(
  "cloudflare-inbox/RecoveryCodesAlreadyGenerated"
)({
  _tag: Schema.Literal("RecoveryCodesAlreadyGenerated"),
  receipt: RecoveryCodeRotationReceiptSchema,
}) {}

export const GenerateRecoveryCodesResult = Schema.Union([
  RecoveryCodesGenerated,
  RecoveryCodesAlreadyGenerated,
]);
export type GenerateRecoveryCodesResult = Schema.Schema.Type<
  typeof GenerateRecoveryCodesResult
>;

export class RecoveryCodeAdministrationError extends Data.TaggedError(
  "RecoveryCodeAdministrationError"
)<{
  readonly cause?: unknown;
  readonly commitState?: AccountSecurityCommitState;
  readonly operation: "generate" | "read-operation";
  readonly reason:
    | "invalid-input"
    | "indeterminate"
    | "not-found"
    | "operation-conflict"
    | "rate-limited"
    | "recovery-identity-required"
    | "restricted-session"
    | "step-up-required"
    | "state-conflict"
    | "storage"
    | "unauthenticated";
}> {}

type RequestEnvironment = AuthPermission.CurrentPrincipal | CurrentRequestAuth;

export interface RecoveryCodeAdministrationService {
  readonly generate: (
    command: GenerateRecoveryCodesCommand
  ) => Effect.Effect<
    GenerateRecoveryCodesResult,
    RecoveryCodeAdministrationError,
    RequestEnvironment
  >;
  readonly readOperation: (
    query: ReadRecoveryCodeRotationQuery
  ) => Effect.Effect<
    RecoveryCodeRotationReceipt,
    RecoveryCodeAdministrationError,
    RequestEnvironment
  >;
}

export class RecoveryCodeAdministration extends Context.Service<
  RecoveryCodeAdministration,
  RecoveryCodeAdministrationService
>()("cloudflare-inbox/RecoveryCodeAdministration", {
  make: Effect.gen(function* () {
    return yield* RecoveryCodeAdministrationTransaction;
  }),
}) {
  static readonly layerNoDeps = Layer.effect(this, this.make);
}
