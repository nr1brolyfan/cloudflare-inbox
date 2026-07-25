# Mailbox Backup And Identity-Preserving Restore

- Owner: Product owner and engineering
- Last reviewed: 2026-07-24
- Scope: `SAFE-005` live backup/restore gate and completed `SAFE-015` local restore rehearsal
- Status: Local rehearsal implemented; live restore is unsupported and not authorized until `SAFE-005` is complete

## Operating Boundary

This runbook records what the local rehearsal proves and the required order for a future live operation. It does not authorize a production backup, restore, direct data mutation, provider resend, or destructive migration. No live Cloudflare backup or restore was exercised, and no backup bucket is implemented by this document or the current repository.

Run the local rehearsal with:

```bash
bun run test:mailbox-restore
```

The test proves, on local Linux:

- An independent capture-time `node:sqlite` backup is the restore source. The live source can mutate, close, and be deleted after capture without changing the restored result.
- Restore is accepted only for the same exact mailbox ID.
- All 15 authoritative MailboxDO tables are preserved: `mailbox_metadata`, `folder`, `message`, `attachment`, `label`, `message_label`, `draft`, `draft_attachment`, `filter_rule`, `inbound_processing`, `rule_evaluation`, `rule_application`, `async_rule_job`, `mailbox_operation`, and `outbound_delivery`.
- Migration history, the complete SQLite schema, integrity and foreign-key checks, and FTS contents and repair are verified.
- Outbound fixtures cover all eight states: `scheduled`, `sending`, `accepted`, `delivered`, `failed`, `bounced`, `cancelled`, and `indeterminate`.
- Raw MIME, inbound attachment, and draft/outbound attachment blobs are restored with exact bytes and metadata.
- MailboxDO v14 backup and restore retains the private nullable outbound archive-recipient snapshot exactly; evidence and operator output contain only digests and counts, never the address.
- Production object-key and metadata builders and production blob readers verify the restored objects.
- SQLite-derived object closure includes authoritative objects and recognized mailbox-scoped in-flight orphans. Missing, unmanifested, foreign-mailbox, non-canonical, or inconsistent objects fail closed.
- Canonical row, schema, object-byte, and object-metadata checksums bind a closed, unique, sorted manifest to the archive.
- Snapshot, manifest, byte, metadata, missing-object, and foreign-object tampering is rejected.
- Injected partial writes leave SQLite unpublished; an idempotent retry verifies existing exact objects and completes the restore.
- SQLite publication is no-clobber and does not remove or replace a concurrent target.
- Returned evidence is a bounded, sanitized record of counts, hashes, schema version, outcome, mode, and limitations.

## Evidence Limitations

The local evidence has these exact boundaries:

- `mode=local-rehearsal`.
- Cloudflare was not exercised.
- Object storage is an in-memory analog.
- Durable Object alarm state is not captured and requires reconciliation.
- Workflow state is not captured and requires reconciliation.
- The manifest self-digest detects accidental or tested mutation but is not authenticity.
- Same-filesystem hard-link publication is a Linux local analog, not evidence of Cloudflare Durable Object restore semantics.

The rehearsal does not establish live RPO, live RTO, Cloudflare D1 or Durable Object point-in-time recovery behavior, R2 retention behavior, archive immutability, operator access, maintenance effectiveness, or recovery under a dated staging deployment.

## State Inventory

A complete live recovery set must inventory and bind one cutoff across all of the following:

| State | Required coverage | Identity or closure check |
| --- | --- | --- |
| D1 control plane | Mailbox registry, addresses/routes, discovery membership, authorization grants, preferences, receipts, audit, auth state, schema, and migration history | The registry mailbox ID and every mailbox reference remain unchanged; D1 is restored last |
| Every `MailboxDO` | Independent SQLite state for every mailbox, including the 15 authoritative tables, migration history, schema, indexes, triggers, and FTS | Resolve the object with `getByName(mailboxId)`; `state.id.name`, requested mailbox ID, and `mailbox_metadata.mailbox_id` must be the same exact value |
| R2 data plane | Raw MIME, inbound attachments, draft/outbound attachments, required metadata, and recognized mailbox-scoped in-flight objects | Object keys and R2 custom metadata must identify the same mailbox and satisfy closure derived from the restored SQLite state |
| Durable Object alarms | Alarm schedule and the outbound work it represents | Not captured by the local archive; inspect and reconcile before traffic resumes |
| Cloudflare Workflows | Inbound and asynchronous-rule instances and checkpoints at the cutoff | Not captured by the local archive; inspect and reconcile before traffic resumes |

Mailbox identity is immutable throughout backup and restore. Never create a replacement mailbox ID, map an archive to a new named object, or rewrite R2 ownership metadata to make a mismatch pass. For each mailbox, the following invariant is mandatory:

