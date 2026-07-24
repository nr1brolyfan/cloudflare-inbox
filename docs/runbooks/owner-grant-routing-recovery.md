# Owner, Grant, And Routing Recovery

- Owner: Product owner and engineering
- Last reviewed: 2026-07-24
- Scope: `SAFE-010`; owner loss, bad mailbox grants, and bad inbound routing

## Operating Boundary

This runbook covers the current global singleton and identifies future organization behavior separately. It does not authorize direct production data repair.

Current constraints:

- `app_mailbox_singleton_idx` permits at most one global mailbox.
- `app_organization_legacy_cutover` is sealed migration provenance. `legacy-primary` retains mailbox `primary`, its creation time, and reserved opaque organization ID `legacy_default_v1`; `fresh-empty` remains the recorded outcome only with empty inventories or the exact unique trusted-bootstrap pair with equal creation provenance. Partial pairs, unrelated/additional rows, timestamp disagreement, changed `primary` ID/creation time, deletion, or replacement are corruption and are storage-blocked. Never infer or repair this identity from organization count or order.
- `app_mailbox_member` is a discovery projection, not authorization. Effect-auth role and permission grants authorize access.
- Supported mailbox administration is owner bootstrap and rename. There is no supported owner transfer, grant/revoke, route disable, or route reassignment operation.
- `app_mailbox_address` is both the enabled inbound lookup and the current primary outbound identity. It has no route history or assignment revision.
- Administrative audit has a closed current taxonomy. It does not contain grant or route mutations.
- `/api/health` checks dependency readiness for D1, R2, Durable Objects, rate limiting, and authorization storage. It does not validate owner, grant, or route semantics.

The reserved organization row does not yet create organization membership, organization grants, domain ownership, mailbox organization ancestry, or tenant authority. The future model will separate Organization Owner, mailbox ownership, assignments, stable addresses, route revisions, and send identities. Those commands do not exist yet and must not be simulated with direct SQL.

## Severity

| Severity | Definition | Examples | Acknowledge | Contain |
| --- | --- | --- | --- | --- |
| `SEV-0` | Confirmed broad disclosure or compromise that cannot be bounded | Cross-organization exposure, bulk unauthorized access, failed containment | 5 min | 15 min |
| `SEV-1` | Confirmed bounded unauthorized access, wrong delivery, or sole-owner compromise | Active bad grant, one address delivering to a wrong mailbox | 15 min | 30 min |
| `SEV-2` | Availability loss or suspected issue without confirmed disclosure | Recoverable owner lockout, messages rejected rather than misrouted | 1 h | 4 h |
| `SEV-3` | Non-production or historical drift without current impact | Staging-only malformed state, expired unused grant | Next business day | Planned |

Any confirmed wrong-mailbox delivery is at least `SEV-1`. Upgrade for sensitive data, broad scope, cross-organization impact, or failed containment.

## Common Workflow

1. Open an incident record with UTC start time, environment, deployment version, incident commander, and affected opaque IDs.
2. Freeze deployments and administrative changes touching identities, grants, addresses, routing, or mailbox lifecycle.
3. Preserve bounded, read-only evidence before remediation.
4. Classify the incident as compromise, availability loss, configuration drift, or corruption.
5. Contain with an existing application or Cloudflare control. Prefer rejection or temporary unavailability over continued disclosure.
6. Apply only a currently supported remediation. Otherwise remain contained and escalate for an application forward-fix.
7. Verify the affected path and an unaffected control path.
8. Restore traffic gradually and monitor through a normal authentication or delivery interval.
9. Record scope, decisions, operation receipts, audit references, residual risk, and follow-up owners.

For `SEV-0` or `SEV-1`, involve the incident commander, security/privacy owner, application owner, and affected data owner immediately. Escalate Cloudflare dependency or routing-control failures to Cloudflare support. Notify legal/privacy according to the applicable disclosure process; do not place message content in that notification channel.

## Owner Loss

### Detection

- The owner cannot sign in or complete account recovery.
- Navigation denies the expected owner or reports no current mailbox.
- The owner user, active membership, or exact mailbox owner grant differs from the bootstrap result.
- Unexpected successful access indicates possible account compromise, not only credential loss.

A healthy `/api/health` response does not rule out owner loss.

### Containment

