import { readFileSync } from "node:fs";

import * as ConfigProvider from "effect/ConfigProvider";

export const PRODUCTION_ENV_FILE = ".env.production";

export const PRODUCTION_APPLICATION_KEYS = [
  "PUBLIC_ORIGIN",
  "AUTH_EMAIL_FROM",
  "MAILBOX_BOOTSTRAP_OWNER_EMAIL_ALLOWLIST",
  "MAILBOX_INITIAL_ADDRESS",
  "MAILBOX_ARCHIVE_RECIPIENT",
  "JOB_MAIL_INBOUND_ROUTE_ENABLED",
  "JOB_MAIL_SHARED_ROUTING_STATE_CONFIRMED",
  "AUTH_SESSION_SECRET",
  "AUTH_CHALLENGE_SECRET",
  "AUTH_PRIVACY_SECRET",
] as const;

export type ProductionApplicationKey =
  (typeof PRODUCTION_APPLICATION_KEYS)[number];
export type ProductionEnvironment = ReadonlyMap<
  ProductionApplicationKey,
  string
>;

export type ProductionEnvFileErrorReason =
  | "duplicate-key"
  | "file-unavailable"
  | "forbidden-key"
  | "invalid-json"
  | "invalid-value"
  | "malformed-line"
  | "missing-key"
  | "unexpected-key";

export class ProductionEnvFileError extends Error {
  readonly reason: ProductionEnvFileErrorReason;

  constructor(reason: ProductionEnvFileErrorReason) {
    super("production environment file is invalid");
    this.name = "ProductionEnvFileError";
    this.reason = reason;
  }
}

const productionApplicationKeys = new Set<string>(PRODUCTION_APPLICATION_KEYS);
const forbiddenKeys = new Set(["ALCHEMY_DEV", "ALCHEMY_STATE"]);

const decodeStringValue = (encoded: string): string => {
  if (encoded === "" || encoded !== encoded.trim()) {
    throw new ProductionEnvFileError("invalid-value");
  }
  if (!encoded.startsWith('"')) {
    if (
      encoded.includes("\0") ||
      encoded.includes("\n") ||
      encoded.includes("\r")
    ) {
      throw new ProductionEnvFileError("invalid-value");
    }
    return encoded;
  }
  try {
    const decoded: unknown = JSON.parse(encoded);
    if (
      typeof decoded !== "string" ||
      decoded.length === 0 ||
      decoded.includes("\0") ||
      decoded.includes("\n") ||
      decoded.includes("\r")
    ) {
      throw new ProductionEnvFileError("invalid-value");
    }
    return decoded;
  } catch (error) {
    if (error instanceof ProductionEnvFileError) {
      throw error;
    }
    throw new ProductionEnvFileError("invalid-value");
  }
};

export const parseProductionEnv = (source: string): ProductionEnvironment => {
  const values = new Map<ProductionApplicationKey, string>();
  for (const line of source.split(/\r?\n/u)) {
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    const match = /^(?<key>[A-Z][A-Z0-9_]*)=(?<value>.*)$/u.exec(line);
    if (match === null) {
      throw new ProductionEnvFileError("malformed-line");
    }
    const key = match.groups?.key;
    const encodedValue = match.groups?.value;
    if (key === undefined || encodedValue === undefined) {
      throw new ProductionEnvFileError("malformed-line");
    }
    if (forbiddenKeys.has(key)) {
      throw new ProductionEnvFileError("forbidden-key");
    }
    if (!productionApplicationKeys.has(key)) {
      throw new ProductionEnvFileError("unexpected-key");
    }
    const applicationKey = key as ProductionApplicationKey;
    if (values.has(applicationKey)) {
      throw new ProductionEnvFileError("duplicate-key");
    }

    if (applicationKey === "MAILBOX_BOOTSTRAP_OWNER_EMAIL_ALLOWLIST") {
      try {
        const decoded: unknown = JSON.parse(encodedValue);
        if (!Array.isArray(decoded)) {
          throw new ProductionEnvFileError("invalid-json");
        }
        values.set(applicationKey, JSON.stringify(decoded));
      } catch (error) {
        if (error instanceof ProductionEnvFileError) {
          throw error;
        }
        throw new ProductionEnvFileError("invalid-json");
      }
    } else {
      values.set(applicationKey, decodeStringValue(encodedValue));
    }
  }

  if (PRODUCTION_APPLICATION_KEYS.some((key) => !values.has(key))) {
    throw new ProductionEnvFileError("missing-key");
  }
  return values;
};

export const readProductionEnvFile = (
  filePath = PRODUCTION_ENV_FILE
): ProductionEnvironment => {
  try {
    return parseProductionEnv(readFileSync(filePath, "utf-8"));
  } catch (error) {
    if (error instanceof ProductionEnvFileError) {
      throw error;
    }
    throw new ProductionEnvFileError("file-unavailable");
  }
};

export const productionConfigProviderFromMap = (
  values: ProductionEnvironment
) => {
  const record = Object.create(null) as Record<string, string>;
  for (const [key, value] of values) {
    record[key] = value;
  }
  // Effect beta.98 has fromUnknown but no fromMap; the validated Map is the
  // sole source used to construct this provider.
  return ConfigProvider.fromUnknown(record);
};
