/* oxlint-disable max-classes-per-file -- Administration error and service form one cohesive use case. */
import { UserIdSchema } from "@effect-auth/core/Identifiers";
import type * as AuthPermission from "@effect-auth/core/Permission";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { MailboxId } from "#/modules/mailbox/domain/Mailbox";
import type { MailboxAuthorizationError } from "#/modules/mailbox/ports/MailboxAuthorization";
import {
  MailboxDisplayName,
  MailboxRecordSchema,
} from "#/modules/organization/domain/Mailbox";
import type { MailboxRecord } from "#/modules/organization/domain/Mailbox";
import { MailboxAdministrationTransaction } from "#/modules/organization/ports/MailboxAdministrationTransaction";
import { NormalizedEmailAddress } from "#/shared/EmailAddress";
import { AdministrativeOperationId } from "#/shared/Operation";
import type { CurrentRequestAuth } from "#/shared/RequestAuth";
import type { RequestCorrelation } from "#/shared/RequestCorrelation";
import { UnixMillis, Version } from "#/shared/Temporal";

export const RenameMailboxCommand = Schema.Struct({
  displayName: MailboxDisplayName,
  expectedVersion: Version,
  mailboxId: MailboxId,
  operationId: AdministrativeOperationId,
});
export type RenameMailboxCommand = Schema.Schema.Type<
  typeof RenameMailboxCommand
>;

export const ReadMailboxAdministrationOperationQuery = Schema.Struct({
  operationId: AdministrativeOperationId,
});
export type ReadMailboxAdministrationOperationQuery = Schema.Schema.Type<
  typeof ReadMailboxAdministrationOperationQuery
>;

export class MailboxAdministrationReceipt extends Schema.Class<MailboxAdministrationReceipt>(
  "cloudflare-inbox/MailboxAdministrationReceipt"
)({
  actorUserId: UserIdSchema,
  committedAt: UnixMillis,
  displayName: MailboxDisplayName,
  expectedVersion: Schema.optional(Version),
  initialAddress: Schema.optional(NormalizedEmailAddress),
  mailboxId: MailboxId,
  operationId: AdministrativeOperationId,
  operationKind: Schema.Literals(["bootstrap-owner", "rename"]),
  result: MailboxRecordSchema,
  schemaVersion: Schema.Literals([1, 2]),
}) {}

export const MailboxAdministrationReceiptSchema =
  MailboxAdministrationReceipt.check(
    Schema.makeFilter((receipt) => {
      const operationValid =
        receipt.operationKind === "bootstrap-owner"
          ? receipt.expectedVersion === undefined &&
            ((receipt.schemaVersion === 1 &&
              receipt.initialAddress === undefined) ||
              (receipt.schemaVersion === 2 &&
                receipt.initialAddress !== undefined)) &&
            receipt.result.version === 1 &&
            receipt.actorUserId === receipt.result.createdByUserId &&
            receipt.result.createdAt === receipt.result.updatedAt &&
            receipt.committedAt === receipt.result.createdAt
          : receipt.expectedVersion !== undefined &&
            receipt.schemaVersion === 1 &&
            receipt.initialAddress === undefined;
      return operationValid &&
        receipt.result.id === receipt.mailboxId &&
        receipt.result.displayName === receipt.displayName &&
        receipt.result.updatedAt === receipt.committedAt
        ? undefined
        : "mailbox administration receipt intent and result must agree";
    })
  );

/** Whether a failed administration write may have reached durable storage. */
export type MailboxAdministrationCommitState =
  | "not-committed"
  | "committed"
  | "unknown";

export class MailboxAdministrationError extends Data.TaggedError(
  "MailboxAdministrationError"
)<{
  readonly cause?: unknown;
  readonly commitState?: MailboxAdministrationCommitState;
  readonly message: string;
  readonly operation: "bootstrap-owner" | "read-operation" | "rename";
  readonly permission?: AuthPermission.PermissionId;
  readonly reason:
    | "authorization-recheck"
    | "conflict"
    | "invalid-input"
    | "not-found"
    | "operation-conflict"
    | "owner-not-eligible"
    | "session-recheck"
    | "step-up-required"
    | "storage";
  readonly scope?: AuthPermission.PermissionScope;
}> {}

export interface MailboxAdministrationService {
  readonly rename: (
    input: RenameMailboxCommand
  ) => Effect.Effect<
    MailboxRecord,
    MailboxAuthorizationError | MailboxAdministrationError,
    AuthPermission.CurrentPrincipal | CurrentRequestAuth | RequestCorrelation
  >;
  readonly readOperation: (
    input: ReadMailboxAdministrationOperationQuery
  ) => Effect.Effect<
    MailboxAdministrationReceipt,
    MailboxAdministrationError,
    AuthPermission.CurrentPrincipal | CurrentRequestAuth | RequestCorrelation
  >;
}

/** Transactional mailbox writes with in-transaction session and permission checks. */
export class MailboxAdministration extends Context.Service<
  MailboxAdministration,
  MailboxAdministrationService
>()("cloudflare-inbox/MailboxAdministration", {
  make: Effect.gen(function* () {
    return yield* MailboxAdministrationTransaction;
  }),
}) {
  static readonly layerNoDeps = Layer.effect(this, this.make);
}
