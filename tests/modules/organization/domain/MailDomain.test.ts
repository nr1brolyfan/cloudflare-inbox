import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  MAIL_DOMAIN_CANONICALIZATION_PROFILE_ID,
  MAIL_DOMAIN_CANONICALIZATION_VERSION,
  CanonicalMailDomain,
  MailDomainCanonicalizationError,
  MailDomainId,
  MailDomainSchema,
  MailDomainStatus,
  canonicalizeMailDomainV1,
} from "#/modules/organization/domain/MailDomain";

const canonicalize = (input: unknown): string =>
  Effect.runSync(canonicalizeMailDomainV1(input));

const canonicalizationSucceeds = (input: unknown): boolean =>
  Exit.isSuccess(Effect.runSyncExit(canonicalizeMailDomainV1(input)));

const decodeSucceeds = <S extends Schema.ConstraintDecoder<unknown, never>>(
  schema: S,
  input: unknown
) => Exit.isSuccess(Schema.decodeUnknownExit(schema)(input));

const pendingDomain = {
  canonicalDomain: "example.com",
  canonicalizationProfileId: MAIL_DOMAIN_CANONICALIZATION_PROFILE_ID,
  canonicalizationVersion: MAIL_DOMAIN_CANONICALIZATION_VERSION,
  createdAt: 1000,
  id: "domain-a",
  organizationId: "organization-a",
  status: "pending_verification",
  updatedAt: 1000,
  version: 1,
} as const;

