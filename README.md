# Cloudflare Inbox

An Effect-native email inbox running on Cloudflare. The application uses a
TanStack Start Worker as its public origin and a private Effect backend Worker
connected through a Cloudflare service binding.

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

`GET http://localhost:1337/api/health` verifies the Website to Backend service
binding. `bun run dev:vite` starts only the TanStack Vite application and does
not provide Cloudflare bindings.

## Commands

```bash
bun run build
bun run typecheck
bun run test
bun run check
bun run format
bun run deploy
bun run destroy
```

Production deployment uses Alchemy's Cloudflare state store. Local development
sets `ALCHEMY_STATE=local` and keeps generated state under the ignored
`.alchemy` directory.

## Structure

```text
alchemy.run.ts              Cloudflare resource graph
src/routes/                 TanStack Start routes
src/server/                 server-only frontend Worker code
src/workers/backend.ts      private Effect backend Worker
```

Add Shadcn components with Bun:

```bash
bunx shadcn@latest add button
```
