# Architecture Migration Guide

## Status And Purpose

This is the normative, compact architecture guide. The source-layout, naming, dependency, and runtime-root migration is complete; these rules now prevent architecture regression. This completion does not mean that the organization, domain, stable-address, or multi-mailbox product plan is implemented. Read it together with `effect-code-style-guide.md`: this document governs architecture and naming, while the style guide governs Effect coding style; `PLAN-FIRMOWEJ-POCZTY.md` governs the remaining product work.

## Target Model

Use **bounded-context-first modules with local hexagonal architecture and explicit runtime roots**:

```text
business ownership: modules/<context>/...
runtime ownership:  apps/<runtime>/...
technical support:  platform/<capability>/...
minimal shared:      shared/...
```

Do not use global `entities/`, `services/`, `interfaces/`, `errors/`, or one application-wide `adapters/` buckets. Do not organize primarily by storage technology or deployment runtime. A dense bounded context may contain `domain/`, `application/`, `ports/`, `adapters/`, and `layers/`; small contexts stay flatter until the extra level improves navigation.

## System Boundaries And Lifetimes

Keep these composition/runtime boundaries distinct:

| Runtime | Lifetime and responsibility |
| --- | --- |
| Website Worker | Process-lifetime `ManagedRuntime`; TanStack/BFF adaptation and private Backend client |
| Backend Worker | Cloudflare bindings, request HTTP graph, auth, request context and request-scoped observability |
| Mailbox Durable Object | One mailbox identity; DO-lifetime SQLite, migrations, stores, RPC handler and alarms |
| Inbound Workflow | Workflow-instance orchestration, retry semantics, MIME/R2/DO adapters |
| Async Rule Workflow | Workflow-instance rule evaluation and persistence |
| AI run | Fresh run-scoped budget/capability layer; never process-global |

Control plane remains D1; mailbox data plane remains per-mailbox DO SQLite; immutable/raw/blob data remains R2. Folder movement must not blur storage authority or resource lifetime.

## Target Source Shape

```text
src/
  modules/
    mailbox/
      domain/         # entities, value objects, invariants, domain errors
      application/    # use cases and application errors
      ports/          # capabilities required by application/domain
      adapters/
        durable-object/
        sqlite/
        r2/
        email/
        http/
      layers/         # closed mailbox feature graphs
    account-security/
    organization/
    address-routing/
    authorization/
    automation/
    ai/
  apps/
    backend-worker/
    mailbox-do/
    website/
    inbound-workflow/
    async-rule-workflow/
  platform/
    control-plane-d1/
    cloudflare/
    observability/
  shared/             # tiny cross-context semantic kernel only
  routes/             # TanStack-owned; keep framework naming/layout
  auth/schema/        # generated/framework-owned until deliberately migrated
  routeTree.gen.ts    # generated
```

These roots are exact. The only framework/generated source exceptions are `src/routes/`, `src/auth/schema/`, `src/router.tsx`, `src/routeTree.gen.ts`, and `src/styles.css`. The required contexts are `account-security`, `address-routing`, `administrative-audit`, `ai`, `authorization`, `automation`, `mailbox`, and `organization`. The required apps are `async-rule-workflow`, `backend-worker`, `inbound-workflow`, `mailbox-do`, and `website`. The required platform capabilities are `cloudflare`, `control-plane-d1`, and `observability`.

Natural context ownership:

| Context | Owns |
| --- | --- |
| `mailbox` | directory, messages, drafts, inbound mailbox state, outbound state, mailbox-local rules and data-plane protocols |
| `account-security` | auth sessions, step-up, passkeys, recovery codes, external recovery identity |
| `organization` | organizations, mailbox registry/lifecycle, memberships/discovery, mailbox administration |
| `address-routing` | stable addresses, inbound route assignment/history, sender identities, quarantine/transfer |
| `authorization` | permission catalog, resource scopes, authorization policies/resolution |
| `automation` | rule administration/evaluation, async jobs and reconciliation |
| `ai` | inference, tool protocol/execution, budgets and AI audit |

Cross-context storage in one D1 database does not make `control-plane` a business context. D1 primitives and the technical authorization-guard table belong in `platform/control-plane-d1`; business table schemas and D1 implementations belong to the context whose behavior they implement. Keep authorization/session predicates inside the same D1 batch as sensitive writes.

## Dependency Rules

Primary direction inside a context:

```text
domain <- application <- adapters <- apps/composition roots
                   ^
                   ports
```

Rules:

