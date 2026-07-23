import { describe, expect, it } from "vitest";

import {
  directoryRequestMetadataByTag,
  mailDataRequestMetadataByTag,
} from "#/modules/mailbox/adapters/durable-object/MailboxDoProtocol";
import type {
  DirectoryRpcRequest,
  DirectoryRpcResponse,
  MailDataRpcRequest,
  MailDataRpcResponse,
} from "#/modules/mailbox/adapters/durable-object/MailboxDoProtocol";
import type { MailboxDomainError } from "#/modules/mailbox/domain/MailboxError";

interface DirectoryMetadata {
  readonly operation: MailboxDomainError["operation"];
  readonly kind: "read" | "write";
  readonly responseTag: Exclude<DirectoryRpcResponse["_tag"], "DomainError">;
}

interface MailDataMetadata {
  readonly operation: MailboxDomainError["operation"];
  readonly kind: "read" | "write";
  readonly responseTag: Exclude<MailDataRpcResponse["_tag"], "DomainError">;
}

const expectedDirectoryMetadata = {
  ListFolders: {
    operation: "list-folders",
    kind: "read",
    responseTag: "FoldersListed",
  },
  CreateFolder: {
    operation: "create-folder",
    kind: "write",
    responseTag: "FolderCreated",
  },
  RenameFolder: {
    operation: "rename-folder",
    kind: "write",
    responseTag: "FolderRenamed",
  },
  DeleteFolder: {
    operation: "delete-folder",
    kind: "write",
    responseTag: "FolderDeleted",
  },
  ListLabels: {
    operation: "list-labels",
    kind: "read",
    responseTag: "LabelsListed",
  },
  CreateLabel: {
    operation: "create-label",
    kind: "write",
    responseTag: "LabelCreated",
  },
  RenameLabel: {
    operation: "rename-label",
    kind: "write",
    responseTag: "LabelRenamed",
  },
  DeleteLabel: {
    operation: "delete-label",
    kind: "write",
    responseTag: "LabelDeleted",
  },
} as const satisfies Record<DirectoryRpcRequest["_tag"], DirectoryMetadata>;

const expectedMailDataMetadata = {
  ListMessages: {
    operation: "list-messages",
    kind: "read",
    responseTag: "MessagesListed",
  },
  SearchMessages: {
    operation: "search-messages",
    kind: "read",
    responseTag: "MessagesSearched",
  },
  GetMessage: {
    operation: "get-message",
    kind: "read",
    responseTag: "MessageFound",
  },
  GetThread: {
    operation: "get-thread",
    kind: "read",
    responseTag: "ThreadFound",
  },
  SetMessageRead: {
    operation: "mutate-message",
    kind: "write",
    responseTag: "MessageMutated",
  },
  SetMessageStarred: {
    operation: "mutate-message",
    kind: "write",
    responseTag: "MessageMutated",
  },
  MoveMessage: {
    operation: "mutate-message",
    kind: "write",
    responseTag: "MessageMutated",
  },
  AddMessageLabel: {
    operation: "mutate-message",
    kind: "write",
    responseTag: "MessageMutated",
  },
  RemoveMessageLabel: {
    operation: "mutate-message",
    kind: "write",
    responseTag: "MessageMutated",
  },
  CreateDraft: {
    operation: "create-draft",
    kind: "write",
    responseTag: "DraftCreated",
  },
  GetDraft: {
    operation: "get-draft",
    kind: "read",
    responseTag: "DraftFound",
  },
  ListDrafts: {
    operation: "list-drafts",
    kind: "read",
    responseTag: "DraftsListed",
  },
  GetAttachmentBlob: {
    operation: "get-attachment",
    kind: "read",
    responseTag: "AttachmentBlobFound",
  },
  UpdateDraft: {
    operation: "update-draft",
    kind: "write",
    responseTag: "DraftUpdated",
  },
  ReserveDraftAttachment: {
    operation: "reserve-draft-attachment",
    kind: "write",
    responseTag: "DraftAttachmentReserved",
  },
  GetDraftAttachment: {
    operation: "get-draft-attachment",
    kind: "read",
    responseTag: "DraftAttachmentFound",
  },
  ListDraftAttachments: {
    operation: "list-draft-attachments",
    kind: "read",
    responseTag: "DraftAttachmentsListed",
  },
  CompleteDraftAttachment: {
    operation: "complete-draft-attachment",
    kind: "write",
    responseTag: "DraftAttachmentCompleted",
  },
  ScheduleOutbound: {
    operation: "schedule-outbound",
    kind: "write",
    responseTag: "OutboundScheduled",
  },
  GetOutboundDelivery: {
    operation: "get-outbound",
    kind: "read",
    responseTag: "OutboundFound",
  },
  CancelOutboundDelivery: {
    operation: "cancel-outbound",
    kind: "write",
    responseTag: "OutboundCancelled",
  },
  ResendOutbound: {
    operation: "resend-outbound",
    kind: "write",
    responseTag: "OutboundResent",
  },
  CommitInbound: {
    operation: "commit-inbound",
    kind: "write",
    responseTag: "InboundCommitted",
  },
  RecordInboundProcessing: {
    operation: "record-inbound",
    kind: "write",
    responseTag: "InboundProcessingRecorded",
  },
  PrepareInboundReplay: {
    operation: "replay-inbound",
    kind: "write",
    responseTag: "InboundReplayPrepared",
  },
} as const satisfies Record<MailDataRpcRequest["_tag"], MailDataMetadata>;

describe("MailboxDO protocol metadata", () => {
  it.each(Object.entries(expectedDirectoryMetadata))(
    "maps directory request %s",
    (tag, metadata) => {
      expect(directoryRequestMetadataByTag).toHaveProperty(tag, metadata);
    }
  );

  it.each(Object.entries(expectedMailDataMetadata))(
    "maps mail-data request %s",
    (tag, metadata) => {
      expect(mailDataRequestMetadataByTag).toHaveProperty(tag, metadata);
    }
  );

  it("contains no untested request metadata", () => {
    expect(directoryRequestMetadataByTag).toStrictEqual(
      expectedDirectoryMetadata
    );
    expect(mailDataRequestMetadataByTag).toStrictEqual(
      expectedMailDataMetadata
    );
  });
});
