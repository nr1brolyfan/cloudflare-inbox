# Job Mail Production Deployment

This runbook prepares and commissions `mail.szymondlugolecki.com` and the exact inbound route `szymon@szymondlugolecki.com`. It does not authorize destructive stack operations. Keep all evidence content-free: record timestamps, release commit, resource identifiers/statuses, boolean checks, DNS record types/names, and test outcomes, but never addresses marked as private, message content, credentials, tokens, or secret values.

## Operator Inputs

Create the ignored `.env.production` from `.env.production.example`. Supply these private inputs only in that file or the relevant manual dashboard form:

- `MAILBOX_BOOTSTRAP_OWNER_EMAIL_ALLOWLIST=["<external-owner-address>"]`: exactly one canonical external owner identity.
- `MAILBOX_ARCHIVE_RECIPIENT=<verified-external-gmail-archive-address>`: exactly one canonical external Gmail archive destination.
- `AUTH_SESSION_SECRET=<43-character-base64url-secret-1>`
- `AUTH_CHALLENGE_SECRET=<43-character-base64url-secret-2>`
- `AUTH_PRIVACY_SECRET=<43-character-base64url-secret-3>`
- Cloudflare account/profile credentials with scoped access to the existing `<cloudflare-account>` and `szymondlugolecki.com` zone.
- Gmail access for manually verifying `<verified-external-gmail-archive-address>`.
- `JOB_MAIL_SHARED_ROUTING_STATE_CONFIRMED=disabled-drop-reviewed`, entered only after the mandatory zone-wide routing inventory and disabled/drop state review below.

The three secrets must be independently generated, distinct, canonical unpadded base64url encodings of exactly 32 bytes. Keep these fixed public commissioning values unchanged:

```dotenv
PUBLIC_ORIGIN=https://mail.szymondlugolecki.com
AUTH_EMAIL_FROM=auth@szymondlugolecki.com
MAILBOX_INITIAL_ADDRESS=szymon@szymondlugolecki.com
JOB_MAIL_INBOUND_ROUTE_ENABLED=false
```

`MAILBOX_ARCHIVE_RECIPIENT` must have the exact canonical domain `gmail.com`; aliases at any other domain are rejected. Ownership verification remains a live manual check.

Run `bun run config:production`; success prints only `production-config ok`, while failure deliberately gives no private value or detailed cause. This command reads only `.env.production`: duplicate keys, malformed lines, unexpected keys, `ALCHEMY_DEV`, `ALCHEMY_STATE`, and missing required keys fail before application preflight, and inherited application values are ignored. Run `bun run release:check` only from the pinned clean release commit. It records HEAD, rejects staged, unstaged, or untracked files, runs check/typecheck/full tests/restore/build/diff checks, and rechecks HEAD and cleanliness.

## DNS Inventory And Shared Ownership

1. Export a content-free inventory of every existing DNS record for `szymondlugolecki.com`, including type, owner/name, TTL/proxy state, provider/lock ownership, and a digest of values where values are sensitive.
2. Identify existing Website hostname records, Email Routing MX records, SPF TXT records, DKIM selectors, DMARC, verification records, and provider-locked records. Do not create a duplicate SPF or DMARC record.
3. Confirm the zone is in the intended Cloudflare account and inspect the current zone-wide Email Routing enabled state, Routing status, catch-all enabled state/action, and every existing custom rule. Enable Email Routing manually and require status `ready` before deployment; the scoped API token can manage rules but Cloudflare's legacy settings endpoint does not accept it.
4. Understand the ownership boundary before continuing: the stack deliberately does not declare `Email.Routing`, so it cannot enable, disable, adopt, or restore that zone-wide setting. Alchemy's `Email.CatchAll` provider does manage/adopt the existing per-zone catch-all singleton without `--adopt` and can disable/change it. `--adopt` does not protect this singleton resource.
5. Require the reviewed baseline to be Routing suitable for commissioning and catch-all exactly disabled with drop action. After recording content-free inventory evidence, set `JOB_MAIL_SHARED_ROUTING_STATE_CONFIRMED=disabled-drop-reviewed`. Never infer or prefill this acknowledgement.
6. Run the dry-run only after that acknowledgement. Compare it to the manual dashboard inventory. Stop if it proposes an unexplained shared-state mutation, deletion/replacement, another mail route change, or unrelated DNS.
7. Destroy and stack contraction are forbidden because singleton restoration/deletion semantics can mutate shared zone-wide mail state. Never delete and recreate DNS or routing to simplify state ownership.
8. This launch assumes `JobMailRouting` was never deployed into production Alchemy state. Before the first plan, run `bun run state:production`; the exact required result is `(no resources in CloudflareInbox/production)`. Also confirm the account inventory contains no production CloudflareInbox Website, Backend, D1, R2, Workflow, AI Gateway, or exact mail rule. Any listed state resource, prior production resource, or `JobMailRouting` entry is a mandatory stop: do not let a plan contract or delete it, and reconcile state under independent review first. The inspection command uses a graph-free stack facade so it cannot evaluate or reconcile application resources.

