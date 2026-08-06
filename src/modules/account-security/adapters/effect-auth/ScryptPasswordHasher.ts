import { scryptSync } from "node:crypto";

import { PasswordHasher, PasswordHashError } from "@effect-auth/core/Password";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

const prefix = "scrypt";
const cost = 2 ** 14;
const blockSize = 8;
const parallelization = 5;
const saltBytes = 16;
const hashBytes = 32;
const maxmem = 32 * 1024 * 1024;

const passwordHashError = (
  operation: "hash" | "verify" | "needsRehash",
  message: string,
  cause?: unknown
) => new PasswordHashError({ operation, message, cause });

const encodeBase64Url = (value: Uint8Array): string =>
  btoa(String.fromCodePoint(...value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");

const decodeCanonicalBase64Url = (value: string): Uint8Array | undefined => {
  try {
    const standard = value.replaceAll("-", "+").replaceAll("_", "/");
    const padded = standard.padEnd(
      standard.length + ((4 - (standard.length % 4)) % 4),
      "="
    );
    const decoded = Uint8Array.from(
      atob(padded),
      (character) => character.codePointAt(0) ?? 0
    );
    return encodeBase64Url(decoded) === value ? decoded : undefined;
  } catch {
    return undefined;
  }
};

const parse = (hash: string) => {
  const parts = hash.length <= 256 ? hash.split("$") : [];
  const [
    algorithm,
    encodedCost,
    encodedBlockSize,
    encodedParallelization,
    encodedSalt,
    encodedDerivedKey,
  ] = parts;
  const salt =
    encodedSalt === undefined
      ? undefined
      : decodeCanonicalBase64Url(encodedSalt);
  const derivedKey =
    encodedDerivedKey === undefined
      ? undefined
      : decodeCanonicalBase64Url(encodedDerivedKey);

  if (
    parts.length !== 6 ||
    algorithm !== prefix ||
    encodedCost !== String(cost) ||
    encodedBlockSize !== String(blockSize) ||
    encodedParallelization !== String(parallelization) ||
    salt?.byteLength !== saltBytes ||
    derivedKey?.byteLength !== hashBytes
  ) {
    return;
  }

  return { derivedKey, salt };
};

const derive = (
  password: Redacted.Redacted<string>,
  salt: Uint8Array,
  operation: "hash" | "verify"
) =>
  Effect.try({
    try: () =>
      new Uint8Array(
        scryptSync(Redacted.value(password), salt, hashBytes, {
          N: cost,
          maxmem,
          p: parallelization,
          r: blockSize,
        })
      ),
    catch: (cause) =>
      passwordHashError(
        operation,
        "Failed to derive scrypt password hash",
        cause
      ),
  });

const equalBytes = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    // oxlint-disable-next-line eslint/no-bitwise -- Compare every derived-key byte without early exit.
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
};

/** Scrypt adapter using parameters from the OWASP Password Storage Cheat Sheet. */
export const ScryptPasswordHasherLayer = Layer.succeed(
  PasswordHasher,
  PasswordHasher.of({
    hash: ({ password }) =>
      Effect.gen(function* () {
        const salt = yield* Effect.try({
          try: () => crypto.getRandomValues(new Uint8Array(saltBytes)),
          catch: (cause) =>
            passwordHashError(
              "hash",
              "Failed to generate password salt",
              cause
            ),
        });
        const derivedKey = yield* derive(password, salt, "hash");
        return [
          prefix,
          cost,
          blockSize,
          parallelization,
          encodeBase64Url(salt),
          encodeBase64Url(derivedKey),
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
        const derivedKey = yield* derive(password, parsed.salt, "verify");
        return equalBytes(derivedKey, parsed.derivedKey);
      }),
    verifyDummy: ({ password }) =>
      derive(password, new Uint8Array(saltBytes).fill(1), "verify").pipe(
        Effect.asVoid
      ),
    needsRehash: ({ hash }) =>
      parse(hash) === undefined
        ? Effect.fail(
            passwordHashError("needsRehash", "Invalid password hash format")
          )
        : Effect.succeed(false),
  })
);
