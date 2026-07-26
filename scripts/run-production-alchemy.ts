import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { PRODUCTION_ENV_FILE, readProductionEnvFile } from "./production-env";
import type { ProductionEnvironment } from "./production-env";

export const PRODUCTION_OPERATIONAL_ENV_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "XDG_CONFIG_HOME",
  "ALCHEMY_PROFILE",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_KEY",
  "CLOUDFLARE_EMAIL",
] as const;

export const productionAlchemyChildEnv = (
  production: ProductionEnvironment,
  ambient: NodeJS.ProcessEnv
): NodeJS.ProcessEnv => {
  const child: NodeJS.ProcessEnv = {};
  for (const key of PRODUCTION_OPERATIONAL_ENV_KEYS) {
    const value = ambient[key];
    if (value !== undefined) {
      child[key] = value;
    }
  }
  for (const [key, value] of production) {
    child[key] = value;
  }
  return child;
};

export const productionAlchemyArgs = (mode: "deploy" | "plan"): string[] => [
  "deploy",
  "--stage",
  "production",
  "--env-file",
  PRODUCTION_ENV_FILE,
  ...(mode === "plan" ? ["--dry-run"] : []),
];

export const runProductionAlchemy = (
  mode: "deploy" | "plan",
  filePath = PRODUCTION_ENV_FILE
): number => {
  let production: ProductionEnvironment;
  try {
    production = readProductionEnvFile(filePath);
  } catch {
    console.error("production environment file is invalid");
    return 1;
  }

  const result = spawnSync("alchemy", productionAlchemyArgs(mode), {
    env: productionAlchemyChildEnv(production, process.env),
    stdio: "inherit",
  });
  return result.status ?? 1;
};

const [, entrypoint, mode] = process.argv;
if (
  entrypoint !== undefined &&
  pathToFileURL(path.resolve(entrypoint)).href === import.meta.url
) {
  if (mode !== "plan" && mode !== "deploy") {
    console.error("production alchemy mode is invalid");
    process.exitCode = 1;
  } else {
    process.exitCode = runProductionAlchemy(mode);
  }
}
