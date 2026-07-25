import { UserId } from "@effect-auth/core/Identifiers";
import * as AuthPermission from "@effect-auth/core/Permission";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  EnrollFirstOwnerPasswordCommand,
  FirstOwnerPasswordEnrolled,
  FirstOwnerPasswordEnrollment,
  FirstOwnerPasswordEnrollmentReceipt,
} from "#/modules/account-security/application/FirstOwnerPasswordEnrollment";
import { FirstOwnerPasswordEnrollmentTransaction } from "#/modules/account-security/ports/FirstOwnerPasswordEnrollmentTransaction";
import { AdministrativeOperationId } from "#/shared/Operation";
import { CurrentRequestAuth } from "#/shared/RequestAuth";
import { UnixMillis } from "#/shared/Temporal";

const operationId = Schema.decodeUnknownSync(AdministrativeOperationId)(
  "00000000-0000-4000-8000-000000000101"
);

describe("first-owner password enrollment service", () => {
  it("accepts only caller intent and delegates to the transaction", async () => {
    const seen: unknown[] = [];
    const receipt = FirstOwnerPasswordEnrollmentReceipt.make({
      committedAt: Schema.decodeUnknownSync(UnixMillis)(1),
      operationId,
      schemaVersion: 1,
    });
    const layer = FirstOwnerPasswordEnrollment.layerNoDeps.pipe(
      Layer.provide(
        Layer.succeed(
          FirstOwnerPasswordEnrollmentTransaction,
          FirstOwnerPasswordEnrollmentTransaction.of({
            enroll: (command) =>
              Effect.sync(() => {
                seen.push(command);
                return FirstOwnerPasswordEnrolled.make({
                  _tag: "FirstOwnerPasswordEnrolled",
                  receipt,
                });
              }),
          })
        )
      )
    );

    const result = await Effect.runPromise(
      FirstOwnerPasswordEnrollment.use((service) =>
        service.enroll({
          operationId,
          password: "correct horse battery staple",
        })
      ).pipe(
        Effect.provide(layer),
        Effect.provideService(
          AuthPermission.CurrentPrincipal,
          AuthPermission.CurrentPrincipal.of(
            AuthPermission.PermissionSubject.user(UserId("user-a"))
          )
        ),
        Effect.provideService(
          CurrentRequestAuth,
          CurrentRequestAuth.of({} as never)
        )
      )
    );

    expect(result).toBeInstanceOf(FirstOwnerPasswordEnrolled);
    expect(seen).toStrictEqual([
      {
        operationId,
        password: "correct horse battery staple",
      },
    ]);
  });

  it.each(["email", "mailboxId", "organizationId", "userId"] as const)(
    "rejects caller-provided %s authority",
    async (field) => {
      const decoded = await Effect.runPromiseExit(
        Schema.decodeUnknownEffect(EnrollFirstOwnerPasswordCommand)({
          [field]: "forged",
          operationId,
          password: "correct horse battery staple",
        })
      );

      expect(decoded._tag).toBe("Failure");
    }
  );

  it("rejects short and oversized passwords at the contract boundary", async () => {
    const decode = Schema.decodeUnknownEffect(EnrollFirstOwnerPasswordCommand);
    const short = await Effect.runPromiseExit(
      decode({ operationId, password: "too short" })
    );
    const oversized = await Effect.runPromiseExit(
      decode({
        operationId,
        password: `valid-prefix-${"x".repeat(1024)}`,
      })
    );

    expect(short._tag).toBe("Failure");
    expect(oversized._tag).toBe("Failure");
  });
});
