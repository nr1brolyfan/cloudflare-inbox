# Cloudflare Inbox

An Effect-native email inbox running on Cloudflare. The application uses a TanStack Start Worker as its public origin and a private Effect backend Worker connected through a Cloudflare service binding.

## Requirements

- Bun 1.3 or newer
- A Cloudflare account for deployed environments

## Development

Install dependencies and start the complete local Cloudflare resource graph:

```bash
bun install
bun run dev
```

The local services use stable addresses:

```text
Website: http://localhost:1337
Backend: http://localhost:1338
```

`GET http://localhost:1337/api/health` verifies the Website to Backend service binding. `bun run dev:vite` starts only the TanStack Vite application and does not provide Cloudflare bindings.

Auth requests are served from the public origin under `/auth/*` and forwarded to the private Backend Worker. During `alchemy dev`, effect-auth's `AuthMailerFromDevEmailStoreLive` writes rendered auth messages to the app-owned D1 `DevEmailStore`. Open `http://localhost:1337/dev-email-inbox` to inspect OTP codes and action links; the route and private Backend API both fail closed outside local development. Credential-bearing messages are never written to logs or telemetry. Completion links keep their challenge and secret in the URL fragment, which browsers do not send to the Website Worker, and remove the fragment immediately after hydration. The full effect-auth Core API is enabled, including email OTP, magic link, session, password registration, sign-in, and reset endpoints. Password creation and reset enforce a 12-character minimum.

The D1 control plane stores the mailbox registry, globally unique mailbox addresses, mailbox membership projection, user preferences, and effect-auth's scoped grants. Application queries use Effect-native Drizzle over `@effect/sql-d1`; raw D1 is isolated to atomic batches because D1 does not expose transactions through its Effect driver. `app_mailbox_member` is used only to discover a user's mailboxes; effect-auth role and permission grants remain the authorization source of truth. Inbound routing validates Cloudflare's SMTP envelope recipient, normalizes only its DNS domain, and resolves an enabled address on an active mailbox before selecting a `MailboxDO`; MIME `To` headers are never routing evidence. The original MIME stream is then written append-only to private R2 with bounded envelope metadata and confirmed before the email event completes, so downstream processing never precedes durable raw storage. A Cloudflare Workflow instance with the same ingest ID starts only after that confirmation, records the durable `raw_stored` checkpoint, verifies the immutable R2 object, and parses it through a memory-bounded `postal-mime` adapter. The durable parsed manifest contains normalized message fields and attachment metadata but never binary content or storage keys. The Workflow reparses the immutable raw object before attachment storage, requires the second manifest to match the durable one, and writes attachment bytes append-only under deterministic R2 keys with SHA-256 and canonical metadata verification on retries; CID remains validated message metadata rather than part of the storage key. A final trusted Workflow step commits the message, attachment metadata, private ingest mapping, FTS update, and `ready` processing state in one MailboxDO SQLite transaction. The canonical ingest ID is the idempotency key: exact retries return the original message ID, changed payloads conflict, and separate SMTP ingests remain distinct even when they reuse an RFC `Message-ID`; RFC references are used only as conservative threading evidence. MailboxDO also records monotonic `raw_stored`, `parsing`, and `attachments_stored` checkpoints plus sticky terminal failures. Transient R2 and DO errors use bounded exponential Workflow retries, deterministic MIME and integrity failures skip automatic retry, and a late failure write can only resolve to the exact already committed message rather than overwrite `ready`. A protected replay accepts only mailbox, ingest, and operation IDs: MailboxDO atomically reopens an eligible failure, increments its execution fence, and durably assigns a fresh Workflow instance before the same immutable raw MIME is read again. Delayed checkpoints, failures, and commits from older executions are rejected, while repeating the replay operation safely recovers the same prepared instance after ambiguous responses. Each logical mailbox maps by canonical mailbox ID to a SQLite-backed `MailboxDO` data-plane instance using Effect-native Drizzle and synchronous SQLite transactions. Versioned migrations run atomically before that instance accepts RPC calls. Mailbox initialization seeds stable system folders; custom folder and label changes use version checks and soft deletion, while create-operation results are durably replayed by operation ID. Messages and threads are read from canonical snapshots with bound keyset cursors; scheduling consumes a draft atomically into an immutable outbound message and versioned delivery record.

Child-resource authorization resolves mailbox and folder ancestry from canonical `MailboxDO` SQLite tables through the trusted `MailboxRepository` and `MailResourceResolver` ports before checking permissions. Folder scopes include both mailbox and folder identity, preventing grants from crossing mailbox boundaries when local folder IDs match. Mailbox routing hints supplied by callers select an active control-plane mailbox's corresponding `MailboxDO` but are never used directly as authorization evidence. The migration introducing qualified scopes invalidates legacy bare folder grants because they cannot be mapped to a mailbox safely.