- Freeze identity, ownership, grant, and deployment changes.
- Treat suspected compromise of the sole owner as at least `SEV-1`.
- Start supported account recovery promptly. Successful completion replaces old sign-in authority and revokes prior sessions and factors.
- If unauthorized mailbox access remains possible, only verified Website maintenance or successful supported account recovery can contain access to existing data. Pausing external routing may limit new data exposure but is not access containment. The repository does not currently provide either operator control. If recovery cannot complete and verified maintenance is unavailable, mark containment as failed, keep the incident at least `SEV-1`, escalate to Cloudflare support and application/security engineering, and do not improvise a deployment or data mutation.

### Read-Only Diagnosis

Run the current owner-chain and recovery-readiness templates below. Determine whether the failure is the account state, login identity, missing recovery prerequisites, discovery membership, or exact owner grant.

`MAILBOX_BOOTSTRAP_OWNER_EMAIL_ALLOWLIST` controls only which verified identities may bootstrap. `MAILBOX_INITIAL_ADDRESS` supplies the trusted initial route and the pre-bootstrap managed-domain claim. After bootstrap, persisted `MailDomain` and the retained legacy primary route are continuity authorities and must agree with trusted configuration; changing configuration does not transfer an existing mailbox, change its creator user ID, or recreate its owner grant, and disagreement fails closed as storage failure.

### Currently Supported Remediation

Use the public `Recovery` flow with both independent proofs:

1. Follow the short-lived link delivered to the verified external recovery identity.
2. Supply one unused recovery code.
3. Use the restricted recovery session only to enroll a user-verified passkey.
4. Save the ten replacement recovery codes returned by successful passkey remediation, then sign in with the new passkey. Rotate again only if that one-time material was lost or exposed.

Recovery must preserve the same `auth_user.id`; the mailbox membership and grant are bound to that user ID.

### Unsupported Branch And Escalation

There is no supported recovery when the user is disabled, the verified external recovery identity or unused code is absent, the membership is missing, or the owner grant is missing. Do not change bootstrap configuration, rerun bootstrap, create a replacement user, or edit D1. Keep containment active and escalate to security and application engineering for a reviewed forward-fix. Production break-glass is currently refused by the gate below.

### Verification

- The original user ID remains active.
- Exactly one active primary login identity exists.
- The expected active membership and exact mailbox-scoped owner grant exist.
- The new passkey signs in and mailbox navigation succeeds.
- Old sessions and sign-in factors fail after completed recovery.
- Recovery/passkey receipts and metadata-only audit records exist.
- The user has no unexpected global, direct, or mailbox grants.

### Rollback Or Forward-Fix

Account recovery is forward-only. Never restore old sessions, passkeys, credentials, or recovery codes. If recovery committed but one-time material was lost, use supported receipt/readback behavior, sign in with the new passkey when possible, and rotate codes through a new operation.

In the future organization model, same-user recovery remains distinct from an audited, step-up-protected organization ownership transfer. Last-owner guards and transfer commands must be implemented before that branch is usable; Organization Admin must not gain implicit mailbox-content access.

## Bad Grant

### Detection

- A principal can perform a mailbox action contrary to policy.
- A role or direct grant has the wrong subject, authority, scope, expiry, or revocation state.
- A global mail grant exists for the suspected principal. Current authorization can honor global grants, while the target model forbids them, so every observed active global mail grant is an incident candidate. Principal-scoped diagnosis does not prove organization-wide absence.
- Membership and grant state disagree.

### Containment

- Freeze grant, membership, identity, and deployment changes.
- Do not treat membership removal or UI hiding as revocation; membership is not authorization.
- Do not disable a role or permission definition as containment. Definition disablement is not runtime revocation in the current authorization contract.
- No supported per-grant mutation or repository-provided maintenance control exists. If an independently verified external maintenance control is already available, use its approved procedure. Otherwise mark containment as failed and escalate; do not treat an improvised deployment, membership edit, or definition disablement as containment.

### Read-Only Diagnosis

Run the bounded grant and role-permission inventories for the suspected principal and compare them with the captured D1 observation time. Check exact mailbox scopes, direct permissions, role grants, current role mappings, expiry, revocation, and all global grants. If either query reports more rows than its limit, the diagnosis is incomplete: keep containment active and use reviewed paginated tooling in the restricted operator environment. Use the owner chain when the owner role is involved. Audit history can establish bootstrap and rename provenance, but absence of a grant event is expected today and proves nothing about unsupported changes.

### Currently Supported Remediation

None. The application exposes no grant or revoke command. Read-only diagnosis is supported; access containment exists only when an independently verified maintenance control is already available. Data mutation is not supported.

### Unsupported Branch And Escalation

