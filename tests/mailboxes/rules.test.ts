import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  EvaluateRulesInput,
  Rule,
  RuleActions,
  RuleConditions,
  RuleSchema,
  evaluateAsyncRuleCandidates,
  evaluateRules,
} from "#/mailboxes/rules";
import { RulePriority } from "#/modules/mailbox/domain/Mailbox";

const decodeSucceeds = <S extends Schema.ConstraintDecoder<unknown, never>>(
  schema: S,
  input: unknown
) => Exit.isSuccess(Schema.decodeUnknownExit(schema)(input));

const ruleInput = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  id: "rule-important",
  mailboxId: "primary",
  name: "Important customer mail",
  enabled: true,
  priority: 100,
  conditions: {
    match: "all",
    items: [
      {
        _tag: "Address",
        field: "envelopeTo",
        operator: "equals",
        value: "support@example.com",
      },
      {
        _tag: "Text",
        field: "subject",
        operator: "contains",
        value: " urgent ",
      },
      { _tag: "HasAttachment", value: true },
    ],
  },
  actions: [
    { _tag: "MoveToFolder", folderId: "priority" },
    { _tag: "AddLabel", labelId: "important" },
    { _tag: "SetRead", read: true },
    { _tag: "SetStarred", starred: true },
  ],
  stopProcessing: false,
  createdAt: 1000,
  updatedAt: 1000,
  version: 1,
  ...overrides,
});

const messageInput = {
  envelopeFrom: "Sender@EXAMPLE.COM",
  envelopeTo: "support@example.com",
  from: "customer@example.com",
  to: ["owner@example.com"],
  cc: ["manager@example.com"],
  bcc: ["audit@example.com"],
  subject: "Résumé URGENT",
  textBody: "Please review the attached report",
  hasAttachments: true,
};

const evaluate = (
  rules: readonly ReturnType<typeof ruleInput>[],
  message: Readonly<Record<string, unknown>> = messageInput
) =>
  evaluateRules(
    Schema.decodeUnknownSync(EvaluateRulesInput)({
      mailboxId: "primary",
      message,
      rules,
    })
  );

