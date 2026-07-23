import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as ts from "typescript";

const root = fileURLToPath(new URL("..", import.meta.url));
const sourceDirectory = path.join(root, "src");
const nativeD1AdapterFile =
  "src/platform/control-plane-d1/ControlPlaneBatch.ts";
const storageSqlExecutionFile =
  "src/modules/mailbox/adapters/sqlite/MailboxSqliteMigrations.ts";
const controlPlaneD1BindingFiles = new Set([
  "src/auth/storage-live.ts",
  "src/platform/control-plane-d1/ControlPlaneBatch.ts",
  "src/platform/control-plane-d1/ControlPlaneDatabase.ts",
  "src/workers/backend.ts",
]);
const nativeMethods = new Set(["batch", "exec", "prepare"]);
const rawStringMethods = new Set(["all", "get", "run", "values"]);
const messages = {
  binding: "ControlPlaneD1Binding capability access",
  native: "native D1 prepare/batch/exec access",
  rawObject: "handwritten SQL object passed to an execution call",
  rawString: "raw string SQL execution",
  sqlRaw: "sql.raw(...) bypasses typed Drizzle fragments",
  storage: "storage.sql.exec(...) execution",
  unsafe: ".unsafe(...) bypasses typed SQL execution",
} as const;

interface MemberAccess {
  readonly name: string;
  readonly receiver: ts.Expression;
}

interface SourceFacts {
  readonly bindings: Set<string>;
  readonly bindingNames: Set<string>;
  readonly clientProviders: Set<string>;
  readonly clients: Set<string>;
  readonly declarations: ts.VariableDeclaration[];
  readonly nativeAliases: Set<string>;
  readonly rawQueryAliases: Set<string>;
  readonly rawStatements: Set<string>;
  readonly rawStrings: Set<string>;
  readonly sqlNames: Set<string>;
  readonly unsafeAliases: Set<string>;
}

const unwrap = (expression: ts.Expression): ts.Expression => {
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isAwaitExpression(expression)
  ) {
    return unwrap(expression.expression);
  }
  if (ts.isYieldExpression(expression) && expression.expression !== undefined) {
    return unwrap(expression.expression);
  }
  return expression;
};

const staticName = (
  expression: ts.Expression | undefined
): string | undefined => {
  if (expression === undefined) {
    return undefined;
  }
  const value = unwrap(expression);
  return ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)
    ? value.text
    : undefined;
};

const memberAccess = (expression: ts.Expression): MemberAccess | undefined => {
  const value = unwrap(expression);
  if (ts.isPropertyAccessExpression(value)) {
    return { name: value.name.text, receiver: value.expression };
  }
  if (ts.isElementAccessExpression(value)) {
    const name = staticName(value.argumentExpression);
    return name === undefined
      ? undefined
      : { name, receiver: value.expression };
  }
  return undefined;
};

const sqlClientType = (type: ts.TypeNode | undefined): boolean =>
  type !== undefined &&
  /\b(?:ControlPlaneDatabase|D1Client|D1Database|EffectSQLiteD1Database)\b/u.test(
    type.getText()
  );

