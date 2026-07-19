import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import {
  DirectoryRpcRequest,
  DirectoryRpcResponse,
  MailboxDomainErrorDto,
} from "./directory-rpc";
import type {
  DirectoryRpcResponse as DirectoryRpcResponseType,
  MailboxDomainErrorDto as MailboxDomainErrorDtoType,
} from "./directory-rpc";
import type { MailboxDomainError } from "./errors/mailbox-domain-error";
import { MailboxId } from "./identifiers";
import {
  MailboxDirectoryRuntime,
  MailboxDirectoryRuntimeLive,
} from "./mailbox-directory-runtime";
import {
  createFolder,
  createLabel,
  deleteFolder,
  deleteLabel,
  initializeMailboxDirectory,
  listFolders,
  listLabels,
  renameFolder,
  renameLabel,
} from "./mailbox-directory-sqlite";
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

const domainErrorDto = (error: MailboxDomainError): MailboxDomainErrorDtoType =>
  Schema.decodeUnknownSync(MailboxDomainErrorDto)({
    _tag: "DomainError",
    operation: error.operation,
    reason: error.reason,
    message: error.message,
    resourceType: error.resourceType,
    resourceId: error.resourceId,
    expectedVersion: error.expectedVersion,
    actualVersion: error.actualVersion,
  });

const mailboxDoImplementation = Effect.gen(function* () {
  const state = yield* Cloudflare.DurableObjectState;
  const runtime = yield* MailboxDirectoryRuntime;

  yield* Effect.sync(() => applyMailboxMigrations(state.raw.storage));
  const mailboxName = yield* Effect.sync(() => {
    if (state.id.name === undefined) {
      throw new Error("MailboxDO must be addressed by canonical mailbox name");
    }
    return state.id.name;
  });
  const mailboxId = yield* Schema.decodeUnknownEffect(MailboxId)(
    mailboxName
  ).pipe(Effect.orDie);
  yield* Effect.sync(() =>
    initializeMailboxRepository(state.raw.storage, mailboxId)
  );
  yield* Effect.sync(() =>
    initializeMailboxDirectory(state.raw.storage, runtime)
  );

  return {
    executeDirectory: (input: unknown) =>
      Effect.gen(function* () {
        const request =
          yield* Schema.decodeUnknownEffect(DirectoryRpcRequest)(input);
        switch (request._tag) {
          case "ListFolders": {
            const value = yield* Effect.sync(() =>
              listFolders(state.storage.sql.raw, mailboxId)
            );
            return yield* Schema.encodeEffect(DirectoryRpcResponse)({
              _tag: "FoldersListed",
              value,
            });
          }
          case "CreateFolder": {
            const result = yield* Effect.sync(() =>
              createFolder(state.raw.storage, mailboxId, request.input, runtime)
            );
            return yield* Schema.encodeEffect(DirectoryRpcResponse)(
              Result.match(result, {
                onFailure: domainErrorDto,
                onSuccess: (value) =>
                  ({
                    _tag: "FolderCreated",
                    value,
                  }) satisfies DirectoryRpcResponseType,
              })
            );
          }
          case "RenameFolder": {
            const result = yield* Effect.sync(() =>
              renameFolder(state.raw.storage, mailboxId, request.input, runtime)
            );
            return yield* Schema.encodeEffect(DirectoryRpcResponse)(
              Result.match(result, {
                onFailure: domainErrorDto,
                onSuccess: (value) =>
                  ({
                    _tag: "FolderRenamed",
                    value,
                  }) satisfies DirectoryRpcResponseType,
              })
            );
          }
          case "DeleteFolder": {
            const result = yield* Effect.sync(() =>
              deleteFolder(state.raw.storage, mailboxId, request.input, runtime)
            );
            return yield* Schema.encodeEffect(DirectoryRpcResponse)(
              Result.match(result, {
                onFailure: domainErrorDto,
                onSuccess: (value) =>
                  ({
                    _tag: "FolderDeleted",
                    value,
                  }) satisfies DirectoryRpcResponseType,
              })
            );
          }
          case "ListLabels": {
            const value = yield* Effect.sync(() =>
              listLabels(state.storage.sql.raw, mailboxId)
            );
            return yield* Schema.encodeEffect(DirectoryRpcResponse)({
              _tag: "LabelsListed",
              value,
            });
          }
          case "CreateLabel": {
            const result = yield* Effect.sync(() =>
              createLabel(state.raw.storage, mailboxId, request.input, runtime)
            );
            return yield* Schema.encodeEffect(DirectoryRpcResponse)(
              Result.match(result, {
                onFailure: domainErrorDto,
                onSuccess: (value) =>
                  ({
                    _tag: "LabelCreated",
                    value,
                  }) satisfies DirectoryRpcResponseType,
              })
            );
          }
          case "RenameLabel": {
            const result = yield* Effect.sync(() =>
              renameLabel(state.raw.storage, mailboxId, request.input, runtime)
            );
            return yield* Schema.encodeEffect(DirectoryRpcResponse)(
              Result.match(result, {
                onFailure: domainErrorDto,
                onSuccess: (value) =>
                  ({
                    _tag: "LabelRenamed",
                    value,
                  }) satisfies DirectoryRpcResponseType,
              })
            );
          }
          case "DeleteLabel": {
            const result = yield* Effect.sync(() =>
              deleteLabel(state.raw.storage, mailboxId, request.input, runtime)
            );
            return yield* Schema.encodeEffect(DirectoryRpcResponse)(
              Result.match(result, {
                onFailure: domainErrorDto,
                onSuccess: (value) =>
                  ({
                    _tag: "LabelDeleted",
                    value,
                  }) satisfies DirectoryRpcResponseType,
              })
            );
          }
          default: {
            const exhaustive: never = request;
            return exhaustive;
          }
        }
      }),
    resolveMailResource: (input: unknown) =>
      Effect.gen(function* () {
        const lookup = yield* Schema.decodeUnknownEffect(MailboxResourceLookup)(
          input
        );
        const result = yield* Effect.sync(() =>
          resolveMailboxResource(state.storage.sql.raw, lookup)
        );
        return yield* Schema.encodeEffect(MailboxResourceLookupResult)(result);
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

        return true;
      }),
  };
}).pipe(Effect.provide(MailboxDirectoryRuntimeLive));

/** SQLite-backed data-plane object with migrations completed before RPC starts. */
export class MailboxDO extends Cloudflare.DurableObject<MailboxDO>()(
  "MailboxDO",
  Effect.succeed(mailboxDoImplementation)
) {}

export type MailboxDONamespace = Effect.Success<typeof MailboxDO>;
