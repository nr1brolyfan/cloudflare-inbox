import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { SqlError } from "effect/unstable/sql/SqlError";

import { MailboxDomainErrorDto } from "./directory-rpc";
import type { MailboxDomainErrorDto as MailboxDomainErrorDtoType } from "./directory-rpc";
import type { MailboxDomainError } from "./errors/mailbox-domain-error";
import type { MailboxId } from "./identifiers";
import { MailDataRpcResponse } from "./mail-data-rpc";
import type { MailDataRpcRequest } from "./mail-data-rpc";
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

const encode = <A, R>(
  effect: Effect.Effect<
    A,
    MailboxDomainError | EffectDrizzleQueryError | SqlError,
    R
  >,
  onSuccess: (value: A) => Schema.Schema.Type<typeof MailDataRpcResponse>
) =>
  Effect.matchEffect(effect, {
    onFailure: (error) =>
      error._tag === "MailboxDomainError"
        ? Effect.succeed(domainErrorDto(error))
        : Effect.fail(error),
    onSuccess: (value) => Effect.succeed(onSuccess(value)),
  }).pipe(Effect.flatMap(Schema.encodeEffect(MailDataRpcResponse)));

export const executeMailDataRequest = (
  mailboxId: MailboxId,
  runtime: MailboxDirectoryRuntime,
  request: MailDataRpcRequest
) => {
  switch (request._tag) {
    case "ListMessages": {
      return encode(listMessages(mailboxId, request.input), (value) => ({
        _tag: "MessagesListed",
        value,
      }));
    }
    case "GetMessage": {
      return encode(getMessage(mailboxId, request.input), (value) => ({
        _tag: "MessageFound",
        value,
      }));
    }
    case "GetThread": {
      return encode(getThread(mailboxId, request.input), (value) => ({
        _tag: "ThreadFound",
        value,
      }));
    }
    case "SetMessageRead": {
      return encode(
        setMessageRead(mailboxId, request.input, runtime),
        (value) => ({ _tag: "MessageMutated", value })
      );
    }
    case "SetMessageStarred": {
      return encode(
        setMessageStarred(mailboxId, request.input, runtime),
        (value) => ({ _tag: "MessageMutated", value })
      );
    }
    case "MoveMessage": {
      return encode(
        moveMessage(mailboxId, request.input, runtime),
        (value) => ({ _tag: "MessageMutated", value })
      );
    }
    case "AddMessageLabel": {
      return encode(
        addMessageLabel(mailboxId, request.input, runtime),
        (value) => ({ _tag: "MessageMutated", value })
      );
    }
    case "RemoveMessageLabel": {
      return encode(
        removeMessageLabel(mailboxId, request.input, runtime),
        (value) => ({ _tag: "MessageMutated", value })
      );
    }
    case "CreateDraft": {
      return encode(
        createDraft(mailboxId, request.input, runtime),
        (value) => ({
          _tag: "DraftCreated",
          value,
        })
      );
    }
    case "GetDraft": {
      return encode(getDraft(mailboxId, request.input), (value) => ({
        _tag: "DraftFound",
        value,
      }));
    }
    case "UpdateDraft": {
      return encode(
        updateDraft(mailboxId, request.input, runtime),
        (value) => ({
          _tag: "DraftUpdated",
          value,
        })
      );
    }
    case "ScheduleOutbound": {
      return encode(
        scheduleOutbound(mailboxId, request.input, runtime),
        (value) => ({ _tag: "OutboundScheduled", value })
      );
    }
    case "GetOutboundDelivery": {
      return encode(getOutboundDelivery(mailboxId, request.input), (value) => ({
        _tag: "OutboundFound",
        value,
      }));
    }
    case "CancelOutboundDelivery": {
      return encode(
        cancelOutboundDelivery(mailboxId, request.input, runtime),
        (value) => ({ _tag: "OutboundCancelled", value })
      );
    }
    case "ResendOutbound": {
      return encode(
        resendOutbound(mailboxId, request.input, runtime),
        (value) => ({ _tag: "OutboundResent", value })
      );
    }
    default: {
      const exhaustive: never = request;
      return exhaustive;
    }
  }
};
