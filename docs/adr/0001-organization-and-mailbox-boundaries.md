# ADR 0001: Organization and mailbox boundaries

- Status: Accepted
- Date: 2026-07-22
- Last updated: 2026-07-24
- Owners: Product owner and engineering

## Context

The current application has one global mailbox. The target product must support personal and shared company mailboxes while preventing users and administrators from reading unrelated mail.

The first deployment does not need public multi-tenant SaaS onboarding, but adding tenant ownership after mailboxes, addresses, grants, and audit data already exist would require a risky migration.

## Decision

The control plane is tenant-aware from its first multi-mailbox migration:

- An `Organization` owns domains, mailboxes, addresses, and organization memberships.
- Organization IDs are case-sensitive opaque ASCII values matching `[A-Za-z0-9_-]{1,128}`. They are immutable, never deleted, and never reused. `legacy_default_v1` is the reserved deterministic migration identity for the first deployment; it is not selected by count or order and has no user-visible naming semantics. Generators for later organizations remain separate work.
- An organization starts `active` at version 1 with equal Unix-millisecond creation and update times. Storage admits only `active` and `suspended`, safe-integer times and versions, exact version increments, and nondecreasing update time. Authorized suspend/resume operations and their audit contract remain separate lifecycle work.
- Organization membership uses stable, never-reused membership IDs and retained epochs. At most one `active` or `suspended` epoch exists for an organization/user pair; revocation is terminal, and a later rejoin creates a new ID after the prior revocation time.
- Membership lifecycle is `active -> suspended|revoked` and `suspended -> active|revoked`. Membership does not contain a role and never constitutes permission by itself.
- The first release creates one organization per deployment.
- Migration 1023 seals exactly one organization-owned cutover outcome. `legacy-primary` binds mailbox `primary`, its safe-integer creation time, and `legacy_default_v1`; `fresh-empty` records that neither mailbox nor organization existed and creates no organization during migration. Reapplication accepts `fresh-empty` only while both inventories remain empty or after the exact unique reserved organization/`primary` pair has been created with equal safe creation provenance; partial, additional, unrelated, or timestamp-disagreeing state fails closed. Legal later lifecycle fields require advanced versions and do not change creation provenance.
- On a fresh cutover, storage admits the first `primary` mailbox only after the reserved organization exists as active version 1 with creation and update times equal to the mailbox creation time. The trusted owner-bootstrap D1 batch conditionally creates that organization under its transaction-local authorization guard before mailbox, address, receipt, grant, and audit writes.
- Migration-owned triggers are transactionally dropped, state-validated, and recreated from exact definitions on every migration application. They seal cutover writes, guard the fresh first mailbox, prevent changing the `primary` mailbox ID or creation time, reject deletion, and reject an existing-ID insert before `INSERT OR REPLACE` conflict handling after either cutover outcome has established creation provenance.
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
