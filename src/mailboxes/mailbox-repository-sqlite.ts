import { and, eq, isNull } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { MailboxId } from "./identifiers";
import { MailboxDatabase } from "./mailbox-database";
import {
  AttachmentLocation,
  DraftLocation,
  FolderLocation,
  MailboxResourceLookupResult,
  MessageLocation,
  RuleLocation,
} from "./mailbox-repository";
import type { MailboxResourceLookup } from "./mailbox-repository";
import {
  attachment,
  draft,
  filterRule,
  folder,
  mailboxMetadata,
  message,
} from "./mailbox-schema";

const notFound = Schema.decodeUnknownSync(MailboxResourceLookupResult)({
  _tag: "NotFound",
});

/** Binds persistent mailbox storage to the canonical Durable Object name. */
export const initializeMailboxRepository = (mailboxId: MailboxId) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;

    yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const rows = yield* tx
          .select({ mailboxId: mailboxMetadata.mailboxId })
          .from(mailboxMetadata)
          .where(eq(mailboxMetadata.singleton, 1));

        if (rows.length === 0) {
          yield* tx.insert(mailboxMetadata).values({ singleton: 1, mailboxId });
        } else if (rows.length !== 1 || rows[0]?.mailboxId !== mailboxId) {
          return yield* Effect.die(
            new Error(
              "Mailbox database identity does not match its Durable Object"
            )
          );
        }
      })
    );
  });

/** Resolves trusted ancestry directly from canonical mailbox tables. */
export const resolveMailboxResource = (lookup: MailboxResourceLookup) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;

    switch (lookup._tag) {
      case "Folder": {
        const [row] = yield* db
          .select({
            mailboxId: mailboxMetadata.mailboxId,
            folderId: folder.id,
          })
          .from(mailboxMetadata)
          .crossJoin(folder)
          .where(
            and(
              eq(mailboxMetadata.singleton, 1),
              eq(folder.id, lookup.folderId),
              isNull(folder.deletedAt)
            )
          );
        return row === undefined
          ? notFound
          : Schema.decodeUnknownSync(FolderLocation)({
              _tag: "Folder",
              ...row,
            });
      }
      case "Message": {
        const [row] = yield* db
          .select({
            mailboxId: mailboxMetadata.mailboxId,
            folderId: folder.id,
            messageId: message.id,
          })
          .from(mailboxMetadata)
          .crossJoin(message)
          .innerJoin(folder, eq(folder.id, message.folderId))
          .where(
            and(
              eq(mailboxMetadata.singleton, 1),
              eq(message.id, lookup.messageId),
              isNull(message.deletedAt),
              isNull(folder.deletedAt)
            )
          );
        return row === undefined
          ? notFound
          : Schema.decodeUnknownSync(MessageLocation)({
              _tag: "Message",
              ...row,
            });
      }
      case "Draft": {
        const [row] = yield* db
          .select({
            mailboxId: mailboxMetadata.mailboxId,
            draftId: draft.id,
          })
          .from(mailboxMetadata)
          .crossJoin(draft)
          .where(
            and(
              eq(mailboxMetadata.singleton, 1),
              eq(draft.id, lookup.draftId),
              isNull(draft.deletedAt)
            )
          );
        return row === undefined
          ? notFound
          : Schema.decodeUnknownSync(DraftLocation)({
              _tag: "Draft",
              ...row,
            });
      }
      case "Rule": {
        const [row] = yield* db
          .select({
            mailboxId: mailboxMetadata.mailboxId,
            ruleId: filterRule.id,
          })
          .from(mailboxMetadata)
          .crossJoin(filterRule)
          .where(
            and(
              eq(mailboxMetadata.singleton, 1),
              eq(filterRule.id, lookup.ruleId),
              isNull(filterRule.deletedAt)
            )
          );
        return row === undefined
          ? notFound
          : Schema.decodeUnknownSync(RuleLocation)({
              _tag: "Rule",
              ...row,
            });
      }
      case "Attachment": {
        const [row] = yield* db
          .select({
            mailboxId: mailboxMetadata.mailboxId,
            folderId: folder.id,
            messageId: message.id,
            attachmentId: attachment.id,
          })
          .from(mailboxMetadata)
          .crossJoin(attachment)
          .innerJoin(message, eq(message.id, attachment.messageId))
          .innerJoin(folder, eq(folder.id, message.folderId))
          .where(
            and(
              eq(mailboxMetadata.singleton, 1),
              eq(attachment.id, lookup.attachmentId),
              isNull(attachment.deletedAt),
              isNull(message.deletedAt),
              isNull(folder.deletedAt)
            )
          );
        return row === undefined
          ? notFound
          : Schema.decodeUnknownSync(AttachmentLocation)({
              _tag: "Attachment",
              ...row,
            });
      }
      default: {
        const exhaustive: never = lookup;
        return exhaustive;
      }
    }
  });
