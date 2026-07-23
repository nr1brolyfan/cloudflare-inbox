import * as Data from "effect/Data";

import type { RuleId, Version } from "./Mailbox";

export class RuleEvaluationError extends Data.TaggedError(
  "RuleEvaluationError"
)<{
  readonly ruleId: RuleId;
  readonly ruleVersion: Version;
  readonly message: string;
  readonly cause: unknown;
}> {}
