# ADR 0003: Authentication and mailbox authorization

- Status: Accepted
- Date: 2026-07-22
- Last updated: 2026-07-24
- Owners: Product owner and engineering

## Context

A business address may route to a shared mailbox. If that address is also accepted as a magic-link, OTP, verification, or recovery proof, every reader of the shared mailbox could impersonate its nominal owner.

The product also needs predictable mailbox roles. Folder-level access would make navigation, effective-access review, and offboarding substantially more complex without being required for the first company use cases.

## Decision

### Authentication

- Authentication identities are independent from hosted business addresses.
- A shared-routed address can never be standalone proof for magic link, OTP, verification, or recovery.
- Having another factor does not make a shared magic link safe; the safe factor replaces email proof instead of re-enabling it.
- The target employee authentication model is passkey-first with recovery codes and a separately verified external recovery identity.
- SSO may be added later.
- Invitation acceptance, identity enrollment, login/recovery initiation, and address transfer must all enforce the recovery-safe identity policy.

SAFE-001 retains five-minute password reauthentication for the existing owner bootstrap while purpose-bound passkey step-up provides the passwordless path. Recovery-code issuance requires the same recent non-recovery evidence plus verified external recovery; replacement, hash-only persistence, and metadata-only audit are atomic, while plaintext is returned once. A basic session cannot enroll its own step-up factor, and password reset is limited to accounts with an existing active password credential. The reusable `control-plane-sensitive` policy version 1 accepts a recent password, TOTP, or user-verified passkey, rejects email OTP, magic link, recovery code, stale evidence, future evidence, and sessions with active requirements, and rechecks the evidence and session expiry against SQLite execution time in the D1 mutation batch. Authentication-event schema versioning remains separate from policy versioning. Future ownership, domain, address, grant, and transfer operations must use the same policy boundary.

SAFE-002 uses the configured public-origin hostname as RP ID, requires exact origin, discoverable credentials and user verification, and disables attestation. Public enrollment requires an unrestricted session, independently established recent authentication, and a verified external recovery identity. Enrollment start and finish carry one caller-generated operation ID bound into challenge metadata. Finish computes a privacy-keyed digest of the full recursively canonicalized decoded browser credential before receipt lookup. Only a receipt matching actor, mode, challenge, proof, and client intent may bypass fresh prerequisites and rate limiting; the verifier then computes a separate digest over all persisted verified fields before replay is returned. Fresh mutation runs prerequisites and rate limiting before verification, then atomically consumes the exact challenge, inserts the credential, metadata-only audit, and immutable privacy-safe dual-digest receipt. Normal replay and authenticated `no-store` POST readback return only that receipt, and readback requires the original operation, challenge, and browser credential. Discoverable sign-in accepts no caller-selected identity or metadata and requires an active user plus verified recovery before normal AuthFlow completion. Step-up binds the challenge purpose to the current session ID, token-generation hash, and policy version before rotating the session with UV passkey evidence. Credential inventory exposes only an opaque application record ID and safe timestamps. Revocation rechecks the token-bound session, recent step-up, verified recovery, target state, and the existence of another active passkey in the same atomic batch as the credential update, immutable operation receipt, and metadata-only audit event.

Public account recovery is implemented as two independent proofs: a short-lived link sent to the verified external recovery identity and one unused recovery code. Atomic consumption rechecks the exact verification row, recovery identity ID/version, active user, and code, then creates a 15-minute session with the exact capability list `["second-passkey"]` and the `recovery_remediation` requirement. Overbroad, unrelated, empty, and unrestricted sessions are denied before remediation handlers; normal application routes and core session-management operations also reject this restricted session. The remediation ceremony binds its challenge to the restricted session, token generation, exact recovery identity, caller operation ID, and an HMAC of an independent browser-held readback secret. Its final D1 batch installs the UV passkey and unrestricted session, replaces primary login authority, revokes prior sessions and sign-in factors, rotates the hash-only recovery-code set, appends metadata-only audits, and writes the binding receipt. Only first unambiguous success returns the new cookie and ten plaintext codes. After the old restricted session is revoked, the supported recovery transport is the public readback endpoint bound to the proof secret, challenge ID, and original browser credential; it returns receipt only, and the one-time cookie, bearer material, and codes are never regenerated. The restricted finish endpoint is not expected to remain usable after revocation.

