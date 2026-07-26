/* oxlint-disable max-classes-per-file -- Separate Website classes keep the production custom domain absent from every other stage. */
import * as Alchemy from "alchemy";
import { ALCHEMY_DEV } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

import Backend from "./src/apps/backend-worker/BackendWorker.ts";
import { jobMailProductionConfig } from "./src/modules/organization/application/JobMailProductionConfig.ts";
import { mailDomainConfigPreflight } from "./src/modules/organization/application/MailDomainConfigPreflight.ts";
import {
  JobMailProductionTopology,
  isJobMailProductionStage,
  jobMailInboundRuleProps,
} from "./src/platform/cloudflare/JobMailProductionTopology.ts";

const websiteProps = {
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
};

export class Website extends Cloudflare.Website.Vite<Website>()(
  "Website",
  websiteProps
) {}

export class ProductionWebsite extends Cloudflare.Website.Vite<ProductionWebsite>()(
  "Website",
  { ...websiteProps, domain: JobMailProductionTopology.website.domain }
) {}

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
    const stack = yield* Alchemy.Stack;
    const isProduction = isJobMailProductionStage(stack.stage);
    const productionConfig = isProduction
      ? yield* jobMailProductionConfig
      : undefined;
    if (!isProduction) {
      yield* mailDomainConfigPreflight;
    }
    const backend = yield* Backend;
    if (productionConfig !== undefined) {
      const routing = yield* Cloudflare.Email.Routing("JobMailRouting", {
        ...JobMailProductionTopology.routing,
      });
      yield* Cloudflare.Email.CatchAll("JobMailCatchAll", {
        ...JobMailProductionTopology.catchAll,
        zone: routing.zoneId,
      });
      yield* Cloudflare.Email.Rule("JobMailInboundRoute", {
        ...jobMailInboundRuleProps(
          backend.workerName,
          productionConfig.routeEnabled
        ),
        zone: routing.zoneId,
      });
    }
    const website = yield* isProduction ? ProductionWebsite : Website;

    return {
      websiteUrl: website.url.as<string>(),
    };
  })
);
