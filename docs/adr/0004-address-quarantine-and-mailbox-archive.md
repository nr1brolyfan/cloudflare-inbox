# ADR 0004: Address quarantine and mailbox archive

- Status: Accepted
- Date: 2026-07-22
- Owners: Product owner and engineering

## Context

After employee offboarding or mailbox retirement, future replies, invoices, credentials, and confidential messages may continue to arrive at an old address. Reassigning that address accidentally can disclose mail to a new person.

Mailbox archival must retain history without allowing the archived store to keep receiving or sending mail. Existing routes must remain auditable and in-flight inbound messages must not change destination during archival.

## Decision

### Address quarantine

An address that is retired without a deliberate transfer enters quarantine:

```text
active -> quarantined -> retired/reusable
```

- Quarantine lasts at least 180 days.
- The address remains reserved and globally unique.
- It has no active inbound route or send identity.
- Inbound mail is rejected and cannot fall through to catch-all.
- It cannot be assigned to another employee or mailbox.
- Expiry never causes automatic reuse.
- After expiry, an Organization Owner/Admin may explicitly reactivate or reassign it after a warning and step-up authentication.
- A deliberate, audited full transfer to another active mailbox may bypass quarantine because it is a continuity decision rather than reuse after retirement.

### Mailbox archive

Mailbox lifecycle includes:

```text
active -> archiving -> archived
archived -> active
```

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

Hard delete and automatic retention deletion are not part of the first release. Archived mailbox data is retained until a separately designed and tested deletion workflow exists.

### Cutover semantics

An inbound message routed before the archival cutover finishes in the old mailbox using its immutable routing snapshot. Messages resolved after cutover go to the new active target or are rejected when the address is quarantined.

## Consequences

- The mailbox status catalog gains `archiving` and `archived`.
- Registry and repository operations must distinguish read-only archived access from active mutation/routing access.
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
- `src/modules/organization/adapters/d1/OrganizationSchema.ts`
- `src/control-plane/inbound-mailbox-resolver-live.ts`
- `src/modules/mailbox/adapters/durable-object/MailboxDoClient.ts`
- `src/modules/mailbox/domain/MailboxOutbound.ts`