- `domain` imports no HTTP, D1, SQLite, R2, Durable Object, Workflow, Alchemy, Cloudflare runtime, React, or concrete adapter.
- `application` imports domain, its required ports, trusted capability contracts, and other explicitly allowed context APIs; never concrete adapters.
- A port is owned by its consumer, not by its implementation technology.
- An adapter implements a port and may import platform APIs; adapters do not reach through another adapter's internals.
- `apps` are composition roots and may select/merge concrete adapters and feature Layers.
- Cross-context imports use explicit public modules/contracts, not persistence schemas or adapter internals.
- Cross-context D1 collaboration uses narrowly named `integration/` predicates and statement factories. These factories return composable Drizzle SQL or `ControlPlaneStatement` values; callers retain one ordered `ControlPlaneBatch` and must not replace transaction-local checks with preflight CRUD calls.
- The trusted mailbox bootstrap composes the organization-owned conditional `legacy_default_v1` insert statement into its existing Backend-owned batch. Organization migration provenance, deterministic migration-owned trigger replacement, creation-time binding, and the fresh-mailbox storage guard remain organization-owned; the app composition root still owns session authorization, statement order, receipt, grant, and audit atomicity.
- Platform request guards accept platform-neutral guarded session facts. Account-security owns adaptation from `CurrentRequestAuth` and binds step-up and remediation policy SQL.
- `shared` contains only truly context-neutral semantics, e.g. generic time/operation primitives. No generic helpers dump.
- Keep the automated architecture and import-boundary checks in `bun run check`.
- Avoid barrels unless they define a deliberate, narrow public API; never add compatibility re-exports without a concrete consumer.

Approved context edges are exact and acyclic: `account-security -> address-routing`, `account-security -> administrative-audit`, `account-security -> organization`, `address-routing -> mailbox`, `address-routing -> organization`, `administrative-audit -> mailbox`, `ai -> mailbox`, `authorization -> mailbox`, `automation -> mailbox`, and `organization -> mailbox`. The account-security to organization edge exists only so recovery-safe identity policy can consume the canonical bootstrap config and bounded managed-domain D1 claim statements instead of reaching into organization persistence. Cross-context imports target `contracts/`, `domain/`, `integration/`, or `ports/`, except for the explicitly approved AI tool calls into `MailboxDraftEditing` and `MailboxMessageReading`.

Approved cross-app edges are also exact and acyclic: `backend-worker -> inbound-workflow`, `backend-worker -> mailbox-do`, `inbound-workflow -> async-rule-workflow`, `inbound-workflow -> mailbox-do`, and `website -> backend-worker`. Platform can depend only on platform/shared code; shared can depend only on shared or external context-neutral libraries; modules never import apps.

## Hexagonal Vocabulary

| Role | Examples |
| --- | --- |
| Inbound port/use case | `MailboxMessageReading`, `MailboxDraftEditing` |
| Driving adapter | HTTP handler, TanStack function, Workflow program, DO RPC handler |
| Outbound port | message repository, blob storage, email provider, workflow starter |
| Driven adapter | DO client, SQLite store, R2 implementation, Cloudflare Email implementation |
| Composition root | Backend Worker, Website runtime, MailboxDO, Workflow runtime |

Low-level clients used only to adapt a platform API, e.g. an R2 binding wrapper, may remain private to that adapter. Do not expose technology-named clients as application ports.

## Naming

Use **PascalCase for first-class TypeScript/TSX modules and symbols**, mirroring Effect (`Effect.ts`, `Layer.ts`, `SqlClient.ts`). Use lowercase/kebab-case for architectural/category directories, mirroring Effect's `internal/`, `unstable/`, and `sql/`.

| Item | Convention | Example |
| --- | --- | --- |
| Context/category directory | lowercase/kebab-case | `account-security/`, `durable-object/` |
| First-class TS module | PascalCase | `MailboxMessageReading.ts` |
| React component module | PascalCase | `DraftEditor.tsx` |
| Class/service/schema/error/type | PascalCase | `MailboxMessageReadingError` |
| Function/local/value | camelCase | `readMailboxMessage` |
| Static service Layers | exact lowercase names | `layerNoDeps`, `layer`, `mockLayer` |
| Standalone adapter Layer | descriptive PascalCase + `Layer` | `MailboxRepositoryDoLayer` |
| Feature/root Layer | descriptive PascalCase + `Layer` | `MailboxHttpLayer`, `BackendApplicationLayer` |
| Context service identifier | stable namespace + PascalCase | `cloudflare-inbox/MailboxMessageReading` |

Local Layer exports use descriptive PascalCase names ending in `Layer`; static service Layers use only `layerNoDeps`, `layer`, or `mockLayer`. Upstream effect-auth identifiers retain their package-defined names and are exempt from this local naming rule. The completed migration used this mapping:

