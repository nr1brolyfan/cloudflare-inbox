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

Auth requests are served from the public origin under `/auth/*` and forwarded to the private Backend Worker. Development uses development-only fallback secrets and writes rendered auth messages to `app_auth_email_outbox` in the development D1 database. The full effect-auth Core API is enabled, including email OTP, magic link, session, password registration, sign-in, and reset endpoints. Password creation and reset enforce a 12-character minimum.

Deployed environments require the values documented in `.env.example`. `PUBLIC_ORIGIN` must be the exact Website origin, `AUTH_EMAIL_FROM` must use a domain configured for Cloudflare Email Routing, and each auth secret must be a separate high-entropy value. Alchemy binds these values as Worker secrets.

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
src/infra/                  Cloudflare resource declarations
src/server/                 server-only frontend Worker code
src/workers/backend.ts      private Effect backend Worker
```

Add Shadcn components with Bun:

```bash
bunx shadcn@latest add button
```