Do not modify `auth_role_grant`, `auth_permission_grant`, `app_mailbox_member`, role mappings, or definitions from this runbook. Escalate `SEV-0`/`SEV-1` to security and application engineering for a normal reviewed repair operation with expected state, idempotency, transactional authorization, immutable receipt, typed audit, and denial tests. Production break-glass remains refused until every prerequisite below exists.

### Verification

- A fresh session for the offending principal is denied the exact operation.
- An authorized control principal still succeeds.
- Discovery membership and effective grant provenance agree.
- No active global mail grants remain for the offending principal unless explicitly recorded as an unresolved incident condition. Organization-wide absence requires future bounded reconciliation and is not proven by this principal-scoped query.
- Any future supported repair has an exact operation receipt and administrative audit event.
- Sensitive responses remain `no-store` and are unavailable through stale browser state.

### Rollback Or Forward-Fix

A mistaken future revoke must be corrected by a new, exact, audited grant operation. Never clear `revoked_at` or restore an old grant row. Future organization behavior may use supported membership suspension, mailbox assignment lifecycle, exact grant revocation, and effective-access readback only after those operations are implemented.

## Bad Routing

### Detection

- SMTP rejects report an unknown recipient or unavailable processing.
- Expected mail does not arrive, or a message is confirmed in the wrong mailbox.
- The Cloudflare catch-all target differs from the expected Backend Worker.
- The D1 route lookup disagrees with the SMTP envelope recipient.
- R2 HEAD metadata for a known ingest has an unexpected bounded `envelope-to` or `mailbox-id`.

The SMTP envelope recipient is routing authority. MIME `To`, `Cc`, and `Bcc` headers are not routing evidence.

### Containment

- Pause the affected external Cloudflare catch-all/Email Routing rule only through an existing verified Cloudflare operator procedure. The repository does not manage or document that control today. If access or a verified procedure is unavailable, mark containment as failed, escalate to Cloudflare support, and do not improvise DNS or routing changes.
- Freeze address, routing, deployment, and mailbox lifecycle changes.
- If a deploy caused the resolver defect, freeze further deploys and prepare a reviewed schema-compatible forward-fix. The repository has no validated rollback command or rehearsal, so do not improvise a rollback during the incident.
- Do not download raw MIME for routine diagnosis.

### Read-Only Diagnosis

Run the current route template using the current canonicalization rule: preserve local-part case and lowercase only the DNS domain. Verify the external catch-all target and DNS separately. In a restricted operator environment, use R2 HEAD for a known ingest key and inspect only bounded custom metadata such as `format-version`, `inbound-ingest-id`, `mailbox-id`, `raw-size`, `received-at`, and `envelope-to`.

The current singleton can legitimately target only its one mailbox. A second active target implies corruption, unsupported mutation, or a later schema generation and requires immediate escalation.

### Currently Supported Remediation

None for route state. There is no route disable or reassignment command and no validated deployment rollback procedure. A code regression requires a reviewed schema-compatible forward-fix; D1 route repair is unsupported.

Inbound replay is not rerouting. It applies only to a failed, replayable ingest and retains the original mailbox identity. Never replay a successful message to move it, rewrite accepted history, or compensate for wrong delivery.

### Unsupported Branch And Escalation

Do not update `mailbox_id`, `normalized_address`, `enabled`, primary identity state, or mailbox status through SQL. Keep external routing paused and escalate to security/privacy, the data owner, and application engineering. Accepted wrong-mailbox content requires disclosure handling and an explicit product/data decision; this runbook does not authorize movement or deletion.

### Verification

- Cloudflare catch-all targets the expected Backend Worker and domain readiness is healthy.
- The canonical SMTP envelope recipient resolves to the expected active mailbox.
- After containment is lifted, send one uniquely identified, non-sensitive canary.
- Confirm only bounded R2 HEAD metadata and intended mailbox appearance; do not retain its full address in the incident ticket.
- Confirm the canary did not appear in any unintended mailbox.

### Rollback Or Forward-Fix

Do not improvise rollback: no validated rollback procedure exists, and reverting code does not undo accepted data. A future route correction is a new expected-revision forward operation that preserves route history. Future assignment snapshots keep in-flight mail at the target selected at ingress, and route-only reassignment must not alter send identities. These capabilities do not exist in the current singleton.

## Read-Only D1 Templates

Use an approved read-only D1 credential or console. Bind numbered parameters through the client; never paste literal email addresses into saved queries, logs, or tickets. Record bounded results, not complete exports.

Capture D1 time first:

```sql
select cast(unixepoch('now') as integer) * 1000 as observed_at_ms;
```

### Current Owner Chain

