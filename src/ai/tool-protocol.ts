/* oxlint-disable max-classes-per-file -- The transport-neutral tool protocol is intentionally consolidated. */
import * as Schema from "effect/Schema";

export const aiToolIdMaxLength = 128;
export const aiToolNameMaxLength = 64;
export const aiToolJsonMaxLength = 32_768;
export const aiToolJsonMaxDepth = 8;
export const aiToolJsonMaxEntries = 256;

const AiToolId = Schema.String.pipe(
  Schema.check(
    Schema.isLengthBetween(1, aiToolIdMaxLength),
    Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9_-]*$/u)
  )
);

export const AiToolRunId = AiToolId.pipe(
  Schema.brand("cloudflare-inbox/AiToolRunId")
);
export type AiToolRunId = Schema.Schema.Type<typeof AiToolRunId>;

export const AiToolCallId = AiToolId.pipe(
  Schema.brand("cloudflare-inbox/AiToolCallId")
);
export type AiToolCallId = Schema.Schema.Type<typeof AiToolCallId>;

export const AiToolName = Schema.String.pipe(
  Schema.check(
    Schema.isLengthBetween(1, aiToolNameMaxLength),
    Schema.isPattern(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u)
  ),
  Schema.brand("cloudflare-inbox/AiToolName")
);
export type AiToolName = Schema.Schema.Type<typeof AiToolName>;

const modelControlledIdentityFields = new Set([
  "allowlist",
  "mailboxId",
  "operationId",
  "permissions",
  "principalId",
  "sessionId",
  "userId",
]);

const isJsonArray = (
  value: Schema.JsonArray | Schema.JsonObject
): value is Schema.JsonArray => Array.isArray(value);

const checkJsonObject = (
  value: Schema.JsonObject,
  rejectIdentityFields: boolean
): string | undefined => {
  let entries = 0;
  const visit = (json: Schema.Json, depth: number): string | undefined => {
    if (depth > aiToolJsonMaxDepth) {
      return `JSON must not exceed ${aiToolJsonMaxDepth} levels`;
    }
    if (json === null || typeof json !== "object") {
      return undefined;
    }

    if (isJsonArray(json)) {
      entries += json.length;
      if (entries > aiToolJsonMaxEntries) {
        return `JSON must not exceed ${aiToolJsonMaxEntries} entries`;
      }
      for (const item of json) {
        const issue = visit(item, depth + 1);
        if (issue !== undefined) {
          return issue;
        }
      }
      return undefined;
    }

    const keys = Object.keys(json);
    entries += keys.length;
    if (entries > aiToolJsonMaxEntries) {
      return `JSON must not exceed ${aiToolJsonMaxEntries} entries`;
    }
    for (const key of keys) {
      if (rejectIdentityFields && modelControlledIdentityFields.has(key)) {
        return `model-controlled arguments must not contain ${key}`;
      }
      const issue = visit(json[key], depth + 1);
      if (issue !== undefined) {
        return issue;
      }
    }
    return undefined;
  };

  const serialized = JSON.stringify(value);
  if ([...serialized].length > aiToolJsonMaxLength) {
    return `JSON must not exceed ${aiToolJsonMaxLength} Unicode code points`;
  }
  return visit(value, 1);
};

const JsonObject = Schema.Record(Schema.String, Schema.Json);

/** JSON-only arguments cannot carry identity or authorization authority. */
export const AiToolArguments = JsonObject.pipe(
  Schema.check(
    Schema.makeFilter<Schema.JsonObject>((value) =>
      checkJsonObject(value, true)
    )
  ),
  Schema.brand("cloudflare-inbox/AiToolArguments")
);
export type AiToolArguments = Schema.Schema.Type<typeof AiToolArguments>;

export const AiToolResultData = JsonObject.pipe(
  Schema.check(
    Schema.makeFilter<Schema.JsonObject>((value) =>
      checkJsonObject(value, false)
    )
  ),
  Schema.brand("cloudflare-inbox/AiToolResultData")
);
export type AiToolResultData = Schema.Schema.Type<typeof AiToolResultData>;

const sanitizedMessage = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter<string>((value) =>
      value.trim().length === 0
        ? "message must not be blank"
        : [...value].length <= 300
          ? undefined
          : "message must not exceed 300 Unicode code points"
    )
  )
);

export class AiToolCall extends Schema.Class<AiToolCall>(
  "cloudflare-inbox/AiToolCall"
)({
  arguments: AiToolArguments,
  callId: AiToolCallId,
  name: AiToolName,
}) {}

export class AiToolFailure extends Schema.Class<AiToolFailure>(
  "cloudflare-inbox/AiToolFailure"
)({
  code: Schema.Literals([
    "denied",
    "execution-failed",
    "invalid-arguments",
    "invalid-result",
    "unavailable",
  ]),
  message: sanitizedMessage,
  retryable: Schema.Boolean,
}) {}

export class AiToolSuccessResult extends Schema.Class<AiToolSuccessResult>(
  "cloudflare-inbox/AiToolSuccessResult"
)({
  _tag: Schema.Literal("AiToolSuccessResult"),
  callId: AiToolCallId,
  output: AiToolResultData,
}) {}

export class AiToolFailureResult extends Schema.Class<AiToolFailureResult>(
  "cloudflare-inbox/AiToolFailureResult"
)({
  _tag: Schema.Literal("AiToolFailureResult"),
  callId: AiToolCallId,
  error: AiToolFailure,
}) {}

export const AiToolResult = Schema.Union([
  AiToolSuccessResult,
  AiToolFailureResult,
]);
export type AiToolResult = Schema.Schema.Type<typeof AiToolResult>;

export class AiToolProtocolError extends Schema.TaggedErrorClass<AiToolProtocolError>(
  "cloudflare-inbox/AiToolProtocolError"
)("AiToolProtocolError", {
  callId: Schema.optional(AiToolCallId),
  message: sanitizedMessage,
  reason: Schema.Literals([
    "forbidden-arguments",
    "invalid-call",
    "unknown-tool",
  ]),
}) {}

export class AiToolExecutionError extends Schema.TaggedErrorClass<AiToolExecutionError>(
  "cloudflare-inbox/AiToolExecutionError"
)("AiToolExecutionError", {
  callId: AiToolCallId,
  message: sanitizedMessage,
  reason: Schema.Literals(["failed", "invalid-result", "unavailable"]),
  retryable: Schema.Boolean,
}) {}
