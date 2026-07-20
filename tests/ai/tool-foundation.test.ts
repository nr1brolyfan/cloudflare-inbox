import * as AuthPermission from "@effect-auth/core/Permission";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { beforeEach, describe, expect, it } from "vitest";

import { AiToolAudit, AiToolAuditEvent } from "#/ai/tool-audit";
import type { AiToolAudit as AiToolAuditService } from "#/ai/tool-audit";
import {
  AiToolExecutor,
  AiToolExecutorFoundationLive,
  CurrentAiToolScope,
  CurrentAiToolScopeSchema,
} from "#/ai/tool-executor";
import type {
  AiToolExecutor as AiToolExecutorService,
  CurrentAiToolScope as CurrentAiToolScopeValue,
} from "#/ai/tool-executor";
import {
  AiToolArguments,
  AiToolCall,
  AiToolCallId,
  AiToolExecutionError,
  AiToolFailureResult,
  AiToolName,
  AiToolResult,
  AiToolResultData,
  AiToolRunId,
  AiToolSuccessResult,
  aiToolIdMaxLength,
  aiToolJsonMaxDepth,
  aiToolJsonMaxEntries,
  aiToolJsonMaxLength,
  aiToolNameMaxLength,
} from "#/ai/tool-protocol";
import type {
  AiToolProtocolError,
  AiToolResult as AiToolResultValue,
} from "#/ai/tool-protocol";
import { MailboxId } from "#/mailboxes/core";

const call = Schema.decodeUnknownSync(AiToolCall)({
  arguments: { query: "synthetic query" },
  callId: "call-a",
  name: "synthetic_tool",
});
const trustedScope = Schema.decodeUnknownSync(CurrentAiToolScopeSchema)({
  mailboxId: "mailbox-trusted",
  runId: "run-a",
  source: "interactive-session",
});

interface AuditRecord {
  readonly event: AiToolAuditEvent;
  readonly principalId: string;
}

const auditRecords: AuditRecord[] = [];

const AiToolAuditTestLive = Layer.succeed(
  AiToolAudit,
  AiToolAudit.of({
    record: (event) =>
      Effect.gen(function* () {
        const principal = yield* AuthPermission.CurrentPrincipal;
        auditRecords.push({ event, principalId: principal.id });
      }),
  })
);

const AiToolExecutorTestLive = AiToolExecutorFoundationLive.pipe(
  Layer.provide(AiToolAuditTestLive)
);

const executeWithVisibleRequirements = (
  executor: AiToolExecutorService,
  input: AiToolCall
): Effect.Effect<
  AiToolResultValue,
  AiToolExecutionError | AiToolProtocolError,
  AuthPermission.CurrentPrincipal | CurrentAiToolScopeValue
> => executor.execute(input);

const execute = (
  input: AiToolCall,
  principalId = "user-a",
  scope = trustedScope
) =>
  AiToolExecutor.pipe(
    Effect.flatMap((executor) =>
      executeWithVisibleRequirements(executor, input)
    ),
    Effect.provide(AiToolExecutorTestLive),
    Effect.provideService(CurrentAiToolScope, scope),
    Effect.provideService(
      AuthPermission.CurrentPrincipal,
      AuthPermission.CurrentPrincipal.of(
        AuthPermission.PermissionSubject.make("user", principalId)
      )
    )
  );

const principalRequiredAuditRecord: AiToolAuditService["record"] = () =>
  AuthPermission.CurrentPrincipal.pipe(Effect.asVoid);

