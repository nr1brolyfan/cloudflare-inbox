/* oxlint-disable max-classes-per-file -- The inference contract is intentionally consolidated. */
import * as Schema from "effect/Schema";

export const aiSystemTextMaxLength = 8192;
export const aiPromptTextMaxLength = 32_768;
export const aiGeneratedTextMaxLength = 32_768;

const boundedText = (name: string, maximum: number) =>
  Schema.String.pipe(
    Schema.check(
      Schema.makeFilter<string>((value) => {
        const { length } = [...value];
        if (value.trim().length === 0) {
          return `${name} must not be blank`;
        }
        return length <= maximum
          ? undefined
          : `${name} must not exceed ${maximum} Unicode code points`;
      })
    )
  );

export const AiSystemText = boundedText(
  "system text",
  aiSystemTextMaxLength
).pipe(Schema.brand("cloudflare-inbox/AiSystemText"));
export type AiSystemText = Schema.Schema.Type<typeof AiSystemText>;

export const AiPromptText = boundedText(
  "prompt text",
  aiPromptTextMaxLength
).pipe(Schema.brand("cloudflare-inbox/AiPromptText"));
export type AiPromptText = Schema.Schema.Type<typeof AiPromptText>;

export const AiGeneratedText = boundedText(
  "generated text",
  aiGeneratedTextMaxLength
).pipe(Schema.brand("cloudflare-inbox/AiGeneratedText"));
export type AiGeneratedText = Schema.Schema.Type<typeof AiGeneratedText>;

export const AiFinishReason = Schema.Literals([
  "stop",
  "length",
  "content-filter",
  "error",
  "other",
  "unknown",
]);
export type AiFinishReason = Schema.Schema.Type<typeof AiFinishReason>;

const AiTokenCount = Schema.Int.pipe(
  Schema.check(
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(2_147_483_647)
  )
);

export class AiInferenceInput extends Schema.Class<AiInferenceInput>(
  "cloudflare-inbox/AiInferenceInput"
)({
  prompt: AiPromptText,
  system: AiSystemText,
}) {}

export class AiInferenceUsage extends Schema.Class<AiInferenceUsage>(
  "cloudflare-inbox/AiInferenceUsage"
)({
  inputTokens: AiTokenCount,
  outputTokens: AiTokenCount,
}) {}

export class AiInferenceOutput extends Schema.Class<AiInferenceOutput>(
  "cloudflare-inbox/AiInferenceOutput"
)({
  finishReason: AiFinishReason,
  text: AiGeneratedText,
  usage: Schema.optionalKey(AiInferenceUsage),
}) {}

export const AiInferenceErrorReason = Schema.Literals([
  "unavailable",
  "provider",
  "invalid-output",
  "unexpected-tool-call",
]);

export class AiInferenceError extends Schema.TaggedErrorClass<AiInferenceError>(
  "cloudflare-inbox/AiInferenceError"
)("AiInferenceError", {
  cause: Schema.optional(Schema.Defect()),
  message: boundedText("AI inference error message", 500),
  reason: AiInferenceErrorReason,
  retryable: Schema.Boolean,
}) {}
