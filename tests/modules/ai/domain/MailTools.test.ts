import * as AuthPermission from "@effect-auth/core/Permission";
import * as AuthPolicy from "@effect-auth/core/Policy";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { beforeEach, describe, expect, it } from "vitest";

import {
  AiToolExecutor,
  AiToolExecutorMailReadOnlyLayer,
  CurrentAiToolScope,
  CurrentAiToolScopeSchema,
} from "#/modules/ai/application/AiToolExecutor";
import type {
  AiToolExecutor as AiToolExecutorService,
  CurrentAiToolScope as CurrentAiToolScopeValue,
} from "#/modules/ai/application/AiToolExecutor";
import { AiToolRunBudgetLayer } from "#/modules/ai/application/AiToolRunBudget";
import { AiToolAuditEvent } from "#/modules/ai/domain/AiToolAuditEvent";
import {
  AiToolCall,
  AiToolFailureResult,
  AiToolResultData,
  AiToolSuccessResult,
} from "#/modules/ai/domain/AiToolProtocol";
import type {
  AiToolExecutionError,
  AiToolProtocolError,
  AiToolResult,
} from "#/modules/ai/domain/AiToolProtocol";
import {
  MailCreateDraftArguments,
  MailCreateDraftTool,
  MailReadArguments,
  MailReadSuccess,
  MailReadTool,
  MailSearchArguments,
  MailSearchSuccess,
  MailSearchTool,
  MailThreadArguments,
  MailThreadSuccess,
  MailThreadTool,
  mailPlainTextMaxLength,
  mailSearchMaxResults,
  mailThreadMaxMessages,
} from "#/modules/ai/domain/MailTools";
import { AiToolAudit } from "#/modules/ai/ports/AiToolAudit";
import {
  MailboxMessageListResult,
  MailboxMessageReadResult,
  MailboxMessageReading,
  MailboxMessageReadingError,
  MailboxThreadResult,
} from "#/modules/mailbox/application/MailboxMessageReading";
import type { MailboxMessageReadingService } from "#/modules/mailbox/application/MailboxMessageReading";

const readResult = Schema.decodeUnknownSync(MailboxMessageReadResult)({
  activityAt: 2000,
  cc: [{ address: "copy@example.test", displayName: "Copy" }],
  direction: "inbound",
  hasAttachments: true,
  hasHtmlBody: true,
  id: "message-1",
  sender: { address: "sender@example.test", displayName: "Sender" },
  subject: "Quarterly report",
  textBody: `Safe text ${"x".repeat(mailPlainTextMaxLength + 100)}`,
  threadId: "thread-1",
  to: [{ address: "owner@example.test" }],
});

const searchResult = Schema.decodeUnknownSync(MailboxMessageListResult)({
  items: Array.from({ length: mailSearchMaxResults + 2 }, (_, index) => ({
    activityAt: 3000 - index,
    direction: "inbound",
    folderId: "inbox",
    hasAttachments: false,
    id: `message-${index + 1}`,
    read: false,
    recipients: [{ address: "owner@example.test" }],
    sender: { address: "sender@example.test", displayName: "Sender" },
    snippet: "Plain preview",
    starred: false,
    subject: "Quarterly report",
    threadId: `thread-${index + 1}`,
    version: 1,
  })),
  nextCursor: "next-search-page",
});

const threadResult = Schema.decodeUnknownSync(MailboxThreadResult)({
  hasMore: false,
  messages: Array.from({ length: mailThreadMaxMessages + 2 }, (_, index) => ({
    activityAt: 2000 + index,
    attachments: [
      {
        disposition: "attachment",
        fileName: "private.pdf",
        id: `attachment-${index + 1}`,
        mimeType: "application/pdf",
        size: 4096,
      },
    ],
    cc: [],
    direction: "inbound",
    hasHtmlBody: true,
    id: `message-${index + 1}`,
    read: true,
    sender: { address: "sender@example.test" },
    textBody: "Plain text",
    to: [{ address: "owner@example.test" }],
  })),
  thread: {
    id: "thread-1",
    latestActivityAt: 2011,
    messageCount: 12,
    subject: "Quarterly report",
    unreadCount: 0,
  },
});

const trustedScope = Schema.decodeUnknownSync(CurrentAiToolScopeSchema)({
  mailboxId: "mailbox-trusted",
  runId: "run-mail-tools",
  source: "interactive-session",
});

const makeCall = (name: string, args: Record<string, Schema.Json>) =>
  Schema.decodeUnknownSync(AiToolCall)({
    arguments: args,
    callId: `call-${name.replaceAll("_", "-")}`,
    name,
  });

const unexpected = () => Effect.die("Unexpected mail reading operation");

