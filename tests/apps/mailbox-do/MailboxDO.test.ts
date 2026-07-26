import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../../src/apps/mailbox-do/MailboxDO.ts", import.meta.url),
  "utf-8"
);

describe("MailboxDO binding discovery", () => {
  it("always discovers email before runtime configuration is read", () => {
    const outerEmail = source.indexOf(
      "const email = yield* Cloudflare.Email.Send(MailboxEmailSender);"
    );
    const innerRuntime = source.indexOf("return Effect.gen(function* () {");

    expect(outerEmail).toBeGreaterThan(-1);
    expect(outerEmail).toBeLessThan(innerRuntime);
    expect(source).not.toContain("ALCHEMY_DEV");
  });

  it("uses the strict runtime flag to select the helper email client", () => {
    expect(source).toContain("yield* Config.boolean(");
    expect(source).toContain('"MAILBOX_OUTBOUND_PROVIDER_DISABLED"');
    expect(source).toContain("providerDisabled ? undefined : email");
  });
});