Private application handlers derive `CurrentSession`, `CurrentActor`, and `CurrentPrincipal` by validating the incoming session cookie directly against D1. Client-provided user or session identifiers are never accepted as authorization evidence.

Outbound sends use a server-authoritative undo window, immutable mailbox snapshots, and a dedicated Cloudflare Email Sending binding. The delivery tracker distinguishes provider acceptance from recipient delivery: `accepted` means Cloudflare accepted and queued the message, while only a later `delivered` event may confirm recipient delivery. Unknown provider outcomes become `indeterminate` and are never retried automatically because another submission could duplicate the message.

Mailbox owner bootstrap derives the owner from an unrestricted validated session and creates the singleton `primary` mailbox, its initial inbound address, discovery membership, and scoped owner grant in one D1 batch. Control-plane mutations repeat the token-bound session and permission checks inside the same batch as the guarded write, closing the revoke-between-check-and-write race without treating membership rows as authorization evidence.

The signed-in Website invokes mailbox operations through TanStack Start server functions. The Website forwards only selected request metadata over the private `BACKEND` binding; the Backend independently enforces the exact public origin, validates the session cookie, and maps domain failures to cause-free HTTP errors. Inbox navigation discovers the active mailbox from the D1 membership projection, then separately requires `mailbox.read` before returning the mailbox name, folder counts, or labels. Folder and label data comes from validated `MailboxDO` directory reads, and the aggregate response rejects any child carrying a different mailbox identity. Message lists require mailbox-scoped `message.read` or `folder.read` on the resolved folder; label views require mailbox-scoped `message.read`. Thread links carry an anchor message that is resolved and authorized before bodies are loaded, preventing a selected folder or label from being used to open an unrelated thread. Thread hydration is SQL-bounded to the latest 50 messages, and folder-scoped reads authorize every returned message. The browser thread projection contains plain text and attachment metadata but no raw HTML body, storage keys, or attachment bytes. HTML preview uses a separate, independently authorized same-origin iframe navigation; Backend parses the body into an inert document, and Website responds with an empty iframe sandbox, restrictive HTTP CSP, no referrer, and no-store caching.

Every environment requires the values documented in `.env.example`. `PUBLIC_ORIGIN` must be the exact Website origin, `AUTH_EMAIL_FROM` must use a domain configured for Cloudflare Email Routing in production, and `MAILBOX_OWNER_EMAIL` must identify the verified account allowed to claim the singleton mailbox and becomes its initial inbound address. Each auth secret must be a separate high-entropy value. Alchemy binds these values as Worker secrets.

## Observability

Cloudflare Workers Logs and native tracing are enabled for both Website and Backend, including invocation, service binding, D1, R2, Durable Object, and fetch spans collected by the platform. Website-to-Backend auth, health, and mailbox calls add Cloudflare custom spans with sanitized method and path attributes. Effect application logs use structured console output in deployed environments so Workers Logs can index their fields.

Local Backend Effect logs and spans can additionally be sent over OTLP/HTTP to Motel. Start Motel, use the base URL reported by the daemon as `OTEL_EXPORTER_OTLP_ENDPOINT`, and then start the application:

```bash
motel start
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:27686 bun run dev
```

The Backend builds OTLP log and trace exporters in the request scope. Alchemy closes that scope through `ctx.waitUntil`, ensuring buffered telemetry is flushed without delaying the response. Effect metrics are intentionally not exported per request; production infrastructure metrics come from Cloudflare.

## Commands

```bash
bun run build
bun run typecheck
bun run test
bun run check
bun run format
bun run generate:auth-migrations
bun run deploy
bun run destroy
```

Run `bun run generate:auth-migrations` after changing `@effect-auth/core`. Committed migrations are verified automatically by `bun run check`.

Production deployment uses Alchemy's Cloudflare state store. Local development sets `ALCHEMY_STATE=local` and keeps generated state under the ignored `.alchemy` directory.

## Structure

```text
alchemy.run.ts              Cloudflare resource graph
src/routes/                 TanStack Start routes
src/auth/                   effect-auth services, session handling, and storage
src/authorization/          mail permission catalog and D1-backed layers
src/control-plane/          D1 adapters and transactional mailbox administration
src/http/                   declarative Effect HTTP APIs and Backend composition
src/infra/                  Cloudflare resource declarations
src/mailboxes/              mail domain, Durable Object protocol, and SQLite stores
src/observability/          health services, Effect logging, and local OTLP layers
src/server/                 Website-side services and TanStack adapters
src/workers/backend.ts      private Effect backend Worker
tests/<area>/               tests mirroring production domains
tests/support/              shared test-only helpers and Layers
```

Production modules live exclusively under `src/`. Tests mirror their domain folders under top-level `tests/`, while reusable test-only database and Layer setup belongs in `tests/support/`.
