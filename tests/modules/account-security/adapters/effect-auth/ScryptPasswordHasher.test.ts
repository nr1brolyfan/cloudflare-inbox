/* oxlint-disable vitest/no-standalone-expect -- Effect tests are registered through @effect/vitest. */
import { PasswordHasher } from "@effect-auth/core/Password";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

import { ScryptPasswordHasherLayer } from "#/modules/account-security/adapters/effect-auth/ScryptPasswordHasher";

const password = Redacted.make("correct horse battery staple");

describe("ScryptPasswordHasher", () => {
  it.effect("round-trips hashes with the configured work factors", () =>
    Effect.gen(function* () {
      const hasher = yield* PasswordHasher;
      const hash = yield* hasher.hash({ password });

      expect(hash).toMatch(/^scrypt\$16384\$8\$5\$/u);
      expect(yield* hasher.verify({ hash, password })).toBeTruthy();
      expect(
        yield* hasher.verify({ hash, password: Redacted.make("incorrect") })
      ).toBeFalsy();
      const { needsRehash } = hasher;
      if (needsRehash === undefined) {
        throw new Error("Expected scrypt rehash policy");
      }
      expect(yield* needsRehash({ hash })).toBeFalsy();
    }).pipe(Effect.provide(ScryptPasswordHasherLayer))
  );

  it.effect("rejects malformed or unsupported hashes", () =>
    PasswordHasher.use((hasher) =>
      hasher.verify({
        hash: "scrypt$32768$8$5$invalid$invalid",
        password,
      })
    ).pipe(
      Effect.flip,
      Effect.map((error) => {
        expect(error).toMatchObject({
          _tag: "PasswordHashError",
          operation: "verify",
        });
        return error;
      }),
      Effect.provide(ScryptPasswordHasherLayer)
    )
  );
});
