import {
  AuthBadRequestError,
  AuthConflictError,
  AuthInternalError,
  AuthNotFoundError,
  AuthOriginCheckMiddleware,
  AuthPolicyDeniedError,
  AuthRequestRejectedError,
  AuthSchemaErrorMiddleware,
  AuthStepUpRequiredError,
  AuthUnauthenticatedError,
} from "@effect-auth/core/HttpApi";
import * as Schema from "effect/Schema";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/unstable/httpapi";

import { CurrentRequestAuthMiddleware } from "#/modules/account-security/contracts/RequestAuthMiddleware";
import {
  CreateMailboxDraftCommand,
  DraftEditorDraft,
  UpdateMailboxDraftCommand,
} from "#/modules/mailbox/application/MailboxDraftEditing";
import { MailboxDraftListResult } from "#/modules/mailbox/application/MailboxDraftReading";
import {
  MailboxMessageActionPayload,
  MailboxMessageActionResult,
} from "#/modules/mailbox/application/MailboxMessageActions";
import { MailboxMessageHtmlResult } from "#/modules/mailbox/application/MailboxMessageHtmlReading";
import {
  MailboxMessageListResult,
  MailboxThreadResult,
} from "#/modules/mailbox/application/MailboxMessageReading";
import {
  GetMailboxOutboundDeliveryQuery,
  GetMailboxOutboundDeliveryResult,
} from "#/modules/mailbox/application/MailboxOutboundDeliveryReading";
import {
  SendMailboxDraftCommand,
  SendMailboxDraftResult,
  UndoMailboxSendCommand,
  UndoMailboxSendResult,
} from "#/modules/mailbox/application/MailboxOutboundSending";
import {
  Cursor,
  AttachmentId,
  DraftId,
  FolderId,
  InboundIngestId,
  LabelId,
  MailboxId,
  MessageId,
  PageSize,
  SearchQuery,
  ThreadId,
} from "#/modules/mailbox/domain/Mailbox";
import {
  DraftAttachmentUploadResult,
  ReserveDraftAttachmentCommand,
  ReservedDraftAttachment,
  UploadDraftAttachmentCommand,
} from "#/modules/mailbox/domain/MailboxDraftAttachment";
import {
  InboundProcessingResult,
  ReplayInboundInput,
} from "#/modules/mailbox/domain/MailboxInbound";
import {
  BootstrapOwnerMailboxCommand,
  MailboxAdministrationReceiptSchema,
  ReadMailboxAdministrationOperationQuery,
  RenameMailboxCommand,
} from "#/modules/organization/application/MailboxAdministration";
import { MailboxNavigationResult } from "#/modules/organization/application/MailboxNavigation";
import { MailboxRecordSchema } from "#/modules/organization/domain/Mailbox";
import { BackendRequestContextMiddleware } from "#/platform/observability/BackendRequestContextMiddleware";

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
  outboundDeliveryId: GetMailboxOutboundDeliveryQuery.fields.outboundDeliveryId,
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
  AuthStepUpRequiredError,
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

export const ReadMailboxAdministrationOperationEndpoint = HttpApiEndpoint.get(
  "readOperation",
  "/api/mailboxes/operations/:operationId",
  {
    error: MailboxErrors,
    params: Schema.Struct({
      operationId: ReadMailboxAdministrationOperationQuery.fields.operationId,
    }),
    success: MailboxAdministrationReceiptSchema,
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

export const ListMailboxDraftsEndpoint = HttpApiEndpoint.get(
  "listDrafts",
  "/api/mailboxes/:mailboxId/drafts",
  {
    error: MailboxErrors,
    params: MailboxParams,
    query: Schema.Struct({
      cursor: Schema.optional(Cursor),
      limit: Schema.optional(PageSize),
    }),
    success: MailboxDraftListResult,
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
      provenance: Schema.optional(Schema.Never),
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

export const GetMailboxOutboundDeliveryEndpoint = HttpApiEndpoint.get(
  "getOutboundDelivery",
  "/api/mailboxes/:mailboxId/outbound/:outboundDeliveryId",
  {
    error: MailboxErrors,
    params: MailboxOutboundDeliveryParams,
    success: GetMailboxOutboundDeliveryResult,
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
      expectedVersion: RenameMailboxCommand.fields.expectedVersion,
      operationId: RenameMailboxCommand.fields.operationId,
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
    GetMailboxOutboundDeliveryEndpoint,
    GetMailboxThreadEndpoint,
    GetMailboxInlineAttachmentEndpoint,
    GetMailboxMessageHtmlEndpoint,
    GetMailboxNavigationEndpoint,
    ListMailboxDraftsEndpoint,
    ListMailboxMessagesEndpoint,
    ReadMailboxAdministrationOperationEndpoint,
    RenameMailboxEndpoint,
    ReserveDraftAttachmentEndpoint,
    ReplayInboundEndpoint,
    SendMailboxDraftEndpoint,
    UndoMailboxSendEndpoint,
    UpdateMailboxDraftEndpoint,
    UploadDraftAttachmentEndpoint
  )
  .middleware(AuthSchemaErrorMiddleware)
  .middleware(BackendRequestContextMiddleware)
  .middleware(CurrentRequestAuthMiddleware)
  .middleware(AuthOriginCheckMiddleware) {}

export const MailboxHttpApi = HttpApi.make("AuthApi").add(MailboxGroup);
