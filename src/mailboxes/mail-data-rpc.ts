import * as Schema from "effect/Schema";

import { MailboxDomainErrorDto } from "./directory-rpc";
import {
  CreateDraftInput,
  DraftResult,
  GetDraftInput,
  UpdateDraftInput,
} from "./draft-contract";
import {
  AddMessageLabelInput,
  GetMessageInput,
  GetMessageResult,
  GetThreadInput,
  GetThreadResult,
  ListMessagesInput,
  MessageMutationResult,
  MessagePage,
  MoveMessageInput,
  RemoveMessageLabelInput,
  SetMessageReadInput,
  SetMessageStarredInput,
} from "./message-contract";
import {
  CancelOutboundDeliveryInput,
  GetOutboundDeliveryInput,
  OutboundDeliveryResult,
  ResendOutboundInput,
  ResendOutboundResult,
  ScheduleOutboundInput,
  ScheduleOutboundResult,
} from "./outbound-contract";

export const MailDataRpcRequest = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("ListMessages"),
    input: ListMessagesInput,
  }),
  Schema.Struct({ _tag: Schema.Literal("GetMessage"), input: GetMessageInput }),
  Schema.Struct({ _tag: Schema.Literal("GetThread"), input: GetThreadInput }),
  Schema.Struct({
    _tag: Schema.Literal("SetMessageRead"),
    input: SetMessageReadInput,
  }),
  Schema.Struct({
    _tag: Schema.Literal("SetMessageStarred"),
    input: SetMessageStarredInput,
  }),
  Schema.Struct({
    _tag: Schema.Literal("MoveMessage"),
    input: MoveMessageInput,
  }),
  Schema.Struct({
    _tag: Schema.Literal("AddMessageLabel"),
    input: AddMessageLabelInput,
  }),
  Schema.Struct({
    _tag: Schema.Literal("RemoveMessageLabel"),
    input: RemoveMessageLabelInput,
  }),
  Schema.Struct({
    _tag: Schema.Literal("CreateDraft"),
    input: CreateDraftInput,
  }),
  Schema.Struct({ _tag: Schema.Literal("GetDraft"), input: GetDraftInput }),
  Schema.Struct({
    _tag: Schema.Literal("UpdateDraft"),
    input: UpdateDraftInput,
  }),
  Schema.Struct({
    _tag: Schema.Literal("ScheduleOutbound"),
    input: ScheduleOutboundInput,
  }),
  Schema.Struct({
    _tag: Schema.Literal("GetOutboundDelivery"),
    input: GetOutboundDeliveryInput,
  }),
  Schema.Struct({
    _tag: Schema.Literal("CancelOutboundDelivery"),
    input: CancelOutboundDeliveryInput,
  }),
  Schema.Struct({
    _tag: Schema.Literal("ResendOutbound"),
    input: ResendOutboundInput,
  }),
]);
export type MailDataRpcRequest = Schema.Schema.Type<typeof MailDataRpcRequest>;

export const MailDataRpcResponse = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("MessagesListed"), value: MessagePage }),
  Schema.Struct({
    _tag: Schema.Literal("MessageFound"),
    value: GetMessageResult,
  }),
  Schema.Struct({
    _tag: Schema.Literal("ThreadFound"),
    value: GetThreadResult,
  }),
  Schema.Struct({
    _tag: Schema.Literal("MessageMutated"),
    value: MessageMutationResult,
  }),
  Schema.Struct({ _tag: Schema.Literal("DraftCreated"), value: DraftResult }),
  Schema.Struct({ _tag: Schema.Literal("DraftFound"), value: DraftResult }),
  Schema.Struct({ _tag: Schema.Literal("DraftUpdated"), value: DraftResult }),
  Schema.Struct({
    _tag: Schema.Literal("OutboundScheduled"),
    value: ScheduleOutboundResult,
  }),
  Schema.Struct({
    _tag: Schema.Literal("OutboundFound"),
    value: OutboundDeliveryResult,
  }),
  Schema.Struct({
    _tag: Schema.Literal("OutboundCancelled"),
    value: OutboundDeliveryResult,
  }),
  Schema.Struct({
    _tag: Schema.Literal("OutboundResent"),
    value: ResendOutboundResult,
  }),
  MailboxDomainErrorDto,
]);
export type MailDataRpcResponse = Schema.Schema.Type<
  typeof MailDataRpcResponse
>;