```text
getByName(mailboxId)
  == Durable Object whose state.id.name is mailboxId
  == SQLite whose mailbox_metadata.mailbox_id is mailboxId
  == R2 objects whose mailbox-id metadata is mailboxId
```

Store only a cryptographic hash of the mailbox ID in ordinary evidence. Keep the actual identifier and restricted archive mapping in the approved recovery environment.

## Durable Decisions And Blockers

The accepted recovery objectives are:

- RPO: 24 hours.
- RTO: 4 hours.
- Backup retention: 35 days.

The required archive design is a separate private Cloudflare-only R2 archive with retention lock, encryption, separate least-privilege credentials, and a writer that has no delete permission. This is a durable design decision, not a claim that the archive bucket, credentials, policy, or writer has been implemented.

Cloudflare Durable Object and D1 point-in-time recovery with a maximum 30-day window is insufficient by itself for the 35-day retention goal. An immutable logical export/archive covering D1, every named MailboxDO, and the complete R2 closure is therefore required in addition to any platform recovery bookmarks.

`SAFE-005` remains blocked because the repository has no live Cloudflare credentials for this operation, verified maintenance controls, supported Durable Object export/import procedure, implemented backup archive, or dated staging backup and identity-preserving restore drill. The local `SAFE-015` rehearsal does not satisfy those requirements.

## Live Backup Required Order

No repository command or supported Cloudflare API for this sequence is documented yet. Use only reviewed controls that exist at execution time; do not infer commands from this runbook.

1. Open an approved change or incident record. Record operators, approvals, nonsecret account and deployment identifiers, UTC start time, objectives, and the exact scope.
2. Enter verified maintenance. Quiesce Website and administrative writes, inbound admission, outbound scheduling and dispatch, Durable Object alarms, and creation of new Workflows. Drain or classify already-started inbound, outbound, alarm, and Workflow work.
3. Stop if any write path remains open, if quiescence cannot be demonstrated, or if maintenance cannot be held for the complete capture.
4. Establish one UTC cutoff and platform bookmark where supported. Record expected D1, MailboxDO, R2, alarm, and Workflow state at that cutoff.
5. Capture D1, then independently capture every registry mailbox's named MailboxDO SQLite state. Record bounded counts and digests; do not skip an unreachable mailbox.
6. Build the immutable R2 archive from SQLite-derived object closure plus explicitly classified mailbox-scoped in-flight objects. Preserve exact bytes, keys, HTTP metadata, and custom metadata.
7. Seal and verify the manifest, archive completeness, retention policy, encryption, and readback before considering the backup successful.
8. Stop and keep maintenance active on any identity mismatch, missing mailbox, missing or foreign object, checksum mismatch, incomplete in-flight classification, failed archive readback, retention failure, or elapsed RPO/RTO threshold. A partial archive is not a backup.

## Live Restore Required Order

Live restore is unsupported and unauthorized until `SAFE-005` has dated staging evidence and all controls above exist.

1. Keep maintenance and all quiescence controls active. Record the selected immutable archive, cutoff, bookmarks, expected state, and an undo bookmark if the platform supports one.
2. Validate manifest authenticity through the future approved mechanism, archive retention/readback, schema compatibility, every mailbox ID hash, checksums, object closure, and the expected D1/MailboxDO inventory before writing any target.
3. Restore R2 objects first with exact keys, bytes, HTTP metadata, and custom metadata. Use no-clobber semantics unless a separately reviewed restore design defines and verifies an exact existing object.
4. Restore each mailbox only to the same named Durable Object selected by `getByName(mailboxId)`. Verify `state.id.name` and `mailbox_metadata.mailbox_id` before and after import. Never restore into a newly generated mailbox identity.
5. Restore D1 last, only after every required R2 object and every named MailboxDO has passed structural and identity verification.
6. Perform semantic verification: schema and migration history, integrity and foreign keys, all authoritative table counts and digests, FTS behavior, folder/message/rule/draft relationships, all outbound states, production-reader access to blobs, control-plane ancestry, and cross-store identity and closure.
7. Reconcile Durable Object alarms and Workflow state against the cutoff. Classify every interrupted item as completed, safely retryable, failed, or indeterminate before enabling background work.
8. Never ask the email provider to resend as a restore mechanism. Never automatically resubmit outbound work that reached `sending`; reconcile it as an indeterminate provider outcome unless authoritative provider evidence proves a terminal state.
9. Monitor the restored system under maintenance using bounded semantic checks and platform health signals. Do not use generic health alone as proof of data correctness.
10. Unfreeze background work, outbound, inbound, administrative writes, and Website writes only after expected-versus-observed evidence is approved. Resume in a reviewed order with continued monitoring.

