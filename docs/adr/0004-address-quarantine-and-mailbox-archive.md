# ADR 0004: Address quarantine and mailbox archive

- Status: Accepted
- Date: 2026-07-22
- Last updated: 2026-07-23
- Owners: Product owner and engineering

## Context

After employee offboarding or mailbox retirement, future replies, invoices, credentials, and confidential messages may continue to arrive at an old address. Reassigning that address accidentally can disclose mail to a new person.

Mailbox archival must retain history without allowing the archived store to keep receiving or sending mail. Existing routes must remain auditable and in-flight inbound messages must not change destination during archival.

## Decision

### Address quarantine

An active or suspended address retired without a deliberate transfer enters quarantine:

```text
active | suspended -> quarantined -> retired (eligible for manual reuse)
```

- Quarantine lasts at least 180 days.
- The address remains reserved and globally unique.
- It has no active inbound route or send identity.
- Inbound mail is rejected and cannot fall through to catch-all.
- While quarantined, it cannot be assigned to another employee or mailbox.
- Expiry never causes automatic reuse.
- After expiry, `retired` means only eligible for manual reuse. An Organization Owner/Admin may explicitly reactivate or reassign it after a warning and step-up authentication.
- Manual reuse preserves the same stable address record, ID, and complete history; it never releases the address for creation as a new identity.
- A deliberate, audited full transfer to another active mailbox may bypass quarantine because it is a continuity decision rather than reuse after retirement.

### Mailbox archive

Mailbox lifecycle includes:

```text
active <-> suspended
active -> archiving -> archived
archived -> active
```

`suspended` is a reversible operational stop. The mailbox remains visible to explicitly authorized users and permits read, search, attachment access, and export, but rejects new inbound routing, outbound sending, and message, folder, label, rule, or draft mutation. Resuming to `active` is audited and revalidates access and readiness. Authorized `active`, `suspended`, and `archived` mailboxes appear in the switcher, but only `active` may be selected as a default.

`archiving` is a transitional state that:

- blocks new sends and new route assignments,
- requires a disposition for every active address,
- cancels or resolves pending and scheduled sends,
- waits for `sending` and manually resolves `indeterminate` outcomes,
- drains inbound messages whose routing snapshot predates the cutover.

Before archival completes, every active address must be either:

- transferred to another active mailbox, or
- placed in quarantine.

The previous route is closed with `valid_to` and an archival reason. It is never deleted. The archived mailbox UI shows it as historical, visually muted, with its current disposition such as `Transferred to HR` or `Quarantined until ...`.

An `archived` mailbox:

- retains messages, attachments, folders, rules, drafts, and audit history in the same `MailboxDO`,
- allows read, search, attachment access, and export only to users with explicit mailbox grants,
- does not grant Organization Admin implicit content access,
- rejects message, folder, label, rule, and draft mutations,
- cannot send mail,
- cannot be an active inbound route target,
- may be restored only through an audited, versioned operation after validating assignments, grants, domain readiness, routes, and send identities.

Suspension and archival do not blanket-revoke assignments or explicit read/export grants. State-specific guards block disallowed operations, while retained grants continue to require exact authorization and never give Organization Admin implicit content access. `archiving` is transitional and is not a normal switcher destination.

Hard delete and automatic retention deletion are not part of the first release. Archived mailbox data is retained until a separately designed and tested deletion workflow exists.

### Cutover semantics

An inbound message routed before the archival cutover finishes in the old mailbox using its immutable routing snapshot. Messages resolved after cutover go to the new active target or are rejected when the address is quarantined.

## Consequences

- The mailbox status catalog and state machine gain `suspended`, `archiving`, and `archived` with the transitions above.
- Registry and repository operations must apply an operation-specific matrix for active, suspended, archiving, and archived access rather than a single active-only predicate.
- Archive is a workflow, not a single status update.
- Route history and address identity cannot cascade-delete with a mailbox.
- UI must force address disposition before confirming archive.
- Quarantine requires `quarantined_at`, `quarantined_until`, reason, version, and audit metadata.

## Rejected alternatives

### Keep active routes pointing to archived mailboxes

Rejected because archived data would continue changing and the mailbox would not be a stable historical store.

### Delete routes during archive

Rejected because route history is required for audit, in-flight delivery explanation, and safe reassignment.

### Automatically release an address after 180 days

Rejected because delayed correspondence can remain sensitive after any fixed interval.

### Hard-delete mailboxes in the first release

Rejected until Durable Object, R2, grant, route, backup, and restore lifecycles have a coordinated deletion workflow.

## References

- `PLAN-FIRMOWEJ-POCZTY.md`
- `src/modules/address-routing/adapters/d1/AddressRoutingSchema.ts`
- `src/modules/address-routing/adapters/d1/InboundMailboxResolverD1.ts`
- `src/modules/mailbox/adapters/durable-object/MailboxDoClient.ts`
- `src/modules/mailbox/domain/MailboxOutbound.ts`
