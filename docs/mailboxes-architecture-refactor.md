# Mailboxes Architecture Refactor

## Goal

Reduce the number of directories and short files, especially in `src/mailboxes`, while preserving explicit Effect dependencies and clear boundaries between domain contracts, application services, transports, persistence, and composition roots.

The refactor favors fewer, longer, cohesive modules over one-file-per-schema or one-file-per-error organization.

## Target Layout

```text
src/mailboxes/
  core.ts                 # identifiers, primitives, MailboxRecord, MailAddress
  addresses.ts            # address entity and transport-neutral contracts
  directory.ts            # folders, labels, commands, queries, results
  messages.ts             # messages, threads, attachments, commands and queries
  drafts.ts               # draft entity and contracts
  inbound.ts              # inbound state, transitions and contracts
  outbound.ts             # outbound state, transitions and contracts
  errors.ts               # mailbox domain and integration errors
  repository.ts           # transport-neutral MailboxRepository service
  administration.ts       # transport-neutral MailboxAdministration service

  sqlite-schema.ts        # Drizzle schema
  sqlite-migrations.ts    # synchronous Durable Object migrations
  sqlite-services.ts      # SQLite services and their Live layers
  do-protocol.ts           # Durable Object request/response schemas
  do-client.ts             # Worker-side repository adapter
  do-handler.ts            # Durable Object-side protocol adapter
  mailbox-do.ts            # thin Durable Object composition root

src/control-plane/
  batch.ts                # contract and concrete D1 batch layer
  database.ts             # D1/Drizzle contract, layers, mailbox registry
  mailbox-administration-live.ts

tests/mailboxes/          # mailbox tests mirroring the production domain
tests/control-plane/      # control-plane tests mirroring the production domain
tests/support/            # shared test-only database and Layer setup
```

The final names may be adjusted where required by framework conventions, but the dependency direction must stay unchanged:

```text
domain contracts -> application services -> adapter contracts -> adapters -> roots
```

Domain modules must not import HTTP, Durable Object, SQLite, D1, or Cloudflare runtime modules.

## Effect Services

Loose groups of SQLite functions become internal services:

- `MailboxDirectoryStore`
- `MailboxMessageStore`
- `MailboxDraftStore`
- `MailboxOutboundStore`
- `MailboxResourceIndex`
- `MailboxOperationStore`
- `MailboxRuntime`
- `MailboxIdentity`

Their implementations and named `XLive` layers may share the larger `sqlite-services.ts` module. Database access, time, ID generation, and canonical mailbox identity must be acquired from Effect context rather than passed manually.

`MailboxOperationStoreLive` captures `MailboxDatabase` once and exposes environment-free replay and persistence methods. Directory, draft, and outbound store layers acquire this shared service explicitly; operation-ID behavior is not hidden in standalone database helpers.

The Worker-side Durable Object adapter should depend on focused services such as a mailbox registry and Durable Object namespace instead of a configuration object containing dependency callbacks.

## Consolidation Rules

- Keep checked `Schema.Class` entities and their commands/queries together by feature, not in individual files.
- Keep public contracts transport-neutral.
- Keep HTTP contracts and handlers in `src/http`; HTTP remains an adapter.
- Merge directory and mail-data RPC schemas into one Durable Object protocol.
- Define each RPC operation, mutation/read classification, request schema, response schema, and domain operation mapping in one place.
- Use one domain-error DTO codec on both sides of the Durable Object boundary.
- Move `ControlPlaneBatchError` to the control-plane batch abstraction.
- Move D1/raw-SQL mailbox administration implementation to `src/control-plane`; retain only its contract and service in `src/mailboxes/administration.ts`.
- Keep generated auth schema and TanStack route-tree files unchanged.
- Remove obsolete leaf modules after all imports have migrated. Do not retain compatibility re-exports without a concrete external consumer.

## Website Boundary

TanStack server functions remain framework adapters, but mailbox and development email operations should delegate to Effect services supplied by one Website-side composition boundary. Direct global environment access and repeated `Effect.runPromise(...pipe(Effect.provide(...)))` composition should be localized in that boundary.

## Required Invariants

The refactor must preserve:

- one shared Backend `HttpApi` and one Backend composition root;
- transport-neutral public mailbox contracts;
- canonical Durable Object mailbox identity from `state.id.name`;
- rejection of RPC payloads targeting a different mailbox than the addressed DO;
- synchronous, atomic SQLite migrations before RPC is accepted;
- seven initialized system folders;
- optimistic versions, soft deletion, operation-ID replay, and request-key checks;
- D1 transactional session and permission rechecks during mailbox mutations;
- selective Website-to-Backend header forwarding;
- current public HTTP error sanitization;
- read failures as `not-committed` and ambiguous mutation transport failures as `unknown`;
- Effect interruption behavior across RPC calls;
- existing serialized RPC tags and encoded field names unless changed through a coordinated protocol migration.

## Execution Order

1. Consolidate domain schemas and contracts and migrate all imports.
2. Move control-plane-owned errors and mailbox administration implementation.
3. Introduce SQLite `Context.Service` boundaries and named Live layers.
4. Consolidate the Durable Object protocol, client, handlers, and error codec.
5. Reduce `mailbox-do.ts` to initialization, layer composition, and delegation.
6. Introduce the Website-side service/composition boundary.
7. Remove superseded files and align tests under the mirrored top-level `tests/` domains, with shared test-only helpers in `tests/support/`.
8. Run formatting, generated-file checks, raw-SQL policy, lint, typecheck, tests, and production build.

## Verification

At minimum, the completed refactor must pass:

```sh
bun run format
bun run check
bun run typecheck
bun run test
bun run build
```

Tests must continue covering migrations, directory and mail-data transactions, idempotency, Durable Object response validation, authorization ancestry, administration race protection, HTTP authorization/origin handling, and trusted Website forwarding.
