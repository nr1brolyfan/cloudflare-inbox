import type * as AuthPermission from "@effect-auth/core/Permission";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { CurrentRequestAuthShape } from "../auth/session";
import type {
  MailAuthorization,
  MailAuthorizationError,
} from "../authorization/mail-authorization";
import { MailboxDisplayName, MailboxId } from "./core";
import type { MailboxRecord } from "./core";

export const BootstrapOwnerMailboxCommand = Schema.Struct({
  displayName: MailboxDisplayName,
});
export type BootstrapOwnerMailboxCommand = Schema.Schema.Type<
  typeof BootstrapOwnerMailboxCommand
>;

export const RenameMailboxCommand = Schema.Struct({
  displayName: MailboxDisplayName,
  mailboxId: MailboxId,
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
    | "storage";
  readonly scope?: AuthPermission.PermissionScope;
}> {}

export interface MailboxAdministration {
  // Trusted auth and authorization capabilities are application dependencies;
  // HTTP middleware is only one adapter that supplies them.
  readonly bootstrapOwner: (
    input: BootstrapOwnerMailboxCommand
  ) => Effect.Effect<
    MailboxRecord,
    MailboxAdministrationError,
    CurrentRequestAuthShape
  >;
  readonly rename: (
    input: RenameMailboxCommand
  ) => Effect.Effect<
    MailboxRecord,
    MailAuthorizationError | MailboxAdministrationError,
    | AuthPermission.CurrentPrincipal
    | CurrentRequestAuthShape
    | MailAuthorization
  >;
}

/** Transactional mailbox writes with in-transaction session and permission checks. */
export const MailboxAdministration = Context.Service<MailboxAdministration>(
  "cloudflare-inbox/MailboxAdministration"
);
