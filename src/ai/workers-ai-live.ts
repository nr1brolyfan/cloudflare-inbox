/* oxlint-disable max-classes-per-file -- Adapter errors and configuration are colocated. */
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { AiInference, AiInferenceError, AiInferenceOutput } from "./inference";
import type { AiFinishReason, AiInferenceInput } from "./inference";

export const workersAiModel =
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as const;
const workersAiMaxOutputTokens = 2048;

export interface WorkersAiConfig {
  readonly maxOutputTokens: typeof workersAiMaxOutputTokens;
  readonly model: typeof workersAiModel;
}

export const WorkersAiConfig = Context.Service<WorkersAiConfig>(
  "cloudflare-inbox/WorkersAiConfig"
);

export const WorkersAiConfigLive = Layer.succeed(
  WorkersAiConfig,
  WorkersAiConfig.of({
    maxOutputTokens: workersAiMaxOutputTokens,
    model: workersAiModel,
  })
);

export interface WorkersAiGatewayRequest {
  readonly input: {
    readonly max_tokens: number;
    readonly messages: {
      readonly content: string;
      readonly role: "system" | "user";
    }[];
    readonly tool_choice: "none";
  };
  readonly model: typeof workersAiModel;
}

/** Minimal QueryGateway-backed binding surface owned by the application. */
export interface WorkersAiGateway {
  readonly run: (
    request: WorkersAiGatewayRequest
  ) => Effect.Effect<unknown, unknown>;
}

export const WorkersAiGateway = Context.Service<WorkersAiGateway>(
  "cloudflare-inbox/WorkersAiGateway"
);

export class WorkersAiClientError extends Data.TaggedError(
  "WorkersAiClientError"
)<{
  readonly cause?: unknown;
  readonly reason: "request" | "invalid-response";
  readonly retryable: boolean;
}> {}

export interface WorkersAiClientRequest {
  readonly prompt: string;
  readonly system: string;
  readonly toolChoice: "none";
}

export interface WorkersAiClientResponse {
  readonly finishReason: AiFinishReason | "tool-calls";
  readonly text: string | undefined;
  readonly toolCallCount: number;
  readonly usage?: {
    readonly inputTokens: number;
    readonly outputTokens: number;
  };
}

export interface WorkersAiClient {
  readonly generateText: (
    request: WorkersAiClientRequest
  ) => Effect.Effect<WorkersAiClientResponse, WorkersAiClientError>;
}

export const WorkersAiClient = Context.Service<WorkersAiClient>(
  "cloudflare-inbox/WorkersAiClient"
);

const statusFrom = (cause: unknown): number | undefined => {
  if (cause === null || typeof cause !== "object") {
    return undefined;
  }
  const record = cause as Record<string, unknown>;
  const status = record.status ?? record.statusCode;
  return typeof status === "number" ? status : undefined;
};

const isRetryableProviderFailure = (cause: unknown): boolean => {
  const status = statusFrom(cause);
  if (status !== undefined) {
    return status === 408 || status === 425 || status === 429 || status >= 500;
  }
  if (cause instanceof Error) {
    return !/authentication|invalid|permission|unauthorized/iu.test(cause.name);
  }
  return true;
};

const tokenCount = (value: unknown): number | undefined =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= 2_147_483_647
    ? value
    : undefined;

const normalizedFinishReason = (
  value: unknown,
  hasToolCalls: boolean
): WorkersAiClientResponse["finishReason"] => {
  if (hasToolCalls || value === "tool_calls" || value === "tool-calls") {
    return "tool-calls";
  }
  switch (value) {
    case undefined:
    case null:
    case "stop": {
      return "stop";
    }
    case "length":
    case "model_length": {
      return "length";
    }
    case "content_filter":
    case "content-filter": {
      return "content-filter";
    }
    case "error": {
      return "error";
    }
    case "unknown": {
      return "unknown";
    }
    default: {
      return "other";
    }
  }
};