Bindings: `?1 = mailbox_id`.

```sql
select
  m.id as mailbox_id,
  m.status as mailbox_status,
  m.version as mailbox_version,
  m.created_by_user_id as expected_owner_user_id,
  u.disabled_at as owner_disabled_at,
  mm.revoked_at as membership_revoked_at,
  rg.role_id,
  rg.scope_type,
  rg.scope_id_present,
  rg.scope_id,
  rg.expires_at as grant_expires_at,
  rg.revoked_at as grant_revoked_at
from app_mailbox as m
left join auth_user as u
  on u.id = m.created_by_user_id
left join app_mailbox_member as mm
  on mm.mailbox_id = m.id
 and mm.user_id = m.created_by_user_id
left join auth_role_grant as rg
  on rg.subject_type = 'user'
 and rg.subject_id = m.created_by_user_id
 and rg.role_id = 'owner'
 and rg.scope_type = 'mailbox'
 and rg.scope_id_present = 1
 and rg.scope_id = m.id
where m.id = ?1
limit 2;
```

The expected result is one row. A second row or multiple matching owner grants is a corruption signal.

### Recovery Readiness Aggregate

This query returns counts only and never reads addresses, code hashes, credential material, session secrets, or metadata.

Bindings: `?1 = owner_user_id`, `?2 = observed_at_ms`.

```sql
select
  (select count(*)
     from app_external_recovery_identity
    where user_id = ?1
      and status = 'verified') as verified_recovery_identities,
  (select count(*)
     from auth_recovery_code
    where user_id = ?1
      and used_at is null
      and revoked_at is null) as unused_recovery_codes,
  (select count(*)
     from auth_passkey_credential
    where user_id = ?1
      and revoked_at is null) as active_passkeys,
  (select count(*)
     from auth_user_identity
    where user_id = ?1
      and is_primary_login = 1
      and verified_at is not null
      and revoked_at is null
      and replaced_by_id is null) as active_primary_login_identities,
  (select count(*)
     from auth_session
    where user_id = ?1
      and revoked_at is null
      and expires_at > ?2) as active_sessions;
```

### Grant Inventory

This inventory is bounded to one suspected principal. `active_at_observation` uses D1 time captured above.

Bindings: `?1 = subject_type`, `?2 = subject_id`, `?3 = observed_at_ms`.

```sql
select
  grant_kind,
  subject_type,
  subject_id,
  authority_id,
  scope_type,
  scope_id_present,
  scope_id,
  expires_at,
  revoked_at,
  count(*) over () as total_rows,
  case
    when revoked_at is null
     and (expires_at is null or expires_at > ?3)
    then 1 else 0
  end as active_at_observation
from (
  select
    'role' as grant_kind,
    subject_type,
    subject_id,
    role_id as authority_id,
    scope_type,
    scope_id_present,
    scope_id,
    expires_at,
    revoked_at
  from auth_role_grant
  where subject_type = ?1
    and subject_id = ?2

  union all

  select
    'permission' as grant_kind,
    subject_type,
    subject_id,
    permission_id as authority_id,
    scope_type,
    scope_id_present,
    scope_id,
    expires_at,
    revoked_at
  from auth_permission_grant
  where subject_type = ?1
    and subject_id = ?2
)
order by grant_kind, authority_id, scope_type, scope_id
limit 100;
```

`total_rows` must be at most 100 for this result to be complete. A larger value requires reviewed pagination; do not infer absence from a truncated result.

### Role-Permission Mappings

This query expands the current role mappings that runtime authorization evaluates for the suspected principal. It does not treat definition disablement as revocation.

Bindings: `?1 = subject_type`, `?2 = subject_id`, `?3 = observed_at_ms`.

```sql
select
  rg.role_id,
  rg.scope_type as grant_scope_type,
  rg.scope_id_present,
  rg.scope_id,
  rp.permission_id,
  rp.scope_type_present as permission_scope_type_present,
  rp.scope_type as permission_scope_type,
  rg.expires_at,
  rg.revoked_at,
  count(*) over () as total_rows,
  case
    when rg.revoked_at is null
     and (rg.expires_at is null or rg.expires_at > ?3)
    then 1 else 0
  end as active_at_observation
from auth_role_grant as rg
join auth_role_permission as rp
  on rp.role_id = rg.role_id
where rg.subject_type = ?1
  and rg.subject_id = ?2
order by rg.role_id, rp.permission_id, rg.scope_type, rg.scope_id
limit 100;
```

`total_rows` must be at most 100. Compare each mapping's scope type with the requested mailbox operation; this output describes current mapping state, not historical state at an earlier incident time.

