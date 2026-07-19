import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { MailboxDomainErrorDto } from "./directory-rpc";
import type { MailboxDomainErrorDto as MailboxDomainErrorDtoType } from "./directory-rpc";
import type { MailboxDomainError } from "./errors/mailbox-domain-error";
import type { MailboxId } from "./identifiers";
import { MailDataRpcResponse } from "./mail-data-rpc";
import type {
  MailDataRpcRequest,
  MailDataRpcResponse as MailDataRpcResponseType,
} from "./mail-data-rpc";
import type { MailboxDirectoryRuntime } from "./mailbox-directory-runtime";
import { createDraft, getDraft, updateDraft } from "./mailbox-draft-sqlite";
import {
  addMessageLabel,
  getMessage,
  getThread,
  listMessages,
  moveMessage,
  removeMessageLabel,
  setMessageRead,
  setMessageStarred,
} from "./mailbox-message-sqlite";
import {
  cancelOutboundDelivery,
  getOutboundDelivery,
  resendOutbound,
  scheduleOutbound,
} from "./mailbox-outbound-sqlite";

const domainErrorDto = (error: MailboxDomainError): MailboxDomainErrorDtoType =>
  Schema.decodeUnknownSync(MailboxDomainErrorDto)({
    _tag: "DomainError",
    operation: error.operation,
    reason: error.reason,
    message: error.message,
    resourceType: error.resourceType,
    resourceId: error.resourceId,
    expectedVersion: error.expectedVersion,
    actualVersion: error.actualVersion,
  });

