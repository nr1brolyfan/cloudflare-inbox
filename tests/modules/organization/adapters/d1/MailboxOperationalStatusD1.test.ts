import { DatabaseSync } from "node:sqlite";

import type { D1Database } from "@cloudflare/workers-types";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { MailboxId } from "#/modules/mailbox/domain/Mailbox";
import { MailboxOperationalStatus } from "#/modules/mailbox/ports/MailboxOperationalStatus";
import { mailboxOperationalStatusD1Layer } from "#/modules/organization/adapters/d1/MailboxOperationalStatusD1";

import {
  applyControlPlaneMigrations,
  insertFreshCutoverOrganization,
  insertOrganizationLifecycleAudit,
  makeTestD1Database,
} from "../../../../support/d1";

describe("MailboxOperationalStatus D1", () => {
  it("acquires an active fence, replays it, releases it, and rejects suspension", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      insertFreshCutoverOrganization(database, 1000);
      database.exec(`
        insert into auth_user (id, created_at, updated_at)
        values ('user-a', 1000, 1000);
        insert into app_mailbox
          (id, display_name, status, created_by_user_id, created_at, updated_at)
        values ('primary', 'Inbox', 'active', 'user-a', 1000, 1000);
      `);
      const mailboxId = Schema.decodeUnknownSync(MailboxId)("primary");
      const fence = {
        mailboxId,
        operationId: "delivery-1",
        operationKind: "outbound-dispatch" as const,
      };
      const run = <A>(
        effect: Effect.Effect<A, unknown, MailboxOperationalStatus>
      ) =>
        Effect.runPromise(
          effect.pipe(
            Effect.provide(
              mailboxOperationalStatusD1Layer(
                makeTestD1Database(database) as unknown as D1Database
              )
            )
          )
        );

      const acquire = Effect.gen(function* () {
        const status = yield* MailboxOperationalStatus;
        return yield* status.acquire(fence);
      });
      const firstHolder = await run(acquire);
      const secondHolder = await run(acquire);
      expect(firstHolder).not.toBeNull();
      expect(secondHolder).not.toBe(firstHolder);
      expect(
        database
          .prepare(
            "select count(*) as count from app_organization_operation_fence"
          )
          .get()
      ).toMatchObject({ count: 2 });

      await run(
        Effect.gen(function* () {
          const status = yield* MailboxOperationalStatus;
          yield* status.release({
            ...fence,
            holderId: firstHolder ?? "missing",
          });
        })
      );
      expect(
        database
          .prepare(
            "select count(*) as count from app_organization_operation_fence"
          )
          .get()
      ).toMatchObject({ count: 1 });
      await run(
        Effect.gen(function* () {
          const status = yield* MailboxOperationalStatus;
          yield* status.release({
            ...fence,
            holderId: secondHolder ?? "missing",
          });
        })
      );
      insertOrganizationLifecycleAudit(database, {
        action: "suspend",
        afterVersion: 2,
        beforeVersion: 1,
        occurredAt: 2000,
        organizationId: "legacy_default_v1",
      });
      database.exec(`
        update app_organization
           set status = 'suspended', updated_at = 2000, version = 2
         where id = 'legacy_default_v1'
      `);
      await expect(
        run(
          Effect.gen(function* () {
            const status = yield* MailboxOperationalStatus;
            return yield* status.acquire({
              ...fence,
              operationId: "delivery-2",
            });
          })
        )
      ).resolves.toBeFalsy();
    } finally {
      database.close();
    }
  });
});
