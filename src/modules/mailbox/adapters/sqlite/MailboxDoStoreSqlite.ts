import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { MailboxDirectoryStore } from "#/modules/mailbox/adapters/sqlite/MailboxDirectoryStoreSqlite";
import { MailboxDraftAttachmentStore } from "#/modules/mailbox/adapters/sqlite/MailboxDraftAttachmentStoreSqlite";
import { MailboxDraftStore } from "#/modules/mailbox/adapters/sqlite/MailboxDraftStoreSqlite";
import { MailboxInboundStore } from "#/modules/mailbox/adapters/sqlite/MailboxInboundStoreSqlite";
import { MailboxMessageStore } from "#/modules/mailbox/adapters/sqlite/MailboxMessageStoreSqlite";
import { MailboxOutboundStore } from "#/modules/mailbox/adapters/sqlite/MailboxOutboundStoreSqlite";
import { MailboxResourceIndex } from "#/modules/mailbox/adapters/sqlite/MailboxResourceIndexSqlite";
import { MailboxOutboundAlarmScheduler } from "#/modules/mailbox/application/MailboxOutboundAlarmScheduler";
import type { MailboxDomainError } from "#/modules/mailbox/domain/MailboxError";
import {
  DirectoryRpcResponse,
  directoryResponseMatchesRequest,
  encodeMailboxDomainError,
  MailDataRpcResponse,
  mailDataResponseMatchesRequest,
} from "#/modules/mailbox/ports/MailboxDoProtocol";
import type {
  DirectoryRpcRequest as DirectoryRpcRequestType,
  DirectoryRpcResponse as DirectoryRpcResponseType,
  MailDataRpcRequest as MailDataRpcRequestType,
  MailDataRpcResponse as MailDataRpcResponseType,
} from "#/modules/mailbox/ports/MailboxDoProtocol";
import { MailboxDoStore } from "#/modules/mailbox/ports/MailboxDoStore";

const protocolMismatch = (channel: string) =>
  Effect.die(new Error(`MailboxDO ${channel} dispatch metadata mismatch`));

const encodeDirectoryResponse = (
  request: DirectoryRpcRequestType,
  response: DirectoryRpcResponseType
) =>
  directoryResponseMatchesRequest(request, response)
    ? Schema.encodeEffect(DirectoryRpcResponse)(response)
    : protocolMismatch("directory");

const encodeMailDataResponse = (
  request: MailDataRpcRequestType,
  response: MailDataRpcResponseType
) =>
  mailDataResponseMatchesRequest(request, response)
    ? Schema.encodeEffect(MailDataRpcResponse)(response)
    : protocolMismatch("mail data");

const isMailboxDomainError = (error: {
  readonly _tag: string;
}): error is MailboxDomainError => error._tag === "MailboxDomainError";

const encodeMailDataResult = <A, E extends { readonly _tag: string }>(
  request: MailDataRpcRequestType,
  effect: Effect.Effect<A, E>,
  onSuccess: (value: A) => MailDataRpcResponseType
) =>
  Effect.result(effect).pipe(
    Effect.flatMap((result): Effect.Effect<unknown, unknown> => {
      if (Result.isFailure(result)) {
        return isMailboxDomainError(result.failure)
          ? encodeMailDataResponse(
              request,
              encodeMailboxDomainError(result.failure)
            )
          : Effect.fail(result.failure);
      }
      return encodeMailDataResponse(request, onSuccess(result.success));
    })
  );

