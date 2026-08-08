import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as ts from "typescript-legacy";

const root = fileURLToPath(new URL("..", import.meta.url));
const managedRoots = ["modules", "apps", "platform", "shared"] as const;
const requiredContexts = [
  "account-security",
  "address-routing",
  "administrative-audit",
  "ai",
  "authorization",
  "automation",
  "mailbox",
  "organization",
] as const;
const requiredApps = [
  "async-rule-workflow",
  "backend-worker",
  "inbound-workflow",
  "mailbox-do",
  "website",
] as const;
const requiredPlatforms = [
  "cloudflare",
  "control-plane-d1",
  "observability",
] as const;
const categoryName = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const moduleName = /^[A-Z][A-Za-z0-9]*\.tsx?$/u;
const integrationTestName = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.test\.tsx?$/u;
const publicContractCategories = new Set([
  "contracts",
  "domain",
  "integration",
  "ports",
]);
const approvedContextDependencies: Readonly<
  Record<(typeof requiredContexts)[number], readonly string[]>
> = {
  "account-security": [
    "address-routing",
    "administrative-audit",
    "organization",
  ],
  "address-routing": ["mailbox", "organization"],
  "administrative-audit": ["mailbox"],
  ai: ["mailbox"],
  authorization: ["mailbox"],
  automation: ["mailbox"],
  mailbox: [],
  organization: ["administrative-audit", "mailbox"],
};
const approvedAppDependencies: Readonly<
  Record<(typeof requiredApps)[number], readonly string[]>
> = {
  "async-rule-workflow": [],
  "backend-worker": ["inbound-workflow", "mailbox-do"],
  "inbound-workflow": ["async-rule-workflow", "mailbox-do"],
  "mailbox-do": [],
  website: ["backend-worker"],
};
const approvedCrossContextApplicationModules = new Set([
  "src/modules/mailbox/application/MailboxDraftEditing",
  "src/modules/mailbox/application/MailboxMessageReading",
]);
const integrationTestFiles = new Set([
  "tests/integration/ai/ai-tool-executor-draft.test.ts",
  "tests/integration/ai/ai-tool-executor-foundation.test.ts",
  "tests/integration/ai/ai-tool-executor-hardening.test.ts",
  "tests/integration/mailbox/mailbox-inbound-repository-do-recorder.test.ts",
  "tests/integration/mailbox/mailbox-mail-data-sqlite.test.ts",
  "tests/integration/mailbox/mailbox-restore-rehearsal.test.ts",
  "tests/integration/organization/mailbox-legacy-organization-assignment-d1.test.ts",
  "tests/integration/organization/mailbox-organization-d1.test.ts",
  "tests/integration/organization/organization-legacy-cutover-d1.test.ts",
  "tests/integration/organization/organization-member-schema-d1.test.ts",
  "tests/integration/organization/organization-owner-assignment-d1.test.ts",
  "tests/integration/organization/user-organization-preference-d1.test.ts",
]);
const allowedTestRoots = new Set([
  ...managedRoots,
  "integration",
  "routes",
  "scripts",
  "support",
]);
const forbiddenDomainTechnology =
  /(?:^|[/:-])(?:alchemy|cloudflare|d1|durable-object|http|r2|react|sqlite|workflow)(?:[/:-]|$)|^@effect\/(?:platform|sql)|^@tanstack\//u;

const isDirectLayerInitializer = (node: ts.Expression): boolean => {
  if (
    !ts.isCallExpression(node) ||
    !ts.isPropertyAccessExpression(node.expression)
  ) {
    return false;
  }
  return (
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "Layer"
  );
};

const isBootstrapAuthorityMember = (node: ts.Node): boolean => {
  if (
    !ts.isPropertySignature(node) &&
    !ts.isMethodSignature(node) &&
    !ts.isPropertyDeclaration(node) &&
    !ts.isMethodDeclaration(node)
  ) {
    return false;
  }
  const name =
    ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)
      ? node.name.text
      : undefined;
  return name !== undefined && /^bootstrap(?:$|[A-Z0-9_])/u.test(name);
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

const sourceFile = (file: string, source: string): ts.SourceFile =>
  ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

interface SourceDependency {
  readonly specifier: string;
  readonly target: string | undefined;
  readonly type: "dynamic import" | "export-from" | "import";
}

