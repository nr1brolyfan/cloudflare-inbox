/* oxlint-disable max-classes-per-file -- Canonicalization error and domain entity form one contract. */
import { nfc } from "@adraffy/ens-normalize";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as punycode from "punycode/";
import { toASCII } from "tr46";

import { OrganizationId } from "#/modules/organization/domain/Organization";
import { ResourceId } from "#/shared/Resource";
import { UnixMillis, Version } from "#/shared/Temporal";

export const MAIL_DOMAIN_CANONICALIZATION_PROFILE_ID =
  "mail-domain/ascii-alabel-input/uts46-nontransitional-std3/unicode-17/v1" as const;
export const MAIL_DOMAIN_CANONICALIZATION_VERSION = 1 as const;

const toAsciiOptions = {
  checkBidi: true,
  checkHyphens: true,
  checkJoiners: true,
  ignoreInvalidPunycode: false,
  transitionalProcessing: false,
  useSTD3ASCIIRules: true,
  verifyDNSLength: true,
} as const;
const forbiddenSyntax = new Set(["@", "/", "\\", ":", "*", "_", "[", "]"]);

export const MailDomainId = ResourceId.pipe(
  Schema.check(
    Schema.makeFilter((id) =>
      /[^A-Za-z0-9_-]/u.test(id)
        ? "MailDomainId may contain only ASCII letters, digits, underscores, and hyphens"
        : undefined
    )
  ),
  Schema.brand("cloudflare-inbox/MailDomainId")
);
export type MailDomainId = Schema.Schema.Type<typeof MailDomainId>;

export const LEGACY_DEFAULT_MAIL_DOMAIN_ID = Schema.decodeUnknownSync(
  MailDomainId
)("legacy_default_v1_domain_v1");

export type MailDomainCanonicalizationErrorReason =
  | "empty"
  | "forbidden-syntax"
  | "invalid-dns-name"
  | "invalid-idna"
  | "ip-literal"
  | "not-a-string"
  | "surrounding-whitespace";

export class MailDomainCanonicalizationError extends Data.TaggedError(
  "MailDomainCanonicalizationError"
)<{
  readonly reason: MailDomainCanonicalizationErrorReason;
}> {}

type CanonicalizationResult =
  | { readonly canonicalDomain: string; readonly success: true }
  | {
      readonly reason: MailDomainCanonicalizationErrorReason;
      readonly success: false;
    };

const rejected = (
  reason: MailDomainCanonicalizationErrorReason
): CanonicalizationResult => ({ reason, success: false });

const isIpv4Literal = (labels: readonly string[]): boolean =>
  labels.length === 4 &&
  labels.every(
    (label) => /^(?:0|[1-9][0-9]{0,2})$/u.test(label) && Number(label) <= 255
  );

const arraysEqual = (left: readonly number[], right: readonly number[]) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

const inputRejectionReason = (
  input: string
): MailDomainCanonicalizationErrorReason | undefined => {
  if (input.length === 0) {
    return "empty";
  }
  if (input.trim() !== input) {
    return "surrounding-whitespace";
  }
  if ([...input].some((character) => (character.codePointAt(0) ?? 0) > 0x7f)) {
    return "invalid-idna";
  }
  if (input.endsWith(".")) {
    return "invalid-dns-name";
  }
  if (
    [...input].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return (
        forbiddenSyntax.has(character) ||
        codePoint <= 0x1f ||
        (codePoint >= 0x7f && codePoint <= 0x9f)
      );
    })
  ) {
    return input.includes("[") || input.includes("]")
      ? "ip-literal"
      : "forbidden-syntax";
  }
};

const isCanonicalALabel = (label: string): boolean => {
  if (!label.startsWith("xn--")) {
    return true;
  }

  const body = label.slice(4);
  try {
    const decoded = punycode.decode(body);
    const codePoints = [...decoded].map(
      (character) => character.codePointAt(0) ?? 0
    );
    return (
      codePoints.some((codePoint) => codePoint > 0x7f) &&
      arraysEqual(nfc(codePoints), codePoints) &&
      punycode.encode(decoded) === body
    );
  } catch {
    return false;
  }
};