describe("mailbox rules", () => {
  it("decodes and encodes a transport-neutral rule", () => {
    const rule = Schema.decodeUnknownSync(RuleSchema)(
      ruleInput({ conditionsJson: "must-not-leak" })
    );

    expect(rule).toBeInstanceOf(Rule);
    expect(rule.conditions.items[1]).toMatchObject({ value: "urgent" });
    expect(Schema.encodeSync(Rule)(rule)).toStrictEqual(
      ruleInput({
        conditions: {
          ...ruleInput().conditions,
          items: [
            ruleInput().conditions.items[0],
            { ...ruleInput().conditions.items[1], value: "urgent" },
            ruleInput().conditions.items[2],
          ],
        },
      })
    );
  });

  it("validates the bounded integer priority", () => {
    expect([
      decodeSucceeds(RulePriority, 0),
      decodeSucceeds(RulePriority, 1_000_000),
      decodeSucceeds(RulePriority, -1),
      decodeSucceeds(RulePriority, 1_000_001),
      decodeSucceeds(RulePriority, 1.5),
    ]).toStrictEqual([true, true, false, false, false]);
  });

  it("requires a non-empty bounded all-or-any condition group", () => {
    const condition = {
      _tag: "HasAttachment",
      value: false,
    };

    expect(
      decodeSucceeds(RuleConditions, { match: "any", items: [condition] })
    ).toBeTruthy();
    expect(
      decodeSucceeds(RuleConditions, { match: "all", items: [] })
    ).toBeFalsy();
    expect(
      decodeSucceeds(RuleConditions, {
        match: "any",
        items: Array.from({ length: 21 }, () => condition),
      })
    ).toBeFalsy();
    expect(
      decodeSucceeds(RuleConditions, { match: "none", items: [condition] })
    ).toBeFalsy();
  });

  it("rejects mismatched fields, operators, and invalid rule timestamps", () => {
    expect(
      decodeSucceeds(RuleConditions, {
        match: "all",
        items: [
          {
            _tag: "Address",
            field: "subject",
            operator: "contains",
            value: "support@example.com",
          },
        ],
      })
    ).toBeFalsy();
    expect(
      decodeSucceeds(RuleConditions, {
        match: "all",
        items: [
          {
            _tag: "Text",
            field: "subject",
            operator: "matchesRegex",
            value: "urgent",
          },
        ],
      })
    ).toBeFalsy();
    expect(
      decodeSucceeds(RuleSchema, ruleInput({ createdAt: 2000 }))
    ).toBeFalsy();
  });

  it("validates folder, label, read, and starred actions", () => {
    expect([
      decodeSucceeds(RuleActions, ruleInput().actions),
      decodeSucceeds(RuleActions, []),
      decodeSucceeds(RuleActions, [
        { _tag: "MoveToFolder", folderId: "archive" },
        { _tag: "MoveToFolder", folderId: "trash" },
      ]),
      decodeSucceeds(RuleActions, [
        { _tag: "AddLabel", labelId: "important" },
        { _tag: "AddLabel", labelId: "important" },
      ]),
      decodeSucceeds(RuleActions, [
        { _tag: "SetRead", read: true },
        { _tag: "SetRead", read: false },
      ]),
      decodeSucceeds(RuleActions, [
        { _tag: "MoveToFolder", folderId: " archive " },
      ]),
    ]).toStrictEqual([true, false, false, false, false, false]);
  });

  it("plans actions in priority, rule ID, and declaration order", () => {
    const rules = [
      ruleInput({
        id: "rule-z",
        priority: 100,
        actions: [{ _tag: "SetRead", read: false }],
      }),
      ruleInput({
        id: "rule-middle",
        priority: 10,
        actions: [{ _tag: "MoveToFolder", folderId: "archive" }],
      }),
      ruleInput({
        id: "rule-a",
        priority: 100,
        actions: [
          { _tag: "AddLabel", labelId: "vip" },
          { _tag: "SetStarred", starred: true },
        ],
      }),
      ruleInput({ id: "rule-disabled", priority: 0, enabled: false }),
    ];
    const originalOrder = rules.map((rule) => rule.id);
    const result = evaluate(rules);

    expect(result.matches.map((rule) => rule.id)).toStrictEqual([
      "rule-middle",
      "rule-a",
      "rule-z",
    ]);
    expect(result.actions).toStrictEqual([
      {
        ruleId: "rule-middle",
        ruleVersion: 1,
        actionIndex: 0,
        action: { _tag: "MoveToFolder", folderId: "archive" },
      },
      {
        ruleId: "rule-a",
        ruleVersion: 1,
        actionIndex: 0,
        action: { _tag: "AddLabel", labelId: "vip" },
      },
      {
        ruleId: "rule-a",
        ruleVersion: 1,
        actionIndex: 1,
        action: { _tag: "SetStarred", starred: true },
      },
      {
        ruleId: "rule-z",
        ruleVersion: 1,
        actionIndex: 0,
        action: { _tag: "SetRead", read: false },
      },
    ]);
    expect(rules.map((rule) => rule.id)).toStrictEqual(originalOrder);
  });

  it("stops only after an enabled matching stopProcessing rule", () => {
    const rules = [
      ruleInput({
        id: "disabled-stop",
        priority: 0,
        enabled: false,
        stopProcessing: true,
        actions: [{ _tag: "AddLabel", labelId: "disabled" }],
      }),
      ruleInput({
        id: "unmatched-stop",
        priority: 1,
        stopProcessing: true,
        conditions: {
          match: "all",
          items: [{ _tag: "HasAttachment", value: false }],
        },
        actions: [{ _tag: "AddLabel", labelId: "unmatched" }],
      }),
      ruleInput({
        id: "before-stop",
        priority: 2,
        actions: [{ _tag: "AddLabel", labelId: "before" }],
      }),
      ruleInput({
        id: "matching-stop",
        priority: 3,
        stopProcessing: true,
        actions: [{ _tag: "SetRead", read: true }],
      }),
      ruleInput({
        id: "after-stop",
        priority: 4,
        actions: [{ _tag: "SetStarred", starred: true }],
      }),
    ];

    const result = evaluate(rules);

    expect(result.matches.map((rule) => rule.id)).toStrictEqual([
      "before-stop",
      "matching-stop",
    ]);
    expect(result.stoppedByRuleId).toBe("matching-stop");
    expect(result.actions.map((action) => action.ruleId)).toStrictEqual([
      "before-stop",
      "matching-stop",
    ]);
  });

  it("requires stopProcessing to be explicit in the rule contract", () => {
    const { stopProcessing: _, ...withoutStopProcessing } = ruleInput();

    expect(decodeSucceeds(RuleSchema, withoutStopProcessing)).toBeFalsy();
  });

  it("separates AI candidates from synchronous rule evaluation", () => {
    const aiRule = ruleInput({
      id: "ai-rule",
      aiInstruction: "Decide whether this message is an urgent escalation",
    });
    const input = Schema.decodeUnknownSync(EvaluateRulesInput)({
      mailboxId: "primary",
      message: messageInput,
      rules: [aiRule],
    });

    expect(evaluateRules(input).matches).toStrictEqual([]);
    expect(
      evaluateAsyncRuleCandidates(input).map((rule) => rule.id)
    ).toStrictEqual(["ai-rule"]);
    expect(
      decodeSucceeds(RuleSchema, {
        ...aiRule,
        stopProcessing: true,
      })
    ).toBeFalsy();
  });

  it.each([
    ["envelopeFrom", "Sender@example.com"],
    ["envelopeTo", "support@example.com"],
    ["from", "customer@example.com"],
    ["to", "owner@example.com"],
    ["cc", "manager@example.com"],
    ["bcc", "audit@example.com"],
  ])("matches the %s address field", (field, value) => {
    const rule = ruleInput({
      conditions: {
        match: "all",
        items: [{ _tag: "Address", field, operator: "equals", value }],
      },
    });

    expect(evaluate([rule]).matches).toHaveLength(1);
  });

  it("compares address domains case-insensitively without folding local parts", () => {
    const exactLocalPart = ruleInput({
      id: "exact-local-part",
      conditions: {
        match: "all",
        items: [
          {
            _tag: "Address",
            field: "envelopeFrom",
            operator: "equals",
            value: "Sender@example.com",
          },
        ],
      },
    });
    const foldedLocalPart = ruleInput({
      id: "folded-local-part",
      conditions: {
        match: "all",
        items: [
          {
            _tag: "Address",
            field: "envelopeFrom",
            operator: "equals",
            value: "sender@example.com",
          },
        ],
      },
    });

    expect(
      evaluate([foldedLocalPart, exactLocalPart]).matches.map((rule) => rule.id)
    ).toStrictEqual(["exact-local-part"]);
  });

  it.each([
    ["subject", "contains", "re\u0301sume\u0301", true],
    ["subject", "doesNotContain", "closed", true],
    ["subject", "startsWith", "RÉSUMÉ", true],
    ["subject", "endsWith", "urgent", true],
    ["textBody", "equals", "PLEASE REVIEW THE ATTACHED REPORT", true],
    ["textBody", "notEquals", "another body", true],
    ["textBody", "contains", "missing", false],
  ])(
    "evaluates %s %s text deterministically",
    (field, operator, value, expected) => {
      const rule = ruleInput({
        conditions: {
          match: "all",
          items: [{ _tag: "Text", field, operator, value }],
        },
      });

      expect(evaluate([rule]).matches).toHaveLength(expected ? 1 : 0);
    }
  );

  it("uses explicit all and any semantics including attachment conditions", () => {
    const all = ruleInput({
      id: "all",
      conditions: {
        match: "all",
        items: [
          { _tag: "HasAttachment", value: true },
          {
            _tag: "Text",
            field: "subject",
            operator: "contains",
            value: "missing",
          },
        ],
      },
    });
    const any = ruleInput({
      id: "any",
      conditions: {
        match: "any",
        items: [
          { _tag: "HasAttachment", value: false },
          {
            _tag: "Text",
            field: "subject",
            operator: "contains",
            value: "urgent",
          },
        ],
      },
    });

    expect(evaluate([all, any]).matches.map((rule) => rule.id)).toStrictEqual([
      "any",
    ]);
  });

  it("rejects cross-mailbox and duplicate rule evaluation inputs", () => {
    expect(
      decodeSucceeds(EvaluateRulesInput, {
        mailboxId: "primary",
        message: messageInput,
        rules: [ruleInput({ mailboxId: "another" })],
      })
    ).toBeFalsy();
    expect(
      decodeSucceeds(EvaluateRulesInput, {
        mailboxId: "primary",
        message: messageInput,
        rules: [ruleInput(), ruleInput()],
      })
    ).toBeFalsy();
  });
});