Stop immediately and preserve maintenance if any archive, identity, count, digest, closure, semantic, alarm, Workflow, or provider-state check differs from expectation. Do not continue to D1 restore or traffic enablement to compensate for an earlier failed layer.

## Evidence Template

Create one restricted evidence record for backup and one for restore. Record expected and observed values separately; never replace an expectation with the observed result after execution.

| Field | Expected | Observed |
| --- | --- | --- |
| Operation and approval | Change/incident ID, approvers, operator roles | IDs and roles only |
| Time | Planned UTC start, cutoff, completion, RPO and RTO limits | Actual UTC start, cutoff, per-phase timestamps, completion, measured age and duration |
| Environment | Environment, nonsecret Cloudflare account ID/name, deployment version | Exact nonsecret environment/account/deployment observed |
| Archive | Archive ID, retention-until time, encryption and lock policy | Readback result and policy references; no credentials or object contents |
| Source and target identity | Same source/target mailbox ID hash for every mailbox | Source hash, target hash, `state.id.name` check, `mailbox_metadata.mailbox_id` check, and R2 metadata check |
| Cutoff and bookmarks | One cutoff; D1/DO bookmarks where supported | Actual cutoff and opaque bookmark references |
| D1 | Schema/migration versions, bounded table counts and digests | Observed versions, counts, digests, integrity, and foreign-key result |
| MailboxDO | Complete mailbox inventory; schema/migration versions; authoritative counts/digests; FTS checks | Per-mailbox bounded results and same-ID outcome |
| R2 closure | Expected required, in-flight, total object counts and aggregate byte/metadata digests | Observed counts, digests, missing/foreign/unmanifested count, and production-reader result |
| Alarm reconciliation | Expected alarm/work item state at cutoff | Recreated, cancelled, completed, failed, or indeterminate counts and decision references |
| Workflow reconciliation | Expected instance/checkpoint state at cutoff | Completed, resumed, safely retried, failed, or indeterminate counts and decision references |
| Outbound | Expected terminal and nonterminal counts; no provider resend | Observed counts, provider evidence references, and every `sending`/unknown outcome classified as indeterminate unless proven otherwise |
| Verification and monitoring | Semantic checks, canary plan, monitoring interval, abort thresholds | Expected-versus-observed checks, sanitized signals, interval, incidents, and final approval |
| Rollback or forward recovery | Decision points and target state | Action taken; undo bookmark only if platform-supported and actually captured |

The local rehearsal evidence may contain only `mode=local-rehearsal`, schema version, restore outcome, bounded object and authoritative-row counts, mailbox ID hash, manifest/row digests, orphan count, and the explicit limitations. It is not a live evidence record.

## Failure Policy

- Fail closed before publication or traffic enablement on any unknown or mismatched state.
- Preserve the source archive, evidence, cutoff, bookmarks, and foreign/concurrent target unchanged for investigation.
- Do not clobber an existing object or Durable Object database merely because its identity matches. Verify exact expected state or stop.
- Treat a partial write as an incomplete operation. Remove only artifacts proven to be owned by that operation, retain successfully written exact immutable objects, and retry idempotently under a new reviewed attempt record.
- If D1 has not been restored, keep it unchanged and repair or restart the earlier R2/MailboxDO phase.
- If D1 has been restored, keep maintenance active. Use a platform-supported undo bookmark only if it was captured, verified, and approved; otherwise perform a reviewed forward recovery. Never invent rollback commands during an incident.
- Escalate an RPO/RTO breach, unavailable mailbox, archive-integrity failure, unresolved `sending` outcome, or failed reconciliation to the incident commander, application owner, security/privacy owner, and Cloudflare support as appropriate.

## Privacy

The manifest and archive contain or can reveal message bodies, raw MIME, attachments, email addresses, mailbox metadata, routing metadata, and operational history. Treat both as production message content, not as ordinary test output.

- Keep archives and manifests only in the approved private recovery boundary with least-privilege access, encryption, retention lock, and access audit.
- Never log archive bytes, manifest entries, object keys, addresses, subjects, headers, bodies, attachment names, R2 metadata, mailbox IDs, credentials, bookmarks, or provider payloads.
- Evidence outside the restricted recovery boundary must use bounded counts, closed outcomes, nonsecret deployment/account references, and cryptographic mailbox-ID and aggregate-state hashes.
- Do not attach D1, MailboxDO, R2, manifest, or Workflow exports to tickets or chat. Reference their restricted evidence IDs instead.

## Review Gate

`SAFE-015` is complete only for the local rehearsal described above. `SAFE-005` remains open and is the live gate. Review this runbook whenever MailboxDO schema, R2 keys or metadata, Workflow/alarm behavior, Cloudflare recovery support, retention objectives, maintenance controls, or reconciliation contracts change.
