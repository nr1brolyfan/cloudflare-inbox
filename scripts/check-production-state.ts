import { spawnSync } from "node:child_process";

import { readProductionEnvFile } from "./production-env";
import { productionAlchemyChildEnv } from "./run-production-alchemy";

const production = readProductionEnvFile();

const result = spawnSync(
  "alchemy",
  [
    "state",
    "resources",
    "scripts/cloudflare-state-inspection.ts",
    "--stack",
    "CloudflareInbox",
    "--stage",
    "production",
    "--env-file",
    ".env.production",
  ],
  {
    env: productionAlchemyChildEnv(production, process.env),
    stdio: "inherit",
  }
);

process.exitCode = result.status ?? 1;
