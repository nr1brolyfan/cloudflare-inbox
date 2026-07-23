import { describe, expect, it } from "vitest";

import {
  checkArchitectureCycles,
  checkArchitectureImports,
  checkArchitecturePath,
  checkArchitectureSource,
  checkArchitectureSourceLayout,
  checkArchitectureTestLayout,
} from "../../scripts/check-architecture";

describe("architecture policy", () => {
  it("accepts PascalCase modules in lowercase category directories", () => {
    expect(
      checkArchitecturePath(
        "src/modules/mailbox/application/MailboxMessageReading.ts"
      )
    ).toStrictEqual([]);
  });

  it("rejects legacy file and category casing in managed roots", () => {
    expect(
      checkArchitecturePath(
        "src/modules/Mailbox/application/message-reading.ts"
      )
    ).toStrictEqual([
      "first-class TypeScript modules must use PascalCase filenames",
      "architecture/category directory must use lowercase kebab-case: Mailbox",
    ]);
  });

  it("rejects application imports from adapters", () => {
    expect(
      checkArchitectureImports(
        "src/modules/mailbox/application/MailboxMessageReading.ts",
        'import { Repository } from "../adapters/Repository";'
      )
    ).toStrictEqual(["domain, application and ports must not import adapters"]);
  });

  it("rejects business-module imports from runtime apps", () => {
    expect(
      checkArchitectureImports(
        "src/modules/mailbox/adapters/http/MailboxHttpHandlers.ts",
        'import { Backend } from "../../../../apps/backend-worker/BackendWorker";'
      )
    ).toStrictEqual(["business modules must not import runtime apps"]);
  });

  it("rejects mailbox imports from the authorization context", () => {
    expect(
      checkArchitectureImports(
        "src/modules/mailbox/application/MailboxMessageReading.ts",
        'import { Policy } from "../../authorization/application/Policy";'
      )
    ).toStrictEqual([
      "context dependency is not an approved one-way edge: mailbox -> authorization",
      "cross-context dependencies must target public contracts, domain models, ports or integration modules",
    ]);
  });

  it("rejects cross-context concrete D1 adapter imports", () => {
    expect(
      checkArchitectureImports(
        "src/modules/account-security/adapters/d1/RecoveryD1.ts",
        'import { address } from "#/modules/address-routing/adapters/d1/AddressRoutingSchema";'
      )
    ).toStrictEqual([
      "cross-context dependencies must target public contracts, domain models, ports or integration modules",
      "D1 adapters must use cross-context integration contracts, not concrete adapters or schemas",
    ]);
  });

  it("accepts deliberate cross-context D1 integration contracts", () => {
    expect(
      checkArchitectureImports(
        "src/modules/account-security/adapters/d1/RecoveryD1.ts",
        'import { addressAvailable } from "#/modules/address-routing/integration/AddressRoutingD1Statements";'
      )
    ).toStrictEqual([]);
  });

  it("rejects platform dependencies on business contexts", () => {
    expect(
      checkArchitectureImports(
        "src/platform/control-plane-d1/RequestAuthGuard.ts",
        'import type { RequestAuth } from "#/modules/account-security/ports/CurrentRequestAuth";'
      )
    ).toStrictEqual([
      "platform modules must not import business contexts or apps",
    ]);
  });

  it("scans export-from and dynamic imports", () => {
    expect(
      checkArchitectureImports(
        "src/modules/mailbox/domain/Example.ts",
        `
          export { Handler } from "../adapters/http/Handler";
          const load = () => import("cloudflare:workers");
        `
      )
    ).toStrictEqual([
      "domain modules must not depend on HTTP, storage, Cloudflare, Alchemy, React or Workflow adapters",
      "domain, application and ports must not import adapters",
    ]);
  });

  it("rejects shared dependencies on higher architecture roots", () => {
    expect(
      checkArchitectureImports(
        "src/shared/Example.ts",
        'export { Mailbox } from "../modules/mailbox/domain/Mailbox";'
      )
    ).toStrictEqual([
      "shared modules must not import modules, apps or platform",
    ]);
  });

  it("rejects unapproved cross-app dependencies", () => {
    expect(
      checkArchitectureImports(
        "src/apps/website/WebsiteApplication.ts",
        'const workflow = import("../inbound-workflow/InboundWorkflow");'
      )
    ).toStrictEqual([
      "app dependency is not an approved one-way edge: website -> inbound-workflow",
    ]);
  });

  it("includes AI in approved context edges and cycle checks", () => {
    expect(
      checkArchitectureImports(
        "src/modules/ai/domain/MailTools.ts",
        'export { MailboxId } from "../../mailbox/domain/Mailbox";'
      )
    ).toStrictEqual([]);
    expect(
      checkArchitectureCycles([
        {
          file: "src/modules/ai/domain/MailTools.ts",
          source: 'export { MailboxId } from "../../mailbox/domain/Mailbox";',
        },
        {
          file: "src/modules/mailbox/domain/Mailbox.ts",
          source: 'const tools = import("../../ai/domain/MailTools");',
        },
      ])
    ).toStrictEqual(["context dependency cycle: ai <-> mailbox"]);
  });

  it("accepts explicitly approved cross-context application surfaces", () => {
    expect(
      checkArchitectureImports(
        "src/modules/ai/ports/AiToolExecutor.ts",
        'import { Reading } from "#/modules/mailbox/application/MailboxMessageReading";'
      )
    ).toStrictEqual([]);
  });

  it("rejects forbidden compatibility re-exports and phantom placement", () => {
    expect(
      checkArchitectureSource(
        "src/modules/mailbox/domain/Mailbox.ts",
        `
          export { Version } from "#/shared/Temporal";
          const runtime = RuntimeContext.phantom;
        `
      )
    ).toStrictEqual([
      "RuntimeContext.phantom is allowed only in concrete adapters and apps",
      "cross-boundary compatibility re-exports are forbidden; import from the owner",
    ]);
  });

  it("enforces local Layer and application service naming", () => {
    expect(
      checkArchitectureSource(
        "src/modules/mailbox/application/Example.ts",
        `
          export const ExampleLive = Layer.succeed(Example, {});
          export class Clock extends Context.Service<Clock>()("Clock") {}
        `
      )
    ).toStrictEqual([
      "local declarations must use a descriptive *Layer name, not ExampleLive",
      "standalone Layer export must use PascalCase and end in Layer: ExampleLive",
      "Clock must define make and static layerNoDeps or move to ports/contracts",
    ]);
  });

  it("enforces exact source roots and required architecture roots", () => {
    const required = [
      "account-security",
      "address-routing",
      "administrative-audit",
      "ai",
      "authorization",
      "automation",
      "mailbox",
      "organization",
    ].map((context) => `src/modules/${context}/domain/Example.ts`);
    const apps = [
      "async-rule-workflow",
      "backend-worker",
      "inbound-workflow",
      "mailbox-do",
      "website",
    ].map((app) => `src/apps/${app}/Example.ts`);
    const platform = ["cloudflare", "control-plane-d1", "observability"].map(
      (capability) => `src/platform/${capability}/Example.ts`
    );
    expect(
      checkArchitectureSourceLayout([
        ...required,
        ...apps,
        ...platform,
        "src/routes/index.tsx",
        "src/auth/schema/index.ts",
        "src/router.tsx",
        "src/routeTree.gen.ts",
        "src/styles.css",
      ])
    ).toStrictEqual([]);
    expect(
      checkArchitectureSourceLayout([
        ...required,
        ...apps,
        ...platform,
        "src/legacy/Legacy.ts",
      ])
    ).toContain(
      "src/legacy/Legacy.ts: source path is not an allowed architecture root"
    );
  });

  it("requires managed tests to mirror source paths", () => {
    expect(
      checkArchitectureTestLayout(
        ["src/modules/mailbox/domain/Mailbox.ts"],
        ["tests/modules/mailbox/domain/Mailbox.test.ts"]
      )
    ).toStrictEqual([]);
    expect(
      checkArchitectureTestLayout(
        ["src/modules/mailbox/domain/Mailbox.ts"],
        ["tests/modules/mailbox/domain/MailboxVariant.test.ts"]
      )
    ).toStrictEqual([
      "tests/modules/mailbox/domain/MailboxVariant.test.ts: managed test must mirror src/modules/mailbox/domain/MailboxVariant.ts",
    ]);
  });

  it("rejects cross-context adapter imports outside D1", () => {
    expect(
      checkArchitectureImports(
        "src/modules/authorization/adapters/transport/Resolver.ts",
        'import { Client } from "#/modules/mailbox/adapters/durable-object/MailboxDoClient";'
      )
    ).toStrictEqual([
      "cross-context dependencies must target public contracts, domain models, ports or integration modules",
      "adapters must not import another context's adapters or schemas",
    ]);
  });

  it("rejects concrete cross-context selection from context layers", () => {
    expect(
      checkArchitectureImports(
        "src/modules/mailbox/layers/MailboxHttpLayer.ts",
        'import { OrganizationLayer } from "#/modules/organization/layers/OrganizationLayer";'
      )
    ).toStrictEqual([
      "context dependency is not an approved one-way edge: mailbox -> organization",
      "cross-context dependencies must target public contracts, domain models, ports or integration modules",
      "context layers must not select another context's concrete layers",
    ]);
  });

  it("rejects unapproved cross-context application imports", () => {
    expect(
      checkArchitectureImports(
        "src/modules/mailbox/adapters/http/MailboxHttpHandlers.ts",
        'import { Navigation } from "#/modules/organization/application/MailboxNavigation";'
      )
    ).toStrictEqual([
      "context dependency is not an approved one-way edge: mailbox -> organization",
      "cross-context dependencies must target public contracts, domain models, ports or integration modules",
    ]);
  });

  it("detects context-level strongly connected components", () => {
    expect(
      checkArchitectureCycles([
        {
          file: "src/modules/mailbox/ports/Example.ts",
          source:
            'import type { Organization } from "#/modules/organization/domain/Mailbox";',
        },
        {
          file: "src/modules/organization/ports/Example.ts",
          source:
            'import type { Mailbox } from "#/modules/mailbox/domain/Mailbox";',
        },
      ])
    ).toStrictEqual(["context dependency cycle: mailbox <-> organization"]);
  });
});
