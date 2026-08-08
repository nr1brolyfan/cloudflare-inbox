import * as Data from "effect/Data";

import type { Version } from "#/shared/Temporal";

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
    | "search-messages"
    | "search-contacts"
    | "get-contact"
    | "save-contact"
    | "remove-contact"
    | "get-attachment"
    | "get-message"
    | "get-thread"
    | "mutate-message"
    | "create-draft"
    | "create-reply-draft"
    | "list-drafts"
    | "get-draft"
    | "update-draft"
    | "reserve-draft-attachment"
    | "get-draft-attachment"
    | "list-draft-attachments"
    | "complete-draft-attachment"
    | "schedule-outbound"
    | "get-outbound"
    | "cancel-outbound"
    | "resend-outbound"
    | "record-inbound"
    | "commit-inbound"
    | "replay-inbound";
  readonly reason:
    | "validation"
    | "message-too-large"
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
    | "attachment"
    | "thread"
    | "draft"
    | "inbound"
    | "outbound"
    | "contact";
  readonly resourceId?: string;
  readonly expectedVersion?: Version;
  readonly actualVersion?: Version;
}> {}
