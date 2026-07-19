import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { MailboxId } from "./identifiers";
import {
  applyMailboxMigrations,
  mailboxSchemaVersion,
} from "./mailbox-migrations";
import {
  MailboxResourceLookup,
  MailboxResourceLookupResult,
} from "./mailbox-repository";
import {
  initializeMailboxRepository,
  resolveMailboxResource,
} from "./mailbox-repository-sqlite";

interface SchemaVersionRow extends Record<string, Cloudflare.SqlStorageValue> {
  readonly version: number;
}

/** SQLite-backed data-plane object with migrations completed before RPC starts. */
export class MailboxDO extends Cloudflare.DurableObject<MailboxDO>()(
  "MailboxDO",
  Effect.succeed(
    Effect.gen(function* () {
      const state = yield* Cloudflare.DurableObjectState;

      yield* Effect.sync(() => applyMailboxMigrations(state.raw.storage));
      const mailboxId = yield* Effect.sync(() => {
        if (state.id.name === undefined) {
          throw new Error(
            "MailboxDO must be addressed by canonical mailbox name"
          );
        }
        return Schema.decodeUnknownSync(MailboxId)(state.id.name);
      });
      yield* Effect.sync(() =>
        initializeMailboxRepository(state.raw.storage, mailboxId)
      );

      return {
        resolveMailResource: (input: unknown) =>
          Effect.sync(() => {
            const lookup = Schema.decodeUnknownSync(MailboxResourceLookup)(
              input
            );
            const result = resolveMailboxResource(
              state.storage.sql.raw,
              lookup
            );
            return Schema.encodeSync(MailboxResourceLookupResult)(result);
          }),
        sqliteReady: () =>
          Effect.gen(function* () {
            const cursor = yield* state.storage.sql.exec<SchemaVersionRow>(
              "SELECT COALESCE(MAX(version), 0) AS version FROM mailbox_schema_migration"
            );
            const row = yield* cursor.one();

            if (row.version !== mailboxSchemaVersion) {
              return yield* Effect.die(
                new Error("MailboxDO SQLite schema is not current")
              );
            }

            return true as const;
          }),
      };
    })
  )
) {}

export type MailboxDONamespace = Effect.Success<typeof MailboxDO>;
