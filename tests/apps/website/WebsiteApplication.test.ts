import { requestHandler } from "@tanstack/react-start/server";
import { describe, expect, it } from "vitest";

import { setMailboxOperationReceiptNoStoreHeaders } from "#/apps/website/WebsiteApplication";

describe("website mailbox operation receipt response", () => {
  it("attaches private no-store headers at the TanStack response boundary", async () => {
    const handler = requestHandler(() => {
      setMailboxOperationReceiptNoStoreHeaders();
      return new Response("{}", {
        headers: { "content-type": "application/json" },
      });
    });

    const response = await handler(
      new Request("https://inbox.test/_server/mailbox-operation"),
      {}
    );

    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
  });
});