const canonicalizeString = (input: unknown): CanonicalizationResult => {
  if (typeof input !== "string") {
    return rejected("not-a-string");
  }
  const rejectionReason = inputRejectionReason(input);
  if (rejectionReason !== undefined) {
    return rejected(rejectionReason);
  }

  const normalizedInput = input.toLowerCase();
  if (!normalizedInput.split(".").every(isCanonicalALabel)) {
    return rejected("invalid-idna");
  }

  let ascii: string | null;
  try {
    ascii = toASCII(normalizedInput, toAsciiOptions);
  } catch {
    return rejected("invalid-idna");
  }
  if (ascii === null) {
    return rejected("invalid-idna");
  }

  const labels = ascii.split(".");
  if (isIpv4Literal(labels)) {
    return rejected("ip-literal");
  }
  if (
    ascii.length < 3 ||
    ascii.length > 253 ||
    ascii !== normalizedInput ||
    ascii !== ascii.toLowerCase() ||
    labels.length < 2 ||
    labels.some(
      (label) =>
        label.length < 1 ||
        label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label)
    ) ||
    /^[0-9]+$/u.test(labels.at(-1) ?? "")
  ) {
    return rejected("invalid-dns-name");
  }

  let recanonicalized: string | null;
  try {
    recanonicalized = toASCII(ascii, toAsciiOptions);
  } catch {
    return rejected("invalid-idna");
  }
  return recanonicalized === ascii
    ? { canonicalDomain: ascii, success: true }
    : rejected("invalid-idna");
};

export const CanonicalMailDomain = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter<string>((value) => {
      const result = canonicalizeString(value);
      return result.success && result.canonicalDomain === value
        ? undefined
        : "must be a canonical mail-domain A-label";
    })
  ),
  Schema.brand("cloudflare-inbox/CanonicalMailDomain")
);
export type CanonicalMailDomain = Schema.Schema.Type<
  typeof CanonicalMailDomain
>;

export const canonicalizeMailDomainV1 = (
  input: unknown
): Effect.Effect<CanonicalMailDomain, MailDomainCanonicalizationError> => {
  const result = canonicalizeString(input);
  if (!result.success) {
    return Effect.fail(
      new MailDomainCanonicalizationError({ reason: result.reason })
    );
  }
  return Schema.decodeUnknownEffect(CanonicalMailDomain)(
    result.canonicalDomain
  ).pipe(
    Effect.mapError(
      () => new MailDomainCanonicalizationError({ reason: "invalid-idna" })
    )
  );
};

export const MailDomainCanonicalizationProfileId = Schema.Literal(
  MAIL_DOMAIN_CANONICALIZATION_PROFILE_ID
);
export const MailDomainStatus = Schema.Literals([
  "pending_verification",
  "verified",
  "active",
  "suspended",
  "retired",
]);
export type MailDomainStatus = Schema.Schema.Type<typeof MailDomainStatus>;

export class MailDomain extends Schema.Class<MailDomain>(
  "cloudflare-inbox/MailDomain"
)({
  canonicalDomain: CanonicalMailDomain,
  canonicalizationProfileId: MailDomainCanonicalizationProfileId,
  canonicalizationVersion: Schema.Literal(MAIL_DOMAIN_CANONICALIZATION_VERSION),
  createdAt: UnixMillis,
  id: MailDomainId,
  organizationId: OrganizationId,
  status: MailDomainStatus,
  updatedAt: UnixMillis,
  version: Version,
}) {}

export const MailDomainSchema = MailDomain.check(
  Schema.makeFilter((domain) => {
    if (domain.updatedAt < domain.createdAt) {
      return "mail domain cannot be updated before creation";
    }
    const minimumVersion = {
      active: 3,
      pending_verification: 1,
      retired: 2,
      suspended: 4,
      verified: 2,
    }[domain.status];
    return domain.version >= minimumVersion
      ? undefined
      : "mail domain version is unreachable for its status";
  })
);

export const MailDomainClaimSource = Schema.Literals([
  "legacy-reconciliation",
  "fresh-bootstrap",
]);

export class MailDomainClaimReceipt extends Schema.Class<MailDomainClaimReceipt>(
  "cloudflare-inbox/MailDomainClaimReceipt"
)({
  canonicalDomain: CanonicalMailDomain,
  canonicalizationProfileId: MailDomainCanonicalizationProfileId,
  canonicalizationVersion: Schema.Literal(MAIL_DOMAIN_CANONICALIZATION_VERSION),
  domainId: MailDomainId,
  effectiveAt: UnixMillis,
  mailboxId: Schema.Literal("primary"),
  normalizedAddressSnapshot: Schema.String,
  organizationId: Schema.Literal("legacy_default_v1"),
  primaryAddressId: Schema.Literal("primary"),
  rawAddressSnapshot: Schema.String,
  schemaVersion: Schema.Literal(1),
  source: MailDomainClaimSource,
  sourceAuditEventId: Schema.optional(Schema.String),
  sourceBootstrapOperationId: Schema.optional(Schema.String),
}) {}
