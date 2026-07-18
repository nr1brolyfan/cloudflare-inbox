import * as Data from "effect/Data";

import type { RuleId } from "../identifiers";
import type { Version } from "../primitives";

export class RuleEvaluationError extends Data.TaggedError(
  "RuleEvaluationError"
)<{
  readonly ruleId: RuleId;
  readonly ruleVersion: Version;
  readonly message: string;
  readonly cause: unknown;
}> {}