After a partial apply, the first-deploy empty-state requirement no longer applies. Stop automatic retries and reconcile the exact persisted state with live account inventory. Require D1 ledger/integrity evidence, exact credential-principal verification, and a reviewed dry-run containing no delete or replace before a forward-fix retry. Preserve every created resource and never clear `creating` state manually. The 2026-07-27 launch recovery uses the pinned Alchemy patch for trigger-safe, per-migration D1 import/ingest with the ledger insert appended to the same import and the fixed `job-mail-production` env-token profile; removing either blocks retry.

## Gmail Destination Verification

Cloudflare destination-address verification is manual and account-level. This stack intentionally does not declare `Cloudflare.Email.Address`, so deploy and destroy cannot provision or remove the Gmail destination.

1. In the Cloudflare Email Routing dashboard, add `<verified-external-gmail-archive-address>` as a destination.
2. Complete the verification link while signed into the intended Gmail account.
3. Explicitly confirm the dashboard reports the destination as verified. Record only status and timestamp, not the address.

## Core Resource Deploy

1. Pin and record the reviewed release commit. Ensure the tracked and untracked worktree is clean and `.env.production` corresponds to it.
2. Run `bun run release:check`, then `bun run config:production`. The production wrapper constructs a scrubbed child environment containing only exact parsed file values plus the reviewed executable/profile/Cloudflare-auth allowlist; inherited application values and all `ALCHEMY_DEV`/`ALCHEMY_STATE` representations are absent.
3. Run `bun run deploy:production:dry-run`. The wrapper invokes Alchemy as `deploy --stage production --env-file .env.production --dry-run`; it cannot use ambient values to complete a missing file key.
4. Review that the plan contains the production Website custom domain, private Backend, D1, R2, Durable Objects, Workflows, restricted send bindings, disabled/drop catch-all, and one exact literal inbound Worker rule with `enabled=false`. Confirm no Email Routing settings singleton, Gmail Address, or SendingSubdomain resource exists.
5. Run `bun run deploy:production`. It reruns release preflight and remains interactive; do not add `--yes`.
6. Treat this only as an uncommissioned core-resource deploy. Do not change `JOB_MAIL_INBOUND_ROUTE_ENABLED` and do not call the system commissioned until the mandatory manual apex Email Sending and exact `p=none` DMARC checks pass.

Alchemy does not fail the deployment merely because Email Routing or Email Sending remains non-ready. After deployment, explicitly check in Cloudflare:

- Email Routing status is `ready`, not `unconfigured`, `misconfigured`, `misconfigured/locked`, or `unlocked`.
- Provider-generated Email Routing DNS records are present and healthy.
- Catch-all is disabled and its configured action is drop.
- Exactly one literal `to` rule exists for `szymon@szymondlugolecki.com`, targets the deployed Backend Worker name, and is disabled.
- No unexpected forwarding, catch-all, or wildcard rule is enabled.
- `mail.szymondlugolecki.com` resolves to and serves the production Website; Backend has no `workers.dev` URL.

