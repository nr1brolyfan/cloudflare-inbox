/* oxlint-disable max-classes-per-file -- Provenance variants form one closed schema-backed union. */
import { SessionIdSchema, UserIdSchema } from "@effect-auth/core/Identifiers";
import * as Context from "effect/Context";
import * as Schema from "effect/Schema";

import {
  DraftId,
  MailboxId,
  OutboundDeliveryId,
  Version,
} from "#/modules/mailbox/domain/Mailbox";
import { OperationId } from "#/shared/Operation";

const ExplicitUserActionResource = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Draft"), draftId: DraftId }),
  Schema.Struct({
    _tag: Schema.Literal("OutboundDelivery"),
    outboundDeliveryId: OutboundDeliveryId,
  }),
]);

export class ExplicitUserAction extends Schema.TaggedClass<ExplicitUserAction>(
  "cloudflare-inbox/ExplicitUserAction"
)("ExplicitUserAction", {
  action: Schema.Literals(["send-draft", "resend-outbound"]),
  actor: Schema.Struct({ sessionId: SessionIdSchema, userId: UserIdSchema }),
  expectedVersion: Version,
  mailboxId: MailboxId,
  operationId: OperationId,
  resource: ExplicitUserActionResource,
  session: Schema.Struct({ sessionId: SessionIdSchema, userId: UserIdSchema }),
}) {}

const AiExecutionId = Schema.String.pipe(
  Schema.check(Schema.isLengthBetween(1, 128))
);

export class AiToolExecution extends Schema.TaggedClass<AiToolExecution>(
  "cloudflare-inbox/AiToolExecution"
)("AiToolExecution", {
  callId: AiExecutionId,
  mailboxId: MailboxId,
  runId: AiExecutionId,
  toolName: Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 64))),
}) {}

export class SystemExecution extends Schema.TaggedClass<SystemExecution>(
  "cloudflare-inbox/SystemExecution"
)("SystemExecution", {
  operation: Schema.String.pipe(Schema.check(Schema.isLengthBetween(1, 128))),
}) {}

export const MailboxOperationProvenance = Schema.Union([
  ExplicitUserAction,
  AiToolExecution,
  SystemExecution,
]);
export type MailboxOperationProvenance = Schema.Schema.Type<
  typeof MailboxOperationProvenance
>;

/** Trusted execution origin supplied only by application boundaries. */
export class CurrentMailboxOperationProvenance extends Context.Service<
  CurrentMailboxOperationProvenance,
  MailboxOperationProvenance
>()("cloudflare-inbox/CurrentMailboxOperationProvenance") {}
