import { and, desc, eq, gte, isNotNull, isNull, or, sql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import {
  ContactDetail,
  ContactSearchResult,
  RemoveContactResult,
} from "#/modules/mailbox/domain/MailboxContact";
import type {
  TrustedGetContactInput,
  TrustedListContactsInput,
  TrustedRemoveContactCommand,
  TrustedSaveContactCommand,
} from "#/modules/mailbox/domain/MailboxContact";
import { MailboxDomainError } from "#/modules/mailbox/domain/MailboxError";
import { normalizeEmailAddressDomain } from "#/shared/EmailAddress";
import { Version } from "#/shared/Temporal";

import { MailboxOperationStore } from "./MailboxOperationStoreSqlite";
import { MailboxDatabase } from "./MailboxSqliteDatabase";
import { MailboxRuntime } from "./MailboxSqliteRuntime";
import { contact, savedContact } from "./MailboxSqliteSchema";

const toContactFtsQuery = (query: string) => {
  const terms = query.match(/[\p{L}\p{N}_]+/gu) ?? [];
  return terms.length === 0
    ? undefined
    : terms.map((term) => `"${term.replaceAll('"', '""')}"*`).join(" ");
};

interface ContactRow {
  readonly address: string;
  readonly inferredDisplayName: string | null;
  readonly manualDisplayName: string | null;
  readonly createdAt: number | null;
  readonly version: number | null;
  readonly firstReceivedAt: number | null;
  readonly lastReceivedAt: number | null;
  readonly receivedCount: number | null;
  readonly firstSentAt: number | null;
  readonly lastSentAt: number | null;
  readonly sentCount: number | null;
}

const minimum = (...values: readonly (number | null)[]) => {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? undefined : Math.min(...present);
};

const maximum = (...values: readonly (number | null)[]) => {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? undefined : Math.max(...present);
};

const contactFromRow = (row: ContactRow) =>
  Schema.decodeUnknownSync(ContactDetail)({
    address: row.address,
    displayName: row.manualDisplayName ?? row.inferredDisplayName ?? undefined,
    saved: row.createdAt !== null,
    savedAt: row.createdAt ?? undefined,
    version: row.version ?? undefined,
    firstInteractionAt: minimum(row.firstReceivedAt, row.firstSentAt),
    lastInteractionAt: maximum(row.lastReceivedAt, row.lastSentAt),
    receivedCount: row.receivedCount ?? 0,
    sentCount: row.sentCount ?? 0,
  });

const selectedContact = {
  address: sql<string>`coalesce(${savedContact.address}, ${contact.address})`,
  inferredDisplayName: contact.displayName,
  manualDisplayName: savedContact.displayName,
  createdAt: savedContact.createdAt,
  version: savedContact.version,
  firstReceivedAt: contact.firstReceivedAt,
  lastReceivedAt: contact.lastReceivedAt,
  receivedCount: contact.receivedCount,
  firstSentAt: contact.firstSentAt,
  lastSentAt: contact.lastSentAt,
  sentCount: contact.sentCount,
};

const searchContacts = (
  input: TrustedListContactsInput
): Effect.Effect<ContactSearchResult, never, MailboxDatabase> =>
  Effect.gen(function* () {
    if (input.mode === "all") {
      const [saved, suggested] = yield* Effect.all([
        searchContacts({ ...input, mode: "saved" }),
        searchContacts({ ...input, mode: "suggested" }),
      ]);
      return Schema.decodeUnknownSync(ContactSearchResult)({
        contacts: [...saved.contacts, ...suggested.contacts].slice(
          0,
          input.limit
        ),
      });
    }
    const db = yield* MailboxDatabase;
    if (input.mode === "saved") {
      const rows = yield* db
        .select(selectedContact)
        .from(savedContact)
        .leftJoin(
          contact,
          eq(contact.normalizedAddress, savedContact.normalizedAddress)
        )
        .where(
          and(
            eq(savedContact.userId, input.userId),
            input.query === undefined
              ? undefined
              : or(
                  sql`instr(lower(${savedContact.address}), lower(${input.query})) > 0`,
                  sql`instr(lower(coalesce(${savedContact.displayName}, '')), lower(${input.query})) > 0`,
                  sql`instr(lower(coalesce(${contact.displayName}, '')), lower(${input.query})) > 0`
                )
          )
        )
        .orderBy(desc(savedContact.updatedAt), savedContact.normalizedAddress)
        .limit(input.limit);
      return Schema.decodeUnknownSync(ContactSearchResult)({
        contacts: rows.map(contactFromRow),
      });
    }

    const ftsQuery =
      input.query === undefined ? undefined : toContactFtsQuery(input.query);
    const matches =
      ftsQuery === undefined
        ? undefined
        : sql`"contact".rowid in (
            select rowid from contact_search where contact_search match ${ftsQuery}
          )`;
    const rows = yield* db
      .select(selectedContact)
      .from(contact)
      .leftJoin(
        savedContact,
        and(
          eq(savedContact.userId, input.userId),
          eq(savedContact.normalizedAddress, contact.normalizedAddress)
        )
      )
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
          isNull(savedContact.userId),
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
      contacts: rows.map(contactFromRow),
    });
  }).pipe(Effect.orDie);

