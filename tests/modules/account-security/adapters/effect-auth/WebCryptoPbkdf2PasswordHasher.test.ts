import { WebCryptoLive } from "@effect-auth/core/Crypto";
/* oxlint-disable vitest/no-standalone-expect -- Effect tests are registered through @effect/vitest. */
import {
  PasswordHasher,
  Pbkdf2PasswordHasherLive,
} from "@effect-auth/core/Password";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

import { WebCryptoPbkdf2PasswordHasherLayer } from "#/modules/account-security/adapters/effect-auth/WebCryptoPbkdf2PasswordHasher";

const password = Redacted.make("correct horse battery staple");

describe("WebCryptoPbkdf2PasswordHasher", () => {
  it.effect("round-trips hashes", () =>
    Effect.gen(function* () {
      const hasher = yield* PasswordHasher;
      const hash = yield* hasher.hash({ password });

      expect(hash).toMatch(/^pbkdf2-sha256\$210000\$/u);
      expect(yield* hasher.verify({ hash, password })).toBeTruthy();
      expect(
        yield* hasher.verify({ hash, password: Redacted.make("incorrect") })
      ).toBeFalsy();
      const { needsRehash } = hasher;
      if (needsRehash === undefined) {
        throw new Error("Expected PBKDF2 rehash policy");
      }
      expect(yield* needsRehash({ hash })).toBeFalsy();
    }).pipe(Effect.provide(WebCryptoPbkdf2PasswordHasherLayer))
  );

  it.effect("produces hashes accepted by the Effect Auth verifier", () =>
    Effect.gen(function* () {
      const nodeHasher = yield* PasswordHasher;
      const hash = yield* nodeHasher.hash({ password });
      const verified = yield* PasswordHasher.use((hasher) =>
        hasher.verify({ hash, password })
      ).pipe(
        Effect.provide(
          Pbkdf2PasswordHasherLive({ iterations: 210_000 }).pipe(
            Layer.provide(WebCryptoLive())
          )
        )
      );

      expect(verified).toBeTruthy();
    }).pipe(Effect.provide(WebCryptoPbkdf2PasswordHasherLayer))
  );

  it.effect("accepts Effect Auth PBKDF2 hashes", () =>
    Effect.gen(function* () {
      const hash = yield* PasswordHasher.use((hasher) =>
        hasher.hash({ password })
      ).pipe(
        Effect.provide(
          Pbkdf2PasswordHasherLive({ iterations: 210_000 }).pipe(
            Layer.provide(WebCryptoLive())
          )
        )
      );
      const verified = yield* PasswordHasher.use((hasher) =>
        hasher.verify({ hash, password })
      ).pipe(Effect.provide(WebCryptoPbkdf2PasswordHasherLayer));

      expect(verified).toBeTruthy();
    })
  );
});