const readingWith = (
  overrides: Partial<MailboxMessageReadingService> = {}
): MailboxMessageReadingService =>
  MailboxMessageReading.of({
    listView: () => Effect.succeed(searchResult),
    openThread: () => Effect.succeed(threadResult),
    readMessage: () => Effect.succeed(readResult),
    ...overrides,
  });

interface AuditRecord {
  readonly event: AiToolAuditEvent;
  readonly principalId: string;
}

const auditRecords: AuditRecord[] = [];

const AuditTestLayer = Layer.succeed(
  AiToolAudit,
  AiToolAudit.of({
    record: (event) =>
      Effect.gen(function* () {
        const principal = yield* AuthPermission.CurrentPrincipal;
        auditRecords.push({ event, principalId: principal.id });
      }),
  })
);

const executeWithVisibleRequirements = (
  executor: AiToolExecutorService,
  call: AiToolCall
): Effect.Effect<
  AiToolResult,
  AiToolExecutionError | AiToolProtocolError,
  AuthPermission.CurrentPrincipal | CurrentAiToolScopeValue
> => executor.execute(call);

const execute = (
  call: AiToolCall,
  reading: MailboxMessageReadingService = readingWith(),
  principalId = "user-a",
  scope = trustedScope
) =>
  AiToolExecutor.pipe(
    Effect.flatMap((executor) =>
      executeWithVisibleRequirements(executor, call)
    ),
    Effect.provide(
      AiToolExecutorMailReadOnlyLayer.pipe(
        Layer.provide(
          Layer.merge(
            AuditTestLayer,
            Layer.merge(
              AiToolRunBudgetLayer,
              Layer.succeed(MailboxMessageReading, reading)
            )
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

describe("static mail tool contracts", () => {
  it("defines exactly the four intended static names", () => {
    expect([
      MailCreateDraftTool.name,
      MailReadTool.name,
      MailSearchTool.name,
      MailThreadTool.name,
    ]).toStrictEqual([
      "mail_create_draft",
      "mail_read",
      "mail_search",
      "mail_thread",
    ]);
  });

  it("keeps identity out of strict model-visible arguments", () => {
    expect(
      Schema.decodeUnknownSync(MailReadArguments)(
        { messageId: "message-1", view: { folderId: "inbox" } },
        { onExcessProperty: "error" }
      )
    ).toMatchObject({ messageId: "message-1" });

    for (const schema of [
      MailCreateDraftArguments,
      MailReadArguments,
      MailSearchArguments,
      MailThreadArguments,
    ]) {
      expect(() =>
        Schema.decodeUnknownSync(schema)(
          { mailboxId: "forged" },
          { onExcessProperty: "error" }
        )
      ).toThrow(/./u);
    }
  });

  it("bounds all public success collections", () => {
    expect(() =>
      Schema.decodeUnknownSync(MailSearchSuccess)({
        items: Array.from({ length: mailSearchMaxResults + 1 }, () => ({
          activityAt: 1,
          direction: "inbound",
          id: "message-1",
          recipients: [],
          snippet: "preview",
          subject: "subject",
          threadId: "thread-1",
        })),
      })
    ).toThrow(/length/u);
    expect(() =>
      Schema.decodeUnknownSync(MailThreadSuccess)({
        hasMore: false,
        messages: Array.from({ length: mailThreadMaxMessages + 1 }, () => ({
          activityAt: 1,
          cc: [],
          direction: "inbound",
          hasAttachments: false,
          id: "message-1",
          textTruncated: false,
          to: [],
        })),
        thread: {
          id: "thread-1",
          latestActivityAt: 1,
          messageCount: 11,
          subject: "subject",
          unreadCount: 0,
        },
      })
    ).toThrow(/length/u);
  });
});

describe("read-only mail tool executor", () => {
  beforeEach(() => {
    auditRecords.length = 0;
  });

  it("reads one safe message from the ambient mailbox and folder view", async () => {
    let received: unknown;
    const result = await Effect.runPromise(
      execute(
        makeCall("mail_read", {
          messageId: "message-1",
          view: { folderId: "inbox" },
        }),
        readingWith({
          readMessage: (input) => {
            received = input;
            return Effect.succeed(readResult);
          },
        })
      )
    );
    const output = successOutput(result);
    const encoded = JSON.stringify(output);

    expect(received).toStrictEqual({
      _tag: "Folder",
      folderId: "inbox",
      mailboxId: "mailbox-trusted",
      messageId: "message-1",
    });
    expect(output).toMatchObject({
      message: {
        hasAttachments: true,
        id: "message-1",
        subject: "Quarterly report",
        textTruncated: true,
        threadId: "thread-1",
      },
    });
    expect(encoded).not.toMatch(/html|mime|attachment-|private\.pdf|storage/u);
    expect([
      ...String((output.message as { plainText: string }).plainText),
    ]).toHaveLength(mailPlainTextMaxLength);
    expect(auditRecords[0]?.event.outcome).toBe("succeeded");
  });

  it("searches only the selected label view and applies result bounds", async () => {
    let received: unknown;
    const result = await Effect.runPromise(
      execute(
        makeCall("mail_search", {
          limit: 3,
          query: "quarterly report",
          read: false,
          view: { labelId: "work" },
        }),
        readingWith({
          listView: (input) => {
            received = input;
            return Effect.succeed(searchResult);
          },
        })
      )
    );
    const output = successOutput(result);

    expect(received).toMatchObject({
      _tag: "Label",
      labelId: "work",
      limit: 3,
      mailboxId: "mailbox-trusted",
      query: "quarterly report",
      read: false,
    });
    expect(output.items).toHaveLength(3);
    expect(output).toMatchObject({ nextCursor: "next-search-page" });
    expect(JSON.stringify(output)).not.toMatch(/folderId|mailboxId|version/u);
  });

  it("opens a bounded thread only through the supplied anchor message", async () => {
    let received: unknown;
    const result = await Effect.runPromise(
      execute(
        makeCall("mail_thread", {
          anchorMessageId: "message-1",
          threadId: "thread-1",
          view: { folderId: "inbox" },
        }),
        readingWith({
          openThread: (input) => {
            received = input;
            return Effect.succeed(threadResult);
          },
        })
      )
    );
    const output = successOutput(result);
    const encoded = JSON.stringify(output);

    expect(received).toStrictEqual({
      _tag: "Folder",
      folderId: "inbox",
      mailboxId: "mailbox-trusted",
      messageId: "message-1",
      threadId: "thread-1",
    });
    expect(output.messages).toHaveLength(mailThreadMaxMessages);
    expect(output).toMatchObject({ hasMore: true });
    expect(encoded).not.toMatch(
      /tracker\.test|mimeType|private\.pdf|attachment-|htmlBody/u
    );
  });

  it("rejects a thread without an anchor before invoking message reading", async () => {
    let reads = 0;
    const result = await Effect.runPromise(
      execute(
        makeCall("mail_thread", {
          threadId: "thread-1",
          view: { folderId: "inbox" },
        }),
        readingWith({
          openThread: () => {
            reads += 1;
            return Effect.succeed(threadResult);
          },
        })
      )
    );

    expect(failureResult(result).error).toMatchObject({
      code: "invalid-arguments",
      retryable: false,
    });
    expect(reads).toBe(0);
    expect(auditRecords[0]?.event.outcome).toBe("rejected");
  });

  it("rejects malformed and excess per-tool arguments before dispatch", async () => {
    const results = await Promise.all(
      [
        { messageId: 42, view: { folderId: "inbox" } },
        {
          extra: "not allowed",
          messageId: "message-1",
          view: { folderId: "inbox" },
        },
        {
          messageId: "message-1",
          view: { folderId: "inbox", labelId: "work" },
        },
      ].map((argumentsValue) =>
        Effect.runPromise(
          execute(
            makeCall(
              "mail_read",
              argumentsValue as unknown as Record<string, Schema.Json>
            ),
            readingWith({ readMessage: unexpected })
          )
        )
      )
    );
    for (const result of results) {
      expect(failureResult(result).error.code).toBe("invalid-arguments");
    }
  });

  it("measures multibyte arguments as UTF-8 bytes", async () => {
    let searches = 0;
    const result = await Effect.runPromise(
      execute(
        makeCall("mail_search", {
          query: "\u{1F642}".repeat(5000),
          view: { folderId: "inbox" },
        }),
        readingWith({
          listView: () => {
            searches += 1;
            return Effect.succeed(searchResult);
          },
        })
      )
    );

    expect(failureResult(result).error).toMatchObject({
      code: "limit-exceeded",
      message: "AI tool run limit was exceeded",
    });
    expect(searches).toBe(0);
    expect(auditRecords[0]?.event).toMatchObject({
      outcome: "rejected",
      reason: "limit-argument-bytes-per-call",
    });
  });

  it.each([
    "mailboxId",
    "principalId",
    "sessionId",
    "operationId",
    "source",
    "provenance",
    "confirmation",
    "initiator",
    "authority",
    "constructor",
    "prototype",
    "__proto__",
  ])(
    "rejects and audits forged %s authority before dispatch",
    async (field) => {
      let reads = 0;
      const valid = makeCall("mail_read", {
        messageId: "message-1",
        view: { folderId: "inbox" },
      });
      const forged = {
        ...valid,
        arguments: { ...valid.arguments, [field]: "attacker" },
      } as unknown as AiToolCall;
      const error = await Effect.runPromise(
        execute(
          forged,
          readingWith({
            readMessage: () => {
              reads += 1;
              return Effect.succeed(readResult);
            },
          })
        ).pipe(Effect.flip)
      );

      expect(error).toMatchObject({
        _tag: "AiToolProtocolError",
        reason: "forbidden-arguments",
      });
      expect({ audits: auditRecords.length, reads }).toStrictEqual({
        audits: 1,
        reads: 0,
      });
      expect(auditRecords[0]?.event).toMatchObject({
        outcome: "rejected",
        reason: "forbidden-arguments",
      });
    }
  );

  it.each(["unknown_tool", "send", "send_email", "create_draft"])(
    "fails closed for unknown or mutating name %s",
    async (name) => {
      const error = await Effect.runPromise(
        execute(makeCall(name, {}), readingWith()).pipe(Effect.flip)
      );

      expect(error).toMatchObject({
        _tag: "AiToolProtocolError",
        reason: "unknown-tool",
      });
      expect(auditRecords[0]?.event).toMatchObject({
        mailboxId: "mailbox-trusted",
        name,
        outcome: "rejected",
      });
    }
  );

  it("maps authorization denial without leaking the policy error", async () => {
    const result = await Effect.runPromise(
      execute(
        makeCall("mail_read", {
          messageId: "message-1",
          view: { labelId: "work" },
        }),
        readingWith({
          readMessage: () =>
            Effect.fail(
              new AuthPolicy.AuthorizationError({
                reason: "missing-permission",
              })
            ),
        })
      )
    );
    const failure = failureResult(result);

    expect(failure.error).toStrictEqual(
      expect.objectContaining({
        code: "denied",
        message: "Mail access was denied",
        retryable: false,
      })
    );
    expect(JSON.stringify(failure)).not.toMatch(
      /private-policy|missing-permission/u
    );
  });

  it("sanitizes expected storage errors and audits no content", async () => {
    const result = await Effect.runPromise(
      execute(
        makeCall("mail_search", {
          query: "private search terms",
          view: { folderId: "inbox" },
        }),
        readingWith({
          listView: () =>
            Effect.fail(
              new MailboxMessageReadingError({
                cause: new Error("private storage key and stack"),
                message: "private provider response",
                reason: "storage",
              })
            ),
        }),
        "private-principal"
      )
    );
    const failure = failureResult(result);
    const audit = Schema.encodeUnknownSync(AiToolAuditEvent)(
      auditRecords[0]?.event
    );

    expect(failure.error).toMatchObject({
      code: "execution-failed",
      message: "Mail content could not be loaded",
      retryable: true,
    });
    expect(JSON.stringify(failure)).not.toMatch(/private|provider|stack/u);
    expect(Object.keys(audit)).toStrictEqual([
      "callId",
      "kind",
      "mailboxId",
      "name",
      "outcome",
      "reason",
      "runId",
      "source",
    ]);
    expect(JSON.stringify(audit)).not.toMatch(/private search|principal/u);
  });

  it("isolates ambient principals without accepting principal arguments", async () => {
    const observed: string[] = [];
    const reading = readingWith({
      readMessage: () =>
        AuthPermission.CurrentPrincipal.pipe(
          Effect.tap((principal) =>
            Effect.sync(() => observed.push(principal.id))
          ),
          Effect.as(readResult)
        ),
    });
    const call = makeCall("mail_read", {
      messageId: "message-1",
      view: { labelId: "work" },
    });

    await Effect.runPromise(execute(call, reading, "user-a"));
    await Effect.runPromise(execute(call, reading, "user-b"));

    expect(observed).toStrictEqual(["user-a", "user-b"]);
    expect(auditRecords.map(({ principalId }) => principalId)).toStrictEqual([
      "user-a",
      "user-b",
    ]);
    for (const { event } of auditRecords) {
      expect(event).not.toHaveProperty("principalId");
    }
  });

  it("encodes every success through bounded JSON result data", async () => {
    const results = await Promise.all(
      [
        makeCall("mail_read", {
          messageId: "message-1",
          view: { folderId: "inbox" },
        }),
        makeCall("mail_search", {
          query: "report",
          view: { folderId: "inbox" },
        }),
        makeCall("mail_thread", {
          anchorMessageId: "message-1",
          threadId: "thread-1",
          view: { folderId: "inbox" },
        }),
      ].map((call) => Effect.runPromise(execute(call, readingWith())))
    );
    for (const result of results) {
      const output = successOutput(result);
      expect(() =>
        Schema.decodeUnknownSync(AiToolResultData)(output)
      ).not.toThrow();
    }
    expect(executeWithVisibleRequirements).toBeTypeOf("function");
    expect(() => Schema.decodeUnknownSync(MailReadSuccess)({})).toThrow(/./u);
  });
});
