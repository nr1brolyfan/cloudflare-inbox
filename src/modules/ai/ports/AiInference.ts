import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type {
  AiInferenceError,
  AiInferenceInput,
  AiInferenceOutput,
} from "../domain/AiInference";

export interface AiInference {
  readonly generate: (
    input: AiInferenceInput
  ) => Effect.Effect<AiInferenceOutput, AiInferenceError>;
}

/** Transport-neutral text inference boundary; it deliberately exposes no tools. */
export const AiInference = Context.Service<AiInference>(
  "cloudflare-inbox/AiInference"
);
