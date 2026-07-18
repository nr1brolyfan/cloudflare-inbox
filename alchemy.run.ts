import * as Alchemy from "alchemy";
import { ALCHEMY_DEV } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

import Backend from "./src/workers/backend.ts";

export class Website extends Cloudflare.Website.Vite<Website>()("Website", {
  compatibility: {
    date: "2026-07-11",
    flags: ["nodejs_compat"],
  },
  dev: {
    port: 1337,
    strictPort: true,
  },
  env: {
    BACKEND: Backend,
    DEV_EMAIL_INBOX_ENABLED: ALCHEMY_DEV,
  },
  assets: {
    runWorkerFirst: true,
  },
  observability: {
    enabled: true,
    logs: {
      enabled: true,
      headSamplingRate: 1,
      invocationLogs: true,
      persist: true,
    },
    traces: {
      enabled: true,
      headSamplingRate: 1,
      persist: true,
    },
  },
}) {}

export type WebsiteEnv = Cloudflare.InferEnv<typeof Website>;

const stackState =
  process.env.ALCHEMY_STATE === "local"
    ? Alchemy.localState()
    : Cloudflare.state();

export default Alchemy.Stack(
  "CloudflareInbox",
  {
    providers: Cloudflare.providers(),
    state: stackState,
  },
  Effect.gen(function* () {
    const backend = yield* Backend;
    const website = yield* Website;

    return {
      backendUrl: backend.url.as<string>(),
      websiteUrl: website.url.as<string>(),
    };
  })
);
