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
3. Confirm the zone is in the intended Cloudflare account and inspect the current zone-wide Email Routing enabled state, Routing status, catch-all enabled state/action, and every existing custom rule.
4. Understand the ownership boundary before continuing: Alchemy's `Email.Routing` and `Email.CatchAll` providers silently manage/adopt existing per-zone shared singletons without `--adopt`. Deployment assumes management ownership and can mutate zone-wide Routing or disable/change the existing catch-all. `--adopt` does not protect these singleton resources.
5. Require the reviewed baseline to be Routing suitable for commissioning and catch-all exactly disabled with drop action. After recording content-free inventory evidence, set `JOB_MAIL_SHARED_ROUTING_STATE_CONFIRMED=disabled-drop-reviewed`. Never infer or prefill this acknowledgement.
6. Run the dry-run only after that acknowledgement. Compare it to the manual dashboard inventory. Stop if it proposes an unexplained shared-state mutation, deletion/replacement, another mail route change, or unrelated DNS.
7. Destroy and stack contraction are forbidden because singleton restoration/deletion semantics can mutate shared zone-wide mail state. Never delete and recreate DNS or routing to simplify state ownership.

## Gmail Destination Verification

Cloudflare destination-address verification is manual and account-level. This stack intentionally does not declare `Cloudflare.Email.Address`, so deploy and destroy cannot provision or remove the Gmail destination.

1. In the Cloudflare Email Routing dashboard, add `<verified-external-gmail-archive-address>` as a destination.
2. Complete the verification link while signed into the intended Gmail account.
3. Explicitly confirm the dashboard reports the destination as verified. Record only status and timestamp, not the address.

## Core Resource Deploy

1. Pin and record the reviewed release commit. Ensure the tracked and untracked worktree is clean and `.env.production` corresponds to it.
2. Run `bun run release:check`, then `bun run config:production`. The production wrapper constructs a scrubbed child environment containing only exact parsed file values plus the reviewed executable/profile/Cloudflare-auth allowlist; inherited application values and all `ALCHEMY_DEV`/`ALCHEMY_STATE` representations are absent.
3. Run `bun run deploy:production:dry-run`. The wrapper invokes Alchemy as `deploy --stage production --env-file .env.production --dry-run`; it cannot use ambient values to complete a missing file key.
4. Review that the plan contains the production Website custom domain, private Backend, D1, R2, Durable Objects, Workflows, restricted send bindings, Email Routing, disabled/drop catch-all, and one exact literal inbound Worker rule with `enabled=false`. Confirm no Gmail Address or SendingSubdomain resource exists.
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

1. Reconfirm Website health/startup, Email Routing ready, exact disabled route, disabled/drop catch-all, Gmail destination verification, manual apex Email Sending ready, sender bindings, provider DNS, and exactly one effective DMARC policy at `p=none`.
2. Keep the exact same pinned release commit and clean worktree used for commissioning. Any source, resource, dependency, generated output, build input, staged, unstaged, untracked, or HEAD drift blocks activation.
3. Change only ignored `.env.production` from `JOB_MAIL_INBOUND_ROUTE_ENABLED=false` to `JOB_MAIL_INBOUND_ROUTE_ENABLED=true`; every other operator input remains byte-for-byte unchanged.
4. Run `bun run release:check`, `bun run config:production`, then `bun run deploy:production:dry-run`.
5. Verify the plan changes only the exact inbound rule enabled state. Any resource, source, or Worker/build drift blocks activation. Run `bun run deploy:production` interactively.
6. Explicitly recheck the exact rule is enabled and the catch-all remains disabled/drop before beginning content-free live acceptance.

## Rollback And Forward Fix

- There is no production destroy command. Never use `alchemy destroy`, contract the production stack, or manually tear it down as rollback; shared Routing/CatchAll ownership makes those operations zone-wide hazards.
- For inbound containment, set `JOB_MAIL_INBOUND_ROUTE_ENABLED=false`, run release check and dry-run, review an enabled-state-only change, then deploy interactively.
- For Website/application regressions, forward-fix from the last reviewed release or deploy a reviewed corrective commit. Preserve D1, R2, Durable Objects, Workflows, DNS ownership, and manual verification state.
- For sending incidents, disable application sending through the reviewed operational control/provider dashboard while preserving records and evidence; do not remove apex onboarding records as a first response.
- If the outcome is ambiguous, stop retries, inspect Alchemy state and Cloudflare status, reconcile the observed graph, and escalate. Do not destroy/recreate resources.

## Evidence Record

Record release commit, stage (`production`), command/gate outcomes, reviewed plan digest, resource/status booleans, DNS inventory digest, Routing/Sending readiness timestamps, catch-all disabled check, exact route disabled/activated checks, sender-restriction checks, rollback decision, and reviewer identities. Never record private owner/archive addresses, secret material, message headers, bodies, attachment names/bytes, cookies, or verification links.