SAFE-002, SAFE-003, SAFE-006, and the finite current-inventory SAFE-007 are complete. Fresh authenticated application-owned control-plane commands repeat exact token binding, database-time session and grant expiry, fail-closed requirement/capability shape, operation authorization, and expected state in the D1 batch that writes the mutation, receipt, and audit. Public account-recovery completion is the explicit proof-authorized operation: its batch rechecks the exact flow, proof, recovery identity version, active user, and code against D1 time. Exact receipt replay remains actor- or proof-bound readback and does not reauthorize fresh state. Generic effect-auth bookkeeping, ephemeral ceremony starts, development storage, AI audit records, migrations, and MailboxDO SQLite are outside that finite command inventory; future application-owned commands inherit the same contract as Definition of Done. Public recovery start uses exact ten-minute IP/email rate-limit rules, a 500 ms response floor, and detached Worker `waitUntil` delivery. Normal unknown, disabled, no-code, recovery-safe policy-denied, and delivery-failure paths are intentionally indistinguishable; dependency, storage, and data-corruption failures remain sanitized generic 500 responses rather than being misclassified as normal ineligibility. Every browser-facing `/auth/*` response is private and no-store at the Website proxy boundary. The `mailbox-session-requirements` matrix version 1 covers the exact 19-operation mailbox HTTP inventory as `unrestricted-only`; a policy-neutral authentication middleware supplies trusted session facts before the matrix rejects unknown operations, unfinished requirements, restricted sessions, malformed claims, and dangling recovery capabilities. Future exceptions must name one exact recovery requirement and one exact singleton capability, while current mailbox operations have none. Recovery remediation also requires exact singleton `second-passkey` at the HTTP and transactional D1 boundaries. SAFE-013 remains open for the remaining generic login/recovery initiation integration.

Permission and role definition disablement is not an additional runtime revocation mechanism in the current effect-auth authorization contract: `hasPermission` evaluates active grants, scopes, expiry, and role-permission mappings without consulting definition lifecycle. SAFE-007 preserves those semantics transactionally rather than silently making definition disablement revoke existing grants; changing that behavior requires a separate authorization-contract decision and migration review.

Recovery-only email identities are application-owned records, not effect-auth `auth_user_identity` rows. This structural separation prevents generic password, OTP, and magic-link flows from treating a verified recovery address as login authority. The purpose-aware recovery-safe policy resolves one managed domain from agreeing current `MailDomain`, retained primary-route, and trusted pre-bootstrap claims, failing closed on malformed, missing, ambiguous, or disagreeing continuity; it also rejects every recorded mailbox route plus active or pending recovery duplicates. External recovery use additionally rejects an active login identity, while login initiation may target its matching active login identity. SAFE-013 applies that boundary to email OTP, magic link, public and password-sign-in-initiated email verification, password reset, external recovery enrollment, and public two-proof recovery. Generic email initiation is decorated at the effect-auth service boundary rather than only at HTTP, and D1 migration 1017 resolves challenge-route races by invalidating later consumption after a route wins while reserving a consumed proof target only until expiry. The policy read and a later auth-owned write are not one cross-adapter transaction; ORG-009 domain mutation controls are responsible for serialization and revalidation before changing managed-domain claims. The migration is intentionally coupled to the effect-auth challenge type and metadata contract, so every vendor upgrade requires compatibility review. INV-010 owns invitation acceptance; ADDR-022 owns full future shared address/route mutations. All three reuse the same policy instead of duplicating its rules.

### Authorization

The first release grants access at mailbox level only. Folder-level grants are not exposed or issued by product workflows.

Permission scope types and IDs are immutable platform contracts:

```text
organization    scope ID: organizationId
mailbox         scope ID: mailboxId
folder          scope ID: JSON [mailboxId, folderId]
send_identity   scope ID: JSON [mailboxId, sendIdentityId]
```

Organization role mappings are exact:

| Permission                        | Scope        | Owner | Admin | Member |
| --------------------------------- | ------------ | ----- | ----- | ------ |
| `organization.read`               | organization | Yes   | Yes   | Yes    |
| `organization.manage_settings`    | organization | Yes   | Yes   | No     |
| `organization.manage_members`     | organization | Yes   | Yes   | No     |
| `organization.manage_domains`     | organization | Yes   | Yes   | No     |
| `organization.manage_addresses`   | organization | Yes   | Yes   | No     |
| `organization.manage_mailboxes`   | organization | Yes   | Yes   | No     |
| `organization.read_audit`         | organization | Yes   | Yes   | No     |
| `organization.transfer_ownership` | organization | Yes   | No    | No     |

