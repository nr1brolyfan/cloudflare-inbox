import { and, eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { MailboxRegistry } from "#/modules/organization/ports/MailboxRegistry";
import { ControlPlaneDatabase } from "#/platform/control-plane-d1/ControlPlaneDatabase";
import { appMailbox } from "#/platform/control-plane-d1/ControlPlaneSchema";

/** Active mailbox existence lookup backed by the control-plane database. */
export const MailboxRegistryD1Layer = Layer.effect(
  MailboxRegistry,
  Effect.gen(function* () {
    const controlPlane = yield* ControlPlaneDatabase;

    return MailboxRegistry.of({
      exists: (mailboxId) =>
        controlPlane
          .select({ id: appMailbox.id })
          .from(appMailbox)
          .where(
            and(eq(appMailbox.id, mailboxId), eq(appMailbox.status, "active"))
          )
          .limit(1)
          .pipe(Effect.map((rows) => rows.length === 1)),
    });
  })
);
