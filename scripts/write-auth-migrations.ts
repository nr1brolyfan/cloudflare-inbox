import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
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

const migrationSql = (content: string) =>
  content.split("\n").slice(3).join("\n").trim();

const existingFiles = await readdir(outputDirectory).catch(() => []);
const staleFiles = existingFiles.filter(
  (file) => /^\d{4}_auth_.+\.sql$/u.test(file) && !generatedFiles.has(file)
);
const changedFiles: string[] = [];

for (const [file, content] of generatedFiles) {
  const path = `${outputDirectory}/${file}`;
  const existing = await readFile(path, "utf-8").catch(() => null);

  const unchangedHistoricalMigration =
    existing !== null &&
    file.endsWith(".sql") &&
    migrationSql(existing) === migrationSql(content);
  if (existing !== content && !unchangedHistoricalMigration) {
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
    const path = `${outputDirectory}/${file}`;
    const existing = await readFile(path, "utf-8").catch(() => null);
    if (existing === null || file === "effect-auth.json") {
      await writeFile(path, content);
      continue;
    }
    if (migrationSql(existing) !== migrationSql(content)) {
      throw new Error(`Historical auth migration drift: ${file}`);
    }
  }

  if (staleFiles.length > 0) {
    throw new Error(
      `Refusing to delete historical auth migrations: ${staleFiles.join(", ")}`
    );
  }

  console.log(`Wrote ${authStorageMigrations.length} auth migrations.`);
}
