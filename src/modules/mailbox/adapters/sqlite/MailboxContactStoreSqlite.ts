import { and, desc, gte, isNotNull, isNull, or, sql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { ContactSearchResult } from "#/modules/mailbox/domain/MailboxContact";
import type { SearchContactsInput } from "#/modules/mailbox/domain/MailboxContact";

import { MailboxDatabase } from "./MailboxSqliteDatabase";
import { contact } from "./MailboxSqliteSchema";

const toContactFtsQuery = (query: string) => {
  const terms = query.match(/[\p{L}\p{N}_]+/gu) ?? [];
  return terms.length === 0
    ? undefined
    : terms.map((term) => `"${term.replaceAll('"', '""')}"*`).join(" ");
};

const searchContacts = (input: SearchContactsInput) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const ftsQuery =
      input.query === undefined ? undefined : toContactFtsQuery(input.query);
    const matches =
      ftsQuery === undefined
        ? undefined
        : sql`"contact".rowid in (
            select rowid from contact_search where contact_search match ${ftsQuery}
          )`;
    const rows = yield* db
      .select({ address: contact.address, displayName: contact.displayName })
      .from(contact)
      .where(
        and(
          or(
            isNotNull(contact.safeLastSeenAt),
            input.allParticipantsEnabledAt === undefined
              ? undefined
              : gte(
                  contact.participantLastSeenAt,
                  input.allParticipantsEnabledAt
                )
          ),
          isNull(contact.hiddenAt),
          matches
        )
      )
      .orderBy(
        desc(sql`${contact.outboundCount} > 0`),
        desc(
          sql`coalesce(${contact.lastOutboundAt}, ${contact.lastInboundAt}, ${contact.safeLastSeenAt})`
        ),
        desc(sql`${contact.outboundCount} + ${contact.inboundCount}`),
        contact.normalizedAddress
      )
      .limit(input.limit);

    return Schema.decodeUnknownSync(ContactSearchResult)({
      contacts: rows.map((row) => ({
        address: row.address,
        displayName: row.displayName ?? undefined,
      })),
    });
  });

const makeMailboxContactStore = (db: MailboxDatabase) => ({
  searchContacts: (input: SearchContactsInput) =>
    searchContacts(input).pipe(Effect.provideService(MailboxDatabase, db)),
});

export type MailboxContactStore = ReturnType<typeof makeMailboxContactStore>;

export const MailboxContactStore = Context.Service<MailboxContactStore>(
  "cloudflare-inbox/MailboxContactStore"
);

export const MailboxContactStoreSqliteLayer = Layer.effect(
  MailboxContactStore,
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    return MailboxContactStore.of(makeMailboxContactStore(db));
  })
);
