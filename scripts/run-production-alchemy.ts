import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { PRODUCTION_ENV_FILE, readProductionEnvFile } from "./production-env";
import type { ProductionEnvironment } from "./production-env";

const workspaceRoot = fileURLToPath(new URL("../", import.meta.url));

export const PRODUCTION_OPERATIONAL_ENV_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "XDG_CONFIG_HOME",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
] as const;

export const JOB_MAIL_PRODUCTION_ALCHEMY_PROFILE = "job-mail-production";
export const JOB_MAIL_PRODUCTION_CLOUDFLARE_ACCOUNT_ID =
  "86b3069c45014c13f4729d416b292bcb";

interface AlchemyProfilesFile {
  readonly version: 0;
  readonly profiles: Record<string, unknown>;
}

const readAlchemyProfilesFile = (file: string): AlchemyProfilesFile => {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf-8"));
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    Reflect.get(parsed, "version") !== 0
  ) {
    throw new Error("production Alchemy profile is invalid");
  }
  const profiles = Reflect.get(parsed, "profiles");
  if (
    typeof profiles !== "object" ||
    profiles === null ||
    Array.isArray(profiles)
  ) {
    throw new Error("production Alchemy profile is invalid");
  }
  return { version: 0, profiles: profiles as Record<string, unknown> };
};

export const ensureProductionAlchemyProfile = (home?: string): void => {
  if (home === undefined) {
    throw new Error("production Alchemy profile is invalid");
  }
  const file = path.join(home, ".alchemy", "profiles.json");
  const config = existsSync(file)
    ? readAlchemyProfilesFile(file)
    : { version: 0 as const, profiles: {} };
  const profile = config.profiles[JOB_MAIL_PRODUCTION_ALCHEMY_PROFILE];
  if (profile !== undefined) {
    if (
      typeof profile !== "object" ||
      profile === null ||
      Array.isArray(profile)
    ) {
      throw new Error("production Alchemy profile is invalid");
    }
    const cloudflare = Reflect.get(profile, "Cloudflare");
    if (
      typeof cloudflare !== "object" ||
      cloudflare === null ||
      Array.isArray(cloudflare) ||
      Reflect.get(cloudflare, "method") !== "env"
    ) {
      throw new Error("production Alchemy profile is invalid");
    }
    chmodSync(file, 0o600);
    return;
  }

  const directory = path.dirname(file);
  const temporary = `${file}.${process.pid}.tmp`;
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    temporary,
    `${JSON.stringify(
      {
        version: 0,
        profiles: {
          ...config.profiles,
          [JOB_MAIL_PRODUCTION_ALCHEMY_PROFILE]: {
            Cloudflare: { method: "env" },
          },
        },
      },
      null,
      2
    )}\n`,
    { mode: 0o600 }
  );
  renameSync(temporary, file);
  chmodSync(file, 0o600);
};

export const productionAlchemyChildEnv = (
  production: ProductionEnvironment,
  ambient: NodeJS.ProcessEnv
): NodeJS.ProcessEnv => {
  if (
    ambient.CLOUDFLARE_ACCOUNT_ID !==
      JOB_MAIL_PRODUCTION_CLOUDFLARE_ACCOUNT_ID ||
    ambient.CLOUDFLARE_API_TOKEN === undefined ||
    ambient.CLOUDFLARE_API_TOKEN === ""
  ) {
    throw new Error("production Cloudflare authentication is invalid");
  }
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
  child.ALCHEMY_PROFILE = JOB_MAIL_PRODUCTION_ALCHEMY_PROFILE;
  return child;
};

export const productionGitHead = (): string => {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: workspaceRoot,
    encoding: "utf-8",
  });
  const releaseSha = result.stdout.trim();
  if (result.status !== 0 || !/^[a-f0-9]{40}$/u.test(releaseSha)) {
    throw new Error("production release SHA is invalid");
  }
  return releaseSha;
};

export const productionAlchemyArgs = (mode: "deploy" | "plan"): string[] => [
  "deploy",
  "--stage",
  "production",
  "--env-file",
  PRODUCTION_ENV_FILE,
  ...(mode === "plan" ? ["--dry-run"] : []),
];

interface AlchemyCliRuntime {
  readonly command: string;
  readonly isBun: boolean;
}

export const alchemyCliInvocation = (
  args: readonly string[],
  runtime?: AlchemyCliRuntime
) => {
  const selectedRuntime = runtime ?? {
    command: process.execPath,
    isBun:
      typeof (process.versions as NodeJS.ProcessVersions & { bun?: string })
        .bun === "string",
  };
  if (!selectedRuntime.isBun) {
    throw new Error("production Alchemy requires Bun");
  }
  return {
    args: [
      fileURLToPath(import.meta.resolve("alchemy/bin/alchemy.js")),
      ...args,
    ],
    command: selectedRuntime.command,
  };
};

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

  try {
    ensureProductionAlchemyProfile(process.env.HOME);
  } catch {
    console.error("production Alchemy profile is invalid");
    return 1;
  }

  const invocation = alchemyCliInvocation(productionAlchemyArgs(mode));
  const childEnv = productionAlchemyChildEnv(production, process.env);
  childEnv.ALCHEMY_RELEASE_SHA = productionGitHead();
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: workspaceRoot,
    env: childEnv,
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
