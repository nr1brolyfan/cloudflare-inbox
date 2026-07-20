import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  DeliveryIndeterminateError,
  DeliveryProviderUnavailableError,
  DeliveryRejectedError,
  DeliveryTemporaryFailureError,
} from "#/mailboxes/errors";
import { MailboxOutboundDispatcher } from "#/mailboxes/mailbox-outbound-dispatcher";
import type { MailboxOutboundDispatcher as Dispatcher } from "#/mailboxes/mailbox-outbound-dispatcher";
import {
  MailboxOutboundAlarmDispatch,
  MailboxOutboundAlarmDispatchLive,
} from "#/mailboxes/outbound-alarm-dispatch-live";
import {
  MailboxAlarmStorage,
  MailboxOutboundAlarmScheduler,
  MailboxOutboundAlarmSchedulerLive,
} from "#/mailboxes/outbound-alarm-live";
import { OutboundProviderAcceptance } from "#/mailboxes/outbound-email-provider";
import { MailboxOutboundLifecycleStoreSqliteLive } from "#/mailboxes/outbound-lifecycle-store-sqlite-live";
import { folder, message, outboundDelivery } from "#/mailboxes/sqlite-schema";
import { MailboxDatabase, MailboxRuntime } from "#/mailboxes/sqlite-services";

import { MailboxDatabaseTestLive } from "../support/mailbox-sqlite";

const acceptance = Schema.decodeUnknownSync(OutboundProviderAcceptance)({
  providerMessageId: "provider-message-1",
});
const alarmNow = () => 1200;

const setup = Effect.gen(function* () {
  const db = yield* MailboxDatabase;
  yield* db.insert(folder).values({
    createdAt: 0,
    id: "scheduled",
    kind: "scheduled",
    name: "Scheduled",
    updatedAt: 0,
  });
});

const seedDelivery = (id: string, sendAt = 1000) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const messageId = `message-${id}`;
    yield* db.insert(message).values({ folderId: "scheduled", id: messageId });
    yield* db.insert(outboundDelivery).values({
      createdAt: 0,
      id,
      messageId,
      sendAt,
      status: "scheduled",
      updatedAt: 0,
    });
  });

const testLive = (
  dispatcher: Dispatcher,
  now: () => number,
  onReconcile: () => void
) => {
  const base = Layer.merge(
    MailboxDatabaseTestLive,
    Layer.succeed(
      MailboxRuntime,
      MailboxRuntime.of({ now, randomId: () => "unused" })
    )
  );
  const lifecycle = MailboxOutboundLifecycleStoreSqliteLive.pipe(
    Layer.provideMerge(base)
  );
  const dependencies = Layer.mergeAll(
    lifecycle,
    Layer.succeed(MailboxOutboundDispatcher, dispatcher),
    Layer.succeed(
      MailboxOutboundAlarmScheduler,
      MailboxOutboundAlarmScheduler.of({
        nextScheduledAt: Effect.succeed(null),
        reconcile: Effect.sync(onReconcile),
      })
    )
  );
  return MailboxOutboundAlarmDispatchLive.pipe(
    Layer.provideMerge(dependencies)
  );
};

const runOutcome = (
  dispatch: Dispatcher["dispatch"]
): Promise<Readonly<Record<string, unknown>>> => {
  let reconciliations = 0;
  let providerCalls = 0;
  return Effect.runPromise(
    Effect.gen(function* () {
      yield* setup;
      yield* seedDelivery("delivery-1");
      const alarm = yield* MailboxOutboundAlarmDispatch;
      yield* alarm.handle;
      const db = yield* MailboxDatabase;
      const [row] = yield* db
        .select()
        .from(outboundDelivery)
        .where(eq(outboundDelivery.id, "delivery-1"));
      return { ...row, providerCalls, reconciliations };
    }).pipe(
      Effect.provide(
        testLive(
          MailboxOutboundDispatcher.of({
            dispatch: (id) => {
              providerCalls += 1;
              return dispatch(id);
            },
          }),
          () => 1200,
          () => {
            reconciliations += 1;
          }
        )
      )
    )
  );
};

