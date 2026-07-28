import { and, eq, isNull } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { authCredential } from "#/auth/schema/modules/credentials";
import { authPasskeyCredential } from "#/auth/schema/modules/passkeys";
import {
  StepUpFactorReader,
  StepUpFactorReadError,
} from "#/modules/account-security/ports/StepUpFactorReader";
import { ControlPlaneDatabase } from "#/platform/control-plane-d1/ControlPlaneDatabase";

const readError = (cause: unknown) => new StepUpFactorReadError({ cause });

export const StepUpFactorReaderD1Layer = Layer.effect(
  StepUpFactorReader,
  Effect.gen(function* () {
    const database = yield* ControlPlaneDatabase;

    return StepUpFactorReader.of({
      passkeyAvailable: (userId) =>
        database
          .select({ id: authPasskeyCredential.id })
          .from(authPasskeyCredential)
          .where(
            and(
              eq(authPasskeyCredential.userId, userId),
              isNull(authPasskeyCredential.revokedAt)
            )
          )
          .limit(1)
          .pipe(
            Effect.mapError(readError),
            Effect.map((rows) => rows.length === 1)
          ),
      passwordAvailable: (userId) =>
        database
          .select({ id: authCredential.id })
          .from(authCredential)
          .where(
            and(
              eq(authCredential.userId, userId),
              eq(authCredential.type, "password"),
              isNull(authCredential.revokedAt)
            )
          )
          .limit(1)
          .pipe(
            Effect.mapError(readError),
            Effect.map((rows) => rows.length === 1)
          ),
    });
  })
);