const getContact = (input: Schema.Schema.Type<typeof TrustedGetContactInput>) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const normalizedAddress = normalizeEmailAddressDomain(input.address);
    const [row] = yield* db
      .select(selectedContact)
      .from(contact)
      .fullJoin(
        savedContact,
        and(
          eq(savedContact.normalizedAddress, contact.normalizedAddress),
          eq(savedContact.userId, input.userId)
        )
      )
      .where(
        and(
          eq(
            sql`coalesce(${savedContact.normalizedAddress}, ${contact.normalizedAddress})`,
            normalizedAddress
          ),
          or(
            isNull(savedContact.userId),
            eq(savedContact.userId, input.userId)
          ),
          or(
            isNotNull(savedContact.userId),
            and(
              isNull(contact.hiddenAt),
              or(
                isNotNull(contact.safeLastSeenAt),
                input.allParticipantsEnabledAt === undefined
                  ? undefined
                  : gte(
                      contact.participantLastSeenAt,
                      input.allParticipantsEnabledAt
                    )
              )
            )
          )
        )
      )
      .limit(1);
    if (row === undefined) {
      return Schema.decodeUnknownSync(ContactDetail)({
        address: input.address,
        receivedCount: 0,
        saved: false,
        sentCount: 0,
      });
    }
    return contactFromRow(row);
  });

const saveContact = (
  input: TrustedSaveContactCommand,
  operations: MailboxOperationStore
) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const runtime = yield* MailboxRuntime;
    return yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const normalizedAddress = normalizeEmailAddressDomain(input.email);
        const requestKey = JSON.stringify({
          displayName: input.displayName ?? null,
          email: input.email,
          expectedVersion: input.expectedVersion ?? null,
          userId: input.userId,
        });
        const previous = yield* operations.replay(
          input.operationId,
          "save-contact",
          "save-contact",
          requestKey,
          ContactDetail
        );
        if (previous !== undefined) {
          return previous;
        }

        const [existing] = yield* tx
          .select({ version: savedContact.version })
          .from(savedContact)
          .where(
            and(
              eq(savedContact.userId, input.userId),
              eq(savedContact.normalizedAddress, normalizedAddress)
            )
          )
          .limit(1);
        if (
          (input.expectedVersion === undefined && existing !== undefined) ||
          (input.expectedVersion !== undefined &&
            existing?.version !== input.expectedVersion)
        ) {
          return Result.fail(
            new MailboxDomainError({
              operation: "save-contact",
              reason: "version-conflict",
              message: "Saved contact changed",
              resourceType: "contact",
              resourceId: normalizedAddress,
              expectedVersion: input.expectedVersion,
              actualVersion:
                existing === undefined
                  ? undefined
                  : Schema.decodeUnknownSync(Version)(existing.version),
            })
          );
        }
        const now = runtime.now();
        yield* tx
          .insert(savedContact)
          .values({
            userId: input.userId,
            normalizedAddress,
            address: input.email,
            displayName: input.displayName,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [savedContact.userId, savedContact.normalizedAddress],
            set: {
              address: input.email,
              displayName: input.displayName ?? null,
              updatedAt: now,
              version: sql`${savedContact.version} + 1`,
            },
          });
        const result = yield* getContact({
          address: input.email,
          mailboxId: input.mailboxId,
          userId: input.userId,
        });
        yield* operations.store(
          input.operationId,
          "save-contact",
          requestKey,
          normalizedAddress,
          JSON.stringify(Schema.encodeSync(ContactDetail)(result)),
          now
        );
        return Result.succeed(result);
      })
    );
  });

