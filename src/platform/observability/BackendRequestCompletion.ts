import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import {
  BackendCorrelationId,
  BackendRequestId,
  CloudflareColo,
  CloudflareRayId,
} from "#/shared/BackendRequestContext";
import type { BackendRequestContext } from "#/shared/BackendRequestContext";

export const BackendRequestOutcome = Schema.Literals([
  "succeeded",
  "rejected",
  "failed",
]);
export type BackendRequestOutcome = Schema.Schema.Type<
  typeof BackendRequestOutcome
>;

export const BackendRequestMethod = Schema.Literals([
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
  "UNKNOWN",
]);
export type BackendRequestMethod = Schema.Schema.Type<
  typeof BackendRequestMethod
>;
export const BackendRequestRoute = Schema.Literals([
  "/api/dev-emails",
  "/api/health",
  "/api/mailboxes/*",
  "/auth/*",
  "/__unmatched__",
]);
export type BackendRequestRoute = Schema.Schema.Type<
  typeof BackendRequestRoute
>;

export const backendRequestMethod = (value: string): BackendRequestMethod =>
  Schema.is(BackendRequestMethod)(value) ? value : "UNKNOWN";

export const backendRequestRoute = (value: string): BackendRequestRoute => {
  const boundary = value.search(/[?#]/u);
  const pathname = boundary === -1 ? value : value.slice(0, boundary);
  if (pathname === "/api/health") {
    return "/api/health";
  }
  if (pathname === "/api/dev-emails") {
    return "/api/dev-emails";
  }
  if (pathname === "/api/mailboxes" || pathname.startsWith("/api/mailboxes/")) {
    return "/api/mailboxes/*";
  }
  if (pathname === "/auth" || pathname.startsWith("/auth/")) {
    return "/auth/*";
  }
  return "/__unmatched__";
};

const BackendHttpStatus = Schema.Int.pipe(
  Schema.check(
    Schema.isGreaterThanOrEqualTo(100),
    Schema.isLessThanOrEqualTo(599)
  ),
  Schema.brand("cloudflare-inbox/BackendHttpStatus")
);
const BackendRequestDurationMillis = Schema.Number.pipe(
  Schema.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0)),
  Schema.brand("cloudflare-inbox/BackendRequestDurationMillis")
);

export class BackendRequestCompletedEvent extends Schema.Class<BackendRequestCompletedEvent>(
  "cloudflare-inbox/BackendRequestCompletedEvent"
)({
  cloudflareColo: Schema.optional(CloudflareColo),
  cloudflareRayId: Schema.optional(CloudflareRayId),
  correlationId: BackendCorrelationId,
  durationMillis: BackendRequestDurationMillis,
  eventName: Schema.Literal("backend.request.completed"),
  method: BackendRequestMethod,
  outcome: BackendRequestOutcome,
  requestId: BackendRequestId,
  route: BackendRequestRoute,
  schemaVersion: Schema.Literal(1),
  serviceName: Schema.Literal("cloudflare-inbox-backend"),
  statusCode: BackendHttpStatus,
}) {}

export const backendRequestOutcome = (
  statusCode: number
): BackendRequestOutcome =>
  statusCode >= 500 ? "failed" : statusCode >= 400 ? "rejected" : "succeeded";

export const BackendRequestCompletedEventSchema =
  BackendRequestCompletedEvent.check(
    Schema.makeFilter((event) =>
      event.outcome === backendRequestOutcome(event.statusCode)
        ? undefined
        : "request outcome must match the response status"
    )
  );

export interface BackendRequestCompletionInput {
  readonly context: BackendRequestContext;
  readonly method: string;
  readonly pathname: string;
  readonly startedAtNanos: bigint;
  readonly statusCode: number;
}

export interface BackendRequestCompletionShape {
  readonly emit: (
    input: BackendRequestCompletionInput
  ) => Effect.Effect<BackendRequestCompletedEvent>;
}

/** Emits the single privacy-bounded completion event for a Backend request. */
export const BackendRequestCompletion =
  Context.Service<BackendRequestCompletionShape>(
    "cloudflare-inbox/BackendRequestCompletion"
  );

export const backendRequestCompletedAnnotations = (
  event: BackendRequestCompletedEvent
): Record<string, unknown> => ({
  ...(event.cloudflareColo === undefined
    ? {}
    : { "cloudflare.colo": event.cloudflareColo }),
  ...(event.cloudflareRayId === undefined
    ? {}
    : { "cloudflare.ray_id": event.cloudflareRayId }),
  "correlation.id": event.correlationId,
  duration_ms: event.durationMillis,
  "event.name": event.eventName,
  "event.outcome": event.outcome,
  "event.schema_version": event.schemaVersion,
  "http.request.method": event.method,
  "http.response.status_code": event.statusCode,
  "request.id": event.requestId,
  "service.name": event.serviceName,
  "http.route": event.route,
});

export const BackendRequestCompletionLayer = Layer.succeed(
  BackendRequestCompletion,
  BackendRequestCompletion.of({
    emit: (input) =>
      Effect.gen(function* () {
        const completedAtNanos = yield* Clock.currentTimeNanos;
        const durationMillis =
          Number(
            completedAtNanos > input.startedAtNanos
              ? completedAtNanos - input.startedAtNanos
              : 0n
          ) / 1_000_000;
        const event = Schema.decodeUnknownSync(
          BackendRequestCompletedEventSchema
        )({
          cloudflareColo: input.context.cloudflareColo,
          cloudflareRayId: input.context.cloudflareRayId,
          correlationId: input.context.correlationId,
          durationMillis,
          eventName: "backend.request.completed",
          method: backendRequestMethod(input.method),
          outcome: backendRequestOutcome(input.statusCode),
          requestId: input.context.requestId,
          route: backendRequestRoute(input.pathname),
          schemaVersion: 1,
          serviceName: "cloudflare-inbox-backend",
          statusCode: input.statusCode,
        });

        yield* Effect.logInfo(event.eventName).pipe(
          Effect.annotateLogs(backendRequestCompletedAnnotations(event))
        );
        return event;
      }),
  })
);