const collectFacts = (sourceFile: ts.SourceFile): SourceFacts => {
  const facts: SourceFacts = {
    bindings: new Set(),
    bindingNames: new Set(["ControlPlaneD1Binding"]),
    clientProviders: new Set(["ControlPlaneDatabase"]),
    clients: new Set(),
    declarations: [],
    nativeAliases: new Set(),
    rawQueryAliases: new Set(),
    rawStatements: new Set(),
    rawStrings: new Set(),
    sqlNames: new Set(["sql"]),
    unsafeAliases: new Set(),
  };

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) {
      facts.declarations.push(node);
    }
    if (
      (ts.isVariableDeclaration(node) || ts.isParameter(node)) &&
      ts.isIdentifier(node.name) &&
      sqlClientType(node.type)
    ) {
      facts.clients.add(node.name.text);
    }
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.importClause?.namedBindings !== undefined &&
      ts.isNamedImports(node.importClause.namedBindings)
    ) {
      for (const specifier of node.importClause.namedBindings.elements) {
        const imported = specifier.propertyName?.text ?? specifier.name.text;
        if (node.moduleSpecifier.text === "drizzle-orm" && imported === "sql") {
          facts.sqlNames.add(specifier.name.text);
        }
        if (imported === "ControlPlaneD1Binding") {
          facts.bindingNames.add(specifier.name.text);
        }
        if (imported === "ControlPlaneDatabase") {
          facts.clientProviders.add(specifier.name.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return facts;
};

const isNamed = (
  expression: ts.Expression,
  names: ReadonlySet<string>
): boolean => {
  const value = unwrap(expression);
  return ts.isIdentifier(value) && names.has(value.text);
};

const isRawString = (
  expression: ts.Expression,
  facts: SourceFacts
): boolean => {
  const value = unwrap(expression);
  if (
    ts.isStringLiteral(value) ||
    ts.isNoSubstitutionTemplateLiteral(value) ||
    ts.isTemplateExpression(value) ||
    (ts.isIdentifier(value) && facts.rawStrings.has(value.text))
  ) {
    return true;
  }
  return (
    ts.isBinaryExpression(value) &&
    value.operatorToken.kind === ts.SyntaxKind.PlusToken &&
    (isRawString(value.left, facts) || isRawString(value.right, facts))
  );
};

const propertyName = (name: ts.PropertyName): string | undefined => {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name)
  ) {
    return name.text;
  }
  return ts.isComputedPropertyName(name)
    ? staticName(name.expression)
    : undefined;
};

const isRawStatement = (
  expression: ts.Expression,
  facts: SourceFacts
): boolean => {
  const value = unwrap(expression);
  if (ts.isIdentifier(value)) {
    return facts.rawStatements.has(value.text);
  }
  if (ts.isArrayLiteralExpression(value)) {
    return value.elements.some(
      (element) =>
        !ts.isOmittedExpression(element) && isRawStatement(element, facts)
    );
  }
  if (!ts.isObjectLiteralExpression(value)) {
    return false;
  }
  return value.properties.some(
    (property) =>
      ts.isPropertyAssignment(property) &&
      propertyName(property.name) === "sql" &&
      isRawString(property.initializer, facts)
  );
};

const isBinding = (expression: ts.Expression, facts: SourceFacts): boolean => {
  const value = unwrap(expression);
  return (
    ts.isIdentifier(value) &&
    (facts.bindingNames.has(value.text) || facts.bindings.has(value.text))
  );
};

const isClient = (expression: ts.Expression, facts: SourceFacts): boolean => {
  const value = unwrap(expression);
  if (ts.isIdentifier(value)) {
    return (
      facts.clients.has(value.text) || facts.clientProviders.has(value.text)
    );
  }
  const access = memberAccess(value);
  if (access?.name === "$client") {
    return isClient(access.receiver, facts);
  }
  if (access?.name === "database") {
    return isBinding(access.receiver, facts);
  }
  if (access?.name === "db") {
    const config = memberAccess(access.receiver);
    return config?.name === "config" && isClient(config.receiver, facts);
  }
  return false;
};

const recordMethodAlias = (
  facts: SourceFacts,
  alias: string,
  method: string
): void => {
  if (nativeMethods.has(method)) {
    facts.nativeAliases.add(alias);
  } else if (rawStringMethods.has(method)) {
    facts.rawQueryAliases.add(alias);
  } else if (method === "unsafe") {
    facts.unsafeAliases.add(alias);
  }
};

const collectIdentifierAlias = (
  facts: SourceFacts,
  name: string,
  initializer: ts.Expression
): void => {
  if (isBinding(initializer, facts)) {
    facts.bindings.add(name);
  }
  if (isClient(initializer, facts)) {
    facts.clients.add(name);
  }
  const access = memberAccess(initializer);
  if (access !== undefined && isClient(access.receiver, facts)) {
    recordMethodAlias(facts, name, access.name);
  }
  if (isRawString(initializer, facts)) {
    facts.rawStrings.add(name);
  }
  if (isRawStatement(initializer, facts)) {
    facts.rawStatements.add(name);
  }
};

const bindingElementSource = (
  element: ts.BindingElement
): string | undefined =>
  element.propertyName === undefined
    ? ts.isIdentifier(element.name)
      ? element.name.text
      : undefined
    : propertyName(element.propertyName);

const collectBindingPatternAliases = (
  facts: SourceFacts,
  pattern: ts.ObjectBindingPattern,
  initializer: ts.Expression
): void => {
  if (isBinding(initializer, facts)) {
    for (const element of pattern.elements) {
      if (
        bindingElementSource(element) === "database" &&
        ts.isIdentifier(element.name)
      ) {
        facts.clients.add(element.name.text);
      }
    }
    return;
  }
  if (!isClient(initializer, facts)) {
    return;
  }
  for (const element of pattern.elements) {
    if (ts.isIdentifier(element.name)) {
      recordMethodAlias(
        facts,
        element.name.text,
        bindingElementSource(element) ?? ""
      );
    }
  }
};

const collectAliases = (facts: SourceFacts): void => {
  for (const declaration of facts.declarations) {
    if (declaration.initializer === undefined) {
      continue;
    }
    const { initializer } = declaration;
    if (ts.isIdentifier(declaration.name)) {
      collectIdentifierAlias(facts, declaration.name.text, initializer);
      continue;
    }
    if (ts.isObjectBindingPattern(declaration.name)) {
      collectBindingPatternAliases(facts, declaration.name, initializer);
    }
  }
};

const isStorageExec = (access: MemberAccess): boolean => {
  if (access.name !== "exec") {
    return false;
  }
  const sql = memberAccess(access.receiver);
  const storage = sql === undefined ? undefined : unwrap(sql.receiver);
  return (
    sql?.name === "sql" &&
    storage !== undefined &&
    ts.isIdentifier(storage) &&
    storage.text === "storage"
  );
};

export const checkSourcePolicy = (
  file: string,
  source: string
): readonly string[] => {
  const normalizedFile = file.replaceAll("\\", "/");
  const sourceFile = ts.createSourceFile(
    normalizedFile,
    source,
    ts.ScriptTarget.Latest,
    true,
    normalizedFile.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const facts = collectFacts(sourceFile);
  collectAliases(facts);
  const violations = new Set<string>();
  if (facts.nativeAliases.size > 0 && normalizedFile !== nativeD1AdapterFile) {
    violations.add(messages.native);
  }
  if (facts.unsafeAliases.size > 0) {
    violations.add(messages.unsafe);
  }

  const inspectAccess = (node: ts.Expression): void => {
    const access = memberAccess(node);
    if (access?.name === "raw" && isNamed(access.receiver, facts.sqlNames)) {
      violations.add(messages.sqlRaw);
    } else if (access?.name === "unsafe" && isClient(access.receiver, facts)) {
      violations.add(messages.unsafe);
    } else if (access !== undefined && isStorageExec(access)) {
      if (normalizedFile !== storageSqlExecutionFile) {
        violations.add(messages.storage);
      }
    } else if (
      access !== undefined &&
      nativeMethods.has(access.name) &&
      isClient(access.receiver, facts) &&
      normalizedFile !== nativeD1AdapterFile
    ) {
      violations.add(messages.native);
    }
  };

  const inspectCall = (node: ts.CallExpression): void => {
    const access = memberAccess(node.expression);
    const target = unwrap(node.expression);
    const [argument] = node.arguments;
    if (
      ((access !== undefined &&
        rawStringMethods.has(access.name) &&
        isClient(access.receiver, facts)) ||
        (ts.isIdentifier(target) && facts.rawQueryAliases.has(target.text))) &&
      argument !== undefined &&
      isRawString(argument, facts)
    ) {
      violations.add(messages.rawString);
    }
    if (
      access !== undefined &&
      (access.name === "execute" || access.name === "batch") &&
      node.arguments.some((item) => isRawStatement(item, facts))
    ) {
      violations.add(messages.rawObject);
    }
  };

  const visit = (node: ts.Node): void => {
    if (
      ts.isIdentifier(node) &&
      facts.bindingNames.has(node.text) &&
      !controlPlaneD1BindingFiles.has(normalizedFile)
    ) {
      violations.add(messages.binding);
    }
    if (
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node)
    ) {
      inspectAccess(node);
    }
    if (ts.isCallExpression(node)) {
      inspectCall(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return Object.values(messages).filter((message) => violations.has(message));
};

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

const main = async (): Promise<void> => {
  const violations: string[] = [];
  for (const absolutePath of await sourceFiles(sourceDirectory)) {
    const file = path.relative(root, absolutePath);
    const source = await readFile(absolutePath, "utf-8");
    violations.push(
      ...checkSourcePolicy(file, source).map(
        (violation) => `${file}: ${violation}`
      )
    );
  }
  if (violations.length > 0) {
    throw new Error(`SQL source policy violations:\n${violations.join("\n")}`);
  }
  console.log(
    "Verified SQL uses Drizzle builders and reviewed native execution capabilities."
  );
};

const [, entrypoint] = process.argv;
if (
  entrypoint !== undefined &&
  pathToFileURL(path.resolve(entrypoint)).href === import.meta.url
) {
  await main();
}
