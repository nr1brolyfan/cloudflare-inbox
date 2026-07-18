import { DevEmailStore, DevEmailStoreError } from "@effect-auth/core/DevEmail";
import type {
  DevEmailListOptions,
  DevEmailMessage,
  DevEmailStoreOperation,
} from "@effect-auth/core/DevEmail";
import type { RuntimeContext } from "alchemy";
import type * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export type D1DevEmailDatabase = Effect.Success<
  ReturnType<typeof Cloudflare.D1.QueryDatabase>
>;

interface DevEmailRow {
  readonly message_json: string;
}

const upsertMessage = `
  insert into app_dev_email_message (
    id,
    kind,
    recipient,
    message_json,
    created_at,
    expires_at
  ) values (?, ?, ?, ?, ?, ?)
  on conflict (id) do update set
    kind = excluded.kind,
    recipient = excluded.recipient,
    message_json = excluded.message_json,
    created_at = excluded.created_at,
    expires_at = excluded.expires_at
`;

const trimMessages = `
  delete from app_dev_email_message
  where id not in (
    select id
    from app_dev_email_message
    order by created_at desc
    limit 100
  )
`;

const listMessages = `
  select message_json
  from app_dev_email_message
  order by created_at desc
  limit 100
`;

const clearMessages = "delete from app_dev_email_message";

const storeError = (
  operation: DevEmailStoreOperation,
  cause: unknown
): DevEmailStoreError =>
  new DevEmailStoreError({
    operation,
    message: `Failed to ${operation} development email`,
    cause,
  });

const eraseRuntimeContext = <A>(
  effect: Effect.Effect<A, never, RuntimeContext>
): Effect.Effect<A> => effect as Effect.Effect<A>;

const storeOperation = <A>(
  operation: DevEmailStoreOperation,
  effect: Effect.Effect<A, never, RuntimeContext>
): Effect.Effect<A, DevEmailStoreError> =>
  eraseRuntimeContext(effect).pipe(
    Effect.catchCause((cause) => Effect.fail(storeError(operation, cause)))
  );

const decodeMessage = (
  row: DevEmailRow
): Effect.Effect<DevEmailMessage, DevEmailStoreError> =>
  Effect.try({
    try: () => JSON.parse(row.message_json) as DevEmailMessage,
    catch: (cause) => storeError("list", cause),
  });

export const makeD1DevEmailStoreLive = (
  database: D1DevEmailDatabase
): Layer.Layer<DevEmailStore> =>
  Layer.succeed(
    DevEmailStore,
    DevEmailStore.of({
      save: (message) =>
        Effect.gen(function* () {
          const messageJson = yield* Effect.try({
            try: () => JSON.stringify(message),
            catch: (cause) => storeError("save", cause),
          });
          yield* storeOperation(
            "save",
            database.batch([
              database
                .prepare(upsertMessage)
                .bind(
                  message.id,
                  message.kind,
                  message.recipient,
                  messageJson,
                  Number(message.createdAt),
                  Number(message.expiresAt)
                ),
              database.prepare(trimMessages),
            ])
          );
        }),
      list: (options: DevEmailListOptions = {}) =>
        Effect.gen(function* () {
          const result = yield* storeOperation(
            "list",
            database.prepare(listMessages).all<DevEmailRow>()
          );
          const messages = yield* Effect.all(result.results.map(decodeMessage));
          const limit = Math.max(0, Math.floor(options.limit ?? 50));

          return messages
            .filter(
              (message) =>
                (options.recipient === undefined ||
                  message.recipient === options.recipient) &&
                (options.kind === undefined || message.kind === options.kind)
            )
            .slice(0, limit);
        }),
      clear: () =>
        storeOperation("clear", database.prepare(clearMessages).run()).pipe(
          Effect.asVoid
        ),
    })
  );