```text
canonical service construction -> Service.layerNoDeps / Service.layer
test implementation            -> Service.mockLayer
concrete adapter               -> <Service><Technology>Layer
HTTP handlers                  -> <Feature>HttpHandlersLayer
closed feature graph           -> <Feature>Layer or <Feature>HttpLayer
final runtime graph            -> <Runtime>ApplicationLayer
```

Framework/generated exceptions retain their required names: TanStack routes, `routeTree.gen.ts`, generated auth schema, migrations, scripts, and tool configuration. Tests under `tests/modules/`, `tests/apps/`, `tests/platform/`, and `tests/shared/` mirror source paths and names. Cross-module suites are permitted only in the explicit checker allowlist under `tests/integration/`; route, script, and support tests retain their own framework/tooling layout.

## Effect Services And Layers

Follow `effect-code-style-guide.md`:

- Import Effect modules as namespaces: `import * as Effect from "effect/Effect"`, etc.; keep type-only imports type-only.
- Application services use class-based `Context.Service` with `make`; expose `static layerNoDeps`; optionally expose `layer` only when one canonical dependency graph exists and `mockLayer` when broadly useful.
- `make` captures stable construction dependencies. Request/run capabilities remain visible in each method's Effect environment.
- Ports use class-based `Context.Service` without a canonical production `make`/`layer` when runtime must choose the adapter.
- `layerNoDeps` never locally provides dependencies; tests must be able to replace every dependency of `make`.
- Concrete adapter and top-level Layers are standalone PascalCase values ending in `Layer`.
- Use `Layer.scoped` and `Effect.acquireRelease` for owned resources.
- Build closed feature graphs before final roots. A root merges feature Layers; it does not wire every leaf service.
- Use `Effect.fn` for meaningful operations/boundaries, not trivial helpers.
- Install logging/exporters at program boundaries. Preserve one wide completion event and current privacy/redaction rules.
- Never promote request-, run-, Workflow-, or DO-scoped state into a longer-lived convenience Layer.
- `RuntimeContext.phantom` appears only at concrete adapter or app call sites that invoke generated Alchemy/Cloudflare APIs.

Representative shape:

```ts
// application/MailboxMessageReading.ts
export class MailboxMessageReading extends Context.Service<
  MailboxMessageReading,
  MailboxMessageReadingShape
>()("cloudflare-inbox/MailboxMessageReading", {
  make: Effect.gen(function* () {
    const messages = yield* MailboxMessageRepository;
    return MailboxMessageReading.of({/* use cases */});
  }),
}) {
  static readonly layerNoDeps = Layer.effect(this, this.make);
  static readonly mockLayer = Layer.mock(this, {/* common defaults */});
}

// ports/MailboxMessageRepository.ts
export class MailboxMessageRepository extends Context.Service<
  MailboxMessageRepository,
  MailboxMessageRepositoryShape
>()("cloudflare-inbox/MailboxMessageRepository") {}

// adapters/durable-object/MailboxMessageRepositoryDo.ts
export const MailboxMessageRepositoryDoLayer = Layer.effect(
  MailboxMessageRepository
  /* adapter construction */
);
```

## Models, Contracts, And Errors

- Validate and brand primitives once at the owning contract.
- Use `Schema.Class` for identity-bearing entities/results; use `Schema.Struct` for commands, queries, payloads and DTOs without identity.
- Keep cross-field invariants in checked schemas. Decode `unknown` at every external/storage boundary.
- Keep cohesive models, commands, results, invariants, errors and service construction together when they form one topic. Do not split for file-count symmetry.
- Domain errors live with domain rules; application errors with the use case; port/infrastructure errors with the port or adapter; public HTTP errors in the HTTP adapter; serialized DO errors in the DO codec.
- In-process errors generally use `Data.TaggedError`; protocol-encoded errors use schema-backed types/DTOs. Never serialize raw causes.
- HTTP contracts may derive fields from application schemas; do not duplicate equivalent schemas merely to satisfy folder boundaries.
- DO and Workflow wire schemas are durable contracts. Moving them must not change tags, fields, encoding, or retry meaning.
- Defects are reserved for violated trusted invariants or runtime-specific retry signaling, not ordinary malformed input/storage failure.

## File Cohesion

File length alone is not a split criterion. Prefer fewer, longer, self-contained modules with one reason to change.

Acceptable long modules: one domain topic, one use case including projections/error/service/make, one wire protocol, one transport client, or one cohesive page controller. Split modules that combine independent stores/features/lifetimes. Keep mailbox SQLite persistence split by its store seams and preserve narrow consumer capabilities, while allowing one DO adapter/transport to implement several narrow ports.

