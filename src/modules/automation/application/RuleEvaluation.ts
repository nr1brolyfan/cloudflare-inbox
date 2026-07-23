import * as Arr from "effect/Array";
import * as Data from "effect/Data";
import * as Order from "effect/Order";
import * as Schema from "effect/Schema";

import {
  EmailAddress,
  normalizeEmailAddressDomain,
} from "#/modules/address-routing/domain/EmailAddress";
import {
  MailboxId,
  MessageSubject,
  RuleId,
  Version,
} from "#/modules/mailbox/domain/Mailbox";
import type {
  Rule,
  RuleAddressCondition,
  RuleCondition,
  RuleTextCondition,
} from "#/modules/mailbox/domain/MailboxRule";
import {
  RuleAction,
  RuleActionIndex,
  RuleSchema,
} from "#/modules/mailbox/domain/MailboxRule";

export class RuleEvaluationError extends Data.TaggedError(
  "RuleEvaluationError"
)<{
  readonly ruleId: RuleId;
  readonly ruleVersion: Version;
  readonly message: string;
  readonly cause: unknown;
}> {}

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
