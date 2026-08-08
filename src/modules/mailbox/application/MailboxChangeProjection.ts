import type { MailboxChangeScopes } from "#/modules/mailbox/domain/MailboxRealtime";
import type {
  DirectoryRpcResponse,
  MailDataRpcResponse,
} from "#/modules/mailbox/ports/MailboxDoProtocol";

const noChanges: MailboxChangeScopes = [];

export const directoryResponseChangeScopes = (
  response: DirectoryRpcResponse
): MailboxChangeScopes => {
  switch (response._tag) {
    case "FolderCreated":
    case "FolderDeleted":
    case "FolderRenamed":
    case "LabelCreated":
    case "LabelDeleted":
    case "LabelRenamed": {
      return ["messages", "navigation", "threads"];
    }
    default: {
      return noChanges;
    }
  }
};

export const mailDataResponseChangeScopes = (
  response: MailDataRpcResponse
): MailboxChangeScopes => {
  switch (response._tag) {
    case "MessageMutated":
    case "MessagesBatchMutated": {
      return ["messages", "navigation", "threads"];
    }
    case "InboundCommitted": {
      return ["contacts", "messages", "navigation", "threads"];
    }
    case "DraftCreated":
    case "DraftUpdated":
    case "ReplyDraftCreated":
    case "DraftAttachmentCompleted":
    case "DraftAttachmentReserved": {
      return ["drafts", "navigation"];
    }
    case "OutboundScheduled": {
      return ["contacts", "drafts", "messages", "navigation", "outbound"];
    }
    case "OutboundCancelled": {
      return ["messages", "navigation", "outbound"];
    }
    case "OutboundResent": {
      return ["contacts", "messages", "navigation", "outbound"];
    }
    default: {
      return noChanges;
    }
  }
};
