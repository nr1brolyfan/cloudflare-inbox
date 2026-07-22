import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import {
  BackendRequestCompletedEventSchema,
  BackendRequestCompletion,
  backendRequestCompletedAnnotations,
  backendRequestMethod,
  backendRequestOutcome,
  backendRequestRoute,
} from "./request-completion";
import {
  BackendCorrelationId,
  BackendRequestContext,
  BackendRequestId,
  CloudflareRayId,
  CurrentBackendRequestContext,
} from "./request-context";
import { BackendRequestContextMiddleware } from "./request-context-middleware";

/** Generates server-owned identity and accepts only bounded Cloudflare metadata. */
export const backendRequestContext = (
  cloudflareRay?: string
): BackendRequestContext => {
  const requestId = Schema.decodeUnknownSync(BackendRequestId)(
    crypto.randomUUID()
  );
  const cloudflareRayId =
    cloudflareRay === undefined || !Schema.is(CloudflareRayId)(cloudflareRay)
      ? undefined
      : cloudflareRay;

  return Schema.decodeUnknownSync(BackendRequestContext)({
    cloudflareColo: cloudflareRayId?.slice(-3),
    cloudflareRayId,
    correlationId: Schema.decodeUnknownSync(BackendCorrelationId)(requestId),
    requestId,
  });
};

/** Captures the fetch-owned context and supplies it to mailbox/admin handlers. */
export const BackendRequestContextMiddlewareLive = Layer.effect(
  BackendRequestContextMiddleware,
  Effect.gen(function* () {
    const context = yield* CurrentBackendRequestContext;
    return (httpEffect) =>
      httpEffect.pipe(
        Effect.provideService(CurrentBackendRequestContext, context)
      );
  })
);

export const BackendRequestCompletionLive = Layer.succeed(
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