### Current Route

The address is a restricted query parameter and is intentionally absent from output.

Bindings: `?1 = normalized_envelope_recipient`.

```sql
select
  a.id as address_id,
  a.mailbox_id,
  a.enabled,
  a.is_primary,
  a.version as address_version,
  a.updated_at as address_updated_at,
  m.status as mailbox_status,
  m.deleted_at as mailbox_deleted_at,
  m.version as mailbox_version
from app_mailbox_address as a
join app_mailbox as m
  on m.id = a.mailbox_id
where a.normalized_address = ?1
limit 2;
```

The unique route index should permit at most one result.

### Administrative Audit History

Bindings: `?1 = mailbox_id`.

```sql
select
  event_id,
  operation_id,
  action,
  outcome,
  actor_type,
  actor_id,
  reason_code,
  change_type,
  resource_version_before,
  resource_version_after,
  occurred_at,
  request_id,
  correlation_id
from app_administrative_audit_event
where resource_type = 'mailbox'
  and resource_id = ?1
order by storage_id desc
limit 100;
```

## Logs, Traces, And Health

Use the existing bounded `backend.request.completed` event for route family, status, outcome, duration, request/correlation IDs, and validated Cloudflare Ray metadata. It intentionally has no actor, mailbox, recipient, raw path, query, header, or body. The `backend.email` span provides numeric raw size and a closed rejection reason when rejected; it does not identify the recipient, mailbox, or ingest. Cloudflare dependency spans may establish availability but not semantic correctness.

Do not infer that an owner, grant, or route is correct from `/api/health`, a successful generic request, or the absence of an error log. Correlate bounded telemetry with the parameterized storage checks above.

## Break-Glass Gate

Production mutation is currently refused. `SAFE-005` lacks dated live Cloudflare backup and identity-preserving restore evidence, verified maintenance controls are absent, and supported grant/route repairs do not exist.

Future production break-glass remains prohibited until all of the following are true:

1. The incident is `SEV-0` or `SEV-1`, with incident commander, security, application owner, and data owner approval.
2. Verified maintenance blocks concurrent Website and administrative writes and pauses affected inbound routing and relevant background work.
3. `SAFE-005` is complete with dated environment evidence.
4. An immutable backup covers control-plane D1, R2, and every affected MailboxDO SQLite database.
5. A dated staging restore drill proves identity-preserving restore to the same mailbox ID.
6. A fresh live pre-change backup is verified within the accepted RPO and linked to the incident.
7. A versioned repair operation is reviewed by two engineers and tested against the exact schema generation and production-shaped data.
8. The repair has exact expected-state predicates, bounded expected counts, idempotency, atomic receipt/audit behavior, verification, and a forward-fix plan.
9. A rollback decision accounts for accepted messages, Workflow state, R2 objects, outbound state, and immutable MailboxDO identity.
10. Evidence and privacy handling are approved before execution.

If any prerequisite is absent, maintain containment and ship a supported application forward-fix. This runbook intentionally provides no mutation, schema, raw MIME, or audit-injection commands.

## Evidence And Privacy

Record only:

- Incident ID, UTC timestamps, environment, deployment version, severity, and responders.
- Necessary opaque user, mailbox, operation, audit, request/correlation, and validated Ray IDs.
- Query template name, separately held parameters, bounded counts/state, and expected versus observed results.
- Supported operation receipts, Cloudflare configuration audit references, and backup/restore evidence IDs.
- Containment and verification results, monitoring interval, residual risk, and follow-up owner.

Never record or export:

- Message content, subject, raw MIME, attachments, or message headers.
- Full email addresses in tickets, logs, traces, chat, or filenames.
- Tokens, cookies, secrets, hashes, credentials, recovery codes, passkey material, or session claims.
- Raw request paths, query strings, request/response headers or bodies, full IP, user agent, or referer.
- Unfiltered rows, generic metadata/event JSON, authentication event JSON, or sensitive `request_key` values.
- Complete D1, R2, or MailboxDO dumps as an incident attachment.

Use R2 HEAD only in a restricted operator environment for routine routing diagnosis. Any access to raw message bytes requires a separate privacy/legal approval and is outside this runbook.

## Exercise And Review

`SAFE-010` remains open until a dated staging exercise records expected and observed state for owner recovery, bad-grant detection, bad-route detection, containment, bounded telemetry, and refusal of break-glass while prerequisites are absent. Review this runbook whenever owner, grant, route, organization, maintenance, backup, audit, or observability contracts change.
