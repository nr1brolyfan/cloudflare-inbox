import { sql } from "drizzle-orm";
import type { EffectSQLiteDOTransaction } from "drizzle-orm/effect-sqlite-do";
import * as Effect from "effect/Effect";

import { normalizeEmailAddressDomain } from "#/shared/EmailAddress";
import type { MailAddress } from "#/shared/MailAddress";

import type { mailboxRelations } from "./MailboxSqliteSchema";
import { contact } from "./MailboxSqliteSchema";

type MailboxTransaction = EffectSQLiteDOTransaction<typeof mailboxRelations>;

interface ContactObservation {
  readonly addresses: readonly MailAddress[];
  readonly at: number;
  readonly direction: "inbound" | "outbound";
  readonly excludeAddresses?: readonly MailAddress["address"][];
  readonly trust: "participant" | "safe";
}

const uniqueAddresses = (
  addresses: readonly MailAddress[],
  excludeAddresses: readonly MailAddress["address"][]
) => {
  const excluded = new Set(excludeAddresses.map(normalizeEmailAddressDomain));
  const unique = new Map<string, MailAddress>();
  for (const item of addresses) {
    const normalized = normalizeEmailAddressDomain(item.address);
    if (!excluded.has(normalized)) {
      unique.set(normalized, item);
    }
  }
  return [...unique.entries()];
};

/** Maintains the mailbox-local contact projection inside its caller's transaction. */
export const upsertContactObservations = (
  tx: MailboxTransaction,
  observation: ContactObservation
) => {
  const nameRank = observation.direction === "outbound" ? 2 : 1;
  const rows = uniqueAddresses(
    observation.addresses,
    observation.excludeAddresses ?? []
  ).map(([normalizedAddress, item]) => ({
    address: item.address,
    displayName: item.displayName?.slice(0, 200) ?? null,
    displayNameRank: item.displayName === undefined ? 0 : nameRank,
    inboundCount: observation.direction === "inbound" ? 1 : 0,
    lastInboundAt: observation.direction === "inbound" ? observation.at : null,
    lastOutboundAt:
      observation.direction === "outbound" ? observation.at : null,
    normalizedAddress,
    outboundCount: observation.direction === "outbound" ? 1 : 0,
    participantLastSeenAt:
      observation.trust === "participant" ? observation.at : null,
    safeLastSeenAt: observation.trust === "safe" ? observation.at : null,
  }));
  if (rows.length === 0) {
    return Effect.void;
  }

  return tx
    .insert(contact)
    .values(rows)
    .onConflictDoUpdate({
      target: contact.normalizedAddress,
      set: {
        address: sql`excluded.address`,
        displayName: sql`case
          when excluded.display_name is not null
            and excluded.display_name_rank >= ${contact.displayNameRank}
          then excluded.display_name
          else ${contact.displayName}
        end`,
        displayNameRank: sql`max(${contact.displayNameRank}, excluded.display_name_rank)`,
        inboundCount: sql`${contact.inboundCount} + excluded.inbound_count`,
        lastInboundAt: sql`case
          when excluded.last_inbound_at is null then ${contact.lastInboundAt}
          when ${contact.lastInboundAt} is null then excluded.last_inbound_at
          else max(${contact.lastInboundAt}, excluded.last_inbound_at)
        end`,
        lastOutboundAt: sql`case
          when excluded.last_outbound_at is null then ${contact.lastOutboundAt}
          when ${contact.lastOutboundAt} is null then excluded.last_outbound_at
          else max(${contact.lastOutboundAt}, excluded.last_outbound_at)
        end`,
        outboundCount: sql`${contact.outboundCount} + excluded.outbound_count`,
        participantLastSeenAt: sql`case
          when excluded.participant_last_seen_at is null then ${contact.participantLastSeenAt}
          when ${contact.participantLastSeenAt} is null then excluded.participant_last_seen_at
          else max(${contact.participantLastSeenAt}, excluded.participant_last_seen_at)
        end`,
        safeLastSeenAt: sql`case
          when excluded.safe_last_seen_at is null then ${contact.safeLastSeenAt}
          when ${contact.safeLastSeenAt} is null then excluded.safe_last_seen_at
          else max(${contact.safeLastSeenAt}, excluded.safe_last_seen_at)
        end`,
      },
    });
};
