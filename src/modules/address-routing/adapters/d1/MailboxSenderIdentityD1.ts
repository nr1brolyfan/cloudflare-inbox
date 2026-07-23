import { and, eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { appMailboxAddress } from "#/modules/address-routing/adapters/d1/AddressRoutingSchema";
import { MailAddress } from "#/modules/address-routing/domain/MailAddress";
import type { MailboxId } from "#/modules/mailbox/domain/Mailbox";
import {
  MailboxSenderIdentity,
  MailboxSenderIdentityError,
} from "#/modules/mailbox/ports/MailboxSenderIdentity";
import { activeOrganizationMailboxPredicate } from "#/modules/organization/integration/OrganizationD1Predicates";
import { ControlPlaneDatabase } from "#/platform/control-plane-d1/ControlPlaneDatabase";

const senderIdentityError = (
  mailboxId: MailboxId,
  reason: MailboxSenderIdentityError["reason"],
  cause?: unknown
) =>
  new MailboxSenderIdentityError({
    cause,
    mailboxId,
    message:
      reason === "not-found"
        ? "Mailbox sender identity is not configured"
        : "Mailbox sender identity could not be loaded",
    reason,
  });

/** D1 lookup for the sole enabled primary address of an active mailbox. */
export const MailboxSenderIdentityD1Layer = Layer.effect(
  MailboxSenderIdentity,
  Effect.gen(function* () {
    const database = yield* ControlPlaneDatabase;

    return MailboxSenderIdentity.of({
      resolve: (mailboxId) =>
        database
          .select({
            address: appMailboxAddress.address,
            displayName: appMailboxAddress.displayName,
          })
          .from(appMailboxAddress)
          .where(
            and(
              eq(appMailboxAddress.mailboxId, mailboxId),
              eq(appMailboxAddress.isPrimary, true),
              eq(appMailboxAddress.enabled, true),
              activeOrganizationMailboxPredicate(
                database,
                appMailboxAddress.mailboxId
              )
            )
          )
          .limit(2)
          .pipe(
            Effect.mapError((cause) =>
              senderIdentityError(mailboxId, "storage", cause)
            ),
            Effect.flatMap((rows) => {
              if (rows.length === 0) {
                return Effect.fail(senderIdentityError(mailboxId, "not-found"));
              }
              if (rows.length > 1) {
                return Effect.fail(
                  senderIdentityError(
                    mailboxId,
                    "storage",
                    new Error("Mailbox sender identity invariant failed")
                  )
                );
              }
              const [row] = rows;
              return Schema.decodeUnknownEffect(MailAddress)({
                address: row.address,
                ...(row.displayName === null
                  ? {}
                  : { displayName: row.displayName }),
              }).pipe(
                Effect.mapError((cause) =>
                  senderIdentityError(mailboxId, "storage", cause)
                )
              );
            })
          ),
    });
  })
);
