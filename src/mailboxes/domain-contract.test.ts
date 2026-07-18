import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { MailboxDisplayNamePayloadSchema } from "../http/mailbox-contract";
import {
  CreateMailboxAddressInput,
  MailboxAddressList,
} from "./address-contract";
import { AttachmentMetadata } from "./attachment-metadata";
import { CreateFolderInput } from "./directory-contract";
import { CreateDraftInput } from "./draft-contract";
import { Folder, FolderSchema } from "./folder";
import { MailboxId } from "./identifiers";
import { MailboxAddressSchema } from "./mailbox-address";
import {
  ListMessagesInput,
  MessageFilters,
  SetMessageReadInput,
} from "./message-contract";
import { MessageDetail, MessageDetailSchema } from "./message-detail";
import {
  EmailAddress,
  MailboxDisplayName,
  PageSize,
  Version,
} from "./primitives";
import { ThreadDetailSchema } from "./thread-detail";

const decodeSucceeds = <S extends Schema.ConstraintDecoder<unknown, never>>(
  schema: S,
  input: unknown
) => Exit.isSuccess(Schema.decodeUnknownExit(schema)(input));

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

describe("mail domain contracts", () => {
  it("validates branded identifiers, versions, page sizes, and Unicode names", () => {
    expect([
      decodeSucceeds(MailboxId, "primary"),
      decodeSucceeds(MailboxId, " primary "),
      decodeSucceeds(Version, 1),
      decodeSucceeds(Version, 0),
      decodeSucceeds(PageSize, 100),
      decodeSucceeds(PageSize, 101),
      decodeSucceeds(EmailAddress, "owner@example.com"),
      decodeSucceeds(EmailAddress, "owner@example."),
      decodeSucceeds(EmailAddress, "a..b@example.com"),
      decodeSucceeds(EmailAddress, "a@-example.com"),
      decodeSucceeds(EmailAddress, "a@example-.com"),
      decodeSucceeds(EmailAddress, "a@exa_mple.com"),
    ]).toStrictEqual([
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
    ]);

    expect(Schema.decodeUnknownSync(MailboxDisplayName)("  Inbox  ")).toBe(
      "Inbox"
    );
    expect(decodeSucceeds(MailboxDisplayName, "😀".repeat(200))).toBeTruthy();
    expect(decodeSucceeds(MailboxDisplayName, "😀".repeat(201))).toBeFalsy();
  });

  it("constructs and encodes schema-backed directory entities", () => {
    const folder = Schema.decodeUnknownSync(Folder)({
      id: "projects",
      mailboxId: "primary",
      name: "  Projects  ",
      kind: "custom",
      createdAt: 1000,
      updatedAt: 1000,
      version: 1,
    });

    expect(folder).toBeInstanceOf(Folder);
    expect(folder.name).toBe("Projects");
    expect(Schema.encodeSync(Folder)(folder)).toStrictEqual({
      id: "projects",
      mailboxId: "primary",
      name: "Projects",
      kind: "custom",
      createdAt: 1000,
      updatedAt: 1000,
      version: 1,
    });
    expect(
      decodeSucceeds(FolderSchema, {
        ...Schema.encodeSync(Folder)(folder),
        createdAt: 2000,
      })
    ).toBeFalsy();
  });

  it("keeps storage keys out of public message details", () => {
    const message = Schema.decodeUnknownSync(MessageDetailSchema)(
      messageInput({
        rawObjectKey: "must-not-leak",
        htmlBodyKey: "must-not-leak",
      })
    );
    const encoded = Schema.encodeSync(MessageDetail)(message);

    expect(message.attachments[0]).toBeInstanceOf(AttachmentMetadata);
    expect(encoded).not.toHaveProperty("rawObjectKey");
    expect(encoded).not.toHaveProperty("htmlBodyKey");
    expect(
      decodeSucceeds(
        MessageDetailSchema,
        messageInput({ hasAttachments: false })
      )
    ).toBeFalsy();
    expect(
      decodeSucceeds(
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

    expect(decodeSucceeds(ThreadDetailSchema, thread)).toBeTruthy();
    expect(
      decodeSucceeds(ThreadDetailSchema, {
        ...thread,
        messages: [messageInput({ threadId: "another-thread" })],
      })
    ).toBeFalsy();
    expect(
      decodeSucceeds(ThreadDetailSchema, {
        ...thread,
        messages: [messageInput(), messageInput({ id: "message-2" })],
      })
    ).toBeFalsy();
    expect(
      decodeSucceeds(ThreadDetailSchema, {
        ...thread,
        thread: { ...thread.thread, unreadCount: 2 },
      })
    ).toBeFalsy();
  });

  it("validates mailbox address commands and primary-address invariants", () => {
    expect(
      decodeSucceeds(CreateMailboxAddressInput, {
        mailboxId: "primary",
        operationId: "alias-1",
        address: "alias@example.",
      })
    ).toBeFalsy();
    expect(
      decodeSucceeds(MailboxAddressSchema, {
        id: "alias-1",
        mailboxId: "primary",
        address: { address: "owner@example.com" },
        isPrimary: true,
        enabled: false,
        createdAt: 1000,
        updatedAt: 1000,
        version: 1,
      })
    ).toBeFalsy();
    expect(
      decodeSucceeds(MailboxAddressList, {
        mailboxId: "primary",
        items: [
          {
            id: "alias-1",
            mailboxId: "primary",
            address: { address: "owner@example.com" },
            isPrimary: true,
            enabled: true,
            createdAt: 1000,
            updatedAt: 1000,
            version: 1,
          },
          {
            id: "alias-2",
            mailboxId: "primary",
            address: { address: "alias@example.com" },
            isPrimary: true,
            enabled: true,
            createdAt: 1000,
            updatedAt: 1000,
            version: 1,
          },
        ],
      })
    ).toBeFalsy();
  });

  it("defines versioned, idempotent public commands and cursor queries", () => {
    expect(
      Schema.decodeUnknownSync(CreateFolderInput)({
        mailboxId: "primary",
        operationId: "create-projects",
        name: " Projects ",
      })
    ).toMatchObject({ name: "Projects" });
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
        messageId: "message-1",
        expectedVersion: 3,
        read: true,
      })
    ).toMatchObject({ expectedVersion: 3, read: true });
    expect(
      Schema.decodeUnknownSync(CreateDraftInput)({
        mailboxId: "primary",
        operationId: "compose-1",
        content: {
          to: [{ address: "recipient@example.com" }],
          cc: [],
          bcc: [],
          subject: "Draft subject",
          textBody: "Draft body",
          attachmentIds: [],
        },
      })
    ).toMatchObject({ operationId: "compose-1" });
    expect(
      decodeSucceeds(MessageFilters, { after: 2000, before: 1000 })
    ).toBeFalsy();
  });

  it("reuses the mailbox name invariant at the HTTP boundary", () => {
    expect(
      Schema.decodeUnknownSync(MailboxDisplayNamePayloadSchema)({
        displayName: "  Team inbox  ",
      })
    ).toStrictEqual({ displayName: "Team inbox" });
    expect(
      decodeSucceeds(MailboxDisplayNamePayloadSchema, {
        displayName: "x".repeat(201),
      })
    ).toBeFalsy();
  });
});
