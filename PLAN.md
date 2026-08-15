# Effect v4 Improvement Plan

## Goal

Bring the repository to Effect `4.0.0-beta.102` and then align production code with `effect-code-style-guide.md` without changing durable protocols, authorization, transaction semantics, or runtime lifetimes accidentally.

Work in small vertical slices. Do not mechanically replace every synchronous decoder, `Effect.gen`, or `provideMerge`: first classify its boundary and behavior, then preserve that behavior in focused tests.

## 0. Activate The Guide

- [ ] Upgrade `effect`, every `@effect/*` dependency and override to `4.0.0-beta.102`.
- [ ] Upgrade/rebuild the local `@effect-auth/core` package with beta.102 peer dependencies before regenerating its tarball and lockfile entry.
- [ ] Review beta.99-beta.102 changelogs and remove beta.98-specific workarounds, including `scripts/production-env.ts` where the new API permits it.
- [ ] Establish a green baseline with the complete verification gate.

Exit: one Effect version across manifests, peers, overrides, and lockfile; full repository gate passes.

## 1. Make Data Boundaries Typed

- [ ] Inventory synchronous codecs and classify each as trusted construction, synchronous framework adaptation, wire input, or persisted data.
- [ ] Convert malformed D1/SQLite rows and JSON columns to effectful decoding mapped into owned storage/corruption errors. Start with: `UserMailboxContactPreferencesD1.ts`, `LegacyMailDomainClaimReconciliation.ts`, `MailboxMessageStoreSqlite.ts`, `MailboxOutboundDispatchStoreSqlite.ts`, `MailboxDraftAttachmentStoreSqlite.ts`, and `MailboxOperationStoreSqlite.ts`.
- [ ] Centralize bounded schema-backed JSON codecs used by mailbox SQLite, R2, DO, and Workflow contracts; retain plain JSON only for proven canonical fingerprints or foreign APIs.
- [ ] Verify Website, HTTP, DO RPC, Workflow step/result, R2 metadata, and external SDK responses decode once at every independent trust boundary.
- [ ] Add malformed row, malformed JSON, incompatible version, and public-error sanitization tests before changing each boundary.

Exit: untrusted malformed data fails through an intentional typed channel; trusted constants and checked internal constructors may remain synchronous.

## 2. Normalize Operations, Errors, And Services

- [ ] Use named `Effect.fn` for meaningful reusable application methods, adapter calls, Workflow steps, alarm work, and background jobs; keep trivial helpers unspanned.
- [ ] Audit `orDie`, `die`, `catchCause`, broad `mapError`, and SDK defect recovery. Preserve interruption and retain distinctions needed for HTTP mapping, retry, and diagnosis.
- [ ] Keep internal errors as `Data.TaggedError`; use schema-backed errors only for encoded protocols. Remove raw causes/messages from exported data.
- [ ] Standardize application ports on class-based `Context.Service`; retain value tags only for immutable config/value capabilities documented by the guide.
- [ ] Rename Layer-returning `make*` exports, starting with `makeRecoverySafeAccountSecurityEffectAuthLayer`, to camelCase names ending in `Layer`. Effect-returning `make*` constructors remain valid.

Exit: important operations have stable names, expected failures remain typed, and service/Layer naming matches both normative guides.

## 3. Simplify Layer Graphs And Lifetimes

- [ ] Review every `provideMerge`; replace it with `provide` unless downstream code intentionally consumes the provider output. Prioritize Website, account-security/effect-auth, and `ControlPlaneBatch` graphs.
- [ ] Verify merged sibling Layers do not rely on each other's outputs and that shared databases, clients, exporters, and state reuse one named Layer value.
- [ ] Keep feature graphs closed before Backend, Website, MailboxDO, and Workflow roots; do not move request/run capabilities into longer-lived Layers.
- [ ] Document and test ownership/disposal for the Website `ManagedRuntime`, request-scoped observability, DO activation, Workflow instances, `waitUntil`, and any scoped background fibers.

Exit: each resource has one lifetime owner, Layer sharing is intentional, and public graph outputs are minimal.

## 4. Complete Observability

- [ ] Extend the Backend completion event with stable service version, environment/region and bounded error type; emit failed terminal outcomes at Error while expected rejections remain Info.
- [ ] Add one schema-versioned completion event and meaningful spans for Workflow instances/steps, MailboxDO RPC/alarm work, outbound delivery, inbound processing, and AI runs. Do not log the same failure per layer.
- [ ] Add bounded metrics for operation outcome/duration, retry exhaustion, queue depth or active work, and exporter health. Add an Effect beta.102 metric exporter at each owning runtime boundary.
- [ ] Use only closed labels such as operation, outcome, normalized route, job type, and error tag. Never label metrics with request/mailbox/user IDs, URLs, or messages.
- [ ] Verify actual trace extraction/injection across supported Website, Backend, Workflow, DO, and outbound HTTP boundaries; document platform gaps instead of assuming propagation.

Exit: critical operations can be diagnosed from one completion event, a trace, and bounded RED/saturation metrics without exposing private data.

## 5. Improve Tests And Enforcement

- [ ] Adopt `@effect/vitest` when touching Effect-heavy suites; use `TestClock` for time/retry behavior and per-test Layers unless shared state is intentional.
- [ ] Replace behavior-heavy partial `Layer.mock` values with complete focused fakes; test acquisition/finalization where resources are owned.
- [ ] Split only oversized test harnesses with multiple responsibilities; keep scenario behavior cohesive.
- [ ] Extend architecture checks for project-owned Layer-returning `make*` exports and other rules that are precise enough to enforce without false positives. Keep semantic boundary review in tests/code review.

Exit: changed behavior has focused success, typed failure, defect/interruption, retry, corruption, and lifecycle coverage where applicable.

## Slice Verification

Run focused tests while developing each slice, then before completing a phase:

```sh
bun run format
bun run check
bun run typecheck
bun run test
bun run build
```

Do not combine protocol changes, broad renames, dependency upgrades, and behavioral refactors in one commit. Preserve generated files and historical migrations unless a phase explicitly requires coordinated regeneration.
