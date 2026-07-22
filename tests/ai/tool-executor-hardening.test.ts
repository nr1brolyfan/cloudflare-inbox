import * as AuthPermission from "@effect-auth/core/Permission";
import * as AuthPolicy from "@effect-auth/core/Policy";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { AiToolAudit, AiToolAuditError } from "#/ai/tool-audit";
import {
  AiToolExecutor,
  AiToolExecutorFoundationLive,
  AiToolExecutorMailInteractiveLive,
  CurrentAiToolScope,
  CurrentAiToolScopeSchema,
} from "#/ai/tool-executor";
import { AiToolCall, AiToolSuccessResult } from "#/ai/tool-protocol";
import { AiToolRunBudgetLive } from "#/ai/tool-run-budget";
import {
  DraftEditorDraft,
  MailboxDraftEditing,
} from "#/mailboxes/draft-editing";
import {
  MailboxMessageReading,
  MailboxMessageReadResult,
} from "#/modules/mailbox/application/MailboxMessageReading";
import type { MailboxMessageReadingService } from "#/modules/mailbox/application/MailboxMessageReading";

const scope = Schema.decodeUnknownSync(CurrentAiToolScopeSchema)({
  mailboxId: "mailbox-a",
  runId: "run-a",
  source: "interactive-session",
});
const principal = AuthPermission.CurrentPrincipal.of(
  AuthPermission.PermissionSubject.make("user", "user-a")
);
const readResult = Schema.decodeUnknownSync(MailboxMessageReadResult)({
  activityAt: 1000,
  cc: [],
  direction: "inbound",
  hasAttachments: false,
  hasHtmlBody: false,
  id: "message-a",
  sender: { address: "sender@example.test" },
  subject: "Subject",
  textBody: "Body",
  threadId: "thread-a",
  to: [{ address: "owner@example.test" }],
});
const draft = Schema.decodeUnknownSync(DraftEditorDraft)({
  attachments: [],
  content: {
    bcc: [],
    cc: [],
    subject: "Subject",
    textBody: "Body",
    to: [{ address: "person@example.test" }],
  },
  createdAt: 1000,
  id: "draft-a",
  mailboxId: "mailbox-a",
  updatedAt: 1000,
  version: 1,
});
const readCall = Schema.decodeUnknownSync(AiToolCall)({
  arguments: { messageId: "message-a", view: { folderId: "inbox" } },
  callId: "call-read",
  name: "mail_read",
});
const draftCall = Schema.decodeUnknownSync(AiToolCall)({
  arguments: {
    bcc: [],
    cc: [],
    plainText: "Body",
    subject: "Subject",
    to: [{ address: "person@example.test" }],
  },
  callId: "call-draft",
  name: "mail_create_draft",
});
const unexpected = () => Effect.die("Unexpected operation");
const auditError = () =>
  new AiToolAuditError({
    cause: new Error("D1 unavailable"),
    reason: "storage",
  });

