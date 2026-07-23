import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { RulePriority } from "#/modules/mailbox/domain/Mailbox";
import {
  Rule,
  RuleActions,
  RuleConditions,
  RuleSchema,
} from "#/modules/mailbox/domain/MailboxRule";

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

describe("mailbox rule contracts", () => {
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

  it("requires stopProcessing to be explicit", () => {
    const { stopProcessing: _, ...withoutStopProcessing } = ruleInput();

    expect(decodeSucceeds(RuleSchema, withoutStopProcessing)).toBeFalsy();
  });

  it("rejects stopProcessing on AI rules", () => {
    expect(
      decodeSucceeds(
        RuleSchema,
        ruleInput({
          aiInstruction: "Decide whether this is an urgent escalation",
          stopProcessing: true,
        })
      )
    ).toBeFalsy();
  });
});