Avoid one-file-per-schema/error/interface. Also avoid generic names such as `Core.ts`, `Utils.ts`, `Services.ts`, `Interfaces.ts`, or `Errors.ts` when a precise PascalCase topic name exists.

## Non-Negotiable Invariants

Preserve throughout moves and refactors:

- one private Backend `HttpApi` and one final Backend HTTP graph;
- Website selective header forwarding, response decoding, public-error sanitization, binary/MIME/size checks and no-store behavior;
- canonical MailboxDO identity from `state.id.name` and rejection of mismatched mailbox payloads;
- synchronous atomic DO SQLite migrations before RPC acceptance;
- seven system folders, optimistic versions, soft deletion, operation-ID replay/request-key checks and existing transactional semantics;
- control-plane token-bound session/permission predicates in the same D1 batch as sensitive mutations;
- trusted resource ancestry from canonical storage, never caller hints as authorization evidence;
- retained control-plane migration ancestry is not user assignment or authority: before ORG-010, only `app_mailbox_legacy_organization_assignment` may carry the `primary` mailbox's organization backfill provenance, and `app_mailbox` must remain without `organization_id`;
- retained ORG-008 owner provenance is `app_organization_owner_assignment_receipt`: its grant-nominated user, fixed membership, organization grant, optional exact mailbox-bootstrap history, and legacy grant tuple are immutable, while later legal membership/grant lifecycle remains forward-only;
- retained ORG-009 domain provenance is `app_mail_domain_claim_receipt`: fixed claim, organization, mailbox, exact primary address epoch and snapshots, canonicalization profile, source, and optional exact compatible bootstrap history are immutable. The reserved claim remains pending/version 1 and lifecycle-frozen until ORG-016; route continuity is not DNS verification or readiness;
- organization membership alone is not permission, and an organization-scoped grant does not authorize mailbox content; ACL-003 must gate organization-sensitive access by active membership in addition to exact permission and canonical resource ancestry;
- current control-plane/data-plane/R2 authority boundaries;
- request capability visibility for principal/session/actor, request context, operation provenance and AI tool scope;
- Workflow retry behavior and typed-error-to-retry-defect conversion;
- stable serialized RPC/Workflow tags and fields unless changed by an explicit coordinated protocol migration;
- `RuntimeContext.phantom` only at concrete Alchemy/Cloudflare adapter call sites;
- generated/framework-owned files and historical migrations untouched unless explicitly scoped;
- telemetry privacy: no credentials, secrets, tokens, message content, raw paths/headers/bodies, or unbounded user data.

## Migration Record

The migration used vertical compiling slices, established naming and import rules first, and used mailbox as the reference implementation. Moves preserved serialized behavior, transaction-local authorization, resource lifetimes, and atomicity. Each feature graph was closed before runtime roots were simplified; source moves were mirrored in tests; obsolete implementations and compatibility re-exports were removed after consumers migrated.

The broad historical order was:

```text
naming/import rules
-> target shells (modules/apps/platform/shared)
-> mailbox domain/application
-> narrow ports
-> DO/SQLite/R2/email adapters
-> mailbox feature Layers and runtime roots
-> account-security/organization/address-routing/authorization/AI
-> boundary enforcement and cleanup
```

## Verification Gate

Every architecture change must format, typecheck, and run focused tests. The complete verification gate is:

```sh
bun run format
bun run check
bun run typecheck
bun run test
bun run build
```

Also verify import-boundary rules, generated-file checks, raw-SQL policy, stable HTTP/DO/Workflow contracts, migrations, idempotency, authorization ancestry, D1 race protection, Workflow retries, Website forwarding, and resource cleanup/lifetimes.

For additive control-plane cutovers, distinguish first application from reapplication before creating mutable state. Validate exact columns, checks, foreign keys, indexes, owned triggers, sentinels, rows, and bounded parent inventories; drop and recreate only migration-owned triggers in the surrounding migration transaction. Reapplication may validate a retained bridge but must never reconstruct missing or changed provenance from current counts, constants, ordering, users, grants, memberships, domains, or navigation. A temporary rolling trigger must be replaced atomically by the migration that introduces its canonical successor.

Generic administrative audit taxonomies must not be reused for a semantically different migration. ORG-008 therefore uses its immutable assignment receipt as the authority ledger and links fresh materialization to the real mailbox bootstrap audit; typed organization audit actions remain future work.

Stock D1 must never infer canonical Punycode. A migration may install structural fences and record an awaiting-reconciliation state, but canonical A-label reconciliation belongs in a required TypeScript initialization Effect using the pinned profile and one atomic conditional D1 batch. ORG-009 is intentionally single-domain; ORG-012 must replace its fresh staging/trigger protocol atomically and retain its cutover, canonical intent, and receipt.
