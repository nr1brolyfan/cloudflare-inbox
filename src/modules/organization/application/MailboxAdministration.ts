/* oxlint-disable max-classes-per-file -- Administration error and service form one cohesive use case. */
import type * as AuthPermission from "@effect-auth/core/Permission";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { CurrentRequestAuthShape } from "#/auth/session";
import type { MailAuthorizationError } from "#/authorization/mail-authorization";
import {
  AdministrativeOperationId,
  MailboxDisplayName,
  MailboxId,
  Version,
} from "#/modules/mailbox/domain/Mailbox";
import type { MailboxRecord } from "#/modules/mailbox/domain/Mailbox";
import type { BackendRequestContext } from "#/observability/request-context";

export const BootstrapOwnerMailboxCommand = Schema.Struct({
  displayName: MailboxDisplayName,
  operationId: AdministrativeOperationId,
});
export type BootstrapOwnerMailboxCommand = Schema.Schema.Type<
  typeof BootstrapOwnerMailboxCommand
>;

export const RenameMailboxCommand = Schema.Struct({
  displayName: MailboxDisplayName,
  expectedVersion: Version,
  mailboxId: MailboxId,
  operationId: AdministrativeOperationId,
});
export type RenameMailboxCommand = Schema.Schema.Type<
  typeof RenameMailboxCommand
>;

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
  readonly operation: "bootstrap-owner" | "rename";
  readonly permission?: AuthPermission.PermissionId;
  readonly reason:
    | "authorization-recheck"
    | "conflict"
    | "invalid-input"
    | "not-found"
    | "owner-not-eligible"
    | "session-recheck"
    | "step-up-required"
    | "storage";
  readonly scope?: AuthPermission.PermissionScope;
}> {}

export interface MailboxAdministrationService {
  // Trusted auth and authorization capabilities are application dependencies;
  // HTTP middleware is only one adapter that supplies them.
  readonly bootstrapOwner: (
    input: BootstrapOwnerMailboxCommand
  ) => Effect.Effect<
    MailboxRecord,
    MailboxAdministrationError,
    | AuthPermission.CurrentPrincipal
    | BackendRequestContext
    | CurrentRequestAuthShape
  >;
  readonly rename: (
    input: RenameMailboxCommand
  ) => Effect.Effect<
    MailboxRecord,
    MailAuthorizationError | MailboxAdministrationError,
    | AuthPermission.CurrentPrincipal
    | BackendRequestContext
    | CurrentRequestAuthShape
  >;
}

/** Transactional mailbox writes with in-transaction session and permission checks. */
export class MailboxAdministration extends Context.Service<
  MailboxAdministration,
  MailboxAdministrationService
>()("cloudflare-inbox/MailboxAdministration") {}
