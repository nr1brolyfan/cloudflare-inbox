# Effect Code Style Guide

## Status And Scope

This is the normative Effect guide for `cloudflare-inbox`. It targets Effect `4.0.0-beta.102` and must be read together with `docs/architecture-migration-guide.md`:

- the architecture guide owns source layout, dependency direction, bounded contexts, runtime ownership, and first-class module naming;
- this guide owns Effect programs, schemas, services, Layers, errors, resources, runtimes, testing, and observability;
- durable HTTP, Durable Object, Workflow, storage, and telemetry contracts may change only through an explicit protocol migration.

This guide is the target-state standard until the coordinated `beta.102` upgrade is complete. Do not enforce beta.102-only rules against the current beta.98 build. The activation gate is one successful repository-wide upgrade of Effect, all `@effect/*` packages, and local packages with exact Effect peer dependencies, including `@effect-auth/core`.

Examples and APIs in this guide must compile against the Effect version declared above. The repository's complete Effect package family must be pinned to that same version before implementation work follows this guide. APIs under `effect/unstable/*` require an upgrade review even when the package version changes only within Effect v4 beta.

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative. A `SHOULD` may be overridden only when the local reason is clearer than following the default. Document non-obvious exceptions next to the code.

## Core Principles

1. Keep external uncertainty at explicit boundaries. Decode unknown data, translate foreign failures, and establish resource ownership there.
2. Keep validated values and typed failures intact inside the application. Do not repeatedly parse, cast, stringify, or erase error information.
3. Keep dependencies visible. Construction dependencies belong in Layer requirements; request-, run-, Workflow-, DO-, and AI-scoped capabilities remain in method environments until their actual owner provides them.
4. Build small feature graphs and close them at the runtime that owns their implementation and lifetime.
5. Make production behavior diagnosable from bounded structured events, traces, and metrics without exposing private data.
6. Prefer the smallest cohesive program. Use Effect abstractions to express real failure, concurrency, resource, or dependency semantics, not ceremony.

## Imports

Effect modules MUST use namespace imports from focused Effect subpaths. This is a project readability convention, not an Effect API requirement.

```ts
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import type { MailboxId } from "./Mailbox";
```

- Keep type-only imports type-only.
- Import unstable modules from their exact subpath.
- Do not introduce a local barrel only to shorten Effect imports.
- Follow framework-required import forms in generated or framework-owned files.

## Effect-Returning Functions

Reusable functions that construct Effects SHOULD use `Effect.fn`. It preserves a useful stack boundary and avoids wrapping a fresh `Effect.gen` manually on every call.

```ts
export const loadMailbox = Effect.fn("MailboxReading.loadMailbox")(function* (
  mailboxId: MailboxId
) {
  const repository = yield* MailboxRepository;
  return yield* repository.get(mailboxId);
});
```

- Use named `Effect.fn("Stable.operation.name")` for meaningful application, adapter, transport, Workflow-step, and background-job operations.
- A named `Effect.fn` creates a span. Do not name every scalar helper or add a span around a single trivial combinator.
- Use stable low-cardinality names. IDs and user-controlled values belong in span attributes, never in span names.
- Use `Effect.gen` for readable local orchestration. Prefer `pipe` for short transformations and error handling.
- When yielding a failure or defect as terminal control flow, use `return yield*` so TypeScript narrows the remaining branch correctly.
- Do not start a runtime inside a reusable function. Return an Effect.

## Schemas And Trust Boundaries

### Boundary Rule

Every independent trust boundary MUST validate incoming data. A value decoded in one process is not permanently trusted after storage or transport.

Trust boundaries include:

- HTTP path, query, header, cookie, and body input;
- HTTP and SDK responses from another service;
- Durable Object RPC payloads and results;
- Workflow inputs, step values, persisted state, and results;
- queue, event, cache, and R2 metadata payloads;
- D1 and SQLite selected rows, including JSON columns;
- environment and deployment configuration;
- data returned by untyped or throwing third-party libraries.

