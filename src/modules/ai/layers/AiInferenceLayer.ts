import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { AiInferenceError } from "../domain/AiInference";
import { AiInference } from "../ports/AiInference";

export const AiInferenceUnavailableLayer = Layer.succeed(
  AiInference,
  AiInference.of({
    generate: () =>
      Effect.fail(
        new AiInferenceError({
          message: "AI inference is not available in this runtime",
          reason: "unavailable",
          retryable: false,
        })
      ),
  })
);
