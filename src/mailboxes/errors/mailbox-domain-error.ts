import * as Data from "effect/Data";

import type { Version } from "../primitives";

export class MailboxDomainError extends Data.TaggedError("MailboxDomainError")<{
  readonly operation:
    | "create-address"
    | "set-address-enabled"
    | "set-primary-address"
    | "create-folder"
    | "list-folders"
    | "rename-folder"
    | "delete-folder"
    | "create-label"
    | "list-labels"
    | "rename-label"
    | "delete-label"
    | "list-messages"
    | "get-message"
    | "get-thread"
    | "mutate-message"
    | "create-draft"
    | "get-draft"
    | "update-draft"
    | "schedule-outbound"
    | "get-outbound"
    | "cancel-outbound"
    | "resend-outbound"
    | "replay-inbound";
  readonly reason:
    | "validation"
    | "not-found"
    | "version-conflict"
    | "idempotency-conflict"
    | "invalid-state"
    | "system-folder"
    | "folder-not-empty";
  readonly message: string;
  readonly resourceType?:
    | "mailbox"
    | "address"
    | "folder"
    | "label"
    | "message"
    | "thread"
    | "draft"
    | "inbound"
    | "outbound";
  readonly resourceId?: string;
  readonly expectedVersion?: Version;
  readonly actualVersion?: Version;
}> {}