Stop commissioning if any status or exact-rule check fails. Do not activate inbound delivery to test around a non-ready state.

## Manual Apex Email Sending

Installed Alchemy supports `SendingSubdomain` only. The required sender is apex `szymon@szymondlugolecki.com`, so Email Sending onboarding and provider records are intentionally manual.

1. In Cloudflare, start Email Sending onboarding for the apex sender/domain using the dashboard-supported flow.
2. Inventory provider-generated SPF, DKIM, ownership, and other records before applying them. Adopt or preserve provider-managed records; do not duplicate a locked record.
3. Maintain one syntactically valid SPF policy for the owner name. Merge reviewed provider requirements rather than publishing a second SPF TXT record.
4. Require exactly one effective `_dmarc` policy in reporting mode `p=none` with reviewed aggregate-reporting settings before commissioning or activation. Missing DMARC, duplicate records, a provider-locked record that cannot be confirmed exactly `p=none`, or any stricter policy is a mandatory stop condition. Do not overwrite a locked record; resolve ownership first. Tighten policy only after live SPF/DKIM/DMARC evidence.
5. Explicitly confirm the Email Sending dashboard status is ready/verified. A successful Alchemy deployment is not evidence of sending readiness.
6. Confirm Worker binding restrictions allow AuthEmail to send only from `auth@szymondlugolecki.com` and MailboxEmail only from `szymon@szymondlugolecki.com`.

## Activation

Activation is forbidden until the following commissioning sequence has completed in order. Do not parallelize or reorder account-security and mailbox steps.

1. Deploy the reviewed core graph with `JOB_MAIL_INBOUND_ROUTE_ENABLED=false` as described above. Recheck the exact route is disabled and catch-all is disabled/drop. Stop if either check differs.
2. Run the exact startup/readiness probe:

   ```sh
   curl --fail-with-body --silent --show-error \
     https://mail.szymondlugolecki.com/api/health \
     --output /tmp/job-mail-production-health.json
   bun -e 'const h=await Bun.file("/tmp/job-mail-production-health.json").json();const expected=["authRateLimit","authorization","controlPlane","mailboxDataPlane","rawMessages"];const keys=Object.keys(h.storage??{}).sort();if(h.service!=="backend"||h.status!=="ok"||keys.length!==expected.length||keys.some((key,index)=>key!==expected[index])||Object.values(h.storage).some((value)=>value!=="ok"))process.exit(1)'
   ```

   A successful response proves the Website-to-Backend request crossed required Backend startup and all five bounded storage probes. Stop on transport failure, non-JSON, any non-`ok` value, unexpected/missing storage keys, startup/reconciliation errors in Workers Logs, or config/deployment disagreement. Do not retry around a deterministic startup failure.