const removeContact = (
  input: TrustedRemoveContactCommand,
  operations: MailboxOperationStore
) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const runtime = yield* MailboxRuntime;
    return yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const normalizedAddress = normalizeEmailAddressDomain(input.email);
        const requestKey = JSON.stringify({
          email: input.email,
          expectedVersion: input.expectedVersion ?? null,
          userId: input.userId,
        });
        const previous = yield* operations.replay(
          input.operationId,
          "remove-contact",
          "remove-contact",
          requestKey,
          RemoveContactResult
        );
        if (previous !== undefined) {
          return previous;
        }
        const [existing] = yield* tx
          .select({ version: savedContact.version })
          .from(savedContact)
          .where(
            and(
              eq(savedContact.userId, input.userId),
              eq(savedContact.normalizedAddress, normalizedAddress)
            )
          )
          .limit(1);
        if (
          input.expectedVersion !== undefined &&
          existing?.version !== input.expectedVersion
        ) {
          return Result.fail(
            new MailboxDomainError({
              operation: "remove-contact",
              reason: "version-conflict",
              message: "Saved contact changed",
              resourceType: "contact",
              resourceId: normalizedAddress,
              expectedVersion: input.expectedVersion,
              actualVersion:
                existing === undefined
                  ? undefined
                  : Schema.decodeUnknownSync(Version)(existing.version),
            })
          );
        }
        if (existing !== undefined) {
          yield* tx
            .delete(savedContact)
            .where(
              and(
                eq(savedContact.userId, input.userId),
                eq(savedContact.normalizedAddress, normalizedAddress)
              )
            );
        }
        const result = Schema.decodeUnknownSync(RemoveContactResult)({
          address: input.email,
          removed: existing !== undefined,
        });
        yield* operations.store(
          input.operationId,
          "remove-contact",
          requestKey,
          normalizedAddress,
          JSON.stringify(Schema.encodeSync(RemoveContactResult)(result)),
          runtime.now()
        );
        return Result.succeed(result);
      })
    );
  });

const makeMailboxContactStore = (
  db: MailboxDatabase,
  operations: MailboxOperationStore,
  runtime: MailboxRuntime
) => ({
  searchContacts: (input: TrustedListContactsInput) =>
    searchContacts(input).pipe(Effect.provideService(MailboxDatabase, db)),
  getContact: (input: Schema.Schema.Type<typeof TrustedGetContactInput>) =>
    getContact(input).pipe(Effect.provideService(MailboxDatabase, db)),
  saveContact: (input: TrustedSaveContactCommand) =>
    saveContact(input, operations).pipe(
      Effect.provideService(MailboxDatabase, db),
      Effect.provideService(MailboxRuntime, runtime),
      Effect.flatMap((result) =>
        Result.match(result, {
          onFailure: Effect.fail,
          onSuccess: Effect.succeed,
        })
      )
    ),
  removeContact: (input: TrustedRemoveContactCommand) =>
    removeContact(input, operations).pipe(
      Effect.provideService(MailboxDatabase, db),
      Effect.provideService(MailboxRuntime, runtime),
      Effect.flatMap((result) =>
        Result.match(result, {
          onFailure: Effect.fail,
          onSuccess: Effect.succeed,
        })
      )
    ),
});

export type MailboxContactStore = ReturnType<typeof makeMailboxContactStore>;

export const MailboxContactStore = Context.Service<MailboxContactStore>(
  "cloudflare-inbox/MailboxContactStore"
);

export const MailboxContactStoreSqliteLayer = Layer.effect(
  MailboxContactStore,
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const operations = yield* MailboxOperationStore;
    const runtime = yield* MailboxRuntime;
    return MailboxContactStore.of(
      makeMailboxContactStore(db, operations, runtime)
    );
  })
);
