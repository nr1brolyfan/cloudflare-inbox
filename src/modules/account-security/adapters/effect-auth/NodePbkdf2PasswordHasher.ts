import { pbkdf2, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import {
  defaultPbkdf2HashBytes,
  defaultPbkdf2Iterations,
  defaultPbkdf2SaltBytes,
  maximumPbkdf2HashBytes,
  maximumPbkdf2Iterations,
  maximumPbkdf2PasswordHashLength,
  maximumPbkdf2SaltBytes,
  minimumPbkdf2HashBytes,
  minimumPbkdf2Iterations,
  minimumPbkdf2SaltBytes,
  minimumPbkdf2VerificationHashBytes,
  PasswordHasher,
  PasswordHashError,
} from "@effect-auth/core/Password";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

const prefix = "pbkdf2-sha256";
const pbkdf2Async = promisify(pbkdf2);

const passwordHashError = (
  operation: "hash" | "verify" | "needsRehash",
  message: string,
  cause?: unknown
) => new PasswordHashError({ operation, message, cause });

const derive = (
  password: Redacted.Redacted<string>,
  salt: Uint8Array,
  iterations: number,
  hashBytes: number,
  operation: "hash" | "verify"
) =>
  Effect.tryPromise({
    try: async () =>
      new Uint8Array(
        await pbkdf2Async(
          Redacted.value(password),
          salt,
          iterations,
          hashBytes,
          "sha256"
        )
      ),
    catch: (cause) =>
      passwordHashError(
        operation,
        "Failed to derive PBKDF2 password hash",
        cause
      ),
  });

const decodeCanonicalBase64Url = (value: string): Uint8Array | undefined => {
  try {
    const decoded = Buffer.from(value, "base64url");
    return decoded.toString("base64url") === value ? decoded : undefined;
  } catch {
    return undefined;
  }
};

const parse = (hash: string) => {
  const parts =
    hash.length <= maximumPbkdf2PasswordHashLength ? hash.split("$") : [];
  const [algorithm, encodedIterations, encodedSalt, encodedDerivedKey] = parts;
  const iterations = Number(encodedIterations);
  const salt =
    encodedSalt === undefined
      ? undefined
      : decodeCanonicalBase64Url(encodedSalt);
  const derivedKey =
    encodedDerivedKey === undefined
      ? undefined
      : decodeCanonicalBase64Url(encodedDerivedKey);

  if (
    parts.length !== 4 ||
    algorithm !== prefix ||
    encodedIterations === undefined ||
    !/^[1-9][0-9]*$/u.test(encodedIterations) ||
    !Number.isSafeInteger(iterations) ||
    iterations > maximumPbkdf2Iterations ||
    salt === undefined ||
    salt.byteLength === 0 ||
    salt.byteLength > maximumPbkdf2SaltBytes ||
    derivedKey === undefined ||
    derivedKey.byteLength < minimumPbkdf2VerificationHashBytes ||
    derivedKey.byteLength > maximumPbkdf2HashBytes
  ) {
    return;
  }

  return { derivedKey, encodedDerivedKey, iterations, salt };
};

/** PBKDF2 adapter using Workers' native node:crypto implementation. */
export const NodePbkdf2PasswordHasherLayer = Layer.succeed(
  PasswordHasher,
  PasswordHasher.of({
    hash: ({ password }) =>
      Effect.gen(function* () {
        if (
          defaultPbkdf2Iterations < minimumPbkdf2Iterations ||
          defaultPbkdf2SaltBytes < minimumPbkdf2SaltBytes ||
          defaultPbkdf2HashBytes < minimumPbkdf2HashBytes
        ) {
          return yield* passwordHashError(
            "hash",
            "Invalid PBKDF2 password hasher parameters"
          );
        }
        const salt = yield* Effect.try({
          try: () => randomBytes(defaultPbkdf2SaltBytes),
          catch: (cause) =>
            passwordHashError(
              "hash",
              "Failed to generate password salt",
              cause
            ),
        });
        const derivedKey = yield* derive(
          password,
          salt,
          defaultPbkdf2Iterations,
          defaultPbkdf2HashBytes,
          "hash"
        );
        return [
          prefix,
          defaultPbkdf2Iterations,
          salt.toString("base64url"),
          Buffer.from(derivedKey).toString("base64url"),
        ].join("$");
      }),
    verify: ({ hash, password }) =>
      Effect.gen(function* () {
        const parsed = parse(hash);
        if (parsed === undefined) {
          return yield* passwordHashError(
            "verify",
            "Invalid password hash format"
          );
        }
        const derivedKey = yield* derive(
          password,
          parsed.salt,
          parsed.iterations,
          parsed.derivedKey.byteLength,
          "verify"
        );
        return timingSafeEqual(derivedKey, parsed.derivedKey);
      }),
    verifyDummy: ({ password }) =>
      derive(
        password,
        new Uint8Array(defaultPbkdf2SaltBytes).fill(1),
        defaultPbkdf2Iterations,
        defaultPbkdf2HashBytes,
        "verify"
      ).pipe(Effect.asVoid),
    needsRehash: ({ hash }) => {
      const parsed = parse(hash);
      return parsed === undefined
        ? Effect.fail(
            passwordHashError("needsRehash", "Invalid password hash format")
          )
        : Effect.succeed(
            parsed.iterations < defaultPbkdf2Iterations ||
              parsed.salt.byteLength < defaultPbkdf2SaltBytes ||
              parsed.derivedKey.byteLength < defaultPbkdf2HashBytes
          );
    },
  })
);