Compile reusable decoders and encoders once at module scope:

```ts
export const MailboxSnapshotV1 = Schema.Struct({
  mailboxId: MailboxId,
  messageCount: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  schemaVersion: Schema.Literal(1),
});
export type MailboxSnapshotV1 = typeof MailboxSnapshotV1.Type;
export type MailboxSnapshotV1Encoded = typeof MailboxSnapshotV1.Encoded;

export const decodeMailboxSnapshot =
  Schema.decodeUnknownEffect(MailboxSnapshotV1);
export const encodeMailboxSnapshot = Schema.encodeEffect(MailboxSnapshotV1);
```

- Use `Schema.decodeUnknownEffect` when input is `unknown`.
- Use `Schema.decodeEffect` when the input already has the schema's `Encoded` type.
- Use `Schema.encodeEffect` for a value with the schema's `Type`.
- Use `Schema.encodeUnknownEffect` only when the value to encode is itself untrusted.
- Prefer effectful codecs in Effect-native code so `SchemaError` stays in the typed failure channel.
- A synchronous decoder MAY be used for trusted internal construction or a deliberately synchronous framework boundary that catches and translates `SchemaError`. It MUST NOT turn malformed storage or wire data into an accidental defect.
- Map `SchemaError` to the error owned by the boundary when schema internals are not part of the public contract.
- Do not replace schema validation with casts, scalar coercion helpers, `Effect.try`, or unchecked object spreading.

### Modeling Choices

`Schema.Struct` is the default for plain immutable data. Use `Schema.Class` when validated construction, methods, inheritance, class identity, or a class-based API materially improves the model.

```ts
export const RenameMailbox = Schema.Struct({
  mailboxId: MailboxId,
  name: MailboxName,
});
export type RenameMailbox = typeof RenameMailbox.Type;

export class Mailbox extends Schema.Class<Mailbox>(
  "cloudflare-inbox/organization/Mailbox"
)({
  id: MailboxId,
  name: MailboxName,
  version: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1))),
}) {}
```

- Use the same symbol name in the value and type namespaces where practical.
- Give classes and Context services globally stable package/path-qualified identifiers.
- Put field and cross-field invariants in the canonical schema.
- `Schema.brand` provides nominal typing but no runtime validation by itself. Add checks before branding and brand only when structural interchangeability is unsafe.
- Do not use `disableChecks` during normal construction.
- Version persisted and wire contracts explicitly when they must survive independent deployments or resumptions.

### Domain, Wire, And Persistence Data

Do not force one representation to serve incompatible concerns. A feature MAY have:

1. a canonical domain or application model;
2. a versioned wire schema;
3. a dialect-local selected-row schema;
4. an explicit encoder or transformation between them.

Storage adapters MUST:

- map validated values to driver input;
- execute the operation through the approved database capability;
- decode every selected row and structured JSON value;
- translate driver and decode failures into the adapter or port error;
- preserve corruption as distinguishable information when it changes recovery;
- avoid reimplementing domain policy.

Raw `JSON.parse` and `JSON.stringify` MUST NOT be used for persisted or wire values unless a bounded owner validates the parsed value and controls the encoded shape. Prefer a shared schema codec for canonical JSON.

## Services

### Service Definition

Class-based `Context.Service` is the default for application services and ports. The identifier is runtime identity and MUST be globally unique.

```ts
export interface MailboxAdministrationShape {
  readonly rename: (
    command: RenameMailbox
  ) => Effect.Effect<Mailbox, MailboxAdministrationError, CurrentRequestAuth>;
}

export class MailboxAdministration extends Context.Service<
  MailboxAdministration,
  MailboxAdministrationShape
>()("cloudflare-inbox/organization/MailboxAdministration", {
  make: Effect.gen(function* () {
    const repository = yield* MailboxAdministrationRepository;

    const rename = Effect.fn("MailboxAdministration.rename")(function* (
      command: RenameMailbox
    ) {
      const auth = yield* CurrentRequestAuth;
      return yield* repository.rename(command, auth);
    });

    return MailboxAdministration.of({ rename });
  }),
}) {
  static readonly layerNoDeps = Layer.effect(this, this.make);
}
```

