import * as Cloudflare from "alchemy/Cloudflare";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
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
import { MailDataRpcRequest } from "./mail-data-rpc";
import { MailboxDatabase } from "./mailbox-database";
import { MailboxDatabaseLive } from "./mailbox-database-live";
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
import { executeMailDataRequest } from "./mailbox-mail-data-handler";
import { mailboxSchemaVersion } from "./mailbox-migrations";
import {
  MailboxResourceLookup,
  MailboxResourceLookupResult,
} from "./mailbox-repository";
import {
  initializeMailboxRepository,
  resolveMailboxResource,
} from "./mailbox-repository-sqlite";
import { mailboxSchemaMigration } from "./mailbox-schema";

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
  const database = yield* MailboxDatabase;

  const mailboxName = yield* Effect.sync(() => {
    if (state.id.name === undefined) {
      throw new Error("MailboxDO must be addressed by canonical mailbox name");
    }
    return state.id.name;
  });
  const mailboxId = yield* Schema.decodeUnknownEffect(MailboxId)(
    mailboxName
  ).pipe(Effect.orDie);
  yield* initializeMailboxRepository(mailboxId);
  yield* initializeMailboxDirectory;
  const mailboxServicesLive = Layer.merge(
    Layer.succeed(MailboxDatabase, database),
    Layer.succeed(MailboxDirectoryRuntime, runtime)
  );

  return {
    executeMailData: (input: unknown) =>
      Schema.decodeUnknownEffect(MailDataRpcRequest)(input).pipe(
        Effect.flatMap((request) =>
          executeMailDataRequest(mailboxId, runtime, request)
        ),
        Effect.provide(mailboxServicesLive),
        Effect.orDie
      ),
    executeDirectory: (input: unknown) =>
      Effect.gen(function* () {
        const request =
          yield* Schema.decodeUnknownEffect(DirectoryRpcRequest)(input);
        switch (request._tag) {
          case "ListFolders": {
            const value = yield* listFolders(mailboxId);
            return yield* Schema.encodeEffect(DirectoryRpcResponse)({
              _tag: "FoldersListed",
              value,
            });
          }
          case "CreateFolder": {
            const result = yield* createFolder(mailboxId, request.input);
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
            const result = yield* renameFolder(mailboxId, request.input);
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
            const result = yield* deleteFolder(mailboxId, request.input);
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
            const value = yield* listLabels(mailboxId);
            return yield* Schema.encodeEffect(DirectoryRpcResponse)({
              _tag: "LabelsListed",
              value,
            });
          }
          case "CreateLabel": {
            const result = yield* createLabel(mailboxId, request.input);
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
            const result = yield* renameLabel(mailboxId, request.input);
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
            const result = yield* deleteLabel(mailboxId, request.input);
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
      }).pipe(Effect.provide(mailboxServicesLive), Effect.orDie),
    resolveMailResource: (input: unknown) =>
      Effect.gen(function* () {
        const lookup = yield* Schema.decodeUnknownEffect(MailboxResourceLookup)(
          input
        );
        const result = yield* resolveMailboxResource(lookup);
        return yield* Schema.encodeEffect(MailboxResourceLookupResult)(result);
      }).pipe(Effect.provide(mailboxServicesLive), Effect.orDie),
    sqliteReady: () =>
      Effect.gen(function* () {
        const [row] = yield* database
          .select({
            version: sql<number>`coalesce(max(${mailboxSchemaMigration.version}), 0)`,
          })
          .from(mailboxSchemaMigration);

        if (row?.version !== mailboxSchemaVersion) {
          return yield* Effect.die(
            new Error("MailboxDO SQLite schema is not current")
          );
        }

        return true;
      }).pipe(Effect.orDie),
  };
}).pipe(
  Effect.orDie,
  Effect.provide(MailboxDatabaseLive),
  Effect.provide(MailboxDirectoryRuntimeLive)
);

/** SQLite-backed data-plane object with migrations completed before RPC starts. */
export class MailboxDO extends Cloudflare.DurableObject<MailboxDO>()(
  "MailboxDO",
  Effect.succeed(mailboxDoImplementation)
) {}

export type MailboxDONamespace = Effect.Success<typeof MailboxDO>;
