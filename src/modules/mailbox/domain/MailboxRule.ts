/* oxlint-disable max-classes-per-file -- Persisted rule contracts form one mailbox domain topic. */
import * as Schema from "effect/Schema";

import { EmailAddress } from "#/shared/EmailAddress";
import { UnixMillis } from "#/shared/Temporal";

import {
  FolderId,
  InboundIngestId,
  LabelId,
  MailboxId,
  MessageId,
  RuleId,
  RuleName,
  RulePriority,
  Version,
} from "./Mailbox";

export const RuleAddressCondition = Schema.Struct({
  _tag: Schema.Literal("Address"),
  field: Schema.Literals([
    "envelopeFrom",
    "envelopeTo",
    "from",
    "to",
    "cc",
    "bcc",
  ]),
  operator: Schema.Literals(["equals", "notEquals"]),
  value: EmailAddress,
});
export type RuleAddressCondition = Schema.Schema.Type<
  typeof RuleAddressCondition
>;

export const RuleMatchText = Schema.Trim.pipe(
  Schema.check(Schema.isLengthBetween(1, 500)),
  Schema.brand("cloudflare-inbox/RuleMatchText")
);
export type RuleMatchText = Schema.Schema.Type<typeof RuleMatchText>;

export const AiRuleInstruction = Schema.Trim.pipe(
  Schema.check(Schema.isLengthBetween(1, 2000)),
  Schema.brand("cloudflare-inbox/AiRuleInstruction")
);
export type AiRuleInstruction = Schema.Schema.Type<typeof AiRuleInstruction>;

export const RuleTextCondition = Schema.Struct({
  _tag: Schema.Literal("Text"),
  field: Schema.Literals(["subject", "textBody"]),
  operator: Schema.Literals([
    "contains",
    "doesNotContain",
    "equals",
    "notEquals",
    "startsWith",
    "endsWith",
  ]),
  value: RuleMatchText,
});
export type RuleTextCondition = Schema.Schema.Type<typeof RuleTextCondition>;

export const RuleHasAttachmentCondition = Schema.Struct({
  _tag: Schema.Literal("HasAttachment"),
  value: Schema.Boolean,
});
export type RuleHasAttachmentCondition = Schema.Schema.Type<
  typeof RuleHasAttachmentCondition
>;

export const RuleCondition = Schema.Union([
  RuleAddressCondition,
  RuleTextCondition,
  RuleHasAttachmentCondition,
]);
export type RuleCondition = Schema.Schema.Type<typeof RuleCondition>;

export const RuleConditions = Schema.Struct({
  match: Schema.Literals(["all", "any"]),
  items: Schema.Array(RuleCondition),
}).check(
  Schema.makeFilter((conditions) =>
    conditions.items.length >= 1 && conditions.items.length <= 20
      ? undefined
      : "a rule must contain between 1 and 20 conditions"
  )
);
export type RuleConditions = Schema.Schema.Type<typeof RuleConditions>;

export const RuleMoveToFolderAction = Schema.Struct({
  _tag: Schema.Literal("MoveToFolder"),
  folderId: FolderId,
});
export type RuleMoveToFolderAction = Schema.Schema.Type<
  typeof RuleMoveToFolderAction
>;

export const RuleAddLabelAction = Schema.Struct({
  _tag: Schema.Literal("AddLabel"),
  labelId: LabelId,
});
export type RuleAddLabelAction = Schema.Schema.Type<typeof RuleAddLabelAction>;

export const RuleSetReadAction = Schema.Struct({
  _tag: Schema.Literal("SetRead"),
  read: Schema.Boolean,
});
export type RuleSetReadAction = Schema.Schema.Type<typeof RuleSetReadAction>;

export const RuleSetStarredAction = Schema.Struct({
  _tag: Schema.Literal("SetStarred"),
  starred: Schema.Boolean,
});
export type RuleSetStarredAction = Schema.Schema.Type<
  typeof RuleSetStarredAction
>;

export const RuleAction = Schema.Union([
  RuleMoveToFolderAction,
  RuleAddLabelAction,
  RuleSetReadAction,
  RuleSetStarredAction,
]);
export type RuleAction = Schema.Schema.Type<typeof RuleAction>;

export const RuleActions = Schema.Array(RuleAction).check(
  Schema.makeFilter((actions) => {
    if (actions.length < 1 || actions.length > 20) {
      return "a rule must contain between 1 and 20 actions";
    }
    const singletonTags = actions
      .filter((action) => action._tag !== "AddLabel")
      .map((action) => action._tag);
    if (new Set(singletonTags).size !== singletonTags.length) {
      return "folder, read, and starred actions may occur at most once";
    }
    const labelIds = actions
      .filter((action) => action._tag === "AddLabel")
      .map((action) => action.labelId);
    return new Set(labelIds).size === labelIds.length
      ? undefined
      : "a label may be added at most once by a rule";
  })
);
export type RuleActions = Schema.Schema.Type<typeof RuleActions>;

/** Lower priorities run first; equal priorities are ordered by rule ID. */
export class Rule extends Schema.Class<Rule>("cloudflare-inbox/Rule")({
  id: RuleId,
  mailboxId: MailboxId,
  name: RuleName,
  enabled: Schema.Boolean,
  priority: RulePriority,
  conditions: RuleConditions,
  actions: RuleActions,
  aiInstruction: Schema.optional(AiRuleInstruction),
  stopProcessing: Schema.Boolean,
  createdAt: UnixMillis,
  updatedAt: UnixMillis,
  version: Version,
}) {}

export const RuleSchema = Rule.check(
  Schema.makeFilter((rule) => {
    if (rule.updatedAt < rule.createdAt) {
      return "updatedAt cannot be earlier than createdAt";
    }
    return rule.aiInstruction === undefined || !rule.stopProcessing
      ? undefined
      : "AI rules cannot stop synchronous rule processing";
  })
);

export const RuleActionIndex = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(19))
);
export type RuleActionIndex = Schema.Schema.Type<typeof RuleActionIndex>;

export class RuleEvaluationRecord extends Schema.Class<RuleEvaluationRecord>(
  "cloudflare-inbox/RuleEvaluationRecord"
)({
  inboundIngestId: InboundIngestId,
  mailboxId: MailboxId,
  messageId: MessageId,
  engineVersion: Schema.Literal(1),
  stoppedByRuleId: Schema.optional(RuleId),
  evaluatedAt: UnixMillis,
}) {}

export const RuleApplicationOutcome = Schema.Literals([
  "applied",
  "noop",
  "skipped_invalid_target",
]);
export type RuleApplicationOutcome = Schema.Schema.Type<
  typeof RuleApplicationOutcome
>;

export class RuleApplication extends Schema.Class<RuleApplication>(
  "cloudflare-inbox/RuleApplication"
)({
  inboundIngestId: InboundIngestId,
  mailboxId: MailboxId,
  messageId: MessageId,
  ruleId: RuleId,
  ruleVersion: Version,
  actionIndex: RuleActionIndex,
  action: RuleAction,
  outcome: RuleApplicationOutcome,
  appliedAt: UnixMillis,
}) {}