- `make` captures stable construction dependencies.
- Per-call capabilities remain visible in the method's `R` type.
- Use `Service.of` when it improves implementation shape checking. It has no required runtime construction semantics.
- A plain `Context.Service<ServiceShape>(identifier)` value MAY represent a simple immutable value capability or configuration when a class adds no useful API. Do not use this exception inconsistently for application ports.
- Ports do not select their production adapter and normally expose no production `make` or `layer`.
- Keep cohesive service shape, errors, projections, construction, and methods together when they have one reason to change.

### Constructor And Layer Naming

| Role | Convention | Example |
| --- | --- | --- |
| Pure or effectful service constructor | `make` or precise `makeX` | `MailboxAdministration.make` |
| Service Layer without bundled dependencies | static `layerNoDeps` | `MailboxAdministration.layerNoDeps` |
| Canonical closed service Layer | static `layer` | `MailboxAdministration.layer` |
| Broadly reusable partial test implementation | static `mockLayer` | `MailboxAdministration.mockLayer` |
| Concrete adapter Layer | PascalCase ending in `Layer` | `MailboxRepositoryDoLayer` |
| Closed feature Layer | PascalCase ending in `Layer` | `MailboxHttpLayer` |
| Runtime graph | PascalCase ending in `ApplicationLayer` | `BackendApplicationLayer` |
| Parameterized Layer factory | camelCase ending in `Layer` | `backendObservabilityLayer(options)` |

- A function named `make` MAY return a pure value or an Effect, following Effect ecosystem conventions. Its type must make effectfulness visible.
- A project-owned `make*` function MUST NOT return a Layer. Name Layer values and factories with a `Layer` suffix.
- `layerNoDeps` MUST NOT provide dependencies captured by `make`.
- Export static `layer` only when the module owns one safe canonical dependency graph. Otherwise leave the choice to a feature or runtime composition root.
- Add `mockLayer` only when one partial default is useful across many tests. Missing `Layer.mock` methods die when invoked, so complete fakes are safer for behavior-heavy tests.

## Layer Construction And Composition

Use the constructor that expresses the actual acquisition:

- `Layer.succeed` for an existing, infallible service value;
- `Layer.effect` for effectful construction, dependencies, mutable state, or scoped acquisition;
- `Layer.effectDiscard` for scoped startup or background work that exports no service;
- `Layer.unwrap` when an Effect selects or constructs an entire Layer;
- `Layer.launch` at a long-running program boundary that should stay alive until interrupted.

### Composition Semantics

```ts
const MailboxReadingDoLayer = MailboxReading.layerNoDeps.pipe(
  Layer.provide(MailboxRepositoryDoLayer)
);

export const MailboxFeatureLayer = Layer.mergeAll(
  MailboxReadingDoLayer,
  MailboxDraftEditingDoLayer
);
```

- `Layer.provide(provider)` supplies requirements and hides the provider's outputs. It is the default for private implementation dependencies.
- `Layer.provideMerge(provider)` supplies requirements and retains provider outputs. Use it only when downstream code intentionally consumes both.
- `Layer.merge` and `Layer.mergeAll` combine sibling outputs. They do not wire one sibling's output into another sibling's requirements.
- An array supplied to `Layer.provide` is a parallel set of providers, not an ordered dependency pipeline.
- A Layer with `R = never` is closed with respect to requirements; it may still fail during construction.
- Do not merge overlapping service tags unless replacement or precedence is intentional, documented, and tested.

### Identity And Sharing

Layer memoization is based on Layer object identity.

```ts
const DatabaseLayer = controlPlaneDatabaseLayer(options);

const FeatureLayer = Layer.merge(
  FeatureA.layerNoDeps.pipe(Layer.provide(DatabaseLayer)),
  FeatureB.layerNoDeps.pipe(Layer.provide(DatabaseLayer))
);
```