3. In the private first-owner UI, complete the first-owner password enrollment for the exact allowlisted signed-in actor and perform the required recent password step-up. Stop on any actor, allowlist, session, receipt, or replay disagreement.
4. Enroll and verify the external recovery identity. Open the verification link through the intended external account, return to a fresh unrestricted session, and stop unless the UI and subsequent protected operation both accept the verified recovery state.
5. Enroll two separate UV passkeys. Independently test each authenticator in a fresh authentication/step-up ceremony before continuing; do not count two records backed by one untested authenticator or a non-UV ceremony. Stop if either independent test fails or either credential is revoked.
6. Generate one current set of exactly ten recovery codes. While the plaintext is still shown in that browser session, save it to the approved offline store and click `I saved these codes` for that exact generation. Any retry, replacement, receipt-only result, reload, remount, or lost plaintext invalidates the acknowledgement; generate and save a fresh set instead.
7. Create mailbox `primary` only after the exact-generation acknowledgement enables the final action and the server accepts its atomic readiness recheck. The browser sends that generation's rotation operation ID only as expected state; the server compares it to the current actor-bound rotation receipt/set, so a rotation from another tab makes the acknowledgement stale and requires saving and acknowledging the newly shown plaintext generation. Stop on `Security setup required`, conflict without an exact receipt replay, or any ambiguous result until receipt readback is reconciled.
8. Open the created mailbox and verify the displayed primary address is exactly `szymon@szymondlugolecki.com`. Exercise the primary mailbox Durable Object through the authenticated inbox read, then rerun both exact health commands from step 2 and require every result to remain `ok`. Stop on address disagreement, primary mailbox/DO failure, degraded health, or startup/log errors.
9. Reconfirm Email Routing ready, exact disabled route, disabled/drop catch-all, Gmail destination verification, manual apex Email Sending ready, sender bindings, provider DNS, and exactly one effective DMARC policy at `p=none`.
10. Keep the exact same pinned release commit and clean worktree used for commissioning. Any source, resource, dependency, generated output, build input, staged, unstaged, untracked, or HEAD drift blocks activation.
11. Change only ignored `.env.production` from `JOB_MAIL_INBOUND_ROUTE_ENABLED=false` to `JOB_MAIL_INBOUND_ROUTE_ENABLED=true`; every other operator input remains byte-for-byte unchanged.
12. Run `bun run release:check`, `bun run config:production`, then `bun run deploy:production:dry-run`.
13. Verify the activation dry-run changes only the exact inbound rule enabled state. Any resource, source, Worker/build, mailbox, or security-state drift blocks activation. Run `bun run deploy:production` interactively.
14. Explicitly recheck the exact rule is enabled and the catch-all remains disabled/drop before beginning content-free live acceptance.

## Rollback And Forward Fix

- There is no production destroy command. Never use `alchemy destroy`, contract the production stack, or manually tear it down as rollback; catch-all singleton ownership and retained application data make those operations unsafe. The manually managed Email Routing setting must not be disabled as application rollback.
- For inbound containment, set `JOB_MAIL_INBOUND_ROUTE_ENABLED=false`, run release check and dry-run, review an enabled-state-only change, then deploy interactively.
- For Website/application regressions, forward-fix from the last reviewed release or deploy a reviewed corrective commit. Preserve D1, R2, Durable Objects, Workflows, DNS ownership, and manual verification state.
- For sending incidents, disable application sending through the reviewed operational control/provider dashboard while preserving records and evidence; do not remove apex onboarding records as a first response.
- If the outcome is ambiguous, stop retries, inspect Alchemy state and Cloudflare status, reconcile the observed graph, and escalate. Do not destroy/recreate resources.

## Evidence Record

Record release commit, stage (`production`), command/gate outcomes, reviewed plan digest, resource/status booleans, DNS inventory digest, Routing/Sending readiness timestamps, catch-all disabled check, exact route disabled/activated checks, sender-restriction checks, rollback decision, and reviewer identities. Never record private owner/archive addresses, secret material, message headers, bodies, attachment names/bytes, cookies, or verification links.

| Mandatory evidence | Content-free record |
| --- | --- |
| Disabled core deployment | release commit, plan digest, deploy timestamp, exact-route-disabled and catch-all-disabled/drop booleans |
| Startup and initial health | both command exit statuses, probe timestamp, Backend `ok`, five storage `ok` booleans, startup-log review boolean |
| First-owner password | completion timestamp, exact-actor-match boolean, receipt/replay outcome without user or credential IDs |
| External recovery | verification timestamp and verified/active boolean without address or identity ID |
| UV passkey 1 | enrollment timestamp and independent UV authentication result without credential ID |
| UV passkey 2 | enrollment timestamp and independent UV authentication result without credential ID |
| Recovery codes | generated-count-is-ten boolean, exact-generation browser acknowledgement timestamp, approved-offline-store boolean; never record codes or set/operation IDs |
| Primary creation | completion/readback outcome, mailbox-is-primary boolean, exact-public-address-match boolean |
| Primary DO and post-create health | authenticated primary inbox-read outcome, repeated health command exits, Backend/five-storage `ok` booleans |
| Activation review | Routing/Sending/DMARC/binding booleans and activation dry-run digest showing enabled-state-only change |
| Activated route | deploy timestamp, exact-route-enabled and catch-all-still-disabled/drop booleans |
