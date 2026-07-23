import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  AiRuleEvaluator,
  AiRuleEvaluatorError,
} from "#/modules/automation/ports/AiRuleEvaluator";

/** Explicit failure for runtimes where AI rule evaluation is not configured. */
export const AiRuleEvaluatorUnavailableLayer = Layer.succeed(
  AiRuleEvaluator,
  AiRuleEvaluator.of({
    evaluate: () =>
      Effect.fail(
        new AiRuleEvaluatorError({
          message: "AI rule evaluation is not configured",
          retryable: true,
        })
      ),
  })
);