// oxlint-disable-next-line eslint/complexity -- exhaustive typed RPC dispatcher
const executeMailDataRequest = (
  request: MailDataRpcRequestType,
  stores: MailboxMessageStore &
    MailboxDraftStore &
    MailboxDraftAttachmentStore &
    MailboxOutboundStore &
    MailboxInboundStore
) => {
  switch (request._tag) {
    case "ListMessages": {
      return encodeMailDataResult(
        request,
        stores.listMessages(request.input),
        (value) => ({ _tag: "MessagesListed", value })
      );
    }
    case "SearchMessages": {
      return encodeMailDataResult(
        request,
        stores.searchMessages(request.input),
        (value) => ({ _tag: "MessagesSearched", value })
      );
    }
    case "GetMessage": {
      return encodeMailDataResult(
        request,
        stores.getMessage(request.input),
        (value) => ({ _tag: "MessageFound", value })
      );
    }
    case "GetAttachmentBlob": {
      return encodeMailDataResult(
        request,
        stores.getAttachmentBlob(request.input),
        (value) => ({ _tag: "AttachmentBlobFound", value })
      );
    }
    case "GetInboundAttachmentBlob": {
      return encodeMailDataResult(
        request,
        stores.getInboundAttachmentBlob(request.input),
        (value) => ({ _tag: "InboundAttachmentBlobFound", value })
      );
    }
    case "GetThread": {
      return encodeMailDataResult(
        request,
        stores.getThread(request.input),
        (value) => ({ _tag: "ThreadFound", value })
      );
    }
    case "SetMessageRead": {
      return encodeMailDataResult(
        request,
        stores.setMessageRead(request.input),
        (value) => ({ _tag: "MessageMutated", value })
      );
    }
    case "SetMessageStarred": {
      return encodeMailDataResult(
        request,
        stores.setMessageStarred(request.input),
        (value) => ({ _tag: "MessageMutated", value })
      );
    }
    case "MoveMessage": {
      return encodeMailDataResult(
        request,
        stores.moveMessage(request.input),
        (value) => ({ _tag: "MessageMutated", value })
      );
    }
    case "AddMessageLabel": {
      return encodeMailDataResult(
        request,
        stores.addMessageLabel(request.input),
        (value) => ({ _tag: "MessageMutated", value })
      );
    }
    case "RemoveMessageLabel": {
      return encodeMailDataResult(
        request,
        stores.removeMessageLabel(request.input),
        (value) => ({ _tag: "MessageMutated", value })
      );
    }
    case "CreateDraft": {
      return encodeMailDataResult(
        request,
        stores.createDraft(request.input),
        (value) => ({ _tag: "DraftCreated", value })
      );
    }
    case "GetDraft": {
      return encodeMailDataResult(
        request,
        stores.getDraft(request.input),
        (value) => ({ _tag: "DraftFound", value })
      );
    }
    case "ListDrafts": {
      return encodeMailDataResult(
        request,
        stores.listDrafts(request.input),
        (value) => ({ _tag: "DraftsListed", value })
      );
    }
    case "UpdateDraft": {
      return encodeMailDataResult(
        request,
        stores.updateDraft(request.input),
        (value) => ({ _tag: "DraftUpdated", value })
      );
    }
    case "ReserveDraftAttachment": {
      return encodeMailDataResult(
        request,
        stores.reserveDraftAttachment(request.input),
        (value) => ({ _tag: "DraftAttachmentReserved", value })
      );
    }
    case "GetDraftAttachment": {
      return encodeMailDataResult(
        request,
        stores.getDraftAttachment(request.input),
        (value) => ({ _tag: "DraftAttachmentFound", value })
      );
    }
    case "ListDraftAttachments": {
      return encodeMailDataResult(
        request,
        stores.listDraftAttachments(request.input),
        (value) => ({ _tag: "DraftAttachmentsListed", value })
      );
    }
    case "CompleteDraftAttachment": {
      return encodeMailDataResult(
        request,
        stores.completeDraftAttachment(request.input),
        (value) => ({ _tag: "DraftAttachmentCompleted", value })
      );
    }
    case "ScheduleOutbound": {
      return encodeMailDataResult(
        request,
        stores.scheduleOutbound(request.input),
        (value) => ({ _tag: "OutboundScheduled", value })
      );
    }
    case "GetOutboundDelivery": {
      return encodeMailDataResult(
        request,
        stores.getOutboundDelivery(request.input),
        (value) => ({ _tag: "OutboundFound", value })
      );
    }
    case "CancelOutboundDelivery": {
      return encodeMailDataResult(
        request,
        stores.cancelOutboundDelivery(request.input),
        (value) => ({ _tag: "OutboundCancelled", value })
      );
    }
    case "ResendOutbound": {
      return encodeMailDataResult(
        request,
        stores.resendOutbound(request.input),
        (value) => ({ _tag: "OutboundResent", value })
      );
    }
    case "CommitInbound": {
      return encodeMailDataResult(
        request,
        stores.commit(request.input),
        (value) => ({ _tag: "InboundCommitted", value })
      );
    }
    case "RecordInboundProcessing": {
      return encodeMailDataResult(
        request,
        stores.record(request.input),
        (value) => ({ _tag: "InboundProcessingRecorded", value })
      );
    }
    case "PrepareInboundReplay": {
      return encodeMailDataResult(
        request,
        stores.prepareReplay(request.input),
        (value) => ({ _tag: "InboundReplayPrepared", value })
      );
    }
    default: {
      const exhaustive: never = request;
      return exhaustive;
    }
  }
};