const sourceFileDependencies = (
  file: string,
  source: string
): readonly SourceDependency[] => {
  const parsed = sourceFile(file, source);
  const dependencies: SourceDependency[] = [];
  const add = (
    type: SourceDependency["type"],
    specifier: ts.Expression | undefined
  ): void => {
    if (specifier !== undefined && ts.isStringLiteralLike(specifier)) {
      dependencies.push({
        specifier: specifier.text,
        target: resolveImport(file, specifier.text),
        type,
      });
    }
  };
  const inspect = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      add("import", node.moduleSpecifier);
    } else if (ts.isExportDeclaration(node)) {
      add("export-from", node.moduleSpecifier);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      add("dynamic import", node.arguments[0]);
    }
    ts.forEachChild(node, inspect);
  };
  inspect(parsed);
  return dependencies;
};

const architectureArea = (file: string): string | undefined => {
  const segments = file.split("/");
  if (segments[0] !== "src") {
    return undefined;
  }
  if (segments[1] === "modules" || segments[1] === "apps") {
    return segments[2] === undefined
      ? undefined
      : `${segments[1]}/${segments[2]}`;
  }
  return segments[1];
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

export interface ArchitectureSource {
  readonly file: string;
  readonly source: string;
}

export const checkArchitectureCycles = (
  sources: readonly ArchitectureSource[]
): readonly string[] => {
  const contexts = new Set<string>(requiredContexts);
  const dependencies = new Map<string, Set<string>>(
    requiredContexts.map((context) => [context, new Set()])
  );
  for (const { file, source } of sources) {
    const normalizedFile = normalize(file);
    if (!normalizedFile.startsWith("src/modules/")) {
      continue;
    }
    const sourceContext = normalizedFile.split("/").at(2);
    if (sourceContext === undefined || !contexts.has(sourceContext)) {
      continue;
    }
    for (const { target } of sourceFileDependencies(normalizedFile, source)) {
      const targetContext = target?.startsWith("src/modules/")
        ? target.split("/")[2]
        : undefined;
      if (
        targetContext !== undefined &&
        targetContext !== sourceContext &&
        contexts.has(targetContext)
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

  const remaining = new Set(contexts);
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

export const checkArchitectureSourceLayout = (
  files: readonly string[]
): readonly string[] => {
  const normalizedFiles = files.map(normalize);
  const violations: string[] = [];
  const exactFrameworkFiles = new Set([
    "src/router.tsx",
    "src/routeTree.gen.ts",
    "src/styles.css",
  ]);

  for (const file of normalizedFiles) {
    const allowed =
      exactFrameworkFiles.has(file) ||
      file.startsWith("src/components/ui/") ||
      file.startsWith("src/routes/") ||
      file.startsWith("src/auth/schema/") ||
      managedRoots.some((managedRoot) =>
        file.startsWith(`src/${managedRoot}/`)
      );
    if (!allowed) {
      violations.push(
        `${file}: source path is not an allowed architecture root`
      );
    }
  }

  const requireRoots = (directory: string, names: readonly string[]): void => {
    const actual = new Set(
      normalizedFiles
        .filter((file) => file.startsWith(`src/${directory}/`))
        .map((file) => file.split("/")[2])
        .filter((name): name is string => name !== undefined)
    );
    for (const name of names) {
      if (!actual.has(name)) {
        violations.push(
          `src/${directory}/${name}: required architecture root is missing`
        );
      }
    }
    for (const name of actual) {
      if (!names.includes(name)) {
        violations.push(
          `src/${directory}/${name}: architecture root is not approved`
        );
      }
    }
  };
  requireRoots("modules", requiredContexts);
  requireRoots("apps", requiredApps);
  requireRoots("platform", requiredPlatforms);
  return violations;
};

export const checkArchitectureTestLayout = (
  sourceFiles: readonly string[],
  testFiles: readonly string[]
): readonly string[] => {
  const sourceSet = new Set(sourceFiles.map(normalize));
  const violations: string[] = [];
  for (const input of testFiles) {
    const file = normalize(input);
    const [, testRoot, ...rest] = file.split("/");
    if (testRoot === undefined || !allowedTestRoots.has(testRoot)) {
      violations.push(`${file}: test path is not an allowed test root`);
      continue;
    }
    if (testRoot === "integration") {
      if (!integrationTestFiles.has(file)) {
        violations.push(
          `${file}: integration suite is not an explicit exception`
        );
      }
      const fileName = rest.at(-1);
      if (fileName !== undefined && !integrationTestName.test(fileName)) {
        violations.push(
          `${file}: integration test filename must use lowercase kebab-case`
        );
      }
      continue;
    }
    if (!(managedRoots as readonly string[]).includes(testRoot)) {
      continue;
    }
    const relative = rest
      .join("/")
      .replace(/\.test(?<extension>\.tsx?)$/u, "$<extension>");
    const source = `src/${testRoot}/${relative}`;
    if (!sourceSet.has(source)) {
      violations.push(`${file}: managed test must mirror ${source}`);
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

export const checkArchitectureSource = (
  file: string,
  source: string
): readonly string[] => {
  const normalizedFile = normalize(file);
  const parsed = sourceFile(normalizedFile, source);
  const violations = new Set<string>();
  const inApplication =
    normalizedFile.startsWith("src/modules/") &&
    normalizedFile.includes("/application/");
  const phantomAllowed =
    normalizedFile.startsWith("src/apps/") ||
    (normalizedFile.startsWith("src/modules/") &&
      normalizedFile.includes("/adapters/"));

  if (source.includes("RuntimeContext.phantom") && !phantomAllowed) {
    violations.add(
      "RuntimeContext.phantom is allowed only in concrete adapters and apps"
    );
  }
  const bootstrapAuthorityRestricted =
    normalizedFile.startsWith("src/modules/organization/application/") &&
    normalizedFile !==
      "src/modules/organization/application/OrganizationBootstrap.ts";

  // Every branch enforces an independent source-declaration policy.
  // oxlint-disable-next-line eslint/complexity
  const inspect = (node: ts.Node): void => {
    if (bootstrapAuthorityRestricted && isBootstrapAuthorityMember(node)) {
      violations.add(
        "OrganizationBootstrap is the only application bootstrap authority"
      );
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
      const target = ts.isStringLiteralLike(node.moduleSpecifier)
        ? resolveImport(normalizedFile, node.moduleSpecifier.text)
        : undefined;
      if (
        target !== undefined &&
        architectureArea(normalizedFile) !== architectureArea(target)
      ) {
        violations.add(
          "cross-boundary compatibility re-exports are forbidden; import from the owner"
        );
      }
    }
    if (ts.isVariableStatement(node)) {
      const exported = node.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
      );
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) {
          continue;
        }
        const name = declaration.name.text;
        if (/(?:Live|ApiLayer)$/u.test(name)) {
          violations.add(
            `local declarations must use a descriptive *Layer name, not ${name}`
          );
        }
        if (
          exported &&
          declaration.initializer !== undefined &&
          isDirectLayerInitializer(declaration.initializer) &&
          !/^[A-Z][A-Za-z0-9]*Layer$/u.test(name)
        ) {
          violations.add(
            `standalone Layer export must use PascalCase and end in Layer: ${name}`
          );
        }
      }
    }
    if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      node.name !== undefined &&
      /(?:Live|ApiLayer)$/u.test(node.name.text)
    ) {
      violations.add(
        `local declarations must use a descriptive *Layer name, not ${node.name.text}`
      );
    }
    if (ts.isPropertyDeclaration(node) && node.initializer !== undefined) {
      const isStatic = node.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword
      );
      const name = ts.isIdentifier(node.name) ? node.name.text : undefined;
      if (
        isStatic &&
        name !== undefined &&
        node.initializer.getText(parsed).includes("Layer.") &&
        !new Set(["layer", "layerNoDeps", "mockLayer"]).has(name)
      ) {
        violations.add(
          `static service Layer must be named layer, layerNoDeps or mockLayer: ${name}`
        );
      }
    }
    if (inApplication && ts.isClassDeclaration(node)) {
      const serviceHeritage = node.heritageClauses?.find((heritage) =>
        heritage.getText(parsed).includes("Context.Service")
      );
      if (serviceHeritage !== undefined) {
        const serviceName = node.name?.text ?? "application service";
        const hasMake = serviceHeritage.getText(parsed).includes("make:");
        const hasLayerNoDeps = node.members.some(
          (member) =>
            ts.isPropertyDeclaration(member) &&
            ts.isIdentifier(member.name) &&
            member.name.text === "layerNoDeps"
        );
        if (!hasMake || !hasLayerNoDeps) {
          violations.add(
            `${serviceName} must define make and static layerNoDeps or move to ports/contracts`
          );
        }
      }
    }
    ts.forEachChild(node, inspect);
  };
  inspect(parsed);
  return [...violations];
};

// Every branch enforces an independent dependency rule.
// oxlint-disable-next-line eslint/complexity
export const checkArchitectureImports = (
  file: string,
  source: string
): readonly string[] => {
  const normalizedFile = normalize(file);
  const violations = new Set<string>();
  const inModules = normalizedFile.startsWith("src/modules/");
  const inApps = normalizedFile.startsWith("src/apps/");
  const inPlatform = normalizedFile.startsWith("src/platform/");
  const inShared = normalizedFile.startsWith("src/shared/");
  const sourceContext = inModules ? normalizedFile.split("/")[2] : undefined;
  const sourceApp = inApps ? normalizedFile.split("/")[2] : undefined;
  const inD1Adapter = inModules && normalizedFile.includes("/adapters/d1/");
  const inAdapter = inModules && normalizedFile.includes("/adapters/");
  const inContextLayer = inModules && normalizedFile.includes("/layers/");
  const inDomain = inModules && normalizedFile.includes("/domain/");
  const inApplication = inModules && normalizedFile.includes("/application/");
  const inPorts = inModules && normalizedFile.includes("/ports/");

  for (const dependency of sourceFileDependencies(normalizedFile, source)) {
    const { specifier, target } = dependency;
    if (inDomain && forbiddenDomainTechnology.test(specifier.toLowerCase())) {
      violations.add(
        "domain modules must not depend on HTTP, storage, Cloudflare, Alchemy, React or Workflow adapters"
      );
    }
    if (target === undefined) {
      continue;
    }
    const targetContext = target.startsWith("src/modules/")
      ? target.split("/")[2]
      : undefined;
    const targetApp = target.startsWith("src/apps/")
      ? target.split("/")[2]
      : undefined;
    if (
      sourceContext !== undefined &&
      targetContext !== undefined &&
      sourceContext !== targetContext &&
      requiredContexts.includes(
        sourceContext as (typeof requiredContexts)[number]
      ) &&
      requiredContexts.includes(
        targetContext as (typeof requiredContexts)[number]
      )
    ) {
      if (
        !approvedContextDependencies[
          sourceContext as (typeof requiredContexts)[number]
        ].includes(targetContext)
      ) {
        violations.add(
          `context dependency is not an approved one-way edge: ${sourceContext} -> ${targetContext}`
        );
      }
      const targetCategory = target.split("/").at(3);
      const approvedApplicationModule = [
        ...approvedCrossContextApplicationModules,
      ].some((module) => target === module || target.startsWith(`${module}.`));
      if (
        (targetCategory === undefined ||
          !publicContractCategories.has(targetCategory)) &&
        !approvedApplicationModule
      ) {
        violations.add(
          "cross-context dependencies must target public contracts, domain models, ports or integration modules"
        );
      }
    }
    if (
      sourceApp !== undefined &&
      targetApp !== undefined &&
      sourceApp !== targetApp &&
      requiredApps.includes(sourceApp as (typeof requiredApps)[number]) &&
      !approvedAppDependencies[
        sourceApp as (typeof requiredApps)[number]
      ].includes(targetApp)
    ) {
      violations.add(
        `app dependency is not an approved one-way edge: ${sourceApp} -> ${targetApp}`
      );
    }
    if (inModules && target.startsWith("src/apps/")) {
      violations.add("business modules must not import runtime apps");
    }
    if (isPlatformBusinessImport(inPlatform, target)) {
      violations.add(
        "platform modules must not import business contexts or apps"
      );
    }
    if (
      inShared &&
      (target.startsWith("src/modules/") ||
        target.startsWith("src/apps/") ||
        target.startsWith("src/platform/"))
    ) {
      violations.add(
        "shared modules must not import modules, apps or platform"
      );
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
      violations.add("domain, application and ports must not import adapters");
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
  return [...violations];
};

const filesInDirectory = async (
  directory: string
): Promise<readonly string[]> => {
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
      files.push(...(await filesInDirectory(entryPath)));
    } else {
      files.push(entryPath);
    }
  }
  return files;
};

const main = async (): Promise<void> => {
  const [absoluteSourceFiles, absoluteTestFiles] = await Promise.all([
    filesInDirectory(path.join(root, "src")),
    filesInDirectory(path.join(root, "tests")),
  ]);
  const sourcePaths = absoluteSourceFiles.map((file) =>
    normalize(path.relative(root, file))
  );
  const testPaths = absoluteTestFiles.map((file) =>
    normalize(path.relative(root, file))
  );
  const managedFiles = sourcePaths.filter(
    (file) =>
      /\.tsx?$/u.test(file) &&
      managedRoots.some((directory) => file.startsWith(`src/${directory}/`))
  );
  const violations: string[] = [
    ...checkArchitectureSourceLayout(sourcePaths),
    ...checkArchitectureTestLayout(sourcePaths, testPaths),
  ];
  const sources: ArchitectureSource[] = [];

  for (const file of managedFiles) {
    const source = await readFile(path.join(root, file), "utf-8");
    sources.push({ file, source });
    violations.push(
      ...checkArchitecturePath(file).map(
        (violation) => `${file}: ${violation}`
      ),
      ...checkArchitectureSource(file, source).map(
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
  console.log(
    `Verified architecture policy for ${managedFiles.length} source files and ${testPaths.length} test files.`
  );
};

const [, entrypoint] = process.argv;
if (
  entrypoint !== undefined &&
  pathToFileURL(path.resolve(entrypoint)).href === import.meta.url
) {
  await main();
}
