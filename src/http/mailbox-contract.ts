import {
  AuthBadRequestError,
  AuthConflictError,
  AuthInternalError,
  AuthNotFoundError,
  AuthOriginCheckMiddleware,
  AuthPolicyDeniedError,
  AuthRequestRejectedError,
  AuthSchemaErrorMiddleware,
  AuthUnauthenticatedError,
} from "@effect-auth/core/HttpApi";
import * as Schema from "effect/Schema";
import {
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/unstable/httpapi";

import { CurrentRequestAuthMiddleware } from "../auth/session";
import {
  BootstrapOwnerMailboxCommand,
  RenameMailboxCommand,
} from "../mailboxes/administration";
import {
  Cursor,
  AttachmentId,
  DraftId,
  FolderId,
  InboundIngestId,
  LabelId,
  MailboxId,
  MailboxRecordSchema,
  MessageId,
  SearchQuery,
  ThreadId,
} from "../mailboxes/core";
import {
  DraftAttachmentUploadResult,
  ReserveDraftAttachmentCommand,
  ReservedDraftAttachment,
  UploadDraftAttachmentCommand,
} from "../mailboxes/draft-attachments";
import {
  CreateMailboxDraftCommand,
  DraftEditorDraft,
  UpdateMailboxDraftCommand,
} from "../mailboxes/draft-editing";
import {
  InboundProcessingResult,
  ReplayInboundInput,
} from "../mailboxes/inbound";
import {
  MailboxMessageActionPayload,
  MailboxMessageActionResult,
} from "../mailboxes/message-actions";
import { MailboxMessageHtmlResult } from "../mailboxes/message-html";
import {
  MailboxMessageListResult,
  MailboxThreadResult,
} from "../mailboxes/message-reading";
import { MailboxNavigationResult } from "../mailboxes/navigation";
import {
  SendMailboxDraftCommand,
  SendMailboxDraftResult,
  UndoMailboxSendCommand,
  UndoMailboxSendResult,
} from "../mailboxes/outbound-sending";

const MailboxParams = Schema.Struct({ mailboxId: MailboxId });
const InboundReplayParams = Schema.Struct({
  mailboxId: MailboxId,
  inboundIngestId: InboundIngestId,
});
const MailboxThreadParams = Schema.Struct({
  mailboxId: MailboxId,
  threadId: ThreadId,
});
const MailboxMessageParams = Schema.Struct({
  mailboxId: MailboxId,
  messageId: MessageId,
});
const MailboxDraftParams = Schema.Struct({
  draftId: DraftId,
  mailboxId: MailboxId,
});
const MailboxOutboundDeliveryParams = Schema.Struct({
  mailboxId: MailboxId,
  outboundDeliveryId: UndoMailboxSendCommand.fields.outboundDeliveryId,
});
const MailboxDraftAttachmentParams = Schema.Struct({
  attachmentId: AttachmentId,
  draftId: DraftId,
  mailboxId: MailboxId,
});
const MailboxInlineAttachmentParams = Schema.Struct({
  attachmentId: AttachmentId,
  mailboxId: MailboxId,
  messageId: MessageId,
});
export const MailboxMessageViewQuery = Schema.Struct({
  attachment: Schema.optional(Schema.Literals(["true", "false"])),
  cursor: Schema.optional(Cursor),
  folder: Schema.optional(FolderId),
  label: Schema.optional(LabelId),
  q: Schema.optional(SearchQuery),
  read: Schema.optional(Schema.Literals(["true", "false"])),
  starred: Schema.optional(Schema.Literals(["true", "false"])),
}).check(
  Schema.makeFilter((query) =>
    (query.folder === undefined) === (query.label === undefined)
      ? "exactly one folder or label is required"
      : undefined
  )
);
export const MailboxThreadViewQuery = Schema.Struct({
  folder: Schema.optional(FolderId),
  label: Schema.optional(LabelId),
  message: MessageId,
}).check(
  Schema.makeFilter((query) =>
    (query.folder === undefined) === (query.label === undefined)
      ? "exactly one folder or label is required"
      : undefined
  )
);
const MailboxErrors = [
  AuthBadRequestError,
  AuthUnauthenticatedError,
  AuthPolicyDeniedError,
  AuthRequestRejectedError,
  AuthNotFoundError,
  AuthConflictError,
  AuthInternalError,
] as const;

export const MailboxPublicErrorSchema = Schema.Union(MailboxErrors);
export type MailboxPublicError = Schema.Codec.Encoded<
  typeof MailboxPublicErrorSchema
>;

export const BootstrapOwnerEndpoint = HttpApiEndpoint.post(
  "bootstrapOwner",
  "/api/mailboxes/bootstrap-owner",
  {
    error: MailboxErrors,
    payload: BootstrapOwnerMailboxCommand,
    success: MailboxRecordSchema.pipe(HttpApiSchema.status(201)),
  }
);

export const GetMailboxNavigationEndpoint = HttpApiEndpoint.get(
  "getNavigation",
  "/api/mailboxes/current/navigation",
  {
    error: MailboxErrors,
    success: MailboxNavigationResult,
  }
);

export const ListMailboxMessagesEndpoint = HttpApiEndpoint.get(
  "listMessages",
  "/api/mailboxes/:mailboxId/messages",
  {
    error: MailboxErrors,
    params: MailboxParams,
    query: MailboxMessageViewQuery,
    success: MailboxMessageListResult,
  }
);

export const ActOnMailboxMessageEndpoint = HttpApiEndpoint.patch(
  "actOnMessage",
  "/api/mailboxes/:mailboxId/messages/:messageId",
  {
    error: MailboxErrors,
    params: MailboxMessageParams,
    payload: MailboxMessageActionPayload,
    success: MailboxMessageActionResult,
  }
);

export const CreateMailboxDraftEndpoint = HttpApiEndpoint.post(
  "createDraft",
  "/api/mailboxes/:mailboxId/drafts",
  {
    error: MailboxErrors,
    params: MailboxParams,
    payload: Schema.Struct({
      operationId: CreateMailboxDraftCommand.fields.operationId,
      content: CreateMailboxDraftCommand.fields.content,
    }),
    success: DraftEditorDraft.pipe(HttpApiSchema.status(201)),
  }
);

export const GetMailboxDraftEndpoint = HttpApiEndpoint.get(
  "getDraft",
  "/api/mailboxes/:mailboxId/drafts/:draftId",
  {
    error: MailboxErrors,
    params: MailboxDraftParams,
    success: DraftEditorDraft,
  }
);

export const UpdateMailboxDraftEndpoint = HttpApiEndpoint.patch(
  "updateDraft",
  "/api/mailboxes/:mailboxId/drafts/:draftId",
  {
    error: MailboxErrors,
    params: MailboxDraftParams,
    payload: Schema.Struct({
      operationId: UpdateMailboxDraftCommand.fields.operationId,
      expectedVersion: UpdateMailboxDraftCommand.fields.expectedVersion,
      content: UpdateMailboxDraftCommand.fields.content,
    }),
    success: DraftEditorDraft,
  }
);

export const SendMailboxDraftEndpoint = HttpApiEndpoint.post(
  "sendDraft",
  "/api/mailboxes/:mailboxId/drafts/:draftId/send",
  {
    error: MailboxErrors,
    params: MailboxDraftParams,
    payload: Schema.Struct({
      expectedVersion: SendMailboxDraftCommand.fields.expectedVersion,
      operationId: SendMailboxDraftCommand.fields.operationId,
    }),
    success: SendMailboxDraftResult.pipe(HttpApiSchema.status(202)),
  }
);

export const UndoMailboxSendEndpoint = HttpApiEndpoint.post(
  "undoSend",
  "/api/mailboxes/:mailboxId/outbound/:outboundDeliveryId/undo",
  {
    error: MailboxErrors,
    params: MailboxOutboundDeliveryParams,
    payload: Schema.Struct({
      expectedVersion: UndoMailboxSendCommand.fields.expectedVersion,
      operationId: UndoMailboxSendCommand.fields.operationId,
    }),
    success: UndoMailboxSendResult,
  }
);

export const ReserveDraftAttachmentEndpoint = HttpApiEndpoint.post(
  "reserveDraftAttachment",
  "/api/mailboxes/:mailboxId/drafts/:draftId/attachments/reservations",
  {
    error: MailboxErrors,
    params: MailboxDraftParams,
    payload: Schema.Struct({
      fileName: ReserveDraftAttachmentCommand.fields.fileName,
      mimeType: ReserveDraftAttachmentCommand.fields.mimeType,
      operationId: ReserveDraftAttachmentCommand.fields.operationId,
      size: ReserveDraftAttachmentCommand.fields.size,
    }),
    success: ReservedDraftAttachment.pipe(HttpApiSchema.status(201)),
  }
);

export const UploadDraftAttachmentEndpoint = HttpApiEndpoint.put(
  "uploadDraftAttachment",
  "/api/mailboxes/:mailboxId/drafts/:draftId/attachments/:attachmentId/content",
  {
    error: MailboxErrors,
    params: MailboxDraftAttachmentParams,
    payload: UploadDraftAttachmentCommand.fields.content.pipe(
      HttpApiSchema.asUint8Array({ contentType: "application/octet-stream" })
    ),
    success: DraftAttachmentUploadResult,
  }
);

export const GetMailboxMessageHtmlEndpoint = HttpApiEndpoint.get(
  "getMessageHtml",
  "/api/mailboxes/:mailboxId/messages/:messageId/html",
  {
    error: MailboxErrors,
    params: MailboxMessageParams,
    query: MailboxMessageViewQuery,
    success: MailboxMessageHtmlResult,
  }
);

export const GetMailboxInlineAttachmentEndpoint = HttpApiEndpoint.get(
  "getInlineAttachment",
  "/api/mailboxes/:mailboxId/messages/:messageId/attachments/:attachmentId/inline",
  {
    error: MailboxErrors,
    params: MailboxInlineAttachmentParams,
    query: MailboxMessageViewQuery,
    success: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
  }
);

export const GetMailboxThreadEndpoint = HttpApiEndpoint.get(
  "getThread",
  "/api/mailboxes/:mailboxId/threads/:threadId",
  {
    error: MailboxErrors,
    params: MailboxThreadParams,
    query: MailboxThreadViewQuery,
    success: MailboxThreadResult,
  }
);

export const RenameMailboxEndpoint = HttpApiEndpoint.patch(
  "rename",
  "/api/mailboxes/:mailboxId",
  {
    error: MailboxErrors,
    params: MailboxParams,
    payload: Schema.Struct({
      displayName: RenameMailboxCommand.fields.displayName,
    }),
    success: MailboxRecordSchema,
  }
);

export const ReplayInboundEndpoint = HttpApiEndpoint.post(
  "replayInbound",
  "/api/mailboxes/:mailboxId/inbound/:inboundIngestId/replay",
  {
    error: MailboxErrors,
    params: InboundReplayParams,
    payload: Schema.Struct({
      operationId: ReplayInboundInput.fields.operationId,
    }),
    success: InboundProcessingResult.pipe(HttpApiSchema.status(202)),
  }
);

export class MailboxGroup extends HttpApiGroup.make("mailboxes")
  .add(
    ActOnMailboxMessageEndpoint,
    BootstrapOwnerEndpoint,
    CreateMailboxDraftEndpoint,
    GetMailboxDraftEndpoint,
    GetMailboxThreadEndpoint,
    GetMailboxInlineAttachmentEndpoint,
    GetMailboxMessageHtmlEndpoint,
    GetMailboxNavigationEndpoint,
    ListMailboxMessagesEndpoint,
    RenameMailboxEndpoint,
    ReserveDraftAttachmentEndpoint,
    ReplayInboundEndpoint,
    SendMailboxDraftEndpoint,
    UndoMailboxSendEndpoint,
    UpdateMailboxDraftEndpoint,
    UploadDraftAttachmentEndpoint
  )
  .middleware(AuthSchemaErrorMiddleware)
  .middleware(CurrentRequestAuthMiddleware)
  .middleware(AuthOriginCheckMiddleware) {}