const encodeDirectoryResult = <A>(
  request: DirectoryRpcRequestType,
  result: Result.Result<A, MailboxDomainError>,
  onSuccess: (value: A) => DirectoryRpcResponseType
) =>
  encodeDirectoryResponse(
    request,
    Result.match(result, {
      onFailure: encodeMailboxDomainError,
      onSuccess,
    })
  );

const executeDirectoryRequest = (
  request: DirectoryRpcRequestType,
  store: MailboxDirectoryStore
) => {
  switch (request._tag) {
    case "ListFolders": {
      return store
        .listFolders()
        .pipe(
          Effect.flatMap((value) =>
            encodeDirectoryResponse(request, { _tag: "FoldersListed", value })
          )
        );
    }
    case "CreateFolder": {
      return store.createFolder(request.input).pipe(
        Effect.flatMap((result) =>
          encodeDirectoryResult(request, result, (value) => ({
            _tag: "FolderCreated",
            value,
          }))
        )
      );
    }
    case "RenameFolder": {
      return store.renameFolder(request.input).pipe(
        Effect.flatMap((result) =>
          encodeDirectoryResult(request, result, (value) => ({
            _tag: "FolderRenamed",
            value,
          }))
        )
      );
    }
    case "DeleteFolder": {
      return store.deleteFolder(request.input).pipe(
        Effect.flatMap((result) =>
          encodeDirectoryResult(request, result, (value) => ({
            _tag: "FolderDeleted",
            value,
          }))
        )
      );
    }
    case "ListLabels": {
      return store
        .listLabels()
        .pipe(
          Effect.flatMap((value) =>
            encodeDirectoryResponse(request, { _tag: "LabelsListed", value })
          )
        );
    }
    case "CreateLabel": {
      return store.createLabel(request.input).pipe(
        Effect.flatMap((result) =>
          encodeDirectoryResult(request, result, (value) => ({
            _tag: "LabelCreated",
            value,
          }))
        )
      );
    }
    case "RenameLabel": {
      return store.renameLabel(request.input).pipe(
        Effect.flatMap((result) =>
          encodeDirectoryResult(request, result, (value) => ({
            _tag: "LabelRenamed",
            value,
          }))
        )
      );
    }
    case "DeleteLabel": {
      return store.deleteLabel(request.input).pipe(
        Effect.flatMap((result) =>
          encodeDirectoryResult(request, result, (value) => ({
            _tag: "LabelDeleted",
            value,
          }))
        )
      );
    }
    default: {
      const exhaustive: never = request;
      return exhaustive;
    }
  }
};

/** SQLite-backed aggregate store used by the Durable Object transport. */
export const MailboxDoStoreSqliteLayer = Layer.effect(
  MailboxDoStore,
  Effect.gen(function* () {
    const directoryStore = yield* MailboxDirectoryStore;
    const resourceIndex = yield* MailboxResourceIndex;
    const messageStore = yield* MailboxMessageStore;
    const draftStore = yield* MailboxDraftStore;
    const draftAttachmentStore = yield* MailboxDraftAttachmentStore;
    const outboundStore = yield* MailboxOutboundStore;
    const inboundStore = yield* MailboxInboundStore;
    const outboundAlarm = yield* MailboxOutboundAlarmScheduler;
    const mailDataStores = {
      ...messageStore,
      ...draftStore,
      ...draftAttachmentStore,
      ...outboundStore,
      ...inboundStore,
    };

    return MailboxDoStore.of({
      executeDirectory: (request) =>
        executeDirectoryRequest(request, directoryStore),
      executeMailData: (request) =>
        Effect.gen(function* () {
          const response = yield* executeMailDataRequest(
            request,
            mailDataStores
          );
          if (
            request._tag === "ScheduleOutbound" ||
            request._tag === "CancelOutboundDelivery" ||
            request._tag === "ResendOutbound"
          ) {
            yield* outboundAlarm.reconcile;
          }
          return response;
        }),
      resolveMailResource: resourceIndex.resolve,
    });
  })
);