describe("AI tool protocol schemas", () => {
  it("brands bounded run and call identifiers", () => {
    expect(
      Schema.decodeUnknownSync(AiToolRunId)("r".repeat(aiToolIdMaxLength))
    ).toHaveLength(aiToolIdMaxLength);
    expect(
      Schema.decodeUnknownSync(AiToolCallId)("c".repeat(aiToolIdMaxLength))
    ).toHaveLength(aiToolIdMaxLength);

    for (const value of [
      "",
      "x".repeat(aiToolIdMaxLength + 1),
      "contains whitespace",
      "-starts-with-separator",
    ]) {
      expect(() => Schema.decodeUnknownSync(AiToolRunId)(value)).toThrow(/./u);
      expect(() => Schema.decodeUnknownSync(AiToolCallId)(value)).toThrow(/./u);
    }
  });

  it("accepts only bounded lower snake-case tool names", () => {
    expect(Schema.decodeUnknownSync(AiToolName)("a1_valid_tool")).toBe(
      "a1_valid_tool"
    );
    expect(
      Schema.decodeUnknownSync(AiToolName)("a".repeat(aiToolNameMaxLength))
    ).toHaveLength(aiToolNameMaxLength);

    for (const value of [
      "",
      "SendEmail",
      "send-email",
      "send__email",
      "send_email_",
      "a".repeat(aiToolNameMaxLength + 1),
    ]) {
      expect(() => Schema.decodeUnknownSync(AiToolName)(value)).toThrow(/./u);
    }
  });

  it("accepts JSON objects and rejects non-JSON argument values", () => {
    expect(
      Schema.decodeUnknownSync(AiToolArguments)({
        filters: [null, true, 3, "synthetic"],
      })
    ).toStrictEqual({ filters: [null, true, 3, "synthetic"] });

    for (const value of [null, [], "query", { value: undefined }]) {
      expect(() => Schema.decodeUnknownSync(AiToolArguments)(value)).toThrow(
        /./u
      );
    }
  });

  it.each([
    "mailboxId",
    "userId",
    "sessionId",
    "permissions",
    "allowlist",
    "operationId",
    "principalId",
  ])("rejects model-controlled identity field %s at any depth", (field) => {
    expect(() =>
      Schema.decodeUnknownSync(AiToolArguments)({
        nested: [{ authority: { [field]: "attacker-controlled" } }],
      })
    ).toThrow(/model-controlled arguments/u);
  });

  it("enforces JSON depth, entry, and serialized-size bounds", () => {
    let nested: Schema.Json = "leaf";
    for (let depth = 0; depth < aiToolJsonMaxDepth; depth += 1) {
      nested = { nested };
    }

    expect(() => Schema.decodeUnknownSync(AiToolArguments)({ nested })).toThrow(
      /levels/u
    );
    expect(() =>
      Schema.decodeUnknownSync(AiToolArguments)(
        Object.fromEntries(
          Array.from({ length: aiToolJsonMaxEntries + 1 }, (_, index) => [
            `key_${index}`,
            index,
          ])
        )
      )
    ).toThrow(/entries/u);
    expect(() =>
      Schema.decodeUnknownSync(AiToolResultData)({
        text: "x".repeat(aiToolJsonMaxLength),
      })
    ).toThrow(/Unicode code points/u);
  });

  it("normalizes sanitized success and failure results", () => {
    const success = Schema.decodeUnknownSync(AiToolResult)({
      _tag: "AiToolSuccessResult",
      callId: "call-a",
      output: { value: "synthetic" },
      prompt: "must disappear",
    });
    const failure = Schema.decodeUnknownSync(AiToolResult)({
      _tag: "AiToolFailureResult",
      callId: "call-a",
      error: {
        cause: new Error("private cause"),
        code: "execution-failed",
        message: "Tool execution failed",
        retryable: false,
      },
      result: "must disappear",
    });

    expect(success).toBeInstanceOf(AiToolSuccessResult);
    expect(success).toStrictEqual(
      new AiToolSuccessResult({
        _tag: "AiToolSuccessResult",
        callId: Schema.decodeUnknownSync(AiToolCallId)("call-a"),
        output: Schema.decodeUnknownSync(AiToolResultData)({
          value: "synthetic",
        }),
      })
    );
    expect(failure).toBeInstanceOf(AiToolFailureResult);
    expect(failure).not.toHaveProperty("result");
    const failureError = "error" in failure ? failure.error : undefined;
    expect(failureError).not.toHaveProperty("cause");
  });

  it("rejects malformed results and unsanitized error messages", () => {
    expect(() =>
      Schema.decodeUnknownSync(AiToolResult)({
        _tag: "AiToolSuccessResult",
        callId: "call-a",
        output: [],
      })
    ).toThrow(/./u);
    expect(() =>
      Schema.decodeUnknownSync(AiToolResult)({
        _tag: "AiToolFailureResult",
        callId: "call-a",
        error: {
          code: "provider-stack",
          message: "private",
          retryable: false,
        },
      })
    ).toThrow(/./u);
    expect(() =>
      Schema.decodeUnknownSync(AiToolExecutionError)({
        _tag: "AiToolExecutionError",
        callId: "call-a",
        message: "x".repeat(301),
        reason: "failed",
        retryable: false,
      })
    ).toThrow(/300 Unicode code points/u);
  });

  it("validates the trusted interactive-session scope", () => {
    expect(trustedScope).toStrictEqual({
      mailboxId: Schema.decodeUnknownSync(MailboxId)("mailbox-trusted"),
      runId: Schema.decodeUnknownSync(AiToolRunId)("run-a"),
      source: "interactive-session",
    });
    expect(() =>
      Schema.decodeUnknownSync(CurrentAiToolScopeSchema)({
        mailboxId: "mailbox-a",
        runId: "run-a",
        source: "async-workflow",
      })
    ).toThrow(/interactive-session/u);
  });
});

