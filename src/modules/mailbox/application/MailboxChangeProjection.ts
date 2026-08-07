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
    case "MessagesBatchMutated":
    case "InboundCommitted": {
      return ["messages", "navigation", "threads"];
    }
    case "DraftCreated":
    case "DraftUpdated":
    case "ReplyDraftCreated":
    case "DraftAttachmentCompleted":
    case "DraftAttachmentReserved": {
      return ["drafts", "navigation"];
    }
    case "OutboundScheduled": {
      return ["drafts", "messages", "navigation", "outbound"];
    }
    case "OutboundCancelled":
    case "OutboundResent": {
      return ["messages", "navigation", "outbound"];
    }
    default: {
      return noChanges;
    }
  }
};
