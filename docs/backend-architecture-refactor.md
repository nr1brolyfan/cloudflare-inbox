# Backend Architecture Refactor

## Dependency Direction

The Backend Worker is the composition root. It acquires Cloudflare resources and provides only boundary-owned Effect services:

```text
Worker bindings and deployment config
  -> ControlPlaneD1Binding
     -> ControlPlaneDatabaseLayer
        -> auth storage, MailboxRegistryLive, health control-plane probe
     -> ControlPlaneBatchLayer
         -> D1DevEmailStoreLive, MailboxAdministrationD1Layer
   -> AuthRuntimeConfig (schema-decoded origin and delivery mode)
      -> AuthServicesLive
         -> RequestSessionAuthenticatorLive
            -> CurrentRequestAuthMiddlewareLive
         -> CoreAuthGroupHandlersLive (wired only by the HTTP root)
  -> MailboxDoNamespace + MailboxRegistry
     -> MailboxDoClientLayer
        -> narrow Mailbox*RepositoryDoLayer adapters
        -> MailboxResourceRepositoryDoLayer
           -> MailResourceResolverLive
           -> MailAuthorizationLive
               -> MailboxAdministrationD1Layer (captured by OrganizationLayer)
  -> MailboxAdministrationConfig
      -> MailboxAdministrationD1Layer
  -> BackendHealthBindings
     -> BackendHealthLive
  -> DevEmailConfig
     -> DevEmailGroupLive

BackendHttpApi
  <- auth handlers
  <- health HTTP adapter
  <- mailbox HTTP adapter
  <- development-email HTTP adapter
```

Inside each `MailboxDO`, `MailboxDatabaseLive` feeds `MailboxOperationStoreLive`; directory, draft, and outbound stores acquire that service explicitly, while message and resource-index stores depend directly on the database. The final store graph is then supplied to `MailboxDoHandlerLayer` and the Durable Object implementation.

`MailboxAdministration.rename` retains only request-scoped `CurrentRequestAuth` and `CurrentPrincipal` requirements. Its stable authorization policy, runtime, configuration, and storage dependencies are captured by `MailboxAdministrationD1Layer` through `OrganizationLayer`.

## Boundaries

- `src/platform/control-plane-d1/ControlPlaneDatabase.ts` owns the raw D1 binding and Effect Drizzle adapter. It does not import HTTP modules.
- `src/platform/control-plane-d1/ControlPlaneBatch.ts` owns the atomic D1 batch contract and adapter. Batch rows remain unknown until a use case decodes them with a concrete schema.
- `src/mailboxes/resource-location.ts` is the schema-backed source for branded resource lookup hints and trusted locations. A claimed mailbox ID selects a lookup target but is never authorization evidence; scopes use only ancestry returned by the trusted repository.
- `src/observability/health.ts` contains transport-neutral health schemas and the service contract. `src/observability/backend-health-live.ts` owns concrete probes. HTTP status annotations and the 200/503 response selection remain in `src/http`.
- `src/modules/mailbox/adapters/http/MailboxHttpApi.ts` owns the shared public mailbox error codec used by the Backend API contract and Website response decoder.
- `tests/` mirrors production domains such as `auth`, `authorization`, `control-plane`, `http`, `mailboxes`, and `server`. Shared test-only setup lives in `tests/support/`; for example, `tests/support/mailbox-sqlite.ts` provides scoped, migrated SQLite test Layers whose temporary databases are released with the Layer scope.

## Auth Graph

`src/apps/backend-worker/BackendApplicationLayer.ts` is the only auth HTTP composition root:

```text
AuthRuntimeConfig
  -> AuthServicesLive
     -> auth domain and feature services
     -> RequestSessionAuthenticatorLive
        -> CurrentRequestAuthMiddlewareLive

AuthRuntimeConfig.publicOrigin.origin
  -> one shared origin policy
     -> AuthOriginCheckMiddlewareLive
     -> AuthHttpApiConfigLive

AuthServicesLive + AuthHttpApiConfigLive + BotProtectionNoopLive
  -> CoreAuthGroupHandlersLive
     -> BackendHttpApi

ControlPlaneDatabase + ControlPlaneBatch
  -> EffectAuthStorageLive
  -> D1DevEmailStoreLive
```

