# ADR 0001: Organization and mailbox boundaries

- Status: Accepted
- Date: 2026-07-22
- Last updated: 2026-07-25
- Owners: Product owner and engineering

## Context

The current application has one global mailbox. The target product must support personal and shared company mailboxes while preventing users and administrators from reading unrelated mail.

The first deployment does not need public multi-tenant SaaS onboarding, but adding tenant ownership after mailboxes, addresses, grants, and audit data already exist would require a risky migration.

## Decision

The control plane is tenant-aware from its first multi-mailbox migration:

- An `Organization` owns domains, mailboxes, addresses, and organization memberships.
- Organization IDs are case-sensitive opaque ASCII values matching `[A-Za-z0-9_-]{1,128}`. They are immutable, never deleted, and never reused. `legacy_default_v1` is the reserved deterministic migration identity for the first deployment; it is not selected by count or order and has no user-visible naming semantics. Generators for later organizations remain separate work.
- An organization starts `active` at version 1 with equal Unix-millisecond creation and update times. Storage admits only `active` and `suspended`, safe-integer times and versions, exact version increments, and nondecreasing update time. ORG-013 permits only audited `active -> suspended` and `suspended -> active` transitions; no-op updates and unknown states fail closed.
- Organization membership uses stable, never-reused membership IDs and retained epochs. At most one `active` or `suspended` epoch exists for an organization/user pair; revocation is terminal, and a later rejoin creates a new ID after the prior revocation time.
- Membership lifecycle is `active -> suspended|revoked` and `suspended -> active|revoked`. Membership does not contain a role and never constitutes permission by itself.
- The first release creates one organization per deployment.
- Migration 1023 seals exactly one organization-owned cutover outcome. `legacy-primary` binds mailbox `primary`, its safe-integer creation time, and `legacy_default_v1`; `fresh-empty` records that neither mailbox nor organization existed and creates no organization during migration. Reapplication accepts `fresh-empty` only while both inventories remain empty or after the exact unique reserved organization/`primary` pair has been created with equal safe creation provenance; partial, additional, unrelated, or timestamp-disagreeing state fails closed. Legal later lifecycle fields require advanced versions and do not change creation provenance.
- On a fresh cutover, storage admits the first `primary` mailbox only after the reserved organization exists as active version 1 with creation and update times equal to the mailbox creation time. The trusted owner-bootstrap D1 batch conditionally creates that organization under its transaction-local authorization guard before mailbox, address, receipt, grant, and audit writes.
- Migration-owned triggers are transactionally dropped, state-validated, and recreated from exact definitions on every migration application. They seal cutover writes, guard the fresh first mailbox, prevent changing the `primary` mailbox ID or creation time, reject deletion, and reject an existing-ID insert before `INSERT OR REPLACE` conflict handling after either cutover outcome has established creation provenance.
- Migration 1024 retains the sole pre-column mailbox ancestry bridge in `app_mailbox_legacy_organization_assignment`. Its only row binds mailbox `primary` to `legacy_default_v1` at their equal safe-integer creation time and records either `legacy-cutover` or `fresh-bootstrap`; the singleton `app_mailbox_legacy_organization_assignment_cutover` seals completion even when a fresh deployment still has empty inventories. Neither table is a user mailbox assignment, membership, grant, or authorization source.
- For a fresh deployment, an ORG-007-owned `AFTER INSERT` trigger materializes the exact ancestry row in the same statement that creates the first mailbox. Its binding requires the sealed fresh-empty ORG-006 outcome, reserved active version-1 organization, initial active version-1 `primary` mailbox, equal creation times, and otherwise empty inventories. A failure aborts the mailbox statement and enclosing D1 batch. Migration reapplication validates but never repairs missing or changed ancestry.
- Migration 1027 additively introduces canonical `app_mailbox.organization_id` and backfills it solely by joining the retained bridge on `mailbox_id`. The physical SQLite column remains nullable during expansion while `SAFE-005` blocks table rebuilds, but every valid committed mailbox is logically required to have one non-null organization that exactly agrees with the retained bridge and parent creation provenance. The bridge remains retained forever; constants, row counts, ordering, users, grants, memberships, domains, receipts, routes, and navigation never select backfill ancestry.
- ORG-010 atomically replaces the temporary ORG-007 mailbox trigger with one consolidated `AFTER INSERT` protocol. It accepts either omission by a rolling old writer or the current writer's internally trusted reserved organization, materializes the original fresh bridge, fills an omitted canonical value only from that exact new bridge, and verifies one-row parent/timestamp/provenance equality before the statement commits. Public bootstrap/rename commands, `MailboxRecord`, APIs, and historical administration receipt versions remain unchanged.
- Migration 1027 is intentionally forward-only: SQLite cannot conditionally execute additive `ALTER TABLE ADD COLUMN`. Its entry preflight requires an absent column and byte-exact 1026 predecessor, the normal migration ledger applies it once, and any manual reapplication rejects before persistent mutation. An additive successor trigger makes manual 1023 reapplication roll back tentative predecessor-trigger drops. Hot readers check data-level ancestry; success-only Backend initialization compares current column/FK/index/table/trigger facts to the immutable ORG-010 generation manifest once per isolate and retries failure. Future successors detect the same generation, and 1027 never heals it.
- Migration 1028 retains and freezes `app_user_preference` and additively creates `app_user_organization_preference` with identity `(organization_id, user_id)`. Backfill organization comes only from the sealed ORG-006 `legacy-primary` row; `fresh-empty` plus any legacy preference, an orphan user, malformed fields, or missing/cross-organization default ancestry aborts atomically. Null remains null, and settings, timestamps, and version are copied without normalization. The table has restricted organization/user parents and a composite restricted default FK through unique `(app_mailbox.organization_id, app_mailbox.id)`.
- A canonical preference records optional ranking state only. Same-organization ancestry verifies resource ownership, not mailbox lifecycle or user access; dormant suspended/deleted defaults remain stored. Preference presence, default, and settings are never organization selection, membership, discovery, assignment, grant, permission, or authorization evidence. Future mailbox navigation must first authenticate and authorize its currently eligible candidate set and may only then rank an exact eligible mailbox by preference.
- ORG-011 changes no public API, Backend/Website mutation, bootstrap write, response, or current navigation selection. Absence is valid. Migration 1028 is forward-only with immutable cutover/generation evidence and a successor collision fence for old migration reapplication; it never heals tampered artifacts. Legacy contraction remains blocked by `SAFE-005`.
- Migration 1025 assigns the uniquely grant-nominated legacy mailbox owner to fixed retained membership `legacy_default_v1_owner_v1` and a canonical organization-scoped `organization.owner` grant. Exact ancestry, user, mailbox membership, creator, catalog, global-grant absence, and compatible bootstrap history corroborate but never select the nominee. Its immutable receipt is the migration authority ledger; the existing mailbox owner grant remains current mailbox authority.
- Fresh owner bootstrap materializes the same membership, organization grant, and receipt from an ORG-008-owned trigger on the real successful mailbox bootstrap audit. This preserves old writers and transaction atomicity without adding organization input to the public command or inventing an organization audit action.
- ORG-012 Phase A establishes one application bootstrap authority without changing storage protocol. Public bootstrap intent contains only display name and operation ID and explicitly rejects named organization, mailbox, owner, address, domain, and protocol fields. `OrganizationBootstrap.make` captures trusted bootstrap configuration and the `OrganizationBootstrapTransaction` port; HTTP does not derive trusted values, while `MailboxAdministration` retains only rename and operation readback.
- Migration 1029 additively expands the ORG-013 lifecycle protocol without rebuilding the retained V1 administrative audit table while `SAFE-005` is open. A separate closed organization audit stream, immutable operation receipt, holder-bound operation-fence table, durable activation sentinel, and sealed generation bind exact actor, organization, before/after version, status, time, matrix V1, and step-up policy V1. Every storage transition requires an activated sentinel, its matching audit row with an existing actor, and an empty operation-fence set; reserved-artifact and exact-predecessor preflight, FK-off parent checks, rowid replacement guards, and update/delete/replace guards preserve the protocol under weakened SQLite pragmas.
- The V1 organization operation matrix allows metadata/audit/operation readback in either status, suspend only while active, resume only while suspended, and ordinary administration only while active. Unknown operations deny. Suspension retains membership, grants, assignments, preferences, domains, mailboxes, and their independent lifecycle histories; it is an additional operational gate, never a bulk revoke or child-status rewrite.
- Suspend and resume require an unrestricted token-bound session, fresh `control-plane-sensitive` step-up, active exact organization membership, and `organization.manage_settings` from an exact organization-scoped grant. Global grants are not accepted. Current mailbox lookup, navigation, inbound routing, and sender identity require the organization to remain active. Each inbound commit and outbound provider dispatch additionally acquires its own holder ID in D1 while active; suspension cannot commit until every holder releases its row, eliminating shared-owner and status-check/side-effect races. Outbound alarms acquire a holder before claiming queued work and retain it through settlement, so suspension cannot race a retry-budget increment. Resume is evaluated directly against the suspended organization and cannot deadlock on the child gate.
- Migration 1029 deliberately leaves `app_organization_lifecycle_activation.status = expanded`. A successor migration may activate it only after all Backend, Workflow, and MailboxDO writers use fences, old instances are drained, maintenance/quiescence controls are available, and dated staging evidence exists. Until then, storage and the application reject suspend/resume; local code completion is not rollout proof.
- The current D1 transaction, `mailbox.owner-bootstrap` audit, V1/V2 receipts, domain intent, rolling triggers, statement order, replay, and unknown-commit behavior remain unchanged. Trigger retirement requires a separate dual-protocol expand/activate/drain/contract cutover with proven live-writer drain, exact Cloudflare D1 atomicity, maintenance/quiescence controls, and dated staging evidence. Phase A supplies none of those production proofs.
- Migration 1026 binds fixed pending claim `legacy_default_v1_domain_v1` to the exact retained `primary` route epoch and `legacy_default_v1`. Its immutable receipt is migration provenance, not verification or readiness. Populated legacy state is canonicalized only by the required Backend TypeScript reconciliation Effect; fresh writers stage the branded canonical domain before audit, and the rolling SQL fallback accepts only ordinary lowercase ASCII LDH. ORG-016 must replace the lifecycle freeze with typed verification/handoff, and ORG-012 must atomically replace the fresh staging trigger while retaining cutover, intent, and receipt.
- Multi-organization SaaS remains deferred, but no new model may depend on a global organization singleton.
- A `Mailbox` is the storage and authorization boundary.
- Each mailbox has its own `MailboxDO` and immutable mailbox ID.
- Newly generated mailbox IDs are opaque, globally unique, and never reused.
- The existing `primary` mailbox ID is a permanent migration exception because it identifies existing Durable Object data.
- Personal and shared mailboxes use the same technical model.
- `personal` and `shared` are product templates that establish safe default assignments and roles.
- An Organization Owner or Admin receives configuration authority but no implicit mailbox-content access.
- Access to a mailbox requires an active organization membership, active mailbox assignment, and an exact effective permission.

