import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import authPackage from "@effect-auth/core/package.json" with { type: "json" };
import {
  generateStorageArtifacts,
  storageFeatureCatalog,
} from "@effect-auth/core/StorageSchemaGenerator";
import { format } from "oxfmt";

const outputDirectory = fileURLToPath(
  new URL("../src/auth/schema", import.meta.url)
);
const manifestPath = `${outputDirectory}/effect-auth.json`;
const checkOnly = process.argv.includes("--check");

const artifacts = generateStorageArtifacts({
  adapter: "drizzle",
  database: "sqlite",
  features: storageFeatureCatalog.map(({ id }) => id),
  mode: "fresh",
  outputs: [
    {
      includeRelations: true,
      kind: "drizzle-schema",
      layout: "module",
    },
  ],
});

const generatedFiles = new Map<string, string>();
for (const file of artifacts.files) {
  const source = [
    `// Generated from @effect-auth/core@${authPackage.version}.`,
    "// Do not edit manually; run `bun run generate:auth-schema`.",
    "",
    ...(file.path === "index.ts" || file.path.endsWith("/index.ts")
      ? [
          "// oxlint-disable-next-line oxc/no-barrel-file -- Generated public schema exports.",
        ]
      : []),
    file.content,
  ].join("\n");
  const formatted = await format(
    path.resolve(outputDirectory, file.path),
    source
  );
  if (formatted.errors.length > 0) {
    throw new Error(`Could not format generated auth schema ${file.path}`);
  }
  generatedFiles.set(file.path, formatted.code);
}

const manifest = `${JSON.stringify(
  {
    apiVersion: artifacts.apiVersion,
    files: artifacts.files.map(({ path: filePath }) => filePath),
    fingerprint: artifacts.fingerprint,
    generatorVersion: artifacts.generatorVersion,
    package: "@effect-auth/core",
    request: artifacts.request,
    schemaVersion: artifacts.schemaVersion,
    version: authPackage.version,
  },
  null,
  2
)}\n`;

const previousManifest = await readFile(manifestPath, "utf-8")
  .then((content) => JSON.parse(content) as { readonly files?: unknown })
  .catch(() => null);
const previousFiles = Array.isArray(previousManifest?.files)
  ? previousManifest.files.filter(
      (file): file is string =>
        typeof file === "string" &&
        !file.startsWith("/") &&
        !file.split("/").includes("..")
    )
  : [];
const staleFiles = previousFiles.filter((file) => !generatedFiles.has(file));
const changedFiles: string[] = [];

for (const [file, content] of generatedFiles) {
  const existing = await readFile(
    path.resolve(outputDirectory, file),
    "utf-8"
  ).catch(() => null);
  if (existing !== content) {
    changedFiles.push(file);
  }
}
if ((await readFile(manifestPath, "utf-8").catch(() => null)) !== manifest) {
  changedFiles.push("effect-auth.json");
}

if (checkOnly) {
  if (changedFiles.length > 0 || staleFiles.length > 0) {
    throw new Error(
      `Auth schema is stale. Changed: ${changedFiles.join(", ") || "none"}; stale: ${staleFiles.join(", ") || "none"}`
    );
  }
  console.log(`Verified ${artifacts.resolved.tables.length} auth tables.`);
} else {
  for (const [file, content] of generatedFiles) {
    const outputPath = path.resolve(outputDirectory, file);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, content);
  }
  await writeFile(manifestPath, manifest);
  for (const file of staleFiles) {
    await unlink(path.resolve(outputDirectory, file));
  }
  console.log(`Wrote ${artifacts.resolved.tables.length} auth tables.`);
}
