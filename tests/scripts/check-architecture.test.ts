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
});
