import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { MailboxDomainError } from "./errors/mailbox-domain-error";
import { MailboxDatabase } from "./mailbox-database";
import { mailboxOperation } from "./mailbox-schema";

export const replayMailboxOperation = <A>(
  operationId: string,
  operation: MailboxDomainError["operation"],
  operationKind: string,
  requestKey: string,
  schema: Schema.Decoder<A>
) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
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
    if (row.operationKind !== operationKind || row.requestKey !== requestKey) {
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
  });

export const storeMailboxOperation = (
  operationId: string,
  operationKind: string,
  requestKey: string,
  resourceId: string,
  resultPayload: string,
  createdAt: number
) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    yield* db.insert(mailboxOperation).values({
      operationId,
      operationKind,
      requestKey,
      resourceId,
      resultPayload,
      createdAt,
    });
  });