## Consequences

- Every D1 ownership relation, permission scope, Workflow payload, R2 metadata record, audit event, and cache key must store or derive organization ancestry.
- The application must apply an organization/mailbox gate before opening a child resource in a `MailboxDO`.
- Navigation must select an explicit mailbox and cannot use an unordered first membership.
- Organization administration and mail-content administration remain separate capabilities.
- Existing `MailboxDO` storage, message processing, rules, search, and outbound state can remain mailbox-oriented.
- The initial `app_organization` migration is an additive tenant-root schema only. It does not seed a legacy organization, add membership, assign the current mailbox, alter the mailbox singleton, or expose a runtime mutation.
- The ORG-006 cutover adds only migration provenance and creation of the reserved organization for a valid retained `primary` mailbox, or deferred atomic creation during trusted bootstrap for a fresh deployment. It does not add membership, organization grants, domains, mailbox ownership columns, preferences, or tenant authorization.
- The ORG-007 bridge adds resource ancestry for the legacy mailbox without changing its ID or granting authority. It is retained migration input for ORG-010, not a runtime navigation or authorization relation.
- The ORG-010 canonical mailbox column records resource ancestry, not access. It does not add ACL-003 membership gating, transfer, multi-mailbox behavior, or caller-provided organization selection, and the singleton remains until ROLL-008.
- The ORG-011 canonical preference is storage-only ranking state. Current unordered singleton navigation remains unchanged until MBX-006/007, and bootstrap intentionally creates no preference.
- The ORG-008 membership and organization grant do not widen mailbox-content access. Organization permission, active membership, and later ACL-003 resource gates remain separate requirements; membership alone is never permission.
- The focused bootstrap service prevents transport adapters from becoming an organization/mailbox/owner/address/domain authority. Actor identity remains request context and is transactionally rechecked; it is not a command field.
- Organization suspension is reversible containment, not deletion. `deleting`, `deleted`, tenant export, and coordinated delete workflows remain excluded until SAAS-006.

## Rejected alternatives

### One deployment model without Organization

Rejected because adding organizations later would require backfilling every ownership and authorization boundary without an existing tenant invariant.

### Separate implementations for personal and shared mailboxes

Rejected because both require the same storage, routing, message, and authorization primitives. Separate implementations would create divergent security behavior.

### Organization Admin implicitly reads every mailbox

Rejected because HR, accounting, and personal mailboxes require configuration administration without automatic content access.

## References

- `PLAN-FIRMOWEJ-POCZTY.md`
- `src/modules/organization/adapters/d1/OrganizationSchema.ts`
- `src/apps/mailbox-do/MailboxDO.ts`
- `src/modules/authorization/contracts/AuthorizationCatalog.ts`
