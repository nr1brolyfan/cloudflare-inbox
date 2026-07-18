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

The D1 control plane stores the mailbox registry, mailbox membership projection, user preferences, and effect-auth's scoped grants. `app_mailbox_member` is used only to discover a user's mailboxes; effect-auth role and permission grants remain the authorization source of truth.

Child-resource authorization resolves mailbox and folder ancestry through the trusted `MailResourceResolver` port before checking permissions. Mailbox routing hints supplied by callers select a future MailboxDO but are never used directly as authorization evidence.

Private application handlers derive `CurrentSession`, `CurrentActor`, and `CurrentPrincipal` by validating the incoming session cookie directly against D1. Client-provided user or session identifiers are never accepted as authorization evidence.

Mailbox owner bootstrap derives the owner from an unrestricted validated session and creates the singleton `primary` mailbox, discovery membership, and scoped owner grant in one D1 batch. Control-plane mutations repeat the token-bound session and permission checks inside the same batch as the guarded write, closing the revoke-between-check-and-write race without treating membership rows as authorization evidence.

The signed-in Website invokes mailbox mutations through TanStack Start server functions. The Website forwards only selected request metadata over the private `BACKEND` binding; the Backend independently enforces the exact public origin, validates the session cookie, and maps domain failures to cause-free HTTP errors.

Every environment requires the values documented in `.env.example`. `PUBLIC_ORIGIN` must be the exact Website origin, `AUTH_EMAIL_FROM` must use a domain configured for Cloudflare Email Routing in production, and `MAILBOX_OWNER_EMAIL` must identify the verified account allowed to claim the singleton mailbox. Each auth secret must be a separate high-entropy value. Alchemy binds these values as Worker secrets.

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
src/auth/                   effect-auth layers and development mail transport
src/authorization/          mail permission catalog and D1-backed layers
src/http/                   declarative Effect HTTP APIs and router composition
src/infra/                  Cloudflare resource declarations
src/mailboxes/              mailbox control-plane application services
src/observability/          Effect logging and local OTLP composition
src/server/                 server-only frontend Worker code
src/workers/backend.ts      private Effect backend Worker
```

Add Shadcn components with Bun:

```bash
bunx shadcn@latest add button
```
