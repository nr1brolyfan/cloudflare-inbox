import * as Schema from "effect/Schema";

import type { MailboxId } from "./identifiers";
import {
  AttachmentLocation,
  DraftLocation,
  FolderLocation,
  MessageLocation,
  RuleLocation,
} from "./mailbox-repository";
import type {
  MailboxResourceLookup,
  MailboxResourceLookupResult,
} from "./mailbox-repository";
import type { MailboxSql, MailboxSqlStorage } from "./mailbox-sqlite";

const oneOrNotFound = <A>(rows: readonly A[]) =>
  rows.length === 0 ? undefined : rows[0];

/** Binds persistent mailbox storage to the canonical Durable Object name. */
export const initializeMailboxRepository = (
  storage: MailboxSqlStorage,
  mailboxId: MailboxId
) =>
  storage.transactionSync(() => {
    const rows = storage.sql
      .exec("SELECT mailbox_id FROM mailbox_metadata WHERE singleton = 1")
      .toArray();

    if (rows.length === 0) {
      storage.sql.exec(
        "INSERT INTO mailbox_metadata (singleton, mailbox_id) VALUES (1, ?)",
        mailboxId
      );
    } else if (rows.length !== 1 || rows[0]?.mailbox_id !== mailboxId) {
      throw new Error(
        "Mailbox database identity does not match its Durable Object"
      );
    }
  });

/** Resolves trusted ancestry directly from canonical mailbox tables. */
export const resolveMailboxResource = (
  sql: MailboxSql,
  lookup: MailboxResourceLookup
): MailboxResourceLookupResult => {
  switch (lookup._tag) {
    case "Folder": {
      const row = oneOrNotFound(
        sql
          .exec(
            `SELECT metadata.mailbox_id, folder.id AS folder_id
               FROM mailbox_metadata AS metadata
               CROSS JOIN folder
              WHERE metadata.singleton = 1
                AND folder.id = ?
                AND folder.deleted_at IS NULL`,
            lookup.folderId
          )
          .toArray()
      );
      return row === undefined
        ? { _tag: "NotFound" }
        : Schema.decodeUnknownSync(FolderLocation)({
            _tag: "Folder",
            mailboxId: row.mailbox_id,
            folderId: row.folder_id,
          });
    }
    case "Message": {
      const row = oneOrNotFound(
        sql
          .exec(
            `SELECT metadata.mailbox_id, folder.id AS folder_id, message.id AS message_id
               FROM mailbox_metadata AS metadata
               CROSS JOIN message
               JOIN folder ON folder.id = message.folder_id
              WHERE metadata.singleton = 1
                AND message.id = ?
                AND message.deleted_at IS NULL
                AND folder.deleted_at IS NULL`,
            lookup.messageId
          )
          .toArray()
      );
      return row === undefined
        ? { _tag: "NotFound" }
        : Schema.decodeUnknownSync(MessageLocation)({
            _tag: "Message",
            mailboxId: row.mailbox_id,
            folderId: row.folder_id,
            messageId: row.message_id,
          });
    }
    case "Draft": {
      const row = oneOrNotFound(
        sql
          .exec(
            `SELECT metadata.mailbox_id, draft.id AS draft_id
               FROM mailbox_metadata AS metadata
               CROSS JOIN draft
              WHERE metadata.singleton = 1
                AND draft.id = ?
                AND draft.deleted_at IS NULL`,
            lookup.draftId
          )
          .toArray()
      );
      return row === undefined
        ? { _tag: "NotFound" }
        : Schema.decodeUnknownSync(DraftLocation)({
            _tag: "Draft",
            mailboxId: row.mailbox_id,
            draftId: row.draft_id,
          });
    }
    case "Rule": {
      const row = oneOrNotFound(
        sql
          .exec(
            `SELECT metadata.mailbox_id, filter_rule.id AS rule_id
               FROM mailbox_metadata AS metadata
               CROSS JOIN filter_rule
              WHERE metadata.singleton = 1
                AND filter_rule.id = ?
                AND filter_rule.deleted_at IS NULL`,
            lookup.ruleId
          )
          .toArray()
      );
      return row === undefined
        ? { _tag: "NotFound" }
        : Schema.decodeUnknownSync(RuleLocation)({
            _tag: "Rule",
            mailboxId: row.mailbox_id,
            ruleId: row.rule_id,
          });
    }
    case "Attachment": {
      const row = oneOrNotFound(
        sql
          .exec(
            `SELECT metadata.mailbox_id,
                    folder.id AS folder_id,
                    message.id AS message_id,
                    attachment.id AS attachment_id
               FROM mailbox_metadata AS metadata
               CROSS JOIN attachment
               JOIN message ON message.id = attachment.message_id
               JOIN folder ON folder.id = message.folder_id
              WHERE metadata.singleton = 1
                AND attachment.id = ?
                AND attachment.deleted_at IS NULL
                AND message.deleted_at IS NULL
                AND folder.deleted_at IS NULL`,
            lookup.attachmentId
          )
          .toArray()
      );
      return row === undefined
        ? { _tag: "NotFound" }
        : Schema.decodeUnknownSync(AttachmentLocation)({
            _tag: "Attachment",
            mailboxId: row.mailbox_id,
            folderId: row.folder_id,
            messageId: row.message_id,
            attachmentId: row.attachment_id,
          });
    }
    default: {
      const exhaustive: never = lookup;
      return exhaustive;
    }
  }
};