const decodeResponse = (
  value: unknown
): Effect.Effect<WorkersAiClientResponse, WorkersAiClientError> => {
  if (typeof value === "string") {
    return Effect.succeed({
      finishReason: "stop",
      text: value,
      toolCallCount: 0,
    });
  }
  if (value === null || typeof value !== "object") {
    return Effect.fail(
      new WorkersAiClientError({
        cause: value,
        reason: "invalid-response",
        retryable: false,
      })
    );
  }

  const record = value as Record<string, unknown>;
  if (record.tool_calls !== undefined && !Array.isArray(record.tool_calls)) {
    return Effect.fail(
      new WorkersAiClientError({
        cause: value,
        reason: "invalid-response",
        retryable: false,
      })
    );
  }
  const toolCallCount = Array.isArray(record.tool_calls)
    ? record.tool_calls.length
    : 0;
  const usage =
    record.usage !== null && typeof record.usage === "object"
      ? (record.usage as Record<string, unknown>)
      : undefined;
  const inputTokens = tokenCount(usage?.prompt_tokens);
  const outputTokens = tokenCount(usage?.completion_tokens);

  return Effect.succeed({
    finishReason: normalizedFinishReason(
      record.finish_reason,
      toolCallCount > 0
    ),
    text: typeof record.response === "string" ? record.response : undefined,
    toolCallCount,
    ...(inputTokens !== undefined && outputTokens !== undefined
      ? { usage: { inputTokens, outputTokens } }
      : {}),
  });
};

export const WorkersAiClientLive = Layer.effect(
  WorkersAiClient,
  Effect.gen(function* () {
    const config = yield* WorkersAiConfig;
    const gateway = yield* WorkersAiGateway;

    return WorkersAiClient.of({
      generateText: (request) =>
        gateway
          .run({
            input: {
              max_tokens: config.maxOutputTokens,
              messages: [
                { content: request.system, role: "system" },
                { content: request.prompt, role: "user" },
              ],
              tool_choice: request.toolChoice,
            },
            model: config.model,
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new WorkersAiClientError({
                  cause,
                  reason: "request",
                  retryable: isRetryableProviderFailure(cause),
                })
            ),
            Effect.flatMap(decodeResponse)
          ),
    });
  })
);

const mapClientError = (error: WorkersAiClientError) =>
  new AiInferenceError({
    cause: error,
    message:
      error.reason === "request"
        ? "AI inference provider request failed"
        : "AI inference provider returned an invalid response",
    reason: error.reason === "request" ? "provider" : "invalid-output",
    retryable: error.retryable,
  });

const decodeOutput = (
  input: AiInferenceInput,
  response: WorkersAiClientResponse
): Effect.Effect<AiInferenceOutput, AiInferenceError> => {
  if (response.toolCallCount > 0 || response.finishReason === "tool-calls") {
    return Effect.fail(
      new AiInferenceError({
        message: "AI inference returned an unexpected tool call",
        reason: "unexpected-tool-call",
        retryable: false,
      })
    );
  }
  if (response.text === undefined || response.text.trim().length === 0) {
    return Effect.fail(
      new AiInferenceError({
        message: "AI inference returned empty generated text",
        reason: "invalid-output",
        retryable: false,
      })
    );
  }

  return Schema.decodeUnknownEffect(AiInferenceOutput)({
    finishReason: response.finishReason,
    text: response.text,
    ...(response.usage === undefined ? {} : { usage: response.usage }),
  }).pipe(
    Effect.mapError(
      (cause) =>
        new AiInferenceError({
          cause,
          message: "AI inference returned output outside contract bounds",
          reason: "invalid-output",
          retryable: false,
        })
    ),
    Effect.withSpan("ai.inference", {
      attributes: {
        "ai.input.system_length": input.system.length,
        "ai.input.prompt_length": input.prompt.length,
      },
    })
  );
};

export const WorkersAiInferenceLive = Layer.effect(
  AiInference,
  Effect.gen(function* () {
    const client = yield* WorkersAiClient;

    return AiInference.of({
      generate: (input) =>
        client
          .generateText({
            prompt: input.prompt,
            system: input.system,
            toolChoice: "none",
          })
          .pipe(
            Effect.mapError(mapClientError),
            Effect.flatMap((response) => decodeOutput(input, response))
          ),
    });
  })
);