The concrete bot-protection no-op is intentionally selected at the Backend root rather than hidden in the auth feature layer. Replacing it therefore changes one explicit adapter decision. The same layer values are reused when providing auth handlers, request authentication, and development email routes so Effect layer memoization prevents duplicate service construction.

`AuthRuntimeConfigSchema` accepts only absolute HTTP(S) URLs and stores a `URL`; consumers use its normalized `.origin`. Its discriminated delivery mode makes an email sender mandatory in production. Development instead leaves `DevEmailStore` visible in `AuthServicesLive`'s requirements, and the Backend root selects `D1DevEmailStoreLive`.

`RequestSessionAuthenticator` owns cookie reading, the single session validation, token binding HMAC, and derivation of `CurrentRequestAuth`, `CurrentSession`, `CurrentActor`, and `CurrentPrincipal`. Middleware only adapts the current HTTP request to that service. Malformed validated tokens and HMAC failures remain typed public internal-auth errors rather than defects.

`src/auth/password-policy.ts` is shared by the server password-risk policy and password-reset readiness. It counts Unicode code points, avoiding the UTF-16 code-unit mismatch between browser and server checks.

`src/auth/storage-live.ts` is the cohesive D1 auth persistence adapter module. Development-email rows are schema-decoded after JSON parsing; corrupt persisted values cannot cross the storage boundary as trusted messages.

## Website Graph

The Website Worker keeps framework adaptation separate from its Effect services while sharing one process-lifetime `ManagedRuntime`:

```text
Cloudflare env + tracing
  -> WebsitePlatformLive
     -> BackendClientLive
     -> WebsiteConfigLive

BackendClient
  -> MailboxBackendOperationsLayer
     -> trusted-header forwarding, response decoding, public error sanitization

BackendClient + WebsiteConfig
  -> DevEmailOperationsLayer
     -> deployment feature gate, list/clear response decoding

WebsitePlatformLayer + mailbox/dev-email operations
  -> WebsiteApplicationLayer
     -> one ManagedRuntime
         -> minimal WebsiteApplication Promise facade
            -> TanStackFunctions.ts
```

`src/apps/website/WebsitePlatform.ts` is the concrete Cloudflare boundary. `MailboxBackendOperations.ts` and `DevEmailOperations.ts` each keep a transport-neutral service contract beside its concrete Backend-binding adapter. `WebsiteApplication.ts` only composes those layers and owns runtime lifetime; request acquisition remains in its TanStack-facing Promise facade.

Mailbox forwarding deliberately copies only `cookie`, `origin`, `referer`, and `user-agent`, performs one binding call, schema-decodes every response, sanitizes public errors, and encodes mailbox IDs as a single path segment. Development-email operations do not contact the Backend when disabled and reject malformed successful responses.

## Intentional Exceptions

- Auth implementation internals and generated auth schemas retain their framework-required structure, while final HTTP policy remains in `src/apps/backend-worker/BackendApplicationLayer.ts`.
- `src/apps/website/TanStackFunctions.ts` is the single `createServerFn` adapter. Actual route modules remain under `src/routes` because TanStack derives route identity from their filenames and unchanged `createFileRoute` literals; large route UIs intentionally remain cohesive rather than being split for file-count symmetry.
- Generated `src/routeTree.gen.ts`, generated auth schemas, and historical migrations remain outside this phase.
- Alchemy's generated Durable Object and Worker adapters require `RuntimeContext.phantom` at their concrete call sites. This framework marker does not enter domain contracts.
- Concrete Website environment acquisition and the full Backend health graph require Cloudflare-generated bindings and Durable Object runtime state. Local tests therefore cover the HTTP health adapter and each Website operation layer with explicit services rather than maintaining a brittle partial Cloudflare emulator.
