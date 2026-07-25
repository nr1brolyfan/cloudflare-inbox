import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  BootstrapOrganizationCommand,
  OrganizationBootstrap,
} from "#/modules/organization/application/OrganizationBootstrap";
import {
  MailboxBootstrapConfig,
  MailboxBootstrapConfigValue,
} from "#/modules/organization/contracts/MailboxBootstrapConfig";
import { OrganizationBootstrapTransaction } from "#/modules/organization/ports/OrganizationBootstrapTransaction";
import type { TrustedBootstrapOrganizationCommand } from "#/modules/organization/ports/OrganizationBootstrapTransaction";

describe(OrganizationBootstrap, () => {
  it("captures trusted config and passes no caller or actor authority", async () => {
    const config = Schema.decodeUnknownSync(MailboxBootstrapConfigValue)({
      initialAddress: "inbox@example.test",
      initialDomain: "example.test",
      ownerEmailAllowlist: ["owner@example.test"],
    });
    let trusted: TrustedBootstrapOrganizationCommand | undefined;
    const transaction = OrganizationBootstrapTransaction.of({
      bootstrap: (input) => {
        trusted = input;
        return Effect.die("Result is not evaluated by this construction test");
      },
    });
    const service = await Effect.runPromise(
      OrganizationBootstrap.make.pipe(
        Effect.provideService(
          MailboxBootstrapConfig,
          MailboxBootstrapConfig.of(config)
        ),
        Effect.provideService(OrganizationBootstrapTransaction, transaction)
      )
    );
    const command = Schema.decodeUnknownSync(BootstrapOrganizationCommand)({
      displayName: "Inbox",
      operationId: "00000000-0000-4000-8000-000000000010",
    });

    service.bootstrap(command);

    expect(trusted).toStrictEqual({
      displayName: "Inbox",
      initialAddress: "inbox@example.test",
      initialDomain: "example.test",
      operationId: "00000000-0000-4000-8000-000000000010",
      ownerEmailAllowlist: ["owner@example.test"],
    });
    expect(trusted).not.toHaveProperty("actorUserId");
    expect(trusted).not.toHaveProperty("mailboxId");
    expect(trusted).not.toHaveProperty("organizationId");
    expect(trusted).not.toHaveProperty("ownerUserId");
  });
});
