import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  AiInference,
  AiInferenceInput,
  aiGeneratedTextMaxLength,
} from "#/ai/inference";
import {
  WorkersAiClient,
  WorkersAiClientError,
  WorkersAiClientLive,
  WorkersAiConfigLive,
  WorkersAiGateway,
  WorkersAiInferenceLive,
  workersAiModel,
} from "#/ai/workers-ai-live";
import type {
  WorkersAiClientResponse,
  WorkersAiGatewayRequest,
} from "#/ai/workers-ai-live";

const input = Schema.decodeUnknownSync(AiInferenceInput)({
  prompt: "Summarize the synthetic document.",
  system: "Return one synthetic sentence.",
});

const runInference = (
  response: Effect.Effect<WorkersAiClientResponse, WorkersAiClientError>
) =>
  Effect.runPromise(
    AiInference.pipe(
      Effect.flatMap((inference) => inference.generate(input)),
      Effect.provide(
        WorkersAiInferenceLive.pipe(
          Layer.provide(
            Layer.succeed(
              WorkersAiClient,
              WorkersAiClient.of({ generateText: () => response })
            )
          )
        )
      )
    )
  );

const runClient = (
  run: (request: WorkersAiGatewayRequest) => Effect.Effect<unknown, unknown>
) =>
  Effect.runPromise(
    WorkersAiClient.pipe(
      Effect.flatMap((client) =>
        client.generateText({
          prompt: input.prompt,
          system: input.system,
          toolChoice: "none",
        })
      ),
      Effect.provide(
        WorkersAiClientLive.pipe(
          Layer.provide(WorkersAiConfigLive),
          Layer.provide(
            Layer.succeed(WorkersAiGateway, WorkersAiGateway.of({ run }))
          )
        )
      )
    )
  );

describe("Workers AI inference adapter", () => {
  it("returns normalized generated text and optional usage", async () => {
    const output = await runInference(
      Effect.succeed({
        finishReason: "stop",
        text: "A synthetic document was summarized.",
        toolCallCount: 0,
        usage: { inputTokens: 12, outputTokens: 6 },
      })
    );

    expect(output).toMatchObject({
      finishReason: "stop",
      text: "A synthetic document was summarized.",
      usage: { inputTokens: 12, outputTokens: 6 },
    });
  });

  it("always requests no tools and does not expose generation controls", async () => {
    let request:
      | {
          readonly prompt: string;
          readonly system: string;
          readonly toolChoice: "none";
        }
      | undefined;
    await Effect.runPromise(
      AiInference.pipe(
        Effect.flatMap((inference) => inference.generate(input)),
        Effect.provide(
          WorkersAiInferenceLive.pipe(
            Layer.provide(
              Layer.succeed(
                WorkersAiClient,
                WorkersAiClient.of({
                  generateText: (value) => {
                    request = value;
                    return Effect.succeed({
                      finishReason: "stop",
                      text: "Synthetic output",
                      toolCallCount: 0,
                    });
                  },
                })
              )
            )
          )
        )
      )
    );

    expect(request).toStrictEqual({
      prompt: input.prompt,
      system: input.system,
      toolChoice: "none",
    });
  });

  it.each([
    [
      "blank output",
      { finishReason: "stop", text: "  ", toolCallCount: 0 } as const,
      "invalid-output",
    ],
    [
      "oversized output",
      {
        finishReason: "length",
        text: "x".repeat(aiGeneratedTextMaxLength + 1),
        toolCallCount: 0,
      } as const,
      "invalid-output",
    ],
    [
      "tool calls",
      {
        finishReason: "tool-calls",
        text: "Synthetic output",
        toolCallCount: 1,
      } as const,
      "unexpected-tool-call",
    ],
  ])("rejects %s", async (_, response, reason) => {
    const failure = await runInference(Effect.succeed(response)).catch(
      (error) => error
    );

    expect(failure).toMatchObject({
      _tag: "AiInferenceError",
      reason,
      retryable: false,
    });
  });

  it("maps client failures without leaking their message", async () => {
    const failure = await runInference(
      Effect.fail(
        new WorkersAiClientError({
          cause: new Error("synthetic provider detail"),
          reason: "request",
          retryable: true,
        })
      )
    ).catch((error) => error);

    expect(failure).toMatchObject({
      message: "AI inference provider request failed",
      reason: "provider",
      retryable: true,
    });
  });
});

describe("Workers AI QueryGateway client", () => {
  it("uses the fixed model and an explicit tool-free payload", async () => {
    let captured: WorkersAiGatewayRequest | undefined;
    const response = await runClient((request) => {
      captured = request;
      return Effect.succeed({
        finish_reason: "length",
        response: "Synthetic provider response",
        usage: { completion_tokens: 4, prompt_tokens: 9, total_tokens: 13 },
      });
    });

    expect(captured).toStrictEqual({
      input: {
        max_tokens: 2048,
        messages: [
          { content: input.system, role: "system" },
          { content: input.prompt, role: "user" },
        ],
        tool_choice: "none",
      },
      model: workersAiModel,
    });
    expect(captured?.input).not.toHaveProperty("tools");
    expect(response).toStrictEqual({
      finishReason: "length",
      text: "Synthetic provider response",
      toolCallCount: 0,
      usage: { inputTokens: 9, outputTokens: 4 },
    });
  });

  it("detects unexpected provider tool calls", async () => {
    const response = await runClient(() =>
      Effect.succeed({
        response: "Synthetic response",
        tool_calls: [{ name: "synthetic_tool" }],
      })
    );

    expect(response).toMatchObject({
      finishReason: "tool-calls",
      toolCallCount: 1,
    });
  });

  it.each([
    [400, false],
    [429, true],
    [503, true],
  ])("maps provider status %i retryability", async (status, retryable) => {
    const failure = await runClient(() => Effect.fail({ status })).catch(
      (error) => error
    );

    expect(failure).toMatchObject({
      _tag: "WorkersAiClientError",
      reason: "request",
      retryable,
    });
  });

  it("treats an unclassified transport exception as retryable", async () => {
    const failure = await runClient(() =>
      Effect.fail(new Error("Synthetic transport failure"))
    ).catch((error) => error);

    expect(failure).toMatchObject({
      reason: "request",
      retryable: true,
    });
  });

  it("rejects malformed provider responses", async () => {
    const failure = await runClient(() =>
      Effect.succeed({ response: "Synthetic response", tool_calls: {} })
    ).catch((error) => error);

    expect(failure).toMatchObject({
      _tag: "WorkersAiClientError",
      reason: "invalid-response",
      retryable: false,
    });
  });
});
