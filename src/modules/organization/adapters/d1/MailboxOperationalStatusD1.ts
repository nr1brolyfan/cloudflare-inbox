import { and, eq, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  MailboxOperationalStatus,
  MailboxOperationalStatusError,
} from "#/modules/mailbox/ports/MailboxOperationalStatus";
import { activeOrganizationMailboxPredicate } from "#/modules/organization/integration/OrganizationD1Predicates";
import {
  ControlPlaneDatabase,
  controlPlaneDatabaseLayerFromBinding,
} from "#/platform/control-plane-d1/ControlPlaneDatabase";

import {
  appMailbox,
  appOrganizationOperationFence,
} from "./OrganizationSchema";

const storageError = (cause: unknown) =>
  new MailboxOperationalStatusError({
    cause,
    message: "Mailbox operational status could not be changed",
  });

export const MailboxOperationalStatusD1Layer = Layer.effect(
  MailboxOperationalStatus,
  Effect.gen(function* () {
    const database = yield* ControlPlaneDatabase;
    return MailboxOperationalStatus.of({
      acquire: (input) => {
        const holderId = crypto.randomUUID();
        return database
          .insert(appOrganizationOperationFence)
          .select(
            database
              .select({
                createdAt:
                  sql<number>`cast(unixepoch('subsec') * 1000 as integer)`.as(
                    "created_at"
                  ),
                mailboxId: appMailbox.id,
                holderId: sql`${holderId}`.as("holder_id"),
                operationId: sql`${input.operationId}`.as("operation_id"),
                operationKind: sql`${input.operationKind}`.as("operation_kind"),
                organizationId: appMailbox.organizationId,
              })
              .from(appMailbox)
              .where(
                and(
                  eq(appMailbox.id, input.mailboxId),
                  activeOrganizationMailboxPredicate(database, input.mailboxId)
                )
              )
          )
          .onConflictDoNothing()
          .returning({ holderId: appOrganizationOperationFence.holderId })
          .pipe(
            Effect.map(([inserted]) => inserted?.holderId ?? null),
            Effect.mapError(storageError)
          );
      },
      isActive: (mailboxId) =>
        database
          .select({ id: appMailbox.id })
          .from(appMailbox)
          .where(activeOrganizationMailboxPredicate(database, mailboxId))
          .limit(1)
          .pipe(
            Effect.map((rows) => rows.length === 1),
            Effect.mapError(storageError)
          ),
      release: (input) =>
        database
          .delete(appOrganizationOperationFence)
          .where(
            and(
              eq(appOrganizationOperationFence.holderId, input.holderId),
              eq(appOrganizationOperationFence.operationId, input.operationId),
              eq(
                appOrganizationOperationFence.operationKind,
                input.operationKind
              ),
              eq(appOrganizationOperationFence.mailboxId, input.mailboxId)
            )
          )
          .pipe(Effect.asVoid, Effect.mapError(storageError)),
    });
  })
);

/** Selects the reviewed D1 adapter without exposing raw SQL capabilities to apps. */
export const mailboxOperationalStatusD1Layer = (database: D1Database) =>
  MailboxOperationalStatusD1Layer.pipe(
    Layer.provide(controlPlaneDatabaseLayerFromBinding(database))
  );
