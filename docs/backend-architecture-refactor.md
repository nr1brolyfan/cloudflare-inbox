# Backend Architecture Refactor

## Status

This document records the completed backend architecture refactor. It preserves the dependency and lifetime decisions that motivated the migration while naming the final modules.

## Dependency Direction

The Backend Worker is the composition root. `src/apps/backend-worker/BackendWorker.ts` acquires Cloudflare resources and supplies boundary-owned Effect services to closed feature graphs:

```text
Cloudflare bindings and deployment config
  -> ControlPlaneDatabaseLayer + ControlPlaneBatchLayer
  -> AccountSecurityLayer + AccountSecurityHttpLayer
  -> AddressRoutingLayer
  -> OrganizationLayer
  -> MailboxAuthorizationLayer
  -> BackendMailboxHttpLayer + BackendHealthLayer
  -> BackendApplicationLayer
  -> BackendWorker
```

The root owns adapter selection. Application and domain modules do not acquire Cloudflare bindings, D1, Durable Object namespaces, R2 buckets, HTTP runtimes, or observability implementations.

Inside each `MailboxDO`, `MailboxDoApplicationLayer` combines the canonical DO identity, synchronous SQLite migration and store graph, outbound provider, alarm handling, and RPC handler. `MailboxDO.ts` owns the Durable Object lifetime and delegates protocol handling to that closed graph.

## Boundaries

- `src/platform/control-plane-d1/ControlPlaneDatabase.ts` owns the D1 binding and Effect Drizzle adapter.
- `src/platform/control-plane-d1/ControlPlaneBatch.ts` owns atomic D1 batches. Rows remain unknown until the consuming context decodes them.
- `src/platform/control-plane-d1/AuthorizationGuardSchema.ts` owns only the technical authorization-guard table.
- Business D1 schemas remain in their owning context. Cross-context SQL uses narrow `integration/` predicates and statement factories.
- `src/modules/mailbox/domain/MailboxResource.ts` owns trusted mailbox resource locations.
- `src/modules/authorization/ports/TrustedMailResourceResolver.ts` owns the capability that resolves canonical resource ancestry.
- `src/platform/observability/BackendHealth.ts` owns transport-neutral health contracts; `src/apps/backend-worker/BackendHealthLayer.ts` selects concrete probes.
- `src/apps/backend-worker/BackendMailboxHttpApi.ts` and `BackendMailboxHttpHandlers.ts` own the private mailbox HTTP contract and handlers.
- `src/modules/account-security/adapters/http/` owns auth HTTP adaptation; final policy and handler composition remain at the Backend root.

## Auth Graph

`src/modules/account-security/layers/AccountSecurityLayer.ts` closes account-security application services over D1, effect-auth, email, passkey, recovery, and session adapters. `AccountSecurityHttpLayer.ts` closes its HTTP handlers and middleware. `BackendApplicationLayer.ts` combines those context layers with the Backend HTTP graph.

The application retains these invariants:

- one validated session supplies request auth, actor, principal, and session capabilities;
- one normalized public origin drives origin checks and HTTP configuration;
- production email delivery is mandatory while local development uses the private D1 development inbox;
- session, step-up, permission, and mutation checks remain inside the same D1 batch as sensitive writes;
- framework-owned effect-auth layer identifiers remain upstream API names and are exempt from the repository's local Layer naming rule.

## Website Graph

The Website Worker keeps framework adaptation separate from Effect services while sharing one process-lifetime `ManagedRuntime`:

```text
Cloudflare environment
  -> WebsitePlatformLayer
  -> MailboxBackendOperationsLayer + DevEmailOperationsLayer
  -> WebsiteApplicationLayer
  -> WebsiteApplication Promise facade
  -> TanStackFunctions.ts
```

`WebsitePlatform.ts` is the Cloudflare boundary. `MailboxBackendOperations.ts` and `DevEmailOperations.ts` own private Backend-binding adaptation. `WebsiteApplication.ts` owns runtime lifetime, and `TanStackFunctions.ts` is the only `createServerFn` adapter.

Mailbox forwarding copies only approved request metadata, performs one service-binding call, schema-decodes every response, sanitizes public errors, and safely encodes resource IDs. Development-email operations fail closed outside local development.

## Permitted Exceptions

- TanStack routes remain under `src/routes/`, with framework-defined filenames and route identities.
- Generated auth schemas remain under `src/auth/schema/`; `src/routeTree.gen.ts` remains generated.
- `RuntimeContext.phantom` is permitted only in concrete Cloudflare/Alchemy adapters and app roots that invoke generated framework APIs.
- Tests that require a real Cloudflare-generated environment continue to cover transport and operation layers with explicit services rather than a partial platform emulator.
