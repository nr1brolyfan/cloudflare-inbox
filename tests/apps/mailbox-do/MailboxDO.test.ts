import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../../src/apps/mailbox-do/MailboxDO.ts", import.meta.url),
  "utf-8"
);

describe("MailboxDO binding discovery", () => {
  it("omits the email binding from the development graph", () => {
    const outerEmail = source.indexOf("yield* Cloudflare.Email.Send");
    const innerRuntime = source.indexOf("return Effect.gen(function* () {");

    expect(outerEmail).toBeGreaterThan(-1);
    expect(outerEmail).toBeLessThan(innerRuntime);
    expect(source).toContain('process.env.ALCHEMY_DEV === "true"');
  });

  it("accepts Alchemy's JSON boolean environment binding", () => {
    expect(source).toContain(
      'process.env.MAILBOX_OUTBOUND_PROVIDER_DISABLED === "true"'
    );
    expect(source).not.toContain("Config.boolean(");
    expect(source).toContain("providerDisabled ? undefined : email");
  });
});
