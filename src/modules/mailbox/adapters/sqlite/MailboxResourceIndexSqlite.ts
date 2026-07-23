import { and, eq, isNull } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import type { MailboxId } from "#/modules/mailbox/domain/Mailbox";
import {
  AttachmentLocation,
  DraftLocation,
  FolderLocation,
  MessageLocation,
  RuleLocation,
} from "#/modules/mailbox/domain/MailboxResource";
import type {
  MailboxResourceLookup,
  MailboxResourceLookupResult as MailboxResourceLookupResultType,
} from "#/modules/mailbox/domain/MailboxResource";
import { MailboxIdentity } from "#/modules/mailbox/ports/MailboxIdentity";

import { MailboxDatabase } from "./MailboxSqliteDatabase";
import {
  attachment,
  draft,
  filterRule,
  folder,
  mailboxMetadata,
  message,
} from "./MailboxSqliteSchema";

const resourceNotFound = {
  _tag: "NotFound",
} as const satisfies MailboxResourceLookupResultType;

const initializeMailboxResourceIndex = (mailboxId: MailboxId) =>
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

const resolveMailboxResource = (lookup: MailboxResourceLookup) =>
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
          ? resourceNotFound
          : yield* Schema.decodeUnknownEffect(FolderLocation)({
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
          ? resourceNotFound
          : yield* Schema.decodeUnknownEffect(MessageLocation)({
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
          ? resourceNotFound
          : yield* Schema.decodeUnknownEffect(DraftLocation)({
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
          ? resourceNotFound
          : yield* Schema.decodeUnknownEffect(RuleLocation)({
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
          ? resourceNotFound
          : yield* Schema.decodeUnknownEffect(AttachmentLocation)({
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

const makeMailboxResourceIndex = (
  db: MailboxDatabase,
  mailboxId: MailboxId
) => ({
  initialize: initializeMailboxResourceIndex(mailboxId).pipe(
    Effect.provideService(MailboxDatabase, db)
  ),
  resolve: (lookup: MailboxResourceLookup) =>
    resolveMailboxResource(lookup).pipe(
      Effect.provideService(MailboxDatabase, db)
    ),
});

export type MailboxResourceIndex = ReturnType<typeof makeMailboxResourceIndex>;

export const MailboxResourceIndex = Context.Service<MailboxResourceIndex>(
  "cloudflare-inbox/MailboxResourceIndex"
);

export const MailboxResourceIndexSqliteLayer = Layer.effect(
  MailboxResourceIndex,
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const { mailboxId } = yield* MailboxIdentity;
    return MailboxResourceIndex.of(makeMailboxResourceIndex(db, mailboxId));
  })
);
