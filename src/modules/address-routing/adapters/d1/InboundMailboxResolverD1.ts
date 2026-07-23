import { and, eq, isNull } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { appMailboxAddress } from "#/modules/address-routing/adapters/d1/AddressRoutingSchema";
import {
  InboundEmailRejected,
  InboundMailboxResolver,
} from "#/modules/address-routing/application/InboundMailboxResolver";
import { normalizeEmailAddressDomain } from "#/modules/address-routing/domain/EmailAddress";
import { MailboxId } from "#/modules/mailbox/domain/Mailbox";
import { appMailbox } from "#/modules/organization/adapters/d1/OrganizationSchema";
import { ControlPlaneDatabase } from "#/platform/control-plane-d1/ControlPlaneDatabase";

const resolutionError = (
  reason: "processing-unavailable" | "unknown-recipient",
  cause?: unknown
) =>
  new InboundEmailRejected({
    cause,
    message:
      reason === "unknown-recipient"
        ? "Mailbox recipient is not configured"
        : "Inbound email processing is not available",
    reason,
  });

/** Active mailbox lookup by the canonical SMTP envelope recipient. */
export const InboundMailboxResolverD1Layer = Layer.effect(
  InboundMailboxResolver,
  Effect.gen(function* () {
    const database = yield* ControlPlaneDatabase;

    return InboundMailboxResolver.of({
      resolve: (recipient) =>
        database
          .select({ mailboxId: appMailboxAddress.mailboxId })
          .from(appMailboxAddress)
          .innerJoin(appMailbox, eq(appMailbox.id, appMailboxAddress.mailboxId))
          .where(
            and(
              eq(
                appMailboxAddress.normalizedAddress,
                normalizeEmailAddressDomain(recipient)
              ),
              eq(appMailboxAddress.enabled, true),
              eq(appMailbox.status, "active"),
              isNull(appMailbox.deletedAt)
            )
          )
          .limit(1)
          .pipe(
            Effect.mapError((cause) =>
              resolutionError("processing-unavailable", cause)
            ),
            Effect.flatMap(([row]) =>
              row === undefined
                ? Effect.fail(resolutionError("unknown-recipient"))
                : Schema.decodeUnknownEffect(MailboxId)(row.mailboxId).pipe(
                    Effect.mapError((cause) =>
                      resolutionError("processing-unavailable", cause)
                    )
                  )
            )
          ),
    });
  })
);
