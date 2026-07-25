import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { MailboxOutboundDispatchStoreSqliteLayer } from "#/modules/mailbox/adapters/sqlite/MailboxOutboundDispatchStoreSqlite";
import { MailboxDatabase } from "#/modules/mailbox/adapters/sqlite/MailboxSqliteDatabase";
import {
  attachment,
  draft,
  draftAttachment,
  folder,
  message,
  outboundDelivery,
} from "#/modules/mailbox/adapters/sqlite/MailboxSqliteSchema";
import {
  MailboxId,
  OutboundDeliveryId,
} from "#/modules/mailbox/domain/Mailbox";
import { MailboxIdentity } from "#/modules/mailbox/ports/MailboxIdentity";
import { MailboxOutboundDispatchStore } from "#/modules/mailbox/ports/MailboxOutboundDispatchStore";

import { MailboxDatabaseTestLayer } from "../../../../support/mailbox-sqlite";

const mailboxId = Schema.decodeUnknownSync(MailboxId)("mailbox-a");
const digest = "a".repeat(64);
const testLive = MailboxOutboundDispatchStoreSqliteLayer.pipe(
  Layer.provide(
    Layer.succeed(MailboxIdentity, MailboxIdentity.of({ mailboxId }))
  ),
  Layer.provideMerge(MailboxDatabaseTestLayer)
);
const deliveryId = Schema.decodeUnknownSync(OutboundDeliveryId)("delivery-1");

const seedMinimalSnapshot = (
  inReplyTo: string | null,
  referencesJson: string
) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    yield* db.insert(folder).values({
      createdAt: 0,
      id: "scheduled",
      kind: "scheduled",
      name: "Scheduled",
      updatedAt: 0,
    });
    yield* db.insert(message).values({
      activityAt: 500,
      bccJson: "[]",
      ccJson: "[]",
      createdAt: 200,
      direction: "outbound",
      folderId: "scheduled",
      id: "message-1",
      inReplyTo,
      outboundDeliveryId: "delivery-1",
      recipientsJson: '[{"address":"to@example.com"}]',
      referencesJson,
      senderJson: '{"address":"sender@example.com"}',
      subject: "Snapshot",
      textBody: "Body",
      threadId: "thread-1",
      toJson: '[{"address":"to@example.com"}]',
      updatedAt: 200,
    });
    yield* db.insert(outboundDelivery).values({
      createdAt: 200,
      id: "delivery-1",
      messageId: "message-1",
      sendAt: 500,
      status: "scheduled",
      updatedAt: 200,
    });
  });

