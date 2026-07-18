import * as Data from "effect/Data";

import type { OperationId } from "../identifiers";

export class WorkflowStartError extends Data.TaggedError("WorkflowStartError")<{
  readonly workflow: "inbound" | "outbound";
  readonly operationId: OperationId;
  readonly message: string;
  readonly cause: unknown;
}> {}