Reuse the exact same Layer value when one resource instance is intended. Calling `controlPlaneDatabaseLayer(options)` twice creates two graph nodes. Use `Layer.fresh` only when independent acquisition is deliberate.

### Composition Roots

- Close coherent feature graphs before final runtime roots.
- Runtime roots select databases, platform clients, exporters, configuration, and lifetime-specific implementations.
- A root SHOULD merge ready feature graphs rather than wire every leaf.
- Provide observability to the application graph when acquisition and background work must be observed. Do not assume a merged sibling satisfies another sibling's requirements.
- Never hide a request-, run-, Workflow-, DO-, or AI-scoped capability inside a process-lifetime convenience Layer.

## Resources, Scopes, And Concurrency

Owned resources MUST have one explicit lifetime owner.

```ts
const ConnectionLayer = Layer.effect(
  Connection,
  Effect.acquireRelease(openConnection, (connection) => connection.close)
);
```

In Effect v4, `Layer.effect` owns the scope required by `acquireRelease`; an extra `Effect.scoped` inside the Layer constructor is not required.

- Use `Effect.acquireRelease` for a reusable scoped resource.
- Use `Effect.acquireUseRelease` for one acquire/use/release operation.
- Use `Effect.scoped` when running a scoped Effect outside a Layer.
- Finalizers MUST be infallible in their typed error channel and MUST release on success, failure, defect, and interruption.
- Use `Effect.forkScoped` for background fibers owned by a request, Layer, or operation scope. Do not leak fibers through unscoped forks.
- Interruption is not a domain failure. Preserve it unless a runtime boundary has a documented translation requirement.
- Cloudflare `waitUntil`, Workflow steps, DO activation, request scopes, and process `ManagedRuntime` are different lifetimes and MUST NOT be conflated.
- Every `ManagedRuntime` MUST have an explicit owner and disposal strategy. Process-lifetime runtimes may dispose during platform shutdown rather than after each request.

## Configuration And Secrets

- Model deployment configuration with `Config` and `Config.schema` where grouped validation is useful.
- Use `Config.redacted` for credentials and reveal a secret only at the foreign API call that requires it.
- `Config.withDefault` is appropriate for missing optional configuration. It MUST NOT silently replace present but malformed production configuration.
- Translate configuration failures only at the runtime startup boundary that can report or act on them.
- Never add credentials, tokens, raw bindings, or secret values to logs, span attributes, errors, or metrics.

## Errors And Control Flow

### Failure Categories

| Category | Meaning | Handling |
| --- | --- | --- |
| Typed failure | Expected domain, validation, transport, or storage outcome | Handle by tag/reason or translate at a boundary |
| Defect | Broken invariant, programmer error, or explicitly documented runtime signal | Report; do not routinely recover |
| Interruption | Cooperative cancellation or scope shutdown | Preserve and release resources |

- Use `Data.TaggedError` for internal typed failures that are never encoded.
- Use `Schema.TaggedErrorClass` for errors that cross a protocol boundary or require schema-based encoding.
- Do not serialize raw `cause`, stack, exception message, or third-party error. Expose a bounded reason and retain the cause only for internal diagnostics.
- Catch the narrowest tags or reasons the caller can meaningfully handle.
- Translate errors when crossing ownership boundaries, not in every layer.
- `mapError` MUST preserve the distinctions required for retry, status mapping, compensation, and diagnosis.
- Use `Effect.try` and `Effect.tryPromise` at synchronous throwing and Promise rejection boundaries. They are not schema validators.
- Use `orDie` only for a documented unrecoverable condition or runtime-specific retry signaling. Malformed external or persisted data is normally typed.
- When inspecting full `Cause`, preserve interruption and unrelated defects.

### HTTP And External Clients

- Decide explicitly whether non-success HTTP status codes are accepted. `HttpClient.execute` does not make every non-2xx response a typed failure; apply the appropriate status filter when success-only behavior is intended.
- Decode response bodies with a Schema before they enter application code.
- Map transport, status, and decode failures separately when callers need different retry or response behavior.
- Sanitize all errors before returning them over a public boundary.

