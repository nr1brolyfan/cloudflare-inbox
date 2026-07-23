import { and, eq, isNull } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import {
  MailboxId,
  normalizeEmailAddressDomain,
} from "#/modules/mailbox/domain/Mailbox";

import {
  InboundEmailRejected,
  InboundMailboxResolver,
} from "../mailboxes/inbound";
import { ControlPlaneDatabase } from "./database";
import { appMailbox, appMailboxAddress } from "./schema";

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
export const InboundMailboxResolverLive = Layer.effect(
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
