import * as AuthPermission from "@effect-auth/core/Permission";
import * as AuthPolicy from "@effect-auth/core/Policy";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { beforeEach, describe, expect, it } from "vitest";

import {
  MailCreateDraftArguments,
  MailCreateDraftTool,
  mailPlainTextMaxLength,
} from "#/ai/mail-tools";
import { AiToolAudit, AiToolAuditEvent } from "#/ai/tool-audit";
import {
  AiToolExecutor,
  AiToolExecutorMailInteractiveLive,
  AiToolExecutorMailReadOnlyLive,
  CurrentAiToolScope,
  CurrentAiToolScopeSchema,
} from "#/ai/tool-executor";
import {
  AiToolCall,
  AiToolFailureResult,
  AiToolResultData,
  AiToolSuccessResult,
} from "#/ai/tool-protocol";
import type { AiToolResult } from "#/ai/tool-protocol";
import {
  DraftEditorDraft,
  MailboxDraftEditing,
  MailboxDraftEditingError,
} from "#/mailboxes/draft-editing";
import type {
  CreateMailboxDraftCommand,
  MailboxDraftEditing as MailboxDraftEditingService,
} from "#/mailboxes/draft-editing";
import { MailboxMessageReading } from "#/mailboxes/message-reading";
import type { MailboxMessageReading as MailboxMessageReadingService } from "#/mailboxes/message-reading";

const trustedScope = Schema.decodeUnknownSync(CurrentAiToolScopeSchema)({
  mailboxId: "mailbox-trusted",
  runId: "run-create-draft",
  source: "interactive-session",
});

const draft = Schema.decodeUnknownSync(DraftEditorDraft)({
  attachments: [],
  content: {
    bcc: [{ address: "audit@example.test" }],
    cc: [{ address: "copy@example.test" }],
    subject: "Private subject",
    textBody: "Private body",
    to: [{ address: "person@example.test", displayName: "Person" }],
  },
  createdAt: 1000,
  id: "draft-created",
  mailboxId: "mailbox-trusted",
  updatedAt: 1000,
  version: 1,
});

const createArguments = {
  bcc: [{ address: "audit@example.test" }],
  cc: [{ address: "copy@example.test" }],
  plainText: "Private body",
  subject: "Private subject",
  to: [{ address: "person@example.test", displayName: "Person" }],
} satisfies Record<string, Schema.Json>;

const makeCall = (
  name: string,
  argumentsValue: Record<string, Schema.Json> = {},
  callId = `call-${name.replaceAll("_", "-")}`
) =>
  Schema.decodeUnknownSync(AiToolCall)({
    arguments: argumentsValue,
    callId,
    name,
  });

const unexpected = () => Effect.die("Unexpected draft editing operation");

const editingWith = (
  create: MailboxDraftEditingService["create"] = () => Effect.succeed(draft)
) =>
  MailboxDraftEditing.of({
    create,
    get: unexpected,
    update: unexpected,
  });

const reading = MailboxMessageReading.of({
  listView: unexpected,
  openThread: unexpected,
  readMessage: unexpected,
});

interface AuditRecord {
  readonly event: AiToolAuditEvent;
  readonly principalId: string;
}

const auditRecords: AuditRecord[] = [];

const AuditTestLive = Layer.succeed(
  AiToolAudit,
  AiToolAudit.of({
    record: (event) =>
      Effect.gen(function* () {
        const principal = yield* AuthPermission.CurrentPrincipal;
        auditRecords.push({ event, principalId: principal.id });
      }),
  })
);

const execute = (
  call: AiToolCall,
  editing: MailboxDraftEditingService = editingWith(),
  principalId = "user-a",
  scope = trustedScope
) =>
  AiToolExecutor.pipe(
    Effect.flatMap((executor) => executor.execute(call)),
    Effect.provide(
      AiToolExecutorMailInteractiveLive.pipe(
        Layer.provide(
          Layer.mergeAll(
            AuditTestLive,
            Layer.succeed(MailboxDraftEditing, editing),
            Layer.succeed(MailboxMessageReading, reading)
          )
        )
      )
    ),
    Effect.provideService(CurrentAiToolScope, scope),
    Effect.provideService(
      AuthPermission.CurrentPrincipal,
      AuthPermission.CurrentPrincipal.of(
        AuthPermission.PermissionSubject.make("user", principalId)
      )
    )
  );

const successOutput = (result: AiToolResult) => {
  if (result instanceof AiToolSuccessResult) {
    return result.output;
  }
  throw new Error("Expected a successful tool result");
};

