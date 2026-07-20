import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import type { AiToolCallId, AiToolName } from "./tool-protocol";

export const aiToolRunLimits = {
  aggregateArgumentBytes: 32 * 1024,
  aggregateResultBytes: 96 * 1024,
  argumentBytesPerCall: 16 * 1024,
  mutations: 1,
  reads: 6,
  resultBytesPerCall: 32 * 1024,
  totalCalls: 8,
} as const;

export type AiToolKind = "mutation" | "read" | "unknown";

export type AiToolBudgetLimit =
  | "aggregate-argument-bytes"
  | "aggregate-result-bytes"
  | "argument-bytes-per-call"
  | "mutations"
  | "reads"
  | "replay-mismatch"
  | "result-bytes-per-call"
  | "total-calls";

export class AiToolBudgetExceeded extends Data.TaggedError(
  "AiToolBudgetExceeded"
)<{
  readonly limit: AiToolBudgetLimit;
}> {}

export interface AiToolRunBudget {
  /** Reserves the total-call slot as soon as trustworthy call metadata exists. */
  readonly consumeCall: (
    callId: AiToolCallId,
    name: AiToolName
  ) => Effect.Effect<void, AiToolBudgetExceeded>;
  readonly consumeInput: (
    callId: AiToolCallId,
    kind: Exclude<AiToolKind, "unknown">,
    argumentBytes: number
  ) => Effect.Effect<void, AiToolBudgetExceeded>;
  readonly consumeResult: (
    callId: AiToolCallId,
    resultBytes: number
  ) => Effect.Effect<void, AiToolBudgetExceeded>;
}

export const AiToolRunBudget = Context.Service<AiToolRunBudget>(
  "cloudflare-inbox/AiToolRunBudget"
);

interface CallReservation {
  readonly argumentBytes?: number;
  readonly kind?: Exclude<AiToolKind, "unknown">;
  readonly name: AiToolName;
  readonly resultBytes?: number;
}

interface BudgetState {
  readonly argumentBytes: number;
  readonly calls: ReadonlyMap<AiToolCallId, CallReservation>;
  readonly mutations: number;
  readonly reads: number;
  readonly resultBytes: number;
}

const exceeded = (limit: AiToolBudgetLimit) =>
  new AiToolBudgetExceeded({ limit });

type BudgetDecision =
  | { readonly _tag: "Allowed" }
  | { readonly _tag: "Exceeded"; readonly error: AiToolBudgetExceeded };

const allowed: BudgetDecision = { _tag: "Allowed" };
const denied = (limit: AiToolBudgetLimit): BudgetDecision => ({
  _tag: "Exceeded",
  error: exceeded(limit),
});

const fromDecision = (decision: BudgetDecision) =>
  decision._tag === "Allowed" ? Effect.void : Effect.fail(decision.error);

/** A fresh layer must be acquired once per AI run; Ref.modify makes parallel calls atomic. */
export const AiToolRunBudgetLive = Layer.effect(
  AiToolRunBudget,
  Ref.make<BudgetState>({
    argumentBytes: 0,
    calls: new Map(),
    mutations: 0,
    reads: 0,
    resultBytes: 0,
  }).pipe(
    Effect.map((state) =>
      AiToolRunBudget.of({
        consumeCall: (callId, name) =>
          Ref.modify(state, (current) => {
            const existing = current.calls.get(callId);
            if (existing !== undefined) {
              return existing.name === name
                ? [allowed, current]
                : [denied("replay-mismatch"), current];
            }
            if (current.calls.size >= aiToolRunLimits.totalCalls) {
              return [denied("total-calls"), current];
            }

            const calls = new Map([...current.calls, [callId, { name }]]);
            return [allowed, { ...current, calls }];
          }).pipe(Effect.flatMap(fromDecision)),
        consumeInput: (callId, kind, argumentBytes) =>
          Ref.modify(state, (current) => {
            const existing = current.calls.get(callId);
            if (existing === undefined) {
              return [denied("replay-mismatch"), current];
            }
            if (
              existing.argumentBytes !== undefined ||
              existing.kind !== undefined
            ) {
              return existing.argumentBytes === argumentBytes &&
                existing.kind === kind
                ? [allowed, current]
                : [denied("replay-mismatch"), current];
            }
            if (argumentBytes > aiToolRunLimits.argumentBytesPerCall) {
              return [denied("argument-bytes-per-call"), current];
            }
            if (
              current.argumentBytes + argumentBytes >
              aiToolRunLimits.aggregateArgumentBytes
            ) {
              return [denied("aggregate-argument-bytes"), current];
            }
            if (kind === "read" && current.reads >= aiToolRunLimits.reads) {
              return [denied("reads"), current];
            }
            if (
              kind === "mutation" &&
              current.mutations >= aiToolRunLimits.mutations
            ) {
              return [denied("mutations"), current];
            }

            const calls = new Map([
              ...current.calls,
              [callId, { ...existing, argumentBytes, kind }],
            ]);
            return [
              allowed,
              {
                ...current,
                argumentBytes: current.argumentBytes + argumentBytes,
                calls,
                mutations: current.mutations + (kind === "mutation" ? 1 : 0),
                reads: current.reads + (kind === "read" ? 1 : 0),
              },
            ];
          }).pipe(Effect.flatMap(fromDecision)),
        consumeResult: (callId, resultBytes) =>
          Ref.modify(state, (current) => {
            const existing = current.calls.get(callId);
            if (existing?.kind === undefined) {
              return [denied("replay-mismatch"), current];
            }
            if (existing.resultBytes !== undefined) {
              return existing.resultBytes === resultBytes
                ? [allowed, current]
                : [denied("replay-mismatch"), current];
            }
            if (resultBytes > aiToolRunLimits.resultBytesPerCall) {
              return [denied("result-bytes-per-call"), current];
            }
            if (
              current.resultBytes + resultBytes >
              aiToolRunLimits.aggregateResultBytes
            ) {
              return [denied("aggregate-result-bytes"), current];
            }

            const calls = new Map([
              ...current.calls,
              [callId, { ...existing, resultBytes }],
            ]);
            return [
              allowed,
              {
                ...current,
                calls,
                resultBytes: current.resultBytes + resultBytes,
              },
            ];
          }).pipe(Effect.flatMap(fromDecision)),
      })
    )
  )
);