describe("AI tool executor audit fail-closed behavior", () => {
  it("charges malformed safe envelopes to total quota only", async () => {
    const records: unknown[] = [];
    const executorLive = AiToolExecutorFoundationLive.pipe(
      Layer.provide(
        Layer.merge(
          AiToolRunBudgetLive,
          Layer.succeed(
            AiToolAudit,
            AiToolAudit.of({
              record: (auditEvent) =>
                Effect.sync(() => records.push(auditEvent)).pipe(Effect.asVoid),
            })
          )
        )
      )
    );
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const executor = yield* AiToolExecutor;
        for (let index = 0; index < 8; index += 1) {
          const malformed = {
            arguments: {},
            callId: `malformed-${index}`,
            excess: true,
            name: "unknown_tool",
          };
          const result = yield* executor.execute(malformed).pipe(Effect.result);
          expect(result).toMatchObject({
            failure: { reason: "invalid-call" },
          });
        }
        return yield* executor.execute({
          arguments: {},
          callId: "ninth-call",
          name: "unknown_tool",
        });
      }).pipe(
        Effect.provide(executorLive),
        Effect.provideService(CurrentAiToolScope, scope),
        Effect.provideService(AuthPermission.CurrentPrincipal, principal)
      )
    );

    expect(results).toMatchObject({
      error: { code: "limit-exceeded" },
    });
    expect(records).toHaveLength(9);
  });

  it("does not charge malformed input without safe call metadata", async () => {
    const executorLive = AiToolExecutorFoundationLive.pipe(
      Layer.provide(
        Layer.merge(
          AiToolRunBudgetLive,
          Layer.succeed(
            AiToolAudit,
            AiToolAudit.of({ record: () => Effect.void })
          )
        )
      )
    );
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const executor = yield* AiToolExecutor;
        for (let index = 0; index < 20; index += 1) {
          yield* executor
            .execute({ arguments: {}, name: "unknown_tool" })
            .pipe(Effect.result);
        }
        return yield* executor
          .execute({
            arguments: {},
            callId: "valid-metadata",
            name: "unknown_tool",
          })
          .pipe(Effect.result);
      }).pipe(
        Effect.provide(executorLive),
        Effect.provideService(CurrentAiToolScope, scope),
        Effect.provideService(AuthPermission.CurrentPrincipal, principal)
      )
    );

    expect(result).toMatchObject({
      failure: { reason: "unknown-tool" },
    });
  });

  it("withholds read results and denials when audit fails", async () => {
    let reads = 0;
    const reading = MailboxMessageReading.of({
      listView: unexpected,
      openThread: unexpected,
      readMessage: () => {
        reads += 1;
        return Effect.succeed(readResult);
      },
    });
    const executorLive = AiToolExecutorMailInteractiveLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          AiToolRunBudgetLive,
          Layer.succeed(
            AiToolAudit,
            AiToolAudit.of({ record: () => Effect.fail(auditError()) })
          ),
          Layer.succeed(MailboxMessageReading, reading),
          Layer.succeed(
            MailboxDraftEditing,
            MailboxDraftEditing.of({
              create: unexpected,
              get: unexpected,
              update: unexpected,
            })
          )
        )
      )
    );
    const run = (readingEffect: MailboxMessageReadingService["readMessage"]) =>
      AiToolExecutor.pipe(
        Effect.flatMap((executor) => executor.execute(readCall)),
        Effect.provide(
          executorLive.pipe(
            Layer.provide(
              Layer.succeed(
                MailboxMessageReading,
                MailboxMessageReading.of({
                  ...reading,
                  readMessage: readingEffect,
                })
              )
            )
          )
        ),
        Effect.provideService(CurrentAiToolScope, scope),
        Effect.provideService(AuthPermission.CurrentPrincipal, principal),
        Effect.result
      );

    const successAuditFailure = await Effect.runPromise(
      AiToolExecutor.pipe(
        Effect.flatMap((executor) => executor.execute(readCall)),
        Effect.provide(executorLive),
        Effect.provideService(CurrentAiToolScope, scope),
        Effect.provideService(AuthPermission.CurrentPrincipal, principal),
        Effect.result
      )
    );
    expect(successAuditFailure).toMatchObject({
      failure: {
        _tag: "AiToolExecutionError",
        message: "AI tool execution could not be audited",
      },
    });
    expect(reads).toBe(1);

    const deniedAuditFailure = await Effect.runPromise(
      run(() =>
        Effect.fail(
          new AuthPolicy.AuthorizationError({ reason: "missing-permission" })
        )
      )
    );
    expect(deniedAuditFailure).toMatchObject({
      failure: { _tag: "AiToolExecutionError" },
    });
  });

  it("retries an idempotent draft and repairs a missing audit row", async () => {
    let auditAttempts = 0;
    const operationIds: string[] = [];
    const executorLive = AiToolExecutorMailInteractiveLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          AiToolRunBudgetLive,
          Layer.succeed(
            AiToolAudit,
            AiToolAudit.of({
              record: () => {
                auditAttempts += 1;
                return auditAttempts === 1
                  ? Effect.fail(auditError())
                  : Effect.void;
              },
            })
          ),
          Layer.succeed(
            MailboxMessageReading,
            MailboxMessageReading.of({
              listView: unexpected,
              openThread: unexpected,
              readMessage: unexpected,
            })
          ),
          Layer.succeed(
            MailboxDraftEditing,
            MailboxDraftEditing.of({
              create: (input) => {
                operationIds.push(input.operationId);
                return Effect.succeed(draft);
              },
              get: unexpected,
              update: unexpected,
            })
          )
        )
      )
    );

    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const executor = yield* AiToolExecutor;
        const first = yield* executor.execute(draftCall).pipe(Effect.result);
        const second = yield* executor.execute(draftCall);
        return { first, second };
      }).pipe(
        Effect.provide(executorLive),
        Effect.provideService(CurrentAiToolScope, scope),
        Effect.provideService(AuthPermission.CurrentPrincipal, principal)
      )
    );

    expect(results.first).toMatchObject({
      failure: { _tag: "AiToolExecutionError" },
    });
    expect(results.second).toBeInstanceOf(AiToolSuccessResult);
    expect(operationIds).toStrictEqual([operationIds[0], operationIds[0]]);
    expect(auditAttempts).toBe(2);
  });
});
