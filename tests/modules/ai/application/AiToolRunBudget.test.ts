/* oxlint-disable unicorn/no-array-for-each -- Effect.forEach is not Array#forEach. */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  AiToolRunBudget,
  AiToolRunBudgetLayer,
  aiToolRunLimits,
} from "#/modules/ai/application/AiToolRunBudget";
import { AiToolCallId, AiToolName } from "#/modules/ai/domain/AiToolProtocol";

const callId = (value: string) => Schema.decodeUnknownSync(AiToolCallId)(value);
const toolName = (value: string) => Schema.decodeUnknownSync(AiToolName)(value);

describe("AI tool run budget", () => {
  it("publishes the fixed stage-10 limits", () => {
    expect(aiToolRunLimits).toStrictEqual({
      aggregateArgumentBytes: 32 * 1024,
      aggregateResultBytes: 96 * 1024,
      argumentBytesPerCall: 16 * 1024,
      mutations: 1,
      reads: 6,
      resultBytesPerCall: 32 * 1024,
      totalCalls: 8,
    });
  });

  it("starts with a fresh budget for every AI run acquisition", async () => {
    const consumeRun = Effect.gen(function* () {
      const budget = yield* AiToolRunBudget;
      for (let index = 0; index < aiToolRunLimits.totalCalls; index += 1) {
        yield* budget.consumeCall(
          callId(`fresh-run-${index}`),
          toolName("mail_read")
        );
      }
    }).pipe(Effect.provide(AiToolRunBudgetLayer));

    await expect(Effect.runPromise(consumeRun)).resolves.toBeUndefined();
    await expect(Effect.runPromise(consumeRun)).resolves.toBeUndefined();
  });

  it("atomically admits eight concurrent calls and rejects the ninth", async () => {
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const budget = yield* AiToolRunBudget;
        return yield* Effect.forEach(
          Array.from({ length: 9 }, (_, index) => index),
          (index) =>
            budget
              .consumeCall(callId(`call-${index}`), toolName("mail_read"))
              .pipe(Effect.result),
          { concurrency: "unbounded" }
        );
      }).pipe(Effect.provide(AiToolRunBudgetLayer))
    );

    expect(results.filter((result) => result._tag === "Success")).toHaveLength(
      8
    );
    expect(results.filter((result) => result._tag === "Failure")).toHaveLength(
      1
    );
    expect(results[8]).toMatchObject({
      failure: { limit: "total-calls" },
    });
  });

  it("enforces read and mutation quotas while exact retries are free", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const budget = yield* AiToolRunBudget;
        const mutationId = callId("mutation-1");
        yield* budget.consumeCall(mutationId, toolName("mail_create_draft"));
        yield* budget.consumeInput(mutationId, "mutation", 100);
        yield* budget.consumeCall(mutationId, toolName("mail_create_draft"));
        yield* budget.consumeInput(mutationId, "mutation", 100);

        const mutation2 = callId("mutation-2");
        yield* budget.consumeCall(mutation2, toolName("mail_create_draft"));
        const mutationFailure = yield* budget
          .consumeInput(mutation2, "mutation", 100)
          .pipe(Effect.result);
        expect(mutationFailure).toMatchObject({
          failure: { limit: "mutations" },
        });
      }).pipe(Effect.provide(AiToolRunBudgetLayer))
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const budget = yield* AiToolRunBudget;
        for (let index = 0; index < aiToolRunLimits.reads; index += 1) {
          const id = callId(`read-${index}`);
          yield* budget.consumeCall(id, toolName("mail_read"));
          yield* budget.consumeInput(id, "read", 1);
        }
        const read7 = callId("read-7");
        yield* budget.consumeCall(read7, toolName("mail_read"));
        const readFailure = yield* budget
          .consumeInput(read7, "read", 1)
          .pipe(Effect.result);
        expect(readFailure).toMatchObject({ failure: { limit: "reads" } });
      }).pipe(Effect.provide(AiToolRunBudgetLayer))
    );
  });

  it("enforces per-call and aggregate UTF-8 byte reservations", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const budget = yield* AiToolRunBudget;
        const tooLarge = callId("argument-large");
        yield* budget.consumeCall(tooLarge, toolName("mail_read"));
        expect(
          yield* budget
            .consumeInput(
              tooLarge,
              "read",
              aiToolRunLimits.argumentBytesPerCall + 1
            )
            .pipe(Effect.result)
        ).toMatchObject({ failure: { limit: "argument-bytes-per-call" } });

        const first = callId("argument-first");
        const second = callId("argument-second");
        yield* budget.consumeCall(first, toolName("mail_read"));
        yield* budget.consumeInput(first, "read", 16 * 1024);
        yield* budget.consumeCall(second, toolName("mail_read"));
        yield* budget.consumeInput(second, "read", 16 * 1024);

        const third = callId("argument-third");
        yield* budget.consumeCall(third, toolName("mail_read"));
        expect(
          yield* budget.consumeInput(third, "read", 1).pipe(Effect.result)
        ).toMatchObject({
          failure: { limit: "aggregate-argument-bytes" },
        });
      }).pipe(Effect.provide(AiToolRunBudgetLayer))
    );
  });

  it("enforces result limits and detects changed call replays", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const budget = yield* AiToolRunBudget;
        const id = callId("result-call");
        yield* budget.consumeCall(id, toolName("mail_read"));
        yield* budget.consumeInput(id, "read", 10);
        expect(
          yield* budget
            .consumeResult(id, aiToolRunLimits.resultBytesPerCall + 1)
            .pipe(Effect.result)
        ).toMatchObject({ failure: { limit: "result-bytes-per-call" } });
        yield* budget.consumeResult(id, 100);
        yield* budget.consumeResult(id, 100);
        expect(
          yield* budget.consumeResult(id, 101).pipe(Effect.result)
        ).toMatchObject({ failure: { limit: "replay-mismatch" } });
        expect(
          yield* budget
            .consumeCall(id, toolName("mail_search"))
            .pipe(Effect.result)
        ).toMatchObject({ failure: { limit: "replay-mismatch" } });
      }).pipe(Effect.provide(AiToolRunBudgetLayer))
    );
  });

  it("enforces the aggregate result limit", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const budget = yield* AiToolRunBudget;
        for (let index = 0; index < 3; index += 1) {
          const id = callId(`aggregate-result-${index}`);
          yield* budget.consumeCall(id, toolName("mail_read"));
          yield* budget.consumeInput(id, "read", 1);
          yield* budget.consumeResult(id, 32 * 1024);
        }
        const fourth = callId("aggregate-result-4");
        yield* budget.consumeCall(fourth, toolName("mail_read"));
        yield* budget.consumeInput(fourth, "read", 1);
        expect(
          yield* budget.consumeResult(fourth, 1).pipe(Effect.result)
        ).toMatchObject({
          failure: { limit: "aggregate-result-bytes" },
        });
      }).pipe(Effect.provide(AiToolRunBudgetLayer))
    );
  });
});