### Retry

A retry policy MUST state:

- which typed failures are transient;
- whether the operation is idempotent or uses an idempotency key;
- exponential or otherwise justified delay;
- jitter for shared remote dependencies;
- a hard attempt or elapsed-time limit;
- what final failure is returned;
- which bounded metric and terminal event expose exhaustion.

`Effect.retry` retries typed failures, not defects or interruption. Workflow engine retry, Durable Object alarms, and persisted delivery retry are runtime protocols; do not replace them with an in-memory generic retry schedule.

## Runtime Boundaries

Calls to `Effect.run*`, `ManagedRuntime.run*`, or platform `runMain` belong only at framework and application boundaries.

- Use one shared `ManagedRuntime` for repeated callbacks that share the same process-lifetime graph.
- Use `runPromiseExit` when a foreign framework boundary needs structured success/failure rather than Promise rejection.
- `runSync` may throw for failure, defect, interruption, or asynchronous work; use it only when synchronous execution is an actual boundary requirement.
- Runtime adapters translate Effect exits into Cloudflare, TanStack, Workflow, Durable Object, or test-framework results.
- Do not expose an Effect runtime or Context as a service locator to domain code.

## Observability

Observability is part of operation design, not error-printing added afterward. The target system includes structured logs, distributed traces, and bounded metrics. Exporters and filtering are configured once by the owning runtime.

### Privacy And Cardinality

Telemetry MUST NOT contain credentials, secrets, auth/session tokens, message content, raw bodies, raw headers, email bodies, attachment content, unrestricted paths, arbitrary error messages, or unbounded user input.

| Signal | High-cardinality IDs | Unbounded values |
| --- | --- | --- |
| Logs | Allowed when required for correlation and privacy-approved | Forbidden |
| Traces | Allowed as attributes when required for diagnosis | Forbidden |
| Metric attributes | Forbidden | Forbidden |

Use normalized routes, closed operation names, stable error tags, bounded outcomes, deployment identity, and bounded resource kinds.

### Wide Completion Events

Each externally initiated operation or service hop SHOULD emit one schema-versioned completion event from its owner. The event SHOULD contain the diagnostic context available at completion, including:

- stable event and operation names;
- outcome: `succeeded`, `rejected`, or `failed`;
- duration;
- normalized route or job type;
- stable typed error tag or bounded failure reason when failed;
- request, correlation, trace, Workflow, or operation IDs where approved;
- service name, version, environment, and region/colo where available;
- bounded business impact such as item count or resource kind.

Expected rejection is not an operational error. Failed terminal operations SHOULD log at Error, handled degradation at Warning, and expected completion at Info. Do not log the same failure in every layer; intermediate layers should add context to the Effect, span, or typed error and let the terminal owner emit the completion event.

Additional logs are justified for lifecycle transitions, security-relevant events, handled degradation, retry exhaustion, and explicitly enabled debug or trace diagnostics.

### Tracing

- Create server or consumer root spans at ingress boundaries.
- Use named `Effect.fn` or `Effect.withSpan` for meaningful child operations.
- Put IDs and bounded context in attributes, never in span names.
- Propagate incoming trace context and inject outgoing context through the actual transport integration. A local root span alone is not propagation.
- Record outcome and stable error type on terminal spans.
- Do not create a span for each scalar helper, row, or log statement.
- Verify propagation across Backend, Website, Workflow, and Durable Object boundaries where the platform supports it.

### Metrics

Use metrics to answer traffic, errors, latency, and saturation questions:

- counter or frequency for completed outcomes and durable events;
- timer or histogram for latency and payload-size distributions;
- gauge for current queue depth, concurrency, or resource saturation.

Metric attributes MUST be finite and bounded. Request IDs, user IDs, mailbox IDs, correlation IDs, raw URLs, error messages, and arbitrary provider strings MUST NOT be metric attributes.

