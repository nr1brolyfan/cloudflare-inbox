/* oxlint-disable max-classes-per-file -- Rule domain schemas are intentionally consolidated. */
import * as Arr from "effect/Array";
import * as Order from "effect/Order";
import * as Schema from "effect/Schema";

import {
  EmailAddress,
  FolderId,
  InboundIngestId,
  LabelId,
  MailboxId,
  MessageId,
  MessageSubject,
  RuleId,
  RuleName,
  RulePriority,
  UnixMillis,
  Version,
  normalizeEmailAddressDomain,
} from "#/modules/mailbox/domain/Mailbox";

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

export const RuleEvaluationMessage = Schema.Struct({
  envelopeFrom: Schema.optional(EmailAddress),
  envelopeTo: EmailAddress,
  from: Schema.optional(EmailAddress),
  to: Schema.Array(EmailAddress),
  cc: Schema.Array(EmailAddress),
  bcc: Schema.Array(EmailAddress),
  subject: MessageSubject,
  textBody: Schema.optional(Schema.String),
  hasAttachments: Schema.Boolean,
});
export type RuleEvaluationMessage = Schema.Schema.Type<
  typeof RuleEvaluationMessage
>;

export const EvaluateRulesInput = Schema.Struct({
  mailboxId: MailboxId,
  message: RuleEvaluationMessage,
  rules: Schema.Array(RuleSchema),
}).check(
  Schema.makeFilter((input) => {
    if (input.rules.some((rule) => rule.mailboxId !== input.mailboxId)) {
      return "every rule must belong to the evaluated mailbox";
    }
    return new Set(input.rules.map((rule) => rule.id)).size ===
      input.rules.length
      ? undefined
      : "rule IDs must be unique within an evaluation";
  })
);
export type EvaluateRulesInput = Schema.Schema.Type<typeof EvaluateRulesInput>;

export const RuleActionIndex = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(19))
);
export type RuleActionIndex = Schema.Schema.Type<typeof RuleActionIndex>;

export const RuleEvaluationResult = Schema.Struct({
  matches: Schema.Array(RuleSchema),
  stoppedByRuleId: Schema.optional(RuleId),
  actions: Schema.Array(
    Schema.Struct({
      ruleId: RuleId,
      ruleVersion: Version,
      actionIndex: RuleActionIndex,
      action: RuleAction,
    })
  ),
});
export type RuleEvaluationResult = Schema.Schema.Type<
  typeof RuleEvaluationResult
>;

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

const addressesForField = (
  message: RuleEvaluationMessage,
  field: RuleAddressCondition["field"]
): readonly EmailAddress[] =>
  ({
    envelopeFrom:
      message.envelopeFrom === undefined ? [] : [message.envelopeFrom],
    envelopeTo: [message.envelopeTo],
    from: message.from === undefined ? [] : [message.from],
    to: message.to,
    cc: message.cc,
    bcc: message.bcc,
  })[field];

const matchesAddressCondition = (
  message: RuleEvaluationMessage,
  condition: RuleAddressCondition
): boolean => {
  const expected = normalizeEmailAddressDomain(condition.value);
  const equals = addressesForField(message, condition.field).some(
    (address) => normalizeEmailAddressDomain(address) === expected
  );
  return condition.operator === "equals" ? equals : !equals;
};

const normalizeMatchText = (value: string): string =>
  value.normalize("NFC").toLocaleLowerCase("en-US");

const matchesTextCondition = (
  message: RuleEvaluationMessage,
  condition: RuleTextCondition
): boolean => {
  const actual = normalizeMatchText(
    condition.field === "subject" ? message.subject : (message.textBody ?? "")
  );
  const expected = normalizeMatchText(condition.value);

  return {
    contains: actual.includes(expected),
    doesNotContain: !actual.includes(expected),
    equals: actual === expected,
    notEquals: actual !== expected,
    startsWith: actual.startsWith(expected),
    endsWith: actual.endsWith(expected),
  }[condition.operator];
};

const matchesCondition = (
  message: RuleEvaluationMessage,
  condition: RuleCondition
): boolean => {
  if (condition._tag === "Address") {
    return matchesAddressCondition(message, condition);
  }
  return condition._tag === "Text"
    ? matchesTextCondition(message, condition)
    : message.hasAttachments === condition.value;
};

const matchesRule = (message: RuleEvaluationMessage, rule: Rule): boolean =>
  rule.conditions.match === "all"
    ? rule.conditions.items.every((condition) =>
        matchesCondition(message, condition)
      )
    : rule.conditions.items.some((condition) =>
        matchesCondition(message, condition)
      );

const RuleOrder = Order.make<Rule>((left, right) => {
  if (left.priority !== right.priority) {
    return left.priority < right.priority ? -1 : 1;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
});

/** Pure evaluation keeps retries independent of locale, storage order, and clocks. */
export const evaluateRules = (
  input: EvaluateRulesInput
): RuleEvaluationResult => {
  const orderedRules = Arr.sort(
    input.rules.filter(
      (rule) => rule.enabled && rule.aiInstruction === undefined
    ),
    RuleOrder
  );
  const matches: Rule[] = [];
  let stoppedByRuleId: RuleId | undefined;
  for (const rule of orderedRules) {
    if (!matchesRule(input.message, rule)) {
      continue;
    }
    matches.push(rule);
    if (rule.stopProcessing) {
      stoppedByRuleId = rule.id;
      break;
    }
  }
  return {
    matches,
    ...(stoppedByRuleId === undefined ? {} : { stoppedByRuleId }),
    actions: matches.flatMap((rule) =>
      rule.actions.map((action, actionIndex) => ({
        ruleId: rule.id,
        ruleVersion: rule.version,
        actionIndex,
        action,
      }))
    ),
  };
};

/** AI rules use deterministic conditions only as cheap synchronous prefilters. */
export const evaluateAsyncRuleCandidates = (
  input: EvaluateRulesInput
): readonly Rule[] => {
  const { stoppedByRuleId } = evaluateRules(input);
  const stoppingRule = input.rules.find((rule) => rule.id === stoppedByRuleId);
  return Arr.sort(
    input.rules.filter(
      (rule) =>
        rule.enabled &&
        rule.aiInstruction !== undefined &&
        (stoppingRule === undefined || RuleOrder(rule, stoppingRule) < 0) &&
        matchesRule(input.message, rule)
    ),
    RuleOrder
  );
};