export const executeMailDataRequest = (
  mailboxId: MailboxId,
  runtime: MailboxDirectoryRuntime,
  request: MailDataRpcRequest
) => {
  switch (request._tag) {
    case "ListMessages": {
      return Effect.gen(function* () {
        const result = yield* Effect.result(
          listMessages(mailboxId, request.input)
        );
        if (Result.isFailure(result)) {
          if (result.failure._tag !== "MailboxDomainError") {
            return yield* Effect.fail(result.failure);
          }
          return yield* Schema.encodeEffect(MailDataRpcResponse)(
            domainErrorDto(result.failure)
          );
        }
        return yield* Schema.encodeEffect(MailDataRpcResponse)({
          _tag: "MessagesListed",
          value: result.success,
        } satisfies MailDataRpcResponseType);
      });
    }
    case "GetMessage": {
      return Effect.gen(function* () {
        const result = yield* Effect.result(
          getMessage(mailboxId, request.input)
        );
        if (Result.isFailure(result)) {
          if (result.failure._tag !== "MailboxDomainError") {
            return yield* Effect.fail(result.failure);
          }
          return yield* Schema.encodeEffect(MailDataRpcResponse)(
            domainErrorDto(result.failure)
          );
        }
        return yield* Schema.encodeEffect(MailDataRpcResponse)({
          _tag: "MessageFound",
          value: result.success,
        } satisfies MailDataRpcResponseType);
      });
    }
    case "GetThread": {
      return Effect.gen(function* () {
        const result = yield* Effect.result(
          getThread(mailboxId, request.input)
        );
        if (Result.isFailure(result)) {
          if (result.failure._tag !== "MailboxDomainError") {
            return yield* Effect.fail(result.failure);
          }
          return yield* Schema.encodeEffect(MailDataRpcResponse)(
            domainErrorDto(result.failure)
          );
        }
        return yield* Schema.encodeEffect(MailDataRpcResponse)({
          _tag: "ThreadFound",
          value: result.success,
        } satisfies MailDataRpcResponseType);
      });
    }
    case "SetMessageRead": {
      return Effect.gen(function* () {
        const result = yield* Effect.result(
          setMessageRead(mailboxId, request.input, runtime)
        );
        if (Result.isFailure(result)) {
          if (result.failure._tag !== "MailboxDomainError") {
            return yield* Effect.fail(result.failure);
          }
          return yield* Schema.encodeEffect(MailDataRpcResponse)(
            domainErrorDto(result.failure)
          );
        }
        return yield* Schema.encodeEffect(MailDataRpcResponse)({
          _tag: "MessageMutated",
          value: result.success,
        } satisfies MailDataRpcResponseType);
      });
    }
    case "SetMessageStarred": {
      return Effect.gen(function* () {
        const result = yield* Effect.result(
          setMessageStarred(mailboxId, request.input, runtime)
        );
        if (Result.isFailure(result)) {
          if (result.failure._tag !== "MailboxDomainError") {
            return yield* Effect.fail(result.failure);
          }
          return yield* Schema.encodeEffect(MailDataRpcResponse)(
            domainErrorDto(result.failure)
          );
        }
        return yield* Schema.encodeEffect(MailDataRpcResponse)({
          _tag: "MessageMutated",
          value: result.success,
        } satisfies MailDataRpcResponseType);
      });
    }
    case "MoveMessage": {
      return Effect.gen(function* () {
        const result = yield* Effect.result(
          moveMessage(mailboxId, request.input, runtime)
        );
        if (Result.isFailure(result)) {
          if (result.failure._tag !== "MailboxDomainError") {
            return yield* Effect.fail(result.failure);
          }
          return yield* Schema.encodeEffect(MailDataRpcResponse)(
            domainErrorDto(result.failure)
          );
        }
        return yield* Schema.encodeEffect(MailDataRpcResponse)({
          _tag: "MessageMutated",
          value: result.success,
        } satisfies MailDataRpcResponseType);
      });
    }
    case "AddMessageLabel": {
      return Effect.gen(function* () {
        const result = yield* Effect.result(
          addMessageLabel(mailboxId, request.input, runtime)
        );
        if (Result.isFailure(result)) {
          if (result.failure._tag !== "MailboxDomainError") {
            return yield* Effect.fail(result.failure);
          }
          return yield* Schema.encodeEffect(MailDataRpcResponse)(
            domainErrorDto(result.failure)
          );
        }
        return yield* Schema.encodeEffect(MailDataRpcResponse)({
          _tag: "MessageMutated",
          value: result.success,
        } satisfies MailDataRpcResponseType);
      });
    }
    case "RemoveMessageLabel": {
      return Effect.gen(function* () {
        const result = yield* Effect.result(
          removeMessageLabel(mailboxId, request.input, runtime)
        );
        if (Result.isFailure(result)) {
          if (result.failure._tag !== "MailboxDomainError") {
            return yield* Effect.fail(result.failure);
          }
          return yield* Schema.encodeEffect(MailDataRpcResponse)(
            domainErrorDto(result.failure)
          );
        }
        return yield* Schema.encodeEffect(MailDataRpcResponse)({
          _tag: "MessageMutated",
          value: result.success,
        } satisfies MailDataRpcResponseType);
      });
    }
    case "CreateDraft": {
      return Effect.gen(function* () {
        const result = yield* Effect.result(
          createDraft(mailboxId, request.input, runtime)
        );
        if (Result.isFailure(result)) {
          if (result.failure._tag !== "MailboxDomainError") {
            return yield* Effect.fail(result.failure);
          }
          return yield* Schema.encodeEffect(MailDataRpcResponse)(
            domainErrorDto(result.failure)
          );
        }
        return yield* Schema.encodeEffect(MailDataRpcResponse)({
          _tag: "DraftCreated",
          value: result.success,
        } satisfies MailDataRpcResponseType);
      });
    }
    case "GetDraft": {
      return Effect.gen(function* () {
        const result = yield* Effect.result(getDraft(mailboxId, request.input));
        if (Result.isFailure(result)) {
          if (result.failure._tag !== "MailboxDomainError") {
            return yield* Effect.fail(result.failure);
          }
          return yield* Schema.encodeEffect(MailDataRpcResponse)(
            domainErrorDto(result.failure)
          );
        }
        return yield* Schema.encodeEffect(MailDataRpcResponse)({
          _tag: "DraftFound",
          value: result.success,
        } satisfies MailDataRpcResponseType);
      });
    }
    case "UpdateDraft": {
      return Effect.gen(function* () {
        const result = yield* Effect.result(
          updateDraft(mailboxId, request.input, runtime)
        );
        if (Result.isFailure(result)) {
          if (result.failure._tag !== "MailboxDomainError") {
            return yield* Effect.fail(result.failure);
          }
          return yield* Schema.encodeEffect(MailDataRpcResponse)(
            domainErrorDto(result.failure)
          );
        }
        return yield* Schema.encodeEffect(MailDataRpcResponse)({
          _tag: "DraftUpdated",
          value: result.success,
        } satisfies MailDataRpcResponseType);
      });
    }
    case "ScheduleOutbound": {
      return Effect.gen(function* () {
        const result = yield* Effect.result(
          scheduleOutbound(mailboxId, request.input, runtime)
        );
        if (Result.isFailure(result)) {
          if (result.failure._tag !== "MailboxDomainError") {
            return yield* Effect.fail(result.failure);
          }
          return yield* Schema.encodeEffect(MailDataRpcResponse)(
            domainErrorDto(result.failure)
          );
        }
        return yield* Schema.encodeEffect(MailDataRpcResponse)({
          _tag: "OutboundScheduled",
          value: result.success,
        } satisfies MailDataRpcResponseType);
      });
    }
    case "GetOutboundDelivery": {
      return Effect.gen(function* () {
        const result = yield* Effect.result(
          getOutboundDelivery(mailboxId, request.input)
        );
        if (Result.isFailure(result)) {
          if (result.failure._tag !== "MailboxDomainError") {
            return yield* Effect.fail(result.failure);
          }
          return yield* Schema.encodeEffect(MailDataRpcResponse)(
            domainErrorDto(result.failure)
          );
        }
        return yield* Schema.encodeEffect(MailDataRpcResponse)({
          _tag: "OutboundFound",
          value: result.success,
        } satisfies MailDataRpcResponseType);
      });
    }
    case "CancelOutboundDelivery": {
      return Effect.gen(function* () {
        const result = yield* Effect.result(
          cancelOutboundDelivery(mailboxId, request.input, runtime)
        );
        if (Result.isFailure(result)) {
          if (result.failure._tag !== "MailboxDomainError") {
            return yield* Effect.fail(result.failure);
          }
          return yield* Schema.encodeEffect(MailDataRpcResponse)(
            domainErrorDto(result.failure)
          );
        }
        return yield* Schema.encodeEffect(MailDataRpcResponse)({
          _tag: "OutboundCancelled",
          value: result.success,
        } satisfies MailDataRpcResponseType);
      });
    }
    case "ResendOutbound": {
      return Effect.gen(function* () {
        const result = yield* Effect.result(
          resendOutbound(mailboxId, request.input, runtime)
        );
        if (Result.isFailure(result)) {
          if (result.failure._tag !== "MailboxDomainError") {
            return yield* Effect.fail(result.failure);
          }
          return yield* Schema.encodeEffect(MailDataRpcResponse)(
            domainErrorDto(result.failure)
          );
        }
        return yield* Schema.encodeEffect(MailDataRpcResponse)({
          _tag: "OutboundResent",
          value: result.success,
        } satisfies MailDataRpcResponseType);
      });
    }
    default: {
      const exhaustive: never = request;
      return exhaustive;
    }
  }
};