describe("outbound alarm dispatch", () => {
  it("persists provider acceptance and invokes the provider exactly once", async () => {
    let calls = 0;
    let reconciliations = 0;
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* setup;
        yield* seedDelivery("delivery-1");
        const alarm = yield* MailboxOutboundAlarmDispatch;
        yield* alarm.handle;
        yield* alarm.handle;
        const db = yield* MailboxDatabase;
        const [row] = yield* db
          .select()
          .from(outboundDelivery)
          .where(eq(outboundDelivery.id, "delivery-1"));
        expect(row).toMatchObject({
          acceptedAt: 1200,
          attemptCount: 1,
          providerMessageId: "provider-message-1",
          status: "accepted",
          updatedAt: 1200,
          version: 3,
        });
        expect({ calls, reconciliations }).toStrictEqual({
          calls: 1,
          reconciliations: 2,
        });
      }).pipe(
        Effect.provide(
          testLive(
            MailboxOutboundDispatcher.of({
              dispatch: () => {
                calls += 1;
                return Effect.succeed(acceptance);
              },
            }),
            () => 1200,
            () => {
              reconciliations += 1;
            }
          )
        )
      )
    );
  });

  it.each([
    ["invalid-message", "invalid_message"],
    ["message-too-large", "message_too_large"],
    ["invalid-sender", "invalid_sender"],
    ["recipient-suppressed", "recipient_suppressed"],
    ["provider-rejected", "provider_rejected"],
  ] as const)("maps permanent rejection %s precisely", async (reason, code) => {
    const row = await runOutcome(() =>
      Effect.fail(new DeliveryRejectedError({ message: "Rejected", reason }))
    );
    expect(row).toMatchObject({
      attemptCount: 1,
      failureAt: 1200,
      failureCode: code,
      providerCalls: 1,
      reconciliations: 1,
      status: "failed",
      version: 3,
    });
  });

  it("persists indeterminate provider outcomes without retrying", async () => {
    const row = await runOutcome(() =>
      Effect.fail(
        new DeliveryIndeterminateError({
          cause: new Error("Connection closed"),
          message: "Unknown acceptance",
        })
      )
    );
    expect(row).toMatchObject({
      attemptCount: 1,
      failureAt: null,
      failureCode: null,
      providerCalls: 1,
      status: "indeterminate",
      version: 3,
    });
  });

  it("persists known temporary failure as explicitly safe to retry", async () => {
    const row = await runOutcome(() =>
      Effect.fail(
        new DeliveryTemporaryFailureError({
          cause: new Error("Rate limited"),
          message: "Try later",
        })
      )
    );
    expect(row).toMatchObject({
      failureAt: 1200,
      failureCode: "temporary_provider_failure",
      providerCalls: 1,
      status: "failed",
    });
  });

  it("settles an unavailable development provider without an alarm loop", async () => {
    const row = await runOutcome(() =>
      Effect.fail(
        new DeliveryProviderUnavailableError({
          cause: new Error("No binding"),
          message: "Provider unavailable",
        })
      )
    );
    expect(row).toMatchObject({
      failureAt: 1200,
      failureCode: "provider_unavailable",
      providerCalls: 1,
      status: "failed",
    });
  });

  it("maps an unknown dispatch defect to indeterminate", async () => {
    const row = await runOutcome(() => Effect.die(new Error("Unknown defect")));
    expect(row).toMatchObject({
      failureAt: null,
      failureCode: null,
      providerCalls: 1,
      status: "indeterminate",
    });
  });

  it("rearms the next scheduled delivery after processing one item", async () => {
    let scheduledAt: number | null = null;
    const alarmStorage = MailboxAlarmStorage.of({
      delete: Effect.sync(() => {
        scheduledAt = null;
      }),
      get: Effect.sync(() => scheduledAt),
      set: (value) =>
        Effect.sync(() => {
          scheduledAt = value;
        }),
    });
    const base = Layer.merge(
      MailboxDatabaseTestLive,
      Layer.succeed(
        MailboxRuntime,
        MailboxRuntime.of({ now: alarmNow, randomId: () => "unused" })
      )
    );
    const lifecycle = MailboxOutboundLifecycleStoreSqliteLive.pipe(
      Layer.provideMerge(base)
    );
    const scheduler = MailboxOutboundAlarmSchedulerLive.pipe(
      Layer.provide(Layer.succeed(MailboxAlarmStorage, alarmStorage)),
      Layer.provideMerge(base)
    );
    const live = MailboxOutboundAlarmDispatchLive.pipe(
      Layer.provide(
        Layer.succeed(
          MailboxOutboundDispatcher,
          MailboxOutboundDispatcher.of({
            dispatch: () => Effect.succeed(acceptance),
          })
        )
      ),
      Layer.provideMerge(Layer.merge(lifecycle, scheduler))
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* setup;
        yield* seedDelivery("due", 1000);
        yield* seedDelivery("next", 5000);
        const alarm = yield* MailboxOutboundAlarmDispatch;
        yield* alarm.handle;
        expect(scheduledAt).toBe(5000);
      }).pipe(Effect.provide(live))
    );
  });
});