describe("outbound dispatch SQLite snapshot store", () => {
  it("loads the frozen sender, recipient buckets, bodies, and attachment locator", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* MailboxDatabase;
        yield* db.insert(folder).values({
          createdAt: 0,
          id: "scheduled",
          kind: "scheduled",
          name: "Scheduled",
          updatedAt: 0,
        });
        yield* db.insert(draft).values({
          attachmentIdsJson: '["draft-attachment-1"]',
          bccJson: "[]",
          ccJson: "[]",
          createdAt: 100,
          deletedAt: 200,
          id: "draft-1",
          subject: "Original draft",
          toJson: '[{"address":"old@example.com"}]',
          updatedAt: 200,
        });
        yield* db.insert(draftAttachment).values({
          contentSha256: digest,
          createdAt: 100,
          draftId: "draft-1",
          expiresAt: 1000,
          fileName: "source-name.txt",
          id: "draft-attachment-1",
          mimeType: "text/plain",
          size: 3,
          status: "stored",
          storedAt: 150,
        });
        yield* db.insert(message).values({
          activityAt: 500,
          bccJson: '[{"address":"bcc@example.com"}]',
          ccJson: '[{"address":"cc@example.com"}]',
          createdAt: 200,
          direction: "outbound",
          folderId: "scheduled",
          htmlBody: "<p>Hello</p>",
          id: "message-1",
          outboundDeliveryId: "delivery-1",
          recipientsJson:
            '[{"address":"to@example.com"},{"address":"cc@example.com"},{"address":"bcc@example.com"}]',
          senderJson: '{"address":"sender@example.com","displayName":"Sender"}',
          snippet: "Hello",
          subject: "Frozen subject",
          textBody: "Hello",
          threadId: "thread-1",
          inReplyTo: "<parent@example.com>",
          referencesJson: '["<root@example.com>","<parent@example.com>"]',
          toJson: '[{"address":"to@example.com"}]',
          updatedAt: 200,
        });
        yield* db.insert(attachment).values({
          contentSha256: digest,
          disposition: "attachment",
          draftAttachmentId: "draft-attachment-1",
          fileName: "frozen-name.txt",
          id: "message-attachment-1",
          messageId: "message-1",
          mimeType: "text/plain",
          size: 3,
        });
        yield* db.insert(outboundDelivery).values({
          createdAt: 200,
          id: "delivery-1",
          messageId: "message-1",
          sendAt: 500,
          status: "scheduled",
          updatedAt: 200,
        });

        yield* db
          .update(draftAttachment)
          .set({ fileName: "mutated-source.txt", mimeType: "application/pdf" })
          .where(eq(draftAttachment.id, "draft-attachment-1"));
        const store = yield* MailboxOutboundDispatchStore;
        const snapshot = yield* store.load(deliveryId);

        expect(snapshot).toMatchObject({
          attachments: [
            {
              attachmentId: "message-attachment-1",
              disposition: "attachment",
              fileName: "frozen-name.txt",
              location: {
                contentSha256: digest,
                draftAttachmentId: "draft-attachment-1",
                mailboxId: "mailbox-a",
                mimeType: "text/plain",
                size: 3,
              },
            },
          ],
          bcc: [{ address: "bcc@example.com" }],
          cc: [{ address: "cc@example.com" }],
          html: "<p>Hello</p>",
          mailboxId: "mailbox-a",
          messageId: "message-1",
          outboundDeliveryId: "delivery-1",
          sender: { address: "sender@example.com", displayName: "Sender" },
          subject: "Frozen subject",
          text: "Hello",
          threading: {
            inReplyTo: "<parent@example.com>",
            references: ["<root@example.com>", "<parent@example.com>"],
          },
          to: [{ address: "to@example.com" }],
        });
      }).pipe(Effect.provide(testLive))
    );
  });

  it.each([
    ["malformed In-Reply-To", "parent@example.com", '["<parent@example.com>"]'],
    [
      "malformed References element",
      "<parent@example.com>",
      '["root@example.com","<parent@example.com>"]',
    ],
    ["non-array References JSON", "<parent@example.com>", "{}"],
    [
      "missing parent in References",
      "<parent@example.com>",
      '["<root@example.com>"]',
    ],
    [
      "duplicate References",
      "<parent@example.com>",
      '["<root@example.com>","<parent@example.com>","<parent@example.com>"]',
    ],
    [
      "parent not final in References",
      "<parent@example.com>",
      '["<parent@example.com>","<root@example.com>"]',
    ],
    [
      "overlimit serialized References",
      "<parent@example.com>",
      JSON.stringify([
        `<${"a".repeat(700)}@example.com>`,
        `<${"b".repeat(700)}@example.com>`,
        `<${"c".repeat(700)}@example.com>`,
        "<parent@example.com>",
      ]),
    ],
    ["References with null In-Reply-To", null, '["<parent@example.com>"]'],
  ])("rejects %s corruption", async (_, inReplyTo, referencesJson) => {
    const error = await Effect.runPromise(
      Effect.gen(function* () {
        yield* seedMinimalSnapshot(inReplyTo, referencesJson);
        const store = yield* MailboxOutboundDispatchStore;
        return yield* store.load(deliveryId).pipe(Effect.flip);
      }).pipe(Effect.provide(testLive))
    );

    expect(error).toMatchObject({
      outboundDeliveryId: "delivery-1",
      reason: "invalid-snapshot",
    });
  });

  it("hydrates ordinary compose without threading metadata", async () => {
    const snapshot = await Effect.runPromise(
      Effect.gen(function* () {
        yield* seedMinimalSnapshot(null, "[]");
        const store = yield* MailboxOutboundDispatchStore;
        return yield* store.load(deliveryId);
      }).pipe(Effect.provide(testLive))
    );

    expect(snapshot).not.toHaveProperty("threading");
  });
});
