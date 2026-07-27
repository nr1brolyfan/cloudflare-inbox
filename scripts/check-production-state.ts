import { spawnSync } from "node:child_process";

import { readProductionEnvFile } from "./production-env";
import {
  alchemyCliInvocation,
  ensureProductionAlchemyProfile,
  productionAlchemyChildEnv,
} from "./run-production-alchemy";

const production = readProductionEnvFile();
ensureProductionAlchemyProfile(process.env.HOME);

const invocation = alchemyCliInvocation([
  "state",
  "resources",
  "scripts/cloudflare-state-inspection.ts",
  "--stack",
  "CloudflareInbox",
  "--stage",
  "production",
  "--env-file",
  ".env.production",
]);
const result = spawnSync(invocation.command, invocation.args, {
  env: productionAlchemyChildEnv(production, process.env),
  stdio: "inherit",
});

process.exitCode = result.status ?? 1;
