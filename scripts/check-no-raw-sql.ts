import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sourceDirectory = path.join(root, "src");
const allowed = new Set([
  "src/control-plane/batch.ts",
  "src/control-plane/external-recovery-identity-live.ts",
  "src/control-plane/mailbox-administration-live.ts",
  "src/mailboxes/sqlite-migrations.ts",
]);
const violations: string[] = [];

const sourceFiles = async (directory: string): Promise<readonly string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(entryPath)));
    } else if (/\.tsx?$/u.test(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
};

for (const absolutePath of await sourceFiles(sourceDirectory)) {
  const file = path.relative(root, absolutePath);
  if (allowed.has(file)) {
    continue;
  }
  const source = await readFile(absolutePath, "utf-8");
  if (/\.(?:exec|prepare)\s*\(/u.test(source)) {
    violations.push(`${file}: native SQL execution`);
  }
}

if (violations.length > 0) {
  throw new Error(`Raw SQL is restricted:\n${violations.join("\n")}`);
}

console.log("Verified application SQL access uses Drizzle.");
