import { describe, expect, it } from "vitest";

import {
  checkArchitectureImports,
  checkArchitecturePath,
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
      "mailbox must depend on its authorization port, not the authorization context",
    ]);
  });

  it("rejects cross-context concrete D1 adapter imports", () => {
    expect(
      checkArchitectureImports(
        "src/modules/account-security/adapters/d1/RecoveryD1.ts",
        'import { address } from "#/modules/address-routing/adapters/d1/AddressRoutingSchema";'
      )
    ).toStrictEqual([
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
    ).toStrictEqual(["platform modules must not import business contexts"]);
  });

  it("rejects cross-context adapter imports outside D1", () => {
    expect(
      checkArchitectureImports(
        "src/modules/authorization/adapters/transport/Resolver.ts",
        'import { Client } from "#/modules/mailbox/adapters/durable-object/MailboxDoClient";'
      )
    ).toStrictEqual([
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
      "context layers must not select another context's concrete layers",
    ]);
  });
});
