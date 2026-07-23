import { and, asc, eq, isNull, lte, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { outboundDelivery } from "#/mailboxes/sqlite-schema";
import { MailboxDatabase } from "#/mailboxes/sqlite-services";
import { MailboxOutboundAlarmClock } from "#/modules/mailbox/ports/MailboxOutboundAlarmClock";
import {
  MailboxOutboundLifecycleStore,
  OutboundDeliveryClaim,
  outboundRetryDelayMillis,
  outboundRetryMaxAttempts,
  outboundSendingStaleTimeoutMillis,
} from "#/modules/mailbox/ports/MailboxOutboundLifecycleStore";

export const MailboxOutboundLifecycleStoreSqliteLayer = Layer.effect(
  MailboxOutboundLifecycleStore,
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const clock = yield* MailboxOutboundAlarmClock;

    return MailboxOutboundLifecycleStore.of({
      claimDue: db
        .transaction((tx) =>
          Effect.gen(function* () {
            const now = clock.now();
            const [due] = yield* tx
              .select()
              .from(outboundDelivery)
              .where(
                and(
                  eq(outboundDelivery.status, "scheduled"),
                  lte(outboundDelivery.sendAt, now),
                  isNull(outboundDelivery.deletedAt)
                )
              )
              .orderBy(asc(outboundDelivery.sendAt), asc(outboundDelivery.id))
              .limit(1);
            if (due === undefined) {
              return null;
            }

            const claimedAt = Math.max(now, due.sendAt, due.updatedAt);
            const [claimed] = yield* tx
              .update(outboundDelivery)
              .set({
                attemptCount: sql`${outboundDelivery.attemptCount} + 1`,
                status: "sending",
                updatedAt: claimedAt,
                version: sql`${outboundDelivery.version} + 1`,
              })
              .where(
                and(
                  eq(outboundDelivery.id, due.id),
                  eq(outboundDelivery.status, "scheduled"),
                  eq(outboundDelivery.version, due.version),
                  lte(outboundDelivery.sendAt, now),
                  isNull(outboundDelivery.deletedAt)
                )
              )
              .returning({
                attemptCount: outboundDelivery.attemptCount,
                outboundDeliveryId: outboundDelivery.id,
                version: outboundDelivery.version,
              });
            if (claimed === undefined) {
              return null;
            }

            return Schema.decodeUnknownSync(OutboundDeliveryClaim)({
              ...claimed,
              claimedAt,
            });
          })
        )
        .pipe(Effect.orDie),
      nextScheduledAt: Effect.all([
        db
          .select({ scheduledAt: outboundDelivery.sendAt })
          .from(outboundDelivery)
          .where(
            and(
              eq(outboundDelivery.status, "scheduled"),
              isNull(outboundDelivery.deletedAt)
            )
          )
          .orderBy(asc(outboundDelivery.sendAt), asc(outboundDelivery.id))
          .limit(1),
        db
          .select({
            scheduledAt: sql<number>`${outboundDelivery.updatedAt} + ${outboundSendingStaleTimeoutMillis}`,
          })
          .from(outboundDelivery)
          .where(
            and(
              eq(outboundDelivery.status, "sending"),
              isNull(outboundDelivery.deletedAt)
            )
          )
          .orderBy(asc(outboundDelivery.updatedAt), asc(outboundDelivery.id))
          .limit(1),
      ]).pipe(
        Effect.map(([scheduled, sending]) => {
          const candidates = [
            scheduled[0]?.scheduledAt,
            sending[0]?.scheduledAt,
          ].filter((value): value is number => value !== undefined);
          return candidates.length === 0 ? null : Math.min(...candidates);
        }),
        Effect.orDie
      ),
      recoverStaleSending: db
        .transaction((tx) =>
          Effect.gen(function* () {
            const now = clock.now();
            const staleBefore = Math.max(
              0,
              now - outboundSendingStaleTimeoutMillis
            );
            const stale = yield* tx
              .select({
                attemptCount: outboundDelivery.attemptCount,
                id: outboundDelivery.id,
                version: outboundDelivery.version,
              })
              .from(outboundDelivery)
              .where(
                and(
                  eq(outboundDelivery.status, "sending"),
                  lte(outboundDelivery.updatedAt, staleBefore),
                  isNull(outboundDelivery.deletedAt)
                )
              )
              .orderBy(
                asc(outboundDelivery.updatedAt),
                asc(outboundDelivery.id)
              );

            // A crashed claim may have reached the provider, so recovery never requeues it.
            const recovered = yield* Effect.all(
              stale.map((candidate) =>
                tx
                  .update(outboundDelivery)
                  .set({
                    acceptedAt: null,
                    bouncedAt: null,
                    cancelledAt: null,
                    deliveredAt: null,
                    failureAt: null,
                    failureCode: null,
                    providerMessageId: null,
                    status: "indeterminate",
                    updatedAt: now,
                    version: sql`${outboundDelivery.version} + 1`,
                  })
                  .where(
                    and(
                      eq(outboundDelivery.id, candidate.id),
                      eq(outboundDelivery.status, "sending"),
                      eq(outboundDelivery.version, candidate.version),
                      eq(outboundDelivery.attemptCount, candidate.attemptCount),
                      lte(outboundDelivery.updatedAt, staleBefore),
                      isNull(outboundDelivery.deletedAt)
                    )
                  )
                  .returning({ id: outboundDelivery.id })
              ),
              { concurrency: 1 }
            );
            return recovered.filter((rows) => rows.length === 1).length;
          })
        )
        .pipe(Effect.orDie),
      retry: (claim) => {
        const retriedAt = Math.max(clock.now(), claim.claimedAt);
        const exhausted = claim.attemptCount >= outboundRetryMaxAttempts;
        return db
          .update(outboundDelivery)
          .set({
            acceptedAt: null,
            bouncedAt: null,
            cancelledAt: null,
            deliveredAt: null,
            failureAt: exhausted ? retriedAt : null,
            failureCode: exhausted ? "retry_exhausted" : null,
            providerMessageId: null,
            ...(exhausted
              ? {}
              : {
                  sendAt:
                    retriedAt + outboundRetryDelayMillis(claim.attemptCount),
                }),
            status: exhausted ? "failed" : "scheduled",
            updatedAt: retriedAt,
            version: sql`${outboundDelivery.version} + 1`,
          })
          .where(
            and(
              eq(outboundDelivery.id, claim.outboundDeliveryId),
              eq(outboundDelivery.status, "sending"),
              eq(outboundDelivery.version, claim.version),
              eq(outboundDelivery.attemptCount, claim.attemptCount),
              isNull(outboundDelivery.deletedAt)
            )
          )
          .returning({ id: outboundDelivery.id })
          .pipe(
            Effect.map((rows) => rows.length === 1),
            Effect.orDie
          );
      },
      settle: (claim, settlement) => {
        const settledAt = Math.max(clock.now(), claim.claimedAt);
        const values =
          settlement._tag === "Accepted"
            ? {
                acceptedAt: settledAt,
                bouncedAt: null,
                cancelledAt: null,
                deliveredAt: null,
                failureAt: null,
                failureCode: null,
                providerMessageId: settlement.providerMessageId,
                status: "accepted" as const,
              }
            : settlement._tag === "Failed"
              ? {
                  acceptedAt: null,
                  bouncedAt: null,
                  cancelledAt: null,
                  deliveredAt: null,
                  failureAt: settledAt,
                  failureCode: settlement.code,
                  providerMessageId: null,
                  status: "failed" as const,
                }
              : {
                  acceptedAt: null,
                  bouncedAt: null,
                  cancelledAt: null,
                  deliveredAt: null,
                  failureAt: null,
                  failureCode: null,
                  providerMessageId: null,
                  status: "indeterminate" as const,
                };

        return db
          .update(outboundDelivery)
          .set({
            ...values,
            updatedAt: settledAt,
            version: sql`${outboundDelivery.version} + 1`,
          })
          .where(
            and(
              eq(outboundDelivery.id, claim.outboundDeliveryId),
              eq(outboundDelivery.status, "sending"),
              eq(outboundDelivery.version, claim.version),
              eq(outboundDelivery.attemptCount, claim.attemptCount),
              isNull(outboundDelivery.deletedAt)
            )
          )
          .returning({ id: outboundDelivery.id })
          .pipe(
            Effect.map((rows) => rows.length === 1),
            Effect.orDie
          );
      },
    });
  })
);
