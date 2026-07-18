import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import authPackage from "@effect-auth/core/package.json" with { type: "json" };
import { authStorageMigrations } from "@effect-auth/core/StorageMigrations";

const outputDirectory = fileURLToPath(
  new URL("../migrations/control-plane", import.meta.url)
);
const checkOnly = process.argv.includes("--check");

const manifest = `${JSON.stringify(
  {
    database: "sqlite/d1",
    migrations: authStorageMigrations.map(({ id }) => id),
    package: "@effect-auth/core",
    version: authPackage.version,
  },
  null,
  2
)}\n`;
const generatedFiles = new Map<string, string>([
  ...authStorageMigrations.map(
    (migration) =>
      [
        `${migration.id}.sql`,
        [
          `-- Generated from @effect-auth/core@${authPackage.version}.`,
          "-- Do not edit manually; run `bun run generate:auth-migrations`.",
          "",
          migration.sql.trim(),
          "",
        ].join("\n"),
      ] as const
  ),
  ["effect-auth.json", manifest] as const,
]);

const existingFiles = await readdir(outputDirectory).catch(() => []);
const staleFiles = existingFiles.filter(
  (file) => /^\d{4}_auth_.+\.sql$/u.test(file) && !generatedFiles.has(file)
);
const changedFiles: string[] = [];

for (const [file, content] of generatedFiles) {
  const path = `${outputDirectory}/${file}`;
  const existing = await readFile(path, "utf-8").catch(() => null);

  if (existing !== content) {
    changedFiles.push(file);
  }
}

if (checkOnly) {
  if (changedFiles.length > 0 || staleFiles.length > 0) {
    throw new Error(
      `Auth migrations are stale. Changed: ${changedFiles.join(", ") || "none"}; stale: ${staleFiles.join(", ") || "none"}`
    );
  }

  console.log(`Verified ${authStorageMigrations.length} auth migrations.`);
} else {
  await mkdir(outputDirectory, { recursive: true });

  for (const [file, content] of generatedFiles) {
    await writeFile(`${outputDirectory}/${file}`, content);
  }

  for (const file of staleFiles) {
    await unlink(`${outputDirectory}/${file}`);
  }

  console.log(`Wrote ${authStorageMigrations.length} auth migrations.`);
}
