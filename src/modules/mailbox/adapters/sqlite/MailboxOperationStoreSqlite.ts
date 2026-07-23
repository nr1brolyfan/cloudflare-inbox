import { eq } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { MailboxDomainError } from "#/modules/mailbox/domain/MailboxError";

import { MailboxDatabase } from "./MailboxSqliteDatabase";
import { mailboxOperation } from "./MailboxSqliteSchema";

const makeMailboxOperationStore = (db: MailboxDatabase) => ({
  replay: <A>(
    operationId: string,
    operation: MailboxDomainError["operation"],
    operationKind: string,
    requestKey: string,
    schema: Schema.Decoder<A>
  ) =>
    Effect.gen(function* () {
      const [row] = yield* db
        .select({
          operationKind: mailboxOperation.operationKind,
          requestKey: mailboxOperation.requestKey,
          resultPayload: mailboxOperation.resultPayload,
        })
        .from(mailboxOperation)
        .where(eq(mailboxOperation.operationId, operationId))
        .limit(1);

      if (row === undefined) {
        return;
      }
      if (
        row.operationKind !== operationKind ||
        row.requestKey !== requestKey
      ) {
        return Result.fail(
          new MailboxDomainError({
            operation,
            reason: "idempotency-conflict",
            message: "Operation ID was already used for a different request",
            resourceId: operationId,
          })
        );
      }
      return Result.succeed(
        Schema.decodeUnknownSync(schema)(JSON.parse(row.resultPayload))
      );
    }),
  store: (
    operationId: string,
    operationKind: string,
    requestKey: string,
    resourceId: string,
    resultPayload: string,
    createdAt: number
  ) =>
    db
      .insert(mailboxOperation)
      .values({
        operationId,
        operationKind,
        requestKey,
        resourceId,
        resultPayload,
        createdAt,
      })
      .pipe(Effect.asVoid),
});

export type MailboxOperationStore = ReturnType<
  typeof makeMailboxOperationStore
>;

/** Durable operation replay shared by idempotent SQLite mutation stores. */
export const MailboxOperationStore = Context.Service<MailboxOperationStore>(
  "cloudflare-inbox/MailboxOperationStore"
);

export const MailboxOperationStoreSqliteLayer = Layer.effect(
  MailboxOperationStore,
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    return MailboxOperationStore.of(makeMailboxOperationStore(db));
  })
);
