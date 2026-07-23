/* oxlint-disable max-classes-per-file -- Recovery-code command, result, error, and service form one security boundary. */
import type * as AuthPermission from "@effect-auth/core/Permission";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { RecoveryCodeAdministrationTransaction } from "#/modules/account-security/ports/RecoveryCodeAdministrationTransaction";
import type { CurrentRequestAuth } from "#/shared/RequestAuth";
import { UnixMillis } from "#/shared/Temporal";

import type { AccountSecurityCommitState } from "./AccountSecurityCommitState";

export const GenerateRecoveryCodesCommand = Schema.Struct({});

export const RecoveryCodeText = Schema.Trimmed.pipe(
  Schema.check(
    Schema.makeFilter((value) =>
      /^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){3}$/u.test(value)
        ? undefined
        : "must be a grouped 16-symbol recovery code"
    )
  )
);

export class GeneratedRecoveryCodeSet extends Schema.Class<GeneratedRecoveryCodeSet>(
  "cloudflare-inbox/GeneratedRecoveryCodeSet"
)({
  codes: Schema.Array(RecoveryCodeText).pipe(
    Schema.check(
      Schema.makeFilter((codes) =>
        codes.length === 10 ? undefined : "must contain exactly 10 codes"
      )
    )
  ),
  generatedAt: UnixMillis,
}) {}

export class RecoveryCodeAdministrationError extends Data.TaggedError(
  "RecoveryCodeAdministrationError"
)<{
  readonly cause?: unknown;
  readonly commitState?: AccountSecurityCommitState;
  readonly operation: "generate";
  readonly reason:
    | "invalid-input"
    | "indeterminate"
    | "rate-limited"
    | "recovery-identity-required"
    | "restricted-session"
    | "step-up-required"
    | "storage"
    | "unauthenticated";
}> {}

type RequestEnvironment = AuthPermission.CurrentPrincipal | CurrentRequestAuth;

export interface RecoveryCodeAdministrationService {
  readonly generate: (
    command: Schema.Schema.Type<typeof GenerateRecoveryCodesCommand>
  ) => Effect.Effect<
    GeneratedRecoveryCodeSet,
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
