import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  AiInference,
  AiInferenceInput,
  AiInferenceOutput,
  AiInferenceUnavailableLive,
  aiGeneratedTextMaxLength,
  aiPromptTextMaxLength,
  aiSystemTextMaxLength,
} from "#/ai/inference";

describe("AI inference contract", () => {
  it("accepts only bounded system and prompt text", () => {
    const input = Schema.decodeUnknownSync(AiInferenceInput)({
      prompt: "p".repeat(aiPromptTextMaxLength),
      system: "s".repeat(aiSystemTextMaxLength),
    });

    expect(input.prompt).toHaveLength(aiPromptTextMaxLength);
    expect(input.system).toHaveLength(aiSystemTextMaxLength);
    expect(Object.keys(input)).toStrictEqual(["prompt", "system"]);
  });

  it.each([
    ["blank system text", { prompt: "Synthetic prompt", system: "  " }],
    [
      "oversized system text",
      {
        prompt: "Synthetic prompt",
        system: "s".repeat(aiSystemTextMaxLength + 1),
      },
    ],
    ["blank prompt text", { prompt: "\n", system: "Synthetic system" }],
    [
      "oversized prompt text",
      {
        prompt: "p".repeat(aiPromptTextMaxLength + 1),
        system: "Synthetic system",
      },
    ],
  ])("rejects %s", (_, value) => {
    expect(() => Schema.decodeUnknownSync(AiInferenceInput)(value)).toThrow(
      /text/u
    );
  });

  it("normalizes output without model or provider fields", () => {
    const output = Schema.decodeUnknownSync(AiInferenceOutput)({
      finishReason: "stop",
      model: "synthetic-model",
      provider: "synthetic-provider",
      text: "Synthetic generated text",
      usage: { inputTokens: 7, outputTokens: 3 },
    });

    expect(output).toMatchObject({
      finishReason: "stop",
      text: "Synthetic generated text",
      usage: { inputTokens: 7, outputTokens: 3 },
    });
    expect(Object.keys(output)).toStrictEqual([
      "finishReason",
      "text",
      "usage",
    ]);
  });

  it("rejects empty, oversized, and invalid-usage output", () => {
    expect(() =>
      Schema.decodeUnknownSync(AiInferenceOutput)({
        finishReason: "stop",
        text: "",
      })
    ).toThrow(/generated text/u);
    expect(() =>
      Schema.decodeUnknownSync(AiInferenceOutput)({
        finishReason: "stop",
        text: "x".repeat(aiGeneratedTextMaxLength + 1),
      })
    ).toThrow(/generated text/u);
    expect(() =>
      Schema.decodeUnknownSync(AiInferenceOutput)({
        finishReason: "stop",
        text: "Synthetic generated text",
        usage: { inputTokens: -1, outputTokens: 2 },
      })
    ).toThrow(/greater than or equal to/u);
  });

  it("fails explicitly when inference is unavailable", async () => {
    const input = Schema.decodeUnknownSync(AiInferenceInput)({
      prompt: "Synthetic prompt",
      system: "Synthetic system",
    });
    const error = await Effect.runPromise(
      AiInference.pipe(
        Effect.flatMap((inference) => inference.generate(input)),
        Effect.provide(AiInferenceUnavailableLive),
        Effect.flip
      )
    );

    expect(error).toMatchObject({
      _tag: "AiInferenceError",
      reason: "unavailable",
      retryable: false,
    });
  });
});
