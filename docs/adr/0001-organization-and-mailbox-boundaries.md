# ADR 0001: Organization and mailbox boundaries

- Status: Accepted
- Date: 2026-07-22
- Owners: Product owner and engineering

## Context

The current application has one global mailbox. The target product must support personal and shared company mailboxes while preventing users and administrators from reading unrelated mail.

The first deployment does not need public multi-tenant SaaS onboarding, but adding tenant ownership after mailboxes, addresses, grants, and audit data already exist would require a risky migration.

## Decision

The control plane is tenant-aware from its first multi-mailbox migration:

- An `Organization` owns domains, mailboxes, addresses, and organization memberships.
- The first release creates one organization per deployment.
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

## Rejected alternatives

### One deployment model without Organization

Rejected because adding organizations later would require backfilling every ownership and authorization boundary without an existing tenant invariant.

### Separate implementations for personal and shared mailboxes

Rejected because both require the same storage, routing, message, and authorization primitives. Separate implementations would create divergent security behavior.

### Organization Admin implicitly reads every mailbox

Rejected because HR, accounting, and personal mailboxes require configuration administration without automatic content access.

## References

- `PLAN-FIRMOWEJ-POCZTY.md`
- `src/control-plane/schema.ts`
- `src/mailboxes/mailbox-do.ts`
- `src/authorization/catalog.ts`
