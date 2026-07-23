# Mailboxes Architecture Refactor

## Status And Goal

This is the historical record of the completed mailbox refactor. The migration reduced a broad mailbox tree into cohesive bounded-context modules while preserving explicit Effect dependencies and the boundaries between domain contracts, application services, ports, adapters, and runtime roots.

The refactor deliberately favored fewer, longer, cohesive modules over one-file-per-schema or one-file-per-error organization.

## Final Layout

```text
src/modules/mailbox/
  domain/                    mailbox entities, value objects and errors
  application/               mailbox use cases
  ports/                     narrow consumer-owned capabilities and protocols
  adapters/durable-object/   DO client, handler, identity and repository adapters
  adapters/sqlite/           per-mailbox schema, migrations and store adapters
  adapters/r2/               immutable raw/blob adapters
  adapters/email/            outbound provider adapters
  adapters/workflow/         Workflow starter adapters
  adapters/react/            mailbox UI adapters
  layers/                    closed mailbox feature graphs

src/modules/organization/    mailbox registry, lifecycle and navigation ownership
src/modules/authorization/   trusted resource ancestry and permission adaptation
src/apps/mailbox-do/         Durable Object lifetime and final application graph
src/apps/backend-worker/     Backend HTTP and control-plane integration
src/platform/control-plane-d1/
                             D1 database and atomic batch capabilities
```

Tests mirror those paths under `tests/modules/`, `tests/apps/`, and `tests/platform/`. The multi-store mail-data suite and split inbound-recorder suite are explicit cross-module exceptions under `tests/integration/mailbox/`. Shared test-only database and Layer setup remains in `tests/support/`.

The enforced dependency direction is:

```text
domain <- application <- adapters <- apps/composition roots
                   ^
                   ports
```

Domain modules do not import HTTP, Durable Object, SQLite, D1, R2, Workflow, Cloudflare, Alchemy, or React adapters.

## Effect Services

Mailbox SQLite capabilities are internal adapter services with standalone technology-named Layers. Application services use class-based `Context.Service`, canonical `make`, and `layerNoDeps`. Consumer-owned ports have no canonical production implementation; app roots select their adapters.

The SQLite graph preserves the existing store seams:

- `MailboxDirectoryStore`
- `MailboxMessageStore`
- `MailboxDraftStore`
- `MailboxOutboundStore`
- `MailboxResourceIndex`
- `MailboxOperationStore`
- `MailboxRuntime`
- `MailboxIdentity`

`MailboxOperationStoreSqliteLayer` captures the database once. Directory, draft, inbound, and outbound stores acquire explicit capabilities, and `MailboxSqliteLayer` closes the final store graph for `MailboxDoStoreSqliteLayer`.

The Worker-side Durable Object adapter depends on focused services such as `MailboxRegistry` and `MailboxDoNamespace`; application code does not receive configuration objects containing dependency callbacks.

## Consolidation Decisions

- Checked entities and their commands, queries, results, and invariants stay together by feature.
- HTTP contracts and handlers are adapters or app-owned composition modules.
- Durable Object request/response schemas remain in `MailboxDoProtocol.ts` as a stable wire contract.
- Each RPC operation retains one mutation/read classification and one domain-operation mapping.
- One domain-error DTO codec is used on both sides of the Durable Object boundary.
- Control-plane errors and D1 batching remain owned by `platform/control-plane-d1` or the business context that performs the mutation.
- Obsolete leaf modules and compatibility re-exports were removed after consumers migrated.

## Website Boundary

TanStack server functions remain framework adapters. Mailbox and development-email operations delegate through the process-lifetime Website application runtime rather than acquiring global environment state or rebuilding Effect graphs per operation.

## Preserved Invariants

The refactor preserved:

- one private Backend `HttpApi` and one Backend HTTP composition root;
- transport-neutral public mailbox contracts;
- canonical Durable Object mailbox identity from `state.id.name`;
- rejection of RPC payloads for a different mailbox;
- synchronous atomic SQLite migrations before RPC acceptance;
- seven initialized system folders;
- optimistic versions, soft deletion, operation-ID replay, and request-key checks;
- transaction-local D1 session and permission rechecks;
- selective Website-to-Backend header forwarding and public-error sanitization;
- read failures as `not-committed` and ambiguous mutation transport failures as `unknown`;
- Effect interruption across RPC calls;
- stable RPC and Workflow tags and encoded fields.

## Historical Execution Shape

The migration proceeded from cohesive domain contracts, through narrow ports and SQLite/DO adapters, to closed feature Layers and thin runtime roots. Source moves were mirrored in tests, superseded files were removed, and the architecture checker became part of `bun run check` before the migration was declared complete.

The final verification gate remains:

```sh
bun run format
bun run check
bun run typecheck
bun run test
bun run build
```
