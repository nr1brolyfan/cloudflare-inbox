import { and, eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { appMailboxAddress } from "#/modules/address-routing/adapters/d1/AddressRoutingSchema";
import { InboundMailboxResolver } from "#/modules/address-routing/ports/InboundMailboxResolver";
import { MailboxId } from "#/modules/mailbox/domain/Mailbox";
import { InboundEmailRejected } from "#/modules/mailbox/ports/InboundEmailIngress";
import { activeOrganizationMailboxPredicate } from "#/modules/organization/integration/OrganizationD1Predicates";
import { ControlPlaneDatabase } from "#/platform/control-plane-d1/ControlPlaneDatabase";
import { normalizeEmailAddressDomain } from "#/shared/EmailAddress";

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
          .where(
            and(
              eq(
                appMailboxAddress.normalizedAddress,
                normalizeEmailAddressDomain(recipient)
              ),
              eq(appMailboxAddress.enabled, true),
              activeOrganizationMailboxPredicate(
                database,
                appMailboxAddress.mailboxId
              )
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
