# ADR 0002: Address routing and sending

- Status: Accepted
- Date: 2026-07-22
- Owners: Product owner and engineering

## Context

The product must support both isolated mailboxes and several addresses entering one mailbox. Addresses must be editable without moving historical messages, and receiving mail must not automatically grant permission to send from the same address.

The current `app_mailbox_address` row is owned by a mailbox and also supplies its outbound primary identity. That shape cannot safely preserve address history or model an address transfer.

## Decision

Email identity, inbound routing, and outbound authority are separate resources:

- `MailAddress` is a stable address under one verified organization domain.
- `InboundRouteAssignment` is a temporal mapping from one address to one mailbox.
- `MailboxSendIdentity` authorizes one mailbox to send from one address.
- One active receiving address has exactly one active inbound route.
- Several addresses may route to the same mailbox.
- One address routing to several mailboxes is a future distribution-group feature and is not part of the first release.
- External forwarding is a separate future feature.

The server constructs addresses from a trusted domain and validated local-part. The first-release local-part policy is:

```text
length: 1..64 ASCII characters
pattern: [a-z0-9]+(?:[._-][a-z0-9]+)*
canonical form: lowercase
```

Domains use versioned IDNA ASCII canonicalization. The server reserves system-managed local-parts including `postmaster`, `abuse`, `security`, `auth`, `noreply`, `mailer-daemon`, and technical bounce addresses.

Existing case-sensitive addresses require a preflight. Canonical collisions are quarantined for operator resolution before a lowercase unique index is enabled.

### Routing changes

A route-only reassignment:

- atomically closes the previous assignment and opens the next assignment in D1,
- changes only future inbound routing,
- does not move historical messages,
- does not change send identities,
- records actor, reason, time, and revision.

Inbound processing snapshots address ID, assignment ID, revision, mailbox ID, and envelope recipient at the routing linearization point. An in-flight message always finishes in the mailbox selected by that snapshot.

A full address transfer additionally changes send identities. It uses:

- a D1 fencing epoch,
- epoch-bound dispatch permits,
- an idempotent outbox/Workflow for `MailboxDO` operations,
- reconciliation for partial failures.

Transfer blocks new permits and does not finalize until `sending` and `indeterminate` permits are safely resolved. A timeout alone cannot authorize finalization after an unknown provider outcome.

### Sending and replies

- A send-enabled mailbox has exactly one default send identity.
- A receive-only mailbox has none.
- Drafts persist an explicit `fromIdentityId` and revision.
- Changing the default affects new drafts, not existing drafts or immutable send snapshots.
- Sending requires mailbox send permissions plus authority to use the selected identity.
- Replies prefer the historical ingress address when it remains send-enabled.
- Reply-all suppresses current mailbox identities and historical own-recipient snapshots, even after an address transfer.

## Consequences

- The current address table must be migrated into stable address, route-history, and send-identity records.
- Legacy primary addresses become both active routes and default send identities.
- Old and in-flight Workflow, draft, and outbound protocol versions require compatibility readers during rollout.
- Address changes become auditable without rewriting historical messages.
- Route-only reassignment remains a small D1 transaction, while full transfer is a coordinated state machine.

## Rejected alternatives

### Store `mailbox_id` directly on the permanent address row

Rejected because reassignment would erase history and couple address identity to message storage.

### Use one Cloudflare routing rule per address

Rejected for the first release because each UI change would require remote provisioning, reconciliation, and rollback. A static catch-all plus exact D1 routing is simpler and atomic.

### Treat inbound aliases as automatically sendable

Rejected because receiving and sending have different security requirements.

## References

- `PLAN-FIRMOWEJ-POCZTY.md`
- `src/platform/control-plane-d1/ControlPlaneSchema.ts`
- `src/control-plane/inbound-mailbox-resolver-live.ts`
- `src/control-plane/mailbox-sender-identity-live.ts`
- `src/mailboxes/inbound-email-routing.ts`
- `src/mailboxes/outbound-sending.ts`