Mailbox role mappings preserve the existing permission behavior and add mailbox-scoped authority for shared send identities:

| Permission | Scope | Owner | Manager | Editor | Viewer |
| --- | --- | --- | --- | --- | --- |
| `mailbox.read` | mailbox | Yes | Yes | Yes | Yes |
| `mailbox.modify` | mailbox | Yes | Yes | Yes | No |
| `mailbox.send` | mailbox | Yes | Yes | No | No |
| `mailbox.send_from_shared_identity` | mailbox | Yes | Yes | No | No |
| `mailbox.manage_settings` | mailbox | Yes | No | No | No |
| `mailbox.manage_members` | mailbox | Yes | No | No | No |
| `mailbox.export` | mailbox | Yes | No | No | No |
| `message.read` | mailbox | Yes | Yes | Yes | Yes |
| `message.modify` | mailbox | Yes | Yes | Yes | No |
| `draft.create` | mailbox | Yes | Yes | Yes | No |
| `draft.send` | mailbox | Yes | Yes | No | No |
| `rule.manage` | mailbox | Yes | Yes | No | No |
| `attachment.read` | mailbox | Yes | Yes | Yes | Yes |
| `attachment.upload` | mailbox | Yes | Yes | Yes | No |
| `folder.read` | folder | Yes | Yes | Yes | Yes |
| `folder.modify` | folder | Yes | Yes | Yes | No |

The platform role IDs are `organization.owner`, `organization.admin`, `organization.member`, `mailbox.owner`, `mailbox.manager`, `mailbox.editor`, and `mailbox.viewer`. Tenant administrators cannot edit these mappings.

`send_identity.use` has `send_identity` scope and is never included in a role mapping. It is an exact direct grant for a restricted identity.

Every send still requires `draft.send` and `mailbox.send` at mailbox scope. A send identity has one access policy:

- `shared`: additionally requires `mailbox.send_from_shared_identity` at mailbox scope.
- `restricted`: additionally requires `send_identity.use` at exact send-identity scope.

The default role-based sender of a shared mailbox uses `shared`. Personal or otherwise sensitive aliases use `restricted`; even a Mailbox Owner needs an explicit exact grant to use one.

Folder and child-resource permissions may remain internal primitives, but no user can receive only folder-level discovery in the first release. Mailbox assignment and mailbox-level read authority are required.

Organization address allocation and transfer require Organization Owner/Admin. Mailbox Owner may manage display name and default `From` only among identities already assigned to that mailbox.

Global mail-role and mail-permission grants are forbidden. Membership supports discovery and lifecycle but never replaces exact authorization.

Migration 1025 retains the legacy `owner` mailbox grant and adds one exact `organization.owner` grant scoped to `legacy_default_v1`, with canonical membership provenance. The grant maps only to the eight organization permissions above and confers no mailbox, message, draft, attachment, folder, rule, or send authority. No organization-sensitive endpoint may treat it as sufficient before ACL-003 also enforces active organization membership and resource ancestry. The immutable ORG-008 assignment receipt, not a fabricated `mailbox.owner-bootstrap` event, records the migration; fresh state links that receipt to the real existing mailbox bootstrap audit. A future typed organization audit taxonomy is required before organization owner lifecycle commands exist.

## Consequences

- Existing role definitions and grants require a coordinated namespace migration.
- Organization administrators can manage configuration without reading HR, accounting, or personal messages.
- Offboarding must revoke sessions, organization membership, mailbox assignments, grants, invitations, and delegated capabilities.
- Effective-access UI must show assignment and grant provenance.
- Existing folder authorization code can remain, but company administration cannot issue folder-only access in the first release.

## Rejected alternatives

### Hosted company email as the only login and recovery identity

Rejected because initial access and account recovery become circular, and shared routes expose credentials to multiple readers.

### Folder-level administration in the first release

Rejected because mailbox-level roles satisfy the agreed use cases with a smaller and more reviewable security surface.

### Editable tenant role definitions

Rejected because changing a shared role definition can silently expand access. Custom roles remain a future feature.

## References

- `PLAN-FIRMOWEJ-POCZTY.md`
- `src/modules/authorization/contracts/AuthorizationCatalog.ts`
- `src/platform/control-plane-d1/AuthorizationGuardSchema.ts`
- `src/platform/control-plane-d1/RequestAuthGuard.ts`
- `src/modules/account-security/integration/AccountSecurityD1RequestGuard.ts`