describe("mail domain", () => {
  it("freezes the Unicode 17 nontransitional STD3 profile", () => {
    expect(MAIL_DOMAIN_CANONICALIZATION_PROFILE_ID).toBe(
      "mail-domain/ascii-alabel-input/uts46-nontransitional-std3/unicode-17/v1"
    );
    expect(MAIL_DOMAIN_CANONICALIZATION_VERSION).toBe(1);
  });

  it("canonicalizes accepted ASCII and canonical A-label vectors", () => {
    const vectors = [
      ["EXAMPLE.COM", "example.com"],
      ["xn--bcher-kva.example", "xn--bcher-kva.example"],
      ["XN--BCHER-KVA.EXAMPLE", "xn--bcher-kva.example"],
      ["xn--fa-hia.de", "xn--fa-hia.de"],
      ["xn--mgbh0fb.xn--kgbechtv", "xn--mgbh0fb.xn--kgbechtv"],
      ["xn--1ca814k.example", "xn--1ca814k.example"],
      ["a.b", "a.b"],
      [`${"a".repeat(63)}.com`, `${"a".repeat(63)}.com`],
      [
        `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`,
        `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`,
      ],
    ] as const;

    for (const [input, expected] of vectors) {
      expect(canonicalize(input)).toBe(expected);
    }
  });

  it("rejects invalid IDNA, syntax, address, and boundary vectors", () => {
    const invalid = [
      undefined,
      null,
      1,
      {},
      "",
      " example.com",
      "example.com ",
      "\texample.com",
      "example.com\n",
      "example.com.",
      "example.com。",
      "example.com．",
      "example.com｡",
      "bücher.example",
      "faß.de",
      "ＦＯＯ．ＥＸＡＭＰＬＥ",
      "foo。example",
      "foo．example",
      "foo｡example",
      "e\u0301xample.com",
      "éxample.com",
      "مثال.إختبار",
      "نامه‌ای.com",
      "localhost",
      "com",
      "127.0.0.1",
      "255.255.255.255",
      "[::1]",
      "[127.0.0.1]",
      "owner@example.com",
      "example.com/path",
      "example.com\\path",
      "example.com:443",
      "*.example.com",
      "foo_bar.example",
      "example.123",
      "example.000",
      "-example.com",
      "example-.com",
      "a..com",
      "ab--cd.example",
      "xn--",
      "xn--a.com",
      "xn--not-punycode-.com",
      "xn--a-xbb734p.example",
      "aא.com",
      "a\u200Cb.com",
      "\u0301example.com",
      `example\u0000.com`,
      `example\u001F.com`,
      `example\u007F.com`,
      `example\u0085.com`,
      `${"a".repeat(64)}.com`,
      `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(62)}`,
    ];

    for (const input of invalid) {
      expect(canonicalizationSucceeds(input)).toBeFalsy();
    }
  });

  it("uses pinned Unicode 17 NFC for U+1ADD independently of host normalization", () => {
    expect(canonicalizationSucceeds("xn--a-xbb734p.example")).toBeFalsy();
    expect(canonicalize("xn--1ca814k.example")).toBe("xn--1ca814k.example");
  });

  it("is idempotent and collapses ASCII and A-label case", () => {
    const collisionSets = [
      ["EXAMPLE.COM", "example.com"],
      ["XN--BCHER-KVA.EXAMPLE", "xn--bcher-kva.example"],
      ["XN--1CA814K.EXAMPLE", "xn--1ca814k.example"],
    ] as const;

    for (const inputs of collisionSets) {
      const outputs = inputs.map(canonicalize);
      expect(new Set(outputs).size).toBe(1);
      expect(canonicalize(outputs[0])).toBe(outputs[0]);
    }
  });

  it("brands only exact canonical A-labels and reports typed failures", () => {
    expect(
      Schema.decodeUnknownSync(CanonicalMailDomain)("xn--bcher-kva.example")
    ).toBe("xn--bcher-kva.example");
    for (const domain of ["EXAMPLE.COM", "bücher.example", "example.123"]) {
      expect(decodeSucceeds(CanonicalMailDomain, domain)).toBeFalsy();
    }

    const failure = Effect.runSync(
      Effect.flip(canonicalizeMailDomainV1(" owner@example.com"))
    );
    expect(failure).toBeInstanceOf(MailDomainCanonicalizationError);
    expect(failure).toMatchObject({ reason: "surrounding-whitespace" });
  });

  it("uses the shared exact opaque ASCII identifier grammar", () => {
    for (const id of ["A", "a", "Az09_-", "x".repeat(128)]) {
      expect(Schema.decodeUnknownSync(MailDomainId)(id)).toBe(id);
    }
    for (const id of [
      "",
      "x".repeat(129),
      " domain-a ",
      "domain.a",
      "domain/a",
      "domäin-a",
      "domain\0a",
    ]) {
      expect(decodeSucceeds(MailDomainId, id)).toBeFalsy();
    }
  });

  it("closes statuses and rejects corrupted entities", () => {
    const reachable = [
      ["pending_verification", 1],
      ["verified", 2],
      ["active", 3],
      ["suspended", 4],
      ["retired", 2],
    ] as const;
    for (const [status, version] of reachable) {
      expect(Schema.decodeUnknownSync(MailDomainStatus)(status)).toBe(status);
      expect(
        Schema.decodeUnknownSync(MailDomainSchema)({
          ...pendingDomain,
          status,
          version,
        })
      ).toMatchObject({ ...pendingDomain, status, version });
    }

    for (const status of ["active", "suspended"] as const) {
      expect(
        decodeSucceeds(MailDomainSchema, { ...pendingDomain, status })
      ).toBeFalsy();
    }

    const corruptions = [
      { ...pendingDomain, canonicalDomain: "EXAMPLE.COM" },
      { ...pendingDomain, canonicalizationProfileId: "unicode-current" },
      { ...pendingDomain, canonicalizationVersion: 2 },
      { ...pendingDomain, createdAt: 1001 },
      { ...pendingDomain, status: "deleted" },
      { ...pendingDomain, updatedAt: Number.MAX_SAFE_INTEGER + 1 },
      { ...pendingDomain, version: 0 },
    ];
    for (const corruption of corruptions) {
      expect(decodeSucceeds(MailDomainSchema, corruption)).toBeFalsy();
    }
  });
});
