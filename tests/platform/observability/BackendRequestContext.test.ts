import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Logger from "effect/Logger";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  BackendRequestCompletionLayer,
  BackendRequestCompletedEventSchema,
  BackendRequestCompletion,
  backendRequestCompletedAnnotations,
  backendRequestOutcome,
  backendRequestRoute,
} from "#/platform/observability/BackendRequestCompletion";
import {
  backendRequestContext,
  CurrentBackendRequestContext,
} from "#/platform/observability/BackendRequestContext";
import { RequestId } from "#/shared/RequestCorrelation";

describe("backend request context", () => {
  it("generates independent server-owned request and correlation IDs", () => {
    const first = backendRequestContext();
    const second = backendRequestContext();

    expect(first.requestId).not.toBe(second.requestId);
    expect(first.correlationId).toBe(first.requestId);
    expect(second.correlationId).toBe(second.requestId);
    expect(() =>
      Schema.decodeUnknownSync(RequestId)("caller-controlled")
    ).toThrow(/caller-controlled/u);
  });

  it("accepts only the strict Cloudflare ray shape", () => {
    expect(backendRequestContext("7f4a1d2c3b4e5f60-WAW")).toMatchObject({
      cloudflareColo: "WAW",
      cloudflareRayId: "7f4a1d2c3b4e5f60-WAW",
    });
    expect([
      backendRequestContext("invalid-ray\nsecret@example.test").cloudflareRayId,
      backendRequestContext("7f4a1d2c3b4e5f607f4a1d2c3b4e5f60").cloudflareRayId,
    ]).toStrictEqual([undefined, undefined]);
  });

  it("provides the current context through the request environment", async () => {
    const context = backendRequestContext();
    const observed = await Effect.runPromise(
      CurrentBackendRequestContext.pipe(
        Effect.provideService(CurrentBackendRequestContext, context)
      )
    );

    expect(observed).toBe(context);
  });

  it("isolates concurrent request environments", async () => {
    const contexts = [
      backendRequestContext(),
      backendRequestContext(),
      backendRequestContext(),
    ];
    const observed = await Effect.runPromise(
      Effect.all(
        contexts.map((context) =>
          CurrentBackendRequestContext.pipe(
            Effect.provideService(CurrentBackendRequestContext, context)
          )
        ),
        { concurrency: "unbounded" }
      )
    );

    expect(observed.map((context) => context.requestId)).toStrictEqual(
      contexts.map((context) => context.requestId)
    );
  });
});

describe("backend request completion", () => {
  it.each([
    [200, "succeeded"],
    [302, "succeeded"],
    [401, "rejected"],
    [499, "rejected"],
    [500, "failed"],
    [503, "failed"],
  ] as const)("derives %s as %s", (statusCode, outcome) => {
    expect(backendRequestOutcome(statusCode)).toBe(outcome);
  });

  it("emits one structured completion event", async () => {
    const messages: unknown[] = [];
    const logger = Logger.make((options) => {
      messages.push(options.message);
    });
    const context = backendRequestContext("7f4a1d2c3b4e5f60-WAW");
    const event = await Effect.runPromise(
      Effect.gen(function* () {
        const completion = yield* BackendRequestCompletion;
        const startedAtNanos = yield* Clock.currentTimeNanos;
        return yield* completion.emit({
          context,
          method: "POST",
          pathname: "/auth/external-recovery-identity?secret=do-not-log",
          startedAtNanos: startedAtNanos + 1_000_000_000_000n,
          statusCode: 401,
        });
      }).pipe(
        Effect.provide(BackendRequestCompletionLayer),
        Effect.provide(Logger.layer([logger]))
      )
    );

    expect(messages).toStrictEqual([["backend.request.completed"]]);
    expect(event).toMatchObject({
      durationMillis: 0,
      method: "POST",
      outcome: "rejected",
      route: "/auth/*",
      statusCode: 401,
    });
    expect(() =>
      Schema.decodeUnknownSync(BackendRequestCompletedEventSchema)({
        ...event,
        outcome: "succeeded",
      })
    ).toThrow(/outcome must match/u);
  });

  it("keeps completion annotations on a strict metadata allowlist", async () => {
    const context = backendRequestContext();
    const event = await Effect.runPromise(
      Effect.gen(function* () {
        const completion = yield* BackendRequestCompletion;
        const startedAtNanos = yield* Clock.currentTimeNanos;
        return yield* completion.emit({
          context,
          method: "CUSTOM-METHOD-WITH-SECRET",
          pathname:
            "/api/mailboxes/primary/send?archiveRecipient=Private.Archive@example.net&token=secret-token#secret-fragment",
          startedAtNanos,
          statusCode: 200,
        });
      }).pipe(Effect.provide(BackendRequestCompletionLayer))
    );
    const serialized = JSON.stringify(
      backendRequestCompletedAnnotations(event)
    );

    expect(event).toMatchObject({
      method: "UNKNOWN",
      route: "/api/mailboxes/*",
    });
    expect(serialized).not.toMatch(
      /Private.Archive@example.net|archiveRecipient|secret-token|secret-fragment|cookie|authorization|user-agent|email/u
    );
  });

  it("maps raw paths to privacy-safe route families", () => {
    expect([
      backendRequestRoute("/auth/secret@example.test/reset-token"),
      backendRequestRoute("/api/mailboxes/private-id/messages/message-id"),
      backendRequestRoute("/unknown/secret-value"),
    ]).toStrictEqual(["/auth/*", "/api/mailboxes/*", "/__unmatched__"]);
  });
});
