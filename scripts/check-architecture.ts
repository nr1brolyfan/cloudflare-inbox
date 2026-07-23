import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as ts from "typescript";

const root = fileURLToPath(new URL("..", import.meta.url));
const managedRoots = ["modules", "apps", "platform", "shared"] as const;
const categoryName = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const moduleName = /^[A-Z][A-Za-z0-9]*\.tsx?$/u;

const normalize = (value: string): string => value.replaceAll("\\", "/");

const resolveImport = (file: string, specifier: string): string | undefined => {
  if (specifier.startsWith("#/")) {
    return `src/${specifier.slice(2)}`;
  }
  if (!specifier.startsWith(".")) {
    return undefined;
  }
  return normalize(path.join(path.dirname(file), specifier));
};

const isCrossContextD1AdapterImport = (
  inD1Adapter: boolean,
  sourceContext: string | undefined,
  targetContext: string | undefined,
  target: string
): boolean =>
  inD1Adapter &&
  targetContext !== undefined &&
  targetContext !== sourceContext &&
  target.includes("/adapters/");

const isPlatformRequestAuthBusinessImport = (
  isPlatformRequestAuthGuard: boolean,
  target: string
): boolean => isPlatformRequestAuthGuard && target.startsWith("src/modules/");

export const checkArchitecturePath = (file: string): readonly string[] => {
  const normalizedFile = normalize(file);
  const relative = normalizedFile.replace(
    /^src\/(?:modules|apps|platform|shared)\//u,
    ""
  );
  const segments = relative.split("/");
  const fileName = segments.pop();
  const violations: string[] = [];

  if (fileName !== undefined && !moduleName.test(fileName)) {
    violations.push(
      "first-class TypeScript modules must use PascalCase filenames"
    );
  }
  for (const segment of segments) {
    if (!categoryName.test(segment)) {
      violations.push(
        `architecture/category directory must use lowercase kebab-case: ${segment}`
      );
    }
  }
  return violations;
};

export const checkArchitectureImports = (
  file: string,
  source: string
): readonly string[] => {
  const normalizedFile = normalize(file);
  const sourceFile = ts.createSourceFile(
    normalizedFile,
    source,
    ts.ScriptTarget.Latest,
    true,
    normalizedFile.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const violations = new Set<string>();
  const inModules = normalizedFile.startsWith("src/modules/");
  const sourceContext = inModules ? normalizedFile.split("/")[2] : undefined;
  const inD1Adapter = inModules && normalizedFile.includes("/adapters/d1/");
  const isPlatformRequestAuthGuard = normalizedFile.endsWith(
    "/platform/control-plane-d1/RequestAuthGuard.ts"
  );
  const inMailbox = normalizedFile.startsWith("src/modules/mailbox/");
  const inDomain = inModules && normalizedFile.includes("/domain/");
  const inApplication = inModules && normalizedFile.includes("/application/");
  const inPorts = inModules && normalizedFile.includes("/ports/");

  const inspect = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const target = resolveImport(normalizedFile, node.moduleSpecifier.text);
      if (target !== undefined) {
        const targetContext = target.startsWith("src/modules/")
          ? target.split("/")[2]
          : undefined;
        if (inModules && target.startsWith("src/apps/")) {
          violations.add("business modules must not import runtime apps");
        }
        if (
          isPlatformRequestAuthBusinessImport(
            isPlatformRequestAuthGuard,
            target
          )
        ) {
          violations.add(
            "platform request auth guard must not import business contexts"
          );
        }
        if (
          isCrossContextD1AdapterImport(
            inD1Adapter,
            sourceContext,
            targetContext,
            target
          )
        ) {
          violations.add(
            "D1 adapters must use cross-context integration contracts, not concrete adapters or schemas"
          );
        }
        if (inMailbox && target.startsWith("src/modules/authorization/")) {
          violations.add(
            "mailbox must depend on its authorization port, not the authorization context"
          );
        }
        if (
          (inDomain || inApplication || inPorts) &&
          target.includes("/adapters/")
        ) {
          violations.add(
            "domain, application and ports must not import adapters"
          );
        }
        if (
          (inDomain || inApplication || inPorts) &&
          target.startsWith("src/platform/")
        ) {
          violations.add(
            "domain, application and ports must not import platform modules"
          );
        }
      }
    }
    ts.forEachChild(node, inspect);
  };

  inspect(sourceFile);
  return [...violations];
};

const sourceFiles = async (directory: string): Promise<readonly string[]> => {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  );
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

const main = async (): Promise<void> => {
  const sourceFilesByRoot = await Promise.all(
    managedRoots.map((directory) =>
      sourceFiles(path.join(root, "src", directory))
    )
  );
  const files = sourceFilesByRoot.flat();
  const violations: string[] = [];

  for (const absolutePath of files) {
    const file = normalize(path.relative(root, absolutePath));
    const source = await readFile(absolutePath, "utf-8");
    violations.push(
      ...checkArchitecturePath(file).map(
        (violation) => `${file}: ${violation}`
      ),
      ...checkArchitectureImports(file, source).map(
        (violation) => `${file}: ${violation}`
      )
    );
  }

  if (violations.length > 0) {
    throw new Error(
      `Architecture policy violations:\n${violations.join("\n")}`
    );
  }
  console.log(`Verified architecture policy for ${files.length} source files.`);
};

const [, entrypoint] = process.argv;
if (
  entrypoint !== undefined &&
  pathToFileURL(path.resolve(entrypoint)).href === import.meta.url
) {
  await main();
}