Use `Effect.track`, `Effect.trackDuration`, and the specialized tracking operators when they accurately represent the Effect's exit semantics. Remember that typed failures and defects are different metric dimensions. Update gauges with current absolute state rather than treating them as counters.

At minimum, runtime boundaries SHOULD expose:

- operation outcome count;
- operation duration;
- retry and retry-exhaustion count;
- queue depth or active work where saturation exists;
- exporter health and dropped telemetry where supported.

### Exporters And Sampling

- Logger, tracer, and metric exporter Layers are owned by runtime composition.
- Scoped exporters MUST flush within the platform lifetime available to their owner.
- Decide whether a logger Layer replaces or merges with the existing logger; avoid accidental duplicate output.
- Configure minimum log levels centrally.
- Exporter failure MUST NOT replace the business operation's error, but it MUST have its own bounded health signal.
- Head sampling cannot guarantee that a later error is retained. Claims such as "all errors are sampled" require an implemented and verified strategy, such as tail sampling or a separate reliable error signal.

## Testing

New Effect-heavy tests SHOULD use `@effect/vitest`.

```ts
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

it.effect("renames a mailbox", () =>
  Effect.gen(function* () {
    const service = yield* MailboxAdministration;
    const mailbox = yield* service.rename(command);
    assert.strictEqual(mailbox.name, command.name);
  }).pipe(Effect.provide(MailboxAdministrationTestLayer))
);
```

- Use `it.effect` for deterministic Effect tests with test services.
- Use `it.live` only when live clock, console, or runtime behavior is intended.
- Use `TestClock` rather than sleeping in retry, timeout, and scheduling tests.
- Use property tests for schemas, canonicalization, codecs, and bounded domain invariants when generated cases provide meaningful coverage.
- Use complete focused fakes for behavior-heavy ports. Use `Layer.mock` only when omitted methods are intentionally forbidden in that test.
- A shared `layer(...)` test block builds once and shares state. Use it only when shared acquisition is intentional; otherwise provide a fresh Layer per test.
- Test Layer acquisition and finalization for owned resources.
- Test typed failure, defect, interruption, retry exhaustion, and cancellation separately when the distinction affects runtime behavior.
- Protocol tests MUST assert stable encoded tags, fields, versions, and retry meaning, not only decoded TypeScript values.
- Existing plain Vitest tests MAY remain when they already express the behavior clearly. Migrate them when touching Effect-heavy setup, time, scope, or Layer lifecycle behavior.

## Review Checklist

Before merging Effect code, verify:

### Data

- Every new trust boundary decodes `unknown` through a Schema.
- Persisted and wire output is encoded through an owned versioned shape.
- `Type` and `Encoded` are not accidentally conflated.
- Sync decoding cannot turn malformed external data into an unintended defect.
- Telemetry and public errors do not expose private or unbounded data.

### Services And Layers

- Context identifiers are globally stable and unique.
- Construction and per-call requirements have the correct lifetime.
- `layerNoDeps` retains every captured construction dependency.
- `provideMerge` outputs are intentionally public.
- Merged sibling Layers do not incorrectly depend on one another.
- Shared resources reuse one named Layer value.
- Every acquired resource, background fiber, and `ManagedRuntime` has an owner.

### Errors And Operations

- Expected failures remain typed and defects remain exceptional.
- Boundary translation preserves retry and diagnosis information.
- Retry is bounded, selective, observable, and safe for the side effect.
- Reusable meaningful operations use `Effect.fn` and stable names.
- Runtime execution occurs only at an application or framework boundary.

### Observability

- The terminal owner emits one bounded completion event.
- Span names and metric attributes are low-cardinality.
- Error tags are stable; raw causes and messages are not exported.
- Trace propagation is configured rather than assumed.
- Exporter scope, flush, logger replacement, and sampling behavior are known.

### Verification

Run the complete repository gate after Effect or architecture changes:

```sh
bun run format
bun run check
bun run typecheck
bun run test
bun run build
```
