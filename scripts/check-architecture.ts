import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as ts from "typescript";

const root = fileURLToPath(new URL("..", import.meta.url));
const managedRoots = ["modules", "apps", "platform", "shared"] as const;
const categoryName = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const moduleName = /^[A-Z][A-Za-z0-9]*\.tsx?$/u;
const cycleCheckedContexts = new Set([
  "account-security",
  "address-routing",
  "administrative-audit",
  "authorization",
  "automation",
  "mailbox",
  "organization",
]);
const publicContractCategories = new Set([
  "contracts",
  "domain",
  "integration",
  "ports",
]);
const approvedContextDependencies: Readonly<Record<string, readonly string[]>> =
  {
    "account-security": ["address-routing", "administrative-audit"],
    "address-routing": ["mailbox", "organization"],
    "administrative-audit": ["mailbox"],
    authorization: ["mailbox"],
    automation: ["mailbox"],
    mailbox: [],
    organization: ["mailbox"],
  };

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

const isPlatformBusinessImport = (
  inPlatform: boolean,
  target: string
): boolean =>
  inPlatform &&
  (target.startsWith("src/modules/") || target.startsWith("src/apps/"));

const sourceFileImports = (file: string, source: string): readonly string[] => {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const imports: string[] = [];
  const inspect = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const target = resolveImport(file, node.moduleSpecifier.text);
      if (target !== undefined) {
        imports.push(target);
      }
    }
    ts.forEachChild(node, inspect);
  };
  inspect(sourceFile);
  return imports;
};

export interface ArchitectureSource {
  readonly file: string;
  readonly source: string;
}

export const checkArchitectureCycles = (
  sources: readonly ArchitectureSource[]
): readonly string[] => {
  const dependencies = new Map<string, Set<string>>(
    [...cycleCheckedContexts].map((context) => [context, new Set()])
  );
  for (const { file, source } of sources) {
    const normalizedFile = normalize(file);
    if (!normalizedFile.startsWith("src/modules/")) {
      continue;
    }
    const sourceContext = normalizedFile.split("/").at(2);
    if (
      sourceContext === undefined ||
      !cycleCheckedContexts.has(sourceContext)
    ) {
      continue;
    }
    for (const target of sourceFileImports(normalizedFile, source)) {
      const targetContext = target.startsWith("src/modules/")
        ? target.split("/")[2]
        : undefined;
      if (
        targetContext !== undefined &&
        targetContext !== sourceContext &&
        cycleCheckedContexts.has(targetContext)
      ) {
        dependencies.get(sourceContext)?.add(targetContext);
      }
    }
  }

  const reaches = (source: string, target: string): boolean => {
    const pending = [...(dependencies.get(source) ?? [])];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const current = pending.pop();
      if (current === undefined || visited.has(current)) {
        continue;
      }
      if (current === target) {
        return true;
      }
      visited.add(current);
      pending.push(...(dependencies.get(current) ?? []));
    }
    return false;
  };

  const remaining = new Set(cycleCheckedContexts);
  const violations: string[] = [];
  while (remaining.size > 0) {
    const [context] = remaining;
    if (context === undefined) {
      break;
    }
    const component = [...remaining].filter(
      (candidate) =>
        candidate === context ||
        (reaches(context, candidate) && reaches(candidate, context))
    );
    for (const member of component) {
      remaining.delete(member);
    }
    if (component.length > 1) {
      // oxlint-disable-next-line unicorn/no-array-sort -- ES2022 does not provide toSorted.
      const sortedComponent = component.sort();
      violations.push(
        `context dependency cycle: ${sortedComponent.join(" <-> ")}`
      );
    }
  }
  return violations;
};

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
  const inPlatform = normalizedFile.startsWith("src/platform/");
  const sourceContext = inModules ? normalizedFile.split("/")[2] : undefined;
  const inD1Adapter = inModules && normalizedFile.includes("/adapters/d1/");
  const inAdapter = inModules && normalizedFile.includes("/adapters/");
  const inContextLayer = inModules && normalizedFile.includes("/layers/");
  const inDomain = inModules && normalizedFile.includes("/domain/");
  const inApplication = inModules && normalizedFile.includes("/application/");
  const inPorts = inModules && normalizedFile.includes("/ports/");

  // Every branch represents an independently enforced dependency rule.
  // oxlint-disable-next-line eslint/complexity
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
        if (
          sourceContext !== undefined &&
          targetContext !== undefined &&
          sourceContext !== targetContext &&
          cycleCheckedContexts.has(sourceContext) &&
          cycleCheckedContexts.has(targetContext)
        ) {
          if (
            !approvedContextDependencies[sourceContext]?.includes(targetContext)
          ) {
            violations.add(
              `context dependency is not an approved one-way edge: ${sourceContext} -> ${targetContext}`
            );
          }
          const targetCategory = target.split("/").at(3);
          if (
            targetCategory === undefined ||
            !publicContractCategories.has(targetCategory)
          ) {
            violations.add(
              "cross-context dependencies must target public contracts, domain models, ports or integration modules"
            );
          }
        }
        if (inModules && target.startsWith("src/apps/")) {
          violations.add("business modules must not import runtime apps");
        }
        if (isPlatformBusinessImport(inPlatform, target)) {
          violations.add("platform modules must not import business contexts");
        }
        if (
          inAdapter &&
          !inD1Adapter &&
          targetContext !== undefined &&
          targetContext !== sourceContext &&
          target.includes("/adapters/")
        ) {
          violations.add(
            "adapters must not import another context's adapters or schemas"
          );
        }
        if (
          inContextLayer &&
          targetContext !== undefined &&
          targetContext !== sourceContext &&
          (target.includes("/adapters/") || target.includes("/layers/"))
        ) {
          violations.add(
            "context layers must not select another context's concrete layers"
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
  const sources: ArchitectureSource[] = [];

  for (const absolutePath of files) {
    const file = normalize(path.relative(root, absolutePath));
    const source = await readFile(absolutePath, "utf-8");
    sources.push({ file, source });
    violations.push(
      ...checkArchitecturePath(file).map(
        (violation) => `${file}: ${violation}`
      ),
      ...checkArchitectureImports(file, source).map(
        (violation) => `${file}: ${violation}`
      )
    );
  }
  violations.push(...checkArchitectureCycles(sources));

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