describe("AI tool foundation executor", () => {
  beforeEach(() => {
    auditRecords.length = 0;
  });

  it.each([
    "synthetic_tool",
    "send",
    "send_email",
    "mailbox_send",
    "draft_send",
    "reply_and_send",
    "create_and_send",
  ])("keeps the empty allowlist closed for %s", async (name) => {
    const input = Schema.decodeUnknownSync(AiToolCall)({
      arguments: {},
      callId: `call-${name}`,
      name,
    });
    const error = await Effect.runPromise(execute(input).pipe(Effect.flip));

    expect(error).toMatchObject({
      _tag: "AiToolProtocolError",
      callId: `call-${name}`,
      message: "AI tool is not available",
      reason: "unknown-tool",
    });
  });

  it("validates forbidden arguments before any dispatch or audit call", async () => {
    const forgedCall = {
      ...call,
      arguments: { mailboxId: "mailbox-attacker" },
    } as unknown as AiToolCall;
    const error = await Effect.runPromise(
      execute(forgedCall).pipe(Effect.flip)
    );

    expect(error).toMatchObject({
      _tag: "AiToolProtocolError",
      reason: "forbidden-arguments",
    });
    expect(auditRecords).toHaveLength(0);
  });

  it("isolates principals while keeping identity out of audit events", async () => {
    await Effect.runPromise(execute(call, "user-a").pipe(Effect.flip));
    await Effect.runPromise(execute(call, "user-b").pipe(Effect.flip));

    expect(auditRecords.map(({ principalId }) => principalId)).toStrictEqual([
      "user-a",
      "user-b",
    ]);
    expect(auditRecords[0]?.event).not.toHaveProperty("principal");
    expect(auditRecords[0]?.event).not.toHaveProperty("userId");
    expect(auditRecords[1]?.event).not.toHaveProperty("principal");
    expect(auditRecords[1]?.event).not.toHaveProperty("userId");
  });

  it("uses ambient scope and cannot be overridden by call fields", async () => {
    const decoded = Schema.decodeUnknownSync(AiToolCall)({
      arguments: { query: "synthetic" },
      callId: "call-scope",
      mailboxId: "mailbox-attacker",
      name: "synthetic_tool",
      runId: "run-attacker",
      source: "async-workflow",
    });
    await Effect.runPromise(execute(decoded).pipe(Effect.flip));

    expect(auditRecords).toHaveLength(1);
    expect(auditRecords[0]?.event).toMatchObject({
      mailboxId: "mailbox-trusted",
      runId: "run-a",
      source: "interactive-session",
    });
  });

  it("encodes privacy-safe audit metadata only", async () => {
    const sensitiveCall = Schema.decodeUnknownSync(AiToolCall)({
      arguments: { query: "private prompt and result" },
      callId: "call-private",
      name: "synthetic_tool",
    });
    await Effect.runPromise(
      execute(sensitiveCall, "private-user").pipe(Effect.flip)
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
    expect(JSON.stringify(encoded)).not.toContain("private prompt");
    expect(JSON.stringify(encoded)).not.toContain("private-user");
    for (const forbidden of ["arguments", "prompt", "result", "cause"]) {
      expect(encoded).not.toHaveProperty(forbidden);
    }
  });

  it("keeps the audit port principal requirement visible", () => {
    expect(principalRequiredAuditRecord).toBeTypeOf("function");
    expect(executeWithVisibleRequirements).toBeTypeOf("function");
  });
});
