import { and, asc, eq, isNull, lte, sql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { AttemptCount, OutboundDeliveryId, UnixMillis, Version } from "./core";
import { OutboundFailureCode, OutboundProviderMessageId } from "./outbound";
import { outboundDelivery } from "./sqlite-schema";
import { MailboxDatabase, MailboxRuntime } from "./sqlite-services";

export class OutboundDeliveryClaim extends Schema.Class<OutboundDeliveryClaim>(
  "cloudflare-inbox/OutboundDeliveryClaim"
)({
  attemptCount: AttemptCount,
  claimedAt: UnixMillis,
  outboundDeliveryId: OutboundDeliveryId,
  version: Version,
}) {}

export const OutboundDeliverySettlement = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Accepted"),
    providerMessageId: OutboundProviderMessageId,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Failed"),
    code: OutboundFailureCode,
  }),
  Schema.Struct({ _tag: Schema.Literal("Indeterminate") }),
]);
export type OutboundDeliverySettlement = Schema.Schema.Type<
  typeof OutboundDeliverySettlement
>;

export interface MailboxOutboundLifecycleStore {
  readonly claimDue: Effect.Effect<OutboundDeliveryClaim | null>;
  readonly settle: (
    claim: OutboundDeliveryClaim,
    settlement: OutboundDeliverySettlement
  ) => Effect.Effect<boolean>;
}

/** Internal DO store; claims and settlements are guarded by lifecycle version and attempt. */
export const MailboxOutboundLifecycleStore =
  Context.Service<MailboxOutboundLifecycleStore>(
    "cloudflare-inbox/MailboxOutboundLifecycleStore"
  );

export const MailboxOutboundLifecycleStoreSqliteLive = Layer.effect(
  MailboxOutboundLifecycleStore,
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const runtime = yield* MailboxRuntime;

    return MailboxOutboundLifecycleStore.of({
      claimDue: db
        .transaction((tx) =>
          Effect.gen(function* () {
            const now = runtime.now();
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
      settle: (claim, settlement) => {
        const settledAt = Math.max(runtime.now(), claim.claimedAt);
        const values =
          settlement._tag === "Accepted"
            ? {
                acceptedAt: settledAt,
                providerMessageId: settlement.providerMessageId,
                status: "accepted" as const,
              }
            : settlement._tag === "Failed"
              ? {
                  failureAt: settledAt,
                  failureCode: settlement.code,
                  status: "failed" as const,
                }
              : { status: "indeterminate" as const };

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