const failureResult = (result: AiToolResult) => {
  if (result instanceof AiToolFailureResult) {
    return result;
  }
  throw new Error("Expected a failed tool result");
};

const visibleInteractiveRequirements: Layer.Layer<
  AiToolExecutor,
  never,
  AiToolAudit | MailboxDraftEditingService | MailboxMessageReadingService
> = AiToolExecutorMailInteractiveLive;

describe("mail create draft tool", () => {
  beforeEach(() => {
    auditRecords.length = 0;
  });

  it("exposes one strict bounded plain-text draft contract", () => {
    expect(MailCreateDraftTool.name).toBe("mail_create_draft");
    expect(
      Schema.decodeUnknownSync(MailCreateDraftArguments)(createArguments, {
        onExcessProperty: "error",
      })
    ).toMatchObject({ subject: "Private subject" });
    expect(() =>
      Schema.decodeUnknownSync(MailCreateDraftArguments)(
        {
          ...createArguments,
          plainText: "x".repeat(mailPlainTextMaxLength + 1),
        },
        { onExcessProperty: "error" }
      )
    ).toThrow(/length/u);
    expect(() =>
      Schema.decodeUnknownSync(MailCreateDraftArguments)(
        { ...createArguments, sender: "attacker@example.test" },
        { onExcessProperty: "error" }
      )
    ).toThrow(/sender/u);
  });

  it("creates through draft editing with the ambient principal and mailbox", async () => {
    let command: CreateMailboxDraftCommand | undefined;
    let principalId: string | undefined;
    const result = await Effect.runPromise(
      execute(
        makeCall("mail_create_draft", createArguments),
        editingWith((input) =>
          Effect.gen(function* () {
            const principal = yield* AuthPermission.CurrentPrincipal;
            principalId = principal.id;
            command = input;
            return draft;
          })
        ),
        "authorized-user"
      )
    );
    const output = successOutput(result);

    expect(principalId).toBe("authorized-user");
    expect(command).toMatchObject({
      content: {
        bcc: [{ address: "audit@example.test" }],
        cc: [{ address: "copy@example.test" }],
        subject: "Private subject",
        textBody: "Private body",
        to: [{ address: "person@example.test", displayName: "Person" }],
      },
      mailboxId: "mailbox-trusted",
    });
    expect(command).not.toHaveProperty("sender");
    expect(command).not.toHaveProperty("attachments");
    expect(output).toStrictEqual(
      Schema.decodeUnknownSync(AiToolResultData)({
        draftId: "draft-created",
        version: 1,
      })
    );
  });

  it("uses the same bounded operation id for an exact long-id retry", async () => {
    const operationIds: string[] = [];
    const stored = new Map<string, DraftEditorDraft>();
    let storageCreates = 0;
    const editing = editingWith((command) =>
      Effect.sync(() => {
        operationIds.push(command.operationId);
        const existing = stored.get(command.operationId);
        if (existing !== undefined) {
          return existing;
        }
        storageCreates += 1;
        stored.set(command.operationId, draft);
        return draft;
      })
    );
    const scope = Schema.decodeUnknownSync(CurrentAiToolScopeSchema)({
      mailboxId: "mailbox-trusted",
      runId: `r${"a".repeat(127)}`,
      source: "interactive-session",
    });
    const call = makeCall(
      "mail_create_draft",
      createArguments,
      `c${"b".repeat(127)}`
    );

    const first = await Effect.runPromise(
      execute(call, editing, "user-a", scope)
    );
    const retry = await Effect.runPromise(
      execute(call, editing, "user-a", scope)
    );

    expect(successOutput(first)).toStrictEqual(successOutput(retry));
    expect(operationIds).toHaveLength(2);
    expect(operationIds[0]).toBe(operationIds[1]);
    expect(operationIds[0]?.length).toBeLessThanOrEqual(128);
    expect(storageCreates).toBe(1);
  });

  it("maps principal authorization denial before any storage effect", async () => {
    let storageCalls = 0;
    const result = await Effect.runPromise(
      execute(
        makeCall("mail_create_draft", createArguments),
        editingWith(() =>
          AuthPermission.CurrentPrincipal.pipe(
            Effect.flatMap(() =>
              Effect.fail(
                new AuthPolicy.AuthorizationError({
                  reason: "missing-permission",
                })
              )
            ),
            Effect.tap(() =>
              Effect.sync(() => {
                storageCalls += 1;
              })
            )
          )
        )
      )
    );

    expect(failureResult(result).error).toMatchObject({
      code: "denied",
      message: "Mail access was denied",
      retryable: false,
    });
    expect(storageCalls).toBe(0);
  });

  it.each(["mailboxId", "operationId"])(
    "rejects forged %s authority before draft editing",
    async (field) => {
      let creates = 0;
      const valid = makeCall("mail_create_draft", createArguments);
      const forged = {
        ...valid,
        arguments: { ...valid.arguments, [field]: "attacker" },
      } as unknown as AiToolCall;
      const error = await Effect.runPromise(
        execute(
          forged,
          editingWith(() => {
            creates += 1;
            return Effect.succeed(draft);
          })
        ).pipe(Effect.flip)
      );

      expect(error).toMatchObject({
        _tag: "AiToolProtocolError",
        reason: "forbidden-arguments",
      });
      expect({ audits: auditRecords.length, creates }).toStrictEqual({
        audits: 0,
        creates: 0,
      });
    }
  );

  it.each(["sender", "attachments", "attachmentIds", "sendAt", "sendNow"])(
    "rejects model-controlled outbound field %s",
    async (field) => {
      let creates = 0;
      const result = await Effect.runPromise(
        execute(
          makeCall("mail_create_draft", {
            ...createArguments,
            [field]: field === "sendNow" ? true : "attacker-controlled",
          }),
          editingWith(() => {
            creates += 1;
            return Effect.succeed(draft);
          })
        )
      );

      expect(failureResult(result).error).toMatchObject({
        code: "invalid-arguments",
        retryable: false,
      });
      expect(creates).toBe(0);
    }
  );

  it("sanitizes expected invalid draft content errors", async () => {
    const result = await Effect.runPromise(
      execute(
        makeCall("mail_create_draft", createArguments),
        editingWith(() =>
          Effect.fail(
            new MailboxDraftEditingError({
              cause: new Error("private repository key and stack"),
              message: "private domain detail",
              reason: "invalid-input",
            })
          )
        )
      )
    );
    const failure = failureResult(result);

    expect(failure.error).toMatchObject({
      code: "invalid-arguments",
      message: "Draft content is invalid",
      retryable: false,
    });
    expect(JSON.stringify(failure)).not.toMatch(/private|repository|stack/u);
  });

  it("audits metadata only and exposes no outbound layer capability", async () => {
    await Effect.runPromise(
      execute(
        makeCall("mail_create_draft", createArguments),
        editingWith(),
        "private-principal"
      )
    );
    const encoded = Schema.encodeUnknownSync(AiToolAuditEvent)(
      auditRecords[0]?.event
    );

    expect(Object.keys(encoded)).toStrictEqual([
      "callId",
      "mailboxId",
      "name",
      "outcome",
      "runId",
      "source",
    ]);
    expect(encoded).toMatchObject({
      mailboxId: "mailbox-trusted",
      name: "mail_create_draft",
      outcome: "succeeded",
    });
    expect(JSON.stringify(encoded)).not.toMatch(
      /Private subject|Private body|private-principal|person@example/u
    );
    expect(visibleInteractiveRequirements).toBe(
      AiToolExecutorMailInteractiveLive
    );
  });

  it.each([
    "send",
    "send_email",
    "mail_send",
    "mail_create_draft_and_send",
    "mail_schedule_draft",
  ])("denies unknown outbound name %s without draft editing", async (name) => {
    let creates = 0;
    const error = await Effect.runPromise(
      execute(
        makeCall(name),
        editingWith(() => {
          creates += 1;
          return Effect.succeed(draft);
        })
      ).pipe(Effect.flip)
    );

    expect(error).toMatchObject({
      _tag: "AiToolProtocolError",
      reason: "unknown-tool",
    });
    expect(creates).toBe(0);
  });

  it("keeps draft creation unavailable in the read-only executor", async () => {
    const error = await Effect.runPromise(
      AiToolExecutor.pipe(
        Effect.flatMap((executor) =>
          executor.execute(makeCall("mail_create_draft", createArguments))
        ),
        Effect.provide(
          AiToolExecutorMailReadOnlyLive.pipe(
            Layer.provide(
              Layer.merge(
                AuditTestLive,
                Layer.succeed(MailboxMessageReading, reading)
              )
            )
          )
        ),
        Effect.provideService(CurrentAiToolScope, trustedScope),
        Effect.provideService(
          AuthPermission.CurrentPrincipal,
          AuthPermission.CurrentPrincipal.of(
            AuthPermission.PermissionSubject.make("user", "user-a")
          )
        ),
        Effect.flip
      )
    );

    expect(error).toMatchObject({
      _tag: "AiToolProtocolError",
      reason: "unknown-tool",
    });
  });
});
