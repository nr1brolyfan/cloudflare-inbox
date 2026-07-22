# ADR 0003: Authentication and mailbox authorization

- Status: Accepted
- Date: 2026-07-22
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

Until SAFE-002 completes passkey sign-in, passkey step-up, and recovery codes, SAFE-001 exposes a five-minute password reauthentication fallback for the existing owner bootstrap. A basic session cannot enroll its own step-up factor, and password reset is limited to accounts with an existing active password credential; passwordless ownership actions remain disabled until passkey sign-in and step-up exist. The reusable `control-plane-sensitive` policy version 1 accepts a recent password, TOTP, or user-verified passkey, rejects email OTP, magic link, recovery code, stale evidence, future evidence, and sessions with active requirements, and rechecks the evidence and session expiry against SQLite execution time in the D1 mutation batch. Authentication-event schema versioning remains separate from policy versioning. Future ownership, domain, address, grant, and transfer operations must use the same policy boundary. SAFE-002 replaces the transitional password-first UX with the accepted passkey-first target.

SAFE-002 uses the configured public-origin hostname as RP ID, requires exact origin, discoverable credentials and user verification, and disables attestation. Public enrollment requires an unrestricted session, independently established recent authentication, and a verified external recovery identity. Credential inventory exposes only an opaque application record ID and safe timestamps. Revocation rechecks the token-bound session, recent step-up, verified recovery, target state, and the existence of another active passkey in the same atomic batch as the credential update, immutable operation receipt, and metadata-only audit event. Passkey sign-in, passkey step-up, and recovery codes remain unavailable until their policy-complete flows are implemented.

Recovery-only email identities are application-owned records, not effect-auth `auth_user_identity` rows. This structural separation prevents generic password, OTP, and magic-link flows from treating a verified recovery address as login authority. Until `MailDomain` exists, the recovery-safe policy treats the configured owner domain as managed and also rejects every recorded mailbox route, active login identity, and active or pending recovery duplicate. The policy must be reused by enrollment, verification, invitation, login/recovery initiation, and future route mutations before SAFE-013 is complete.

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
- `src/authorization/catalog.ts`
- `src/authorization/mail-authorization.ts`
- `src/control-plane/schema.ts`
- `src/auth/session.ts`
