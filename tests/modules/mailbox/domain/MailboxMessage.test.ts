import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  AttachmentMetadata,
  ListMessagesInput,
  MessageDetail,
  MessageDetailSchema,
  MessageFilters,
  MessageSummarySchema,
  SearchMessagesInput,
  SetMessageReadInput,
  ThreadDetailSchema,
} from "#/modules/mailbox/domain/MailboxMessage";

const decodes = <S extends Schema.ConstraintDecoder<unknown, never>>(
  schema: S,
  value: unknown
) => Exit.isSuccess(Schema.decodeUnknownExit(schema)(value));

const message = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  id: "message-1",
  mailboxId: "primary",
  folderId: "inbox",
  threadId: "thread-1",
  direction: "inbound",
  subject: "Subject",
  recipients: [{ address: "owner@example.com" }],
  snippet: "Snippet",
  activityAt: 1000,
  read: false,
  starred: false,
  hasAttachments: false,
  labelIds: [],
  size: 100,
  version: 1,
  ...overrides,
});

const messageDetail = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  ...message(),
  references: [],
  to: [{ address: "owner@example.com" }],
  cc: [],
  bcc: [],
  receivedAt: 1000,
  attachments: [],
  ...overrides,
});

const messageInput = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  id: "message-1",
  mailboxId: "primary",
  folderId: "inbox",
  threadId: "thread-1",
  direction: "inbound",
  subject: "Hello",
  sender: { address: "sender@example.com", displayName: "Sender" },
  recipients: [{ address: "owner@example.com" }],
  snippet: "Hello from the message",
  activityAt: 1000,
  read: false,
  starred: false,
  hasAttachments: true,
  labelIds: ["important"],
  size: 2048,
  version: 1,
  rfcMessageId: "<message-1@example.com>",
  references: [],
  to: [{ address: "owner@example.com" }],
  cc: [],
  bcc: [],
  textBody: "Hello from the message",
  receivedAt: 1000,
  attachments: [
    {
      id: "attachment-1",
      messageId: "message-1",
      fileName: "invoice.pdf",
      mimeType: "application/pdf",
      size: 1024,
      disposition: "attachment",
    },
  ],
  ...overrides,
});

describe("mailbox message contracts", () => {
  it("associates delivery state only with outbound messages", () => {
    expect([
      decodes(MessageSummarySchema, message()),
      decodes(
        MessageSummarySchema,
        message({
          outboundDeliveryId: "delivery-1",
          deliveryStatus: "accepted",
        })
      ),
      decodes(
        MessageSummarySchema,
        message({ outboundDeliveryId: "delivery-1" })
      ),
      decodes(
        MessageSummarySchema,
        message({
          direction: "outbound",
          outboundDeliveryId: "delivery-1",
          deliveryStatus: "scheduled",
        })
      ),
      decodes(MessageSummarySchema, message({ direction: "outbound" })),
    ]).toStrictEqual([true, false, false, true, false]);
  });

  it("keeps lifecycle metadata consistent with delivery state", () => {
    expect([
      decodes(MessageDetailSchema, messageDetail()),
      decodes(MessageDetailSchema, messageDetail({ acceptedAt: 1100 })),
      decodes(
        MessageDetailSchema,
        messageDetail({
          direction: "outbound",
          outboundDeliveryId: "delivery-1",
          deliveryStatus: "scheduled",
          receivedAt: undefined,
          scheduledAt: 1000,
        })
      ),
      decodes(
        MessageDetailSchema,
        messageDetail({
          direction: "outbound",
          outboundDeliveryId: "delivery-1",
          deliveryStatus: "accepted",
          receivedAt: undefined,
          scheduledAt: 1000,
        })
      ),
      decodes(
        MessageDetailSchema,
        messageDetail({
          direction: "outbound",
          outboundDeliveryId: "delivery-1",
          deliveryStatus: "accepted",
          receivedAt: undefined,
          scheduledAt: 1000,
          acceptedAt: 1100,
        })
      ),
      decodes(
        MessageDetailSchema,
        messageDetail({
          direction: "outbound",
          outboundDeliveryId: "delivery-1",
          deliveryStatus: "accepted",
          receivedAt: undefined,
          scheduledAt: 1200,
          acceptedAt: 1100,
        })
      ),
    ]).toStrictEqual([true, false, true, false, true, false]);
  });

  it("keeps storage keys out of public message details", () => {
    const decoded = Schema.decodeUnknownSync(MessageDetailSchema)(
      messageInput({
        rawObjectKey: "must-not-leak",
        htmlBodyKey: "must-not-leak",
      })
    );
    const encoded = Schema.encodeSync(MessageDetail)(decoded);

    expect(decoded.attachments[0]).toBeInstanceOf(AttachmentMetadata);
    expect(encoded).not.toHaveProperty("rawObjectKey");
    expect(encoded).not.toHaveProperty("htmlBodyKey");
    expect(
      decodes(MessageDetailSchema, messageInput({ hasAttachments: false }))
    ).toBeFalsy();
    expect(
      decodes(
        MessageDetailSchema,
        messageInput({
          attachments: [
            {
              id: "attachment-1",
              messageId: "another-message",
              fileName: "invoice.pdf",
              mimeType: "application/pdf",
              size: 1024,
              disposition: "attachment",
            },
          ],
        })
      )
    ).toBeFalsy();
  });

  it("rejects contradictory and cross-thread aggregate data", () => {
    const thread = {
      thread: {
        id: "thread-1",
        mailboxId: "primary",
        subject: "Hello",
        participants: [{ address: "sender@example.com" }],
        messageCount: 1,
        unreadCount: 1,
        latestActivityAt: 1000,
      },
      messages: [messageInput()],
    };

    expect(decodes(ThreadDetailSchema, thread)).toBeTruthy();
    expect(
      decodes(ThreadDetailSchema, {
        ...thread,
        messages: [messageInput({ threadId: "another-thread" })],
      })
    ).toBeFalsy();
    expect(
      decodes(ThreadDetailSchema, {
        ...thread,
        messages: [messageInput(), messageInput({ id: "message-2" })],
      })
    ).toBeFalsy();
    expect(
      decodes(ThreadDetailSchema, {
        ...thread,
        thread: { ...thread.thread, unreadCount: 2 },
      })
    ).toBeFalsy();
  });

  it("defines versioned public commands and cursor queries", () => {
    expect(
      Schema.decodeUnknownSync(ListMessagesInput)({
        mailboxId: "primary",
        filters: { labelIds: ["important"], read: false },
        page: { cursor: "opaque-cursor", limit: 50 },
      })
    ).toMatchObject({ page: { limit: 50 } });
    expect(
      Schema.decodeUnknownSync(SetMessageReadInput)({
        mailboxId: "primary",
        operationId: "read-message-1",
        messageId: "message-1",
        expectedVersion: 3,
        read: true,
      })
    ).toMatchObject({ expectedVersion: 3, read: true });
    expect(decodes(MessageFilters, { after: 2000, before: 1000 })).toBeFalsy();
  });

  it("defines the public search query contract", () => {
    expect(
      Schema.decodeUnknownSync(SearchMessagesInput)({
        mailboxId: "primary",
        query: " invoice status ",
        filters: { folderId: "inbox" },
      })
    ).toMatchObject({ query: "invoice status" });
  });
});
