/* oxlint-disable unicorn/no-array-sort, eslint/no-await-in-loop -- Canonicalization sorts fresh arrays; restore writes are intentionally sequential for deterministic retries. */
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  openSync,
  rmSync,
  rmdirSync,
} from "node:fs";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

import * as Schema from "effect/Schema";

import {
  draftAttachmentCustomMetadata,
  draftAttachmentObjectKey,
} from "#/modules/mailbox/adapters/r2/DraftAttachmentR2Object";
import {
  inboundAttachmentCustomMetadata,
  inboundAttachmentMetadataBytes,
  inboundAttachmentObjectKey,
} from "#/modules/mailbox/adapters/r2/InboundAttachmentR2Object";
import {
  inboundRawMessageCustomMetadata,
  inboundRawMessageObjectKey,
} from "#/modules/mailbox/adapters/r2/InboundRawMessageR2Object";
import { applyMailboxMigrations } from "#/modules/mailbox/adapters/sqlite/MailboxSqliteMigrations";
import { Sha256Digest } from "#/modules/mailbox/domain/Mailbox";
import { ParsedInboundAttachmentV1 } from "#/modules/mailbox/domain/MailboxInbound";
import { OutboundDraftAttachmentLocation } from "#/modules/mailbox/ports/MailboxOutboundDispatchStore";

const authoritativeTables = [
  "mailbox_metadata",
  "folder",
  "message",
  "attachment",
  "label",
  "message_label",
  "draft",
  "draft_attachment",
  "filter_rule",
  "inbound_processing",
  "rule_evaluation",
  "rule_application",
  "async_rule_job",
  "mailbox_operation",
  "outbound_delivery",
] as const;

const Metadata = Schema.Record(Schema.String, Schema.String);
const Count = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));
const RehearsalLimitations = Schema.Struct({
  cloudflare: Schema.Literal("not-exercised"),
  durableObjectAlarm: Schema.Literal("not-captured-requires-reconciliation"),
  manifestIntegrity: Schema.Literal("self-digest-not-authenticity"),
  objectStorage: Schema.Literal("in-memory-analog"),
  workflowState: Schema.Literal("not-captured-requires-reconciliation"),
});

export const LocalRestoreManifestEntry = Schema.Struct({
  classification: Schema.Literals([
    "authoritative",
    "mailbox-orphan-in-flight",
  ]),
  customMetadata: Metadata,
  httpMetadata: Metadata,
  key: Schema.String,
  metadataSha256: Sha256Digest,
  objectType: Schema.Literals([
    "raw-message",
    "inbound-attachment",
    "draft-outbound-attachment",
  ]),
  sha256: Sha256Digest,
  size: Count,
});
export type LocalRestoreManifestEntry = Schema.Schema.Type<
  typeof LocalRestoreManifestEntry
>;

const SupportedRestoreSchemaVersion = Schema.Literals([
  12, 13, 14, 15, 16, 17, 18,
]);
type SupportedRestoreSchemaVersion = 12 | 13 | 14 | 15 | 16 | 17 | 18;
type LegacyRestoreSchemaVersion = 12 | 13 | 14 | 15 | 16 | 17;

export const LocalMailboxRestoreManifest = Schema.Struct({
  entries: Schema.Array(LocalRestoreManifestEntry),
  mailboxIdSha256: Sha256Digest,
  mode: Schema.Literal("local-rehearsal"),
  overallSha256: Sha256Digest,
  schemaVersion: SupportedRestoreSchemaVersion,
  sqliteRowsSha256: Sha256Digest,
  sqliteSchemaSha256: Sha256Digest,
  limitations: RehearsalLimitations,
});
export type LocalMailboxRestoreManifest = Schema.Schema.Type<
  typeof LocalMailboxRestoreManifest
>;

export const LocalMailboxRestoreEvidence = Schema.Struct({
  archiveObjectCount: Count,
  authoritativeRowCount: Count,
  mailboxIdSha256: Sha256Digest,
  manifestSha256: Sha256Digest,
  mode: Schema.Literal("local-rehearsal"),
  orphanInFlightObjectCount: Count,
  restoreOutcome: Schema.Literals(["restored", "already-restored"]),
  schemaVersion: Schema.Literal(18),
  sqliteRowsSha256: Sha256Digest,
  limitations: RehearsalLimitations,
});
export type LocalMailboxRestoreEvidence = Schema.Schema.Type<
  typeof LocalMailboxRestoreEvidence
>;

export interface RehearsalObject {
  readonly bytes: Uint8Array;
  readonly customMetadata: Readonly<Record<string, string>>;
  readonly httpMetadata: Readonly<Record<string, string>>;
}

export interface RehearsalSourceObject extends RehearsalObject {
  readonly classification: "authoritative" | "mailbox-orphan-in-flight";
  readonly objectType:
    | "raw-message"
    | "inbound-attachment"
    | "draft-outbound-attachment";
}

export interface LocalMailboxRestoreArchive {
  readonly close: () => void;
  readonly manifest: LocalMailboxRestoreManifest;
  readonly objects: Map<string, RehearsalSourceObject>;
  readonly snapshotPath: string;
}

export interface RehearsalObjectDestination {
  readonly get: (key: string) => Promise<RehearsalObject | undefined>;
  readonly putIfAbsent: (
    key: string,
    object: RehearsalObject
  ) => Promise<"exists" | "written">;
}

interface PathIdentity {
  readonly dev: bigint;
  readonly ino: bigint;
}

const isMissingPathError = (error: unknown) =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

const pathIdentity = (filePath: string): PathIdentity => {
  const stats = lstatSync(filePath, { bigint: true });
  return { dev: stats.dev, ino: stats.ino };
};

const regularFileIdentity = (filePath: string, label: string): PathIdentity => {
  const stats = lstatSync(filePath, { bigint: true });
  if (!stats.isFile()) {
    throw new Error(`${label} is not a regular file`);
  }
  return { dev: stats.dev, ino: stats.ino };
};

const identitiesMatch = (left: PathIdentity, right: PathIdentity) =>
  left.dev === right.dev && left.ino === right.ino;

const assertOwnedRegularFile = (
  filePath: string,
  ownership: PathIdentity,
  label: string
) => {
  let current: PathIdentity;
  try {
    current = regularFileIdentity(filePath, label);
  } catch (error) {
    if (isMissingPathError(error)) {
      throw new Error(`${label} disappeared`, { cause: error });
    }
    throw error;
  }
  if (!identitiesMatch(current, ownership)) {
    throw new Error(`${label} identity changed`);
  }
};

const removeOwnedPath = (
  ownedPath: string,
  ownership: PathIdentity,
  recursive = false
) => {
  try {
    if (identitiesMatch(pathIdentity(ownedPath), ownership)) {
      rmSync(ownedPath, { recursive });
    }
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
  }
};

const removeOwnedRegularFile = (
  filePath: string,
  ownership: PathIdentity
): boolean => {
  try {
    const stats = lstatSync(filePath, { bigint: true });
    if (
      !stats.isFile() ||
      !identitiesMatch({ dev: stats.dev, ino: stats.ino }, ownership)
    ) {
      return false;
    }
    rmSync(filePath);
    return true;
  } catch (error) {
    if (isMissingPathError(error)) {
      return true;
    }
    throw error;
  }
};

const removeOwnedEmptyDirectory = (
  directory: string,
  ownership: PathIdentity
) => {
  try {
    if (identitiesMatch(pathIdentity(directory), ownership)) {
      rmdirSync(directory);
    }
  } catch (error) {
    if (
      !isMissingPathError(error) &&
      !(error instanceof Error && "code" in error && error.code === "ENOTEMPTY")
    ) {
      throw error;
    }
  }
};

const makeOwnedTemporaryDirectory = (parent: string, prefix: string) => {
  const directory = mkdtempSync(path.join(parent, prefix));
  chmodSync(directory, 0o700);
  return { directory, ownership: pathIdentity(directory) };
};

const createOwnedFile = (filePath: string): PathIdentity => {
  const descriptor = openSync(filePath, "wx", 0o600);
  closeSync(descriptor);
  return regularFileIdentity(filePath, "owned temporary SQLite file");
};

export class InMemoryRehearsalObjectDestination implements RehearsalObjectDestination {
  readonly objects: Map<string, RehearsalObject>;

  constructor(
    objects: Map<string, RehearsalObject> = new Map<string, RehearsalObject>()
  ) {
    this.objects = objects;
  }

  get(key: string): Promise<RehearsalObject | undefined> {
    return Promise.resolve(this.objects.get(key));
  }

  putIfAbsent(
    key: string,
    object: RehearsalObject
  ): Promise<"exists" | "written"> {
    if (this.objects.has(key)) {
      return Promise.resolve("exists");
    }
    this.objects.set(key, copyRestoredObject(object));
    return Promise.resolve("written");
  }
}

type SqliteValue = bigint | number | string | null;
type CanonicalRows = Readonly<
  Record<string, readonly Record<string, SqliteValue>[]>
>;

const migrationStorage = (database: DatabaseSync) => ({
  transactionSync: <A>(run: () => A) => {
    database.exec("BEGIN");
    try {
      const result = run();
      database.exec("COMMIT");
      return result;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  },
  sql: {
    exec: (query: string, ...bindings: (string | number | null)[]) => {
      const statement = database.prepare(query);
      const rows = /^\s*(?:SELECT|WITH|PRAGMA)/iu.test(query)
        ? statement.all(...bindings)
        : (statement.run(...bindings), []);
      return {
        one: () => {
          if (rows.length !== 1 || rows[0] === undefined) {
            throw new Error(`Expected one row, received ${rows.length}`);
          }
          return rows[0];
        },
        toArray: () => rows,
      };
    },
  },
});

const codeUnitCompare = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => codeUnitCompare(left, right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  if (typeof value === "bigint") {
    return `{"$bigint":${JSON.stringify(value.toString())}}`;
  }
  return JSON.stringify(value);
};

const sha256 = (value: Uint8Array | string) =>
  Schema.decodeUnknownSync(Sha256Digest)(
    createHash("sha256").update(value).digest("hex")
  );

const exactRecord = (
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>
) => canonicalJson(left) === canonicalJson(right);

const copyRestoredObject = (object: RehearsalObject): RehearsalObject => ({
  bytes: Uint8Array.from(object.bytes),
  customMetadata: { ...object.customMetadata },
  httpMetadata: { ...object.httpMetadata },
});

const copySourceObject = (
  object: RehearsalSourceObject
): RehearsalSourceObject => ({
  ...copyRestoredObject(object),
  classification: object.classification,
  objectType: object.objectType,
});

const objectMetadataSha256 = (object: RehearsalObject) =>
  sha256(
    canonicalJson({
      customMetadata: object.customMetadata,
      httpMetadata: object.httpMetadata,
    })
  );

const mailboxIdFrom = (database: DatabaseSync) => {
  const rows = database
    .prepare("SELECT mailbox_id FROM mailbox_metadata WHERE singleton = 1")
    .all();
  if (rows.length !== 1 || typeof rows[0]?.mailbox_id !== "string") {
    throw new Error("SQLite snapshot does not identify one mailbox");
  }
  return rows[0].mailbox_id;
};

const databaseSchemaVersion = (
  database: DatabaseSync
): SupportedRestoreSchemaVersion => {
  const versions = database
    .prepare("SELECT version FROM mailbox_schema_migration ORDER BY version")
    .all()
    .map((row) => row.version);
  const version = versions.at(-1);
  if (
    version !== 12 &&
    version !== 13 &&
    version !== 14 &&
    version !== 15 &&
    version !== 16 &&
    version !== 18
  ) {
    throw new Error("SQLite snapshot has an unsupported schema version");
  }
  const expectedVersions = Array.from(
    { length: version },
    (_, index) => index + 1
  );
  if (canonicalJson(versions) !== canonicalJson(expectedVersions)) {
    throw new Error(`SQLite snapshot is not schema v${version}`);
  }
  return version as SupportedRestoreSchemaVersion;
};

const assertHealthy = (
  database: DatabaseSync,
  expectedVersion?: SupportedRestoreSchemaVersion
) => {
  const version = databaseSchemaVersion(database);
  if (expectedVersion !== undefined && version !== expectedVersion) {
    throw new Error(
      `SQLite snapshot is schema v${version}, expected v${expectedVersion}`
    );
  }

  const integrity = database.prepare("PRAGMA integrity_check").all();
  if (
    integrity.length !== 1 ||
    integrity[0]?.integrity_check !== "ok" ||
    database.prepare("PRAGMA foreign_key_check").all().length !== 0
  ) {
    throw new Error("SQLite snapshot failed integrity checks");
  }
  return version;
};

export const canonicalMailboxRows = (database: DatabaseSync): CanonicalRows =>
  Object.fromEntries(
    [...authoritativeTables, "mailbox_schema_migration"].map((table) => {
      const columns = database
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((row) => String(row.name));
      if (columns.length === 0) {
        throw new Error(`SQLite snapshot is missing ${table}`);
      }
      const statement = database.prepare(
        `SELECT ${columns.map((column) => `"${column}"`).join(", ")} FROM ${table}`
      );
      statement.setReadBigInts(true);
      const rows = statement
        .all()
        .map((row) => ({ ...row }) as Record<string, SqliteValue>)
        .sort((left, right) =>
          codeUnitCompare(canonicalJson(left), canonicalJson(right))
        );
      return [table, rows];
    })
  );

export const canonicalMailboxSchema = (database: DatabaseSync) =>
  database
    .prepare(
      `SELECT type, name, tbl_name, sql FROM sqlite_schema
       WHERE name NOT LIKE 'sqlite_%'
       ORDER BY type, name`
    )
    .all()
    .map((row) => ({ ...row }));

const sqliteDigests = (database: DatabaseSync) => {
  const schemaVersion = assertHealthy(database);
  const rows = canonicalMailboxRows(database);
  return {
    rowCount: authoritativeTables.reduce(
      (count, table) => count + (rows[table]?.length ?? 0),
      0
    ),
    rowsSha256: sha256(canonicalJson(rows)),
    schemaVersion,
    schemaSha256: sha256(canonicalJson(canonicalMailboxSchema(database))),
  };
};

const manifestPayload = (
  manifest: Omit<LocalMailboxRestoreManifest, "overallSha256">
) => canonicalJson(manifest);

const assertManifest = (input: unknown): LocalMailboxRestoreManifest => {
  const manifest = Schema.decodeUnknownSync(LocalMailboxRestoreManifest)(input);
  if (canonicalJson(manifest) !== canonicalJson(input)) {
    throw new Error(
      "restore manifest contains unknown or non-canonical fields"
    );
  }
  const keys = manifest.entries.map((entry) => entry.key);
  const sortedKeys = [...keys].sort(codeUnitCompare);
  if (
    new Set(keys).size !== keys.length ||
    canonicalJson(keys) !== canonicalJson(sortedKeys)
  ) {
    throw new Error("restore manifest entries must be unique and sorted");
  }
  const { overallSha256: _, ...payload } = manifest;
  if (sha256(manifestPayload(payload)) !== manifest.overallSha256) {
    throw new Error("restore manifest digest mismatch");
  }
  return manifest;
};

const objectMatchesEntry = (
  object: RehearsalObject,
  entry: LocalRestoreManifestEntry
) =>
  object.bytes.byteLength === entry.size &&
  sha256(object.bytes) === entry.sha256 &&
  objectMetadataSha256(object) === entry.metadataSha256 &&
  exactRecord(object.customMetadata, entry.customMetadata) &&
  exactRecord(object.httpMetadata, entry.httpMetadata);

const assertExactObject = (
  key: string,
  object: RehearsalSourceObject,
  expected: {
    readonly customMetadata: Readonly<Record<string, string>>;
    readonly httpMetadata: Readonly<Record<string, string>>;
    readonly objectType: RehearsalSourceObject["objectType"];
  },
  classification: RehearsalSourceObject["classification"]
) => {
  if (
    object.classification !== classification ||
    object.objectType !== expected.objectType ||
    !exactRecord(object.customMetadata, expected.customMetadata) ||
    !exactRecord(object.httpMetadata, expected.httpMetadata)
  ) {
    throw new Error(`restore archive object contract mismatch at ${key}`);
  }
};

const decimalInteger = (value: string | undefined, field: string): number => {
  if (value === undefined || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new TypeError(`restore archive has invalid ${field}`);
  }
  const decoded = Number(value);
  if (!Number.isSafeInteger(decoded)) {
    throw new TypeError(`restore archive has invalid ${field}`);
  }
  return decoded;
};

const assertRecognizedOrphan = (
  mailboxId: string,
  key: string,
  object: RehearsalSourceObject
) => {
  if (object.customMetadata["mailbox-id"] !== mailboxId) {
    throw new Error(
      `restore archive contains a foreign mailbox object at ${key}`
    );
  }
  if (object.objectType === "raw-message") {
    const ingestId = object.customMetadata["inbound-ingest-id"];
    const rawSize = decimalInteger(
      object.customMetadata["raw-size"],
      "raw-size metadata"
    );
    const receivedAt = decimalInteger(
      object.customMetadata["received-at"],
      "received-at metadata"
    );
    const envelopeTo = object.customMetadata["envelope-to"];
    if (ingestId === undefined || envelopeTo === undefined) {
      throw new Error(`restore archive has incomplete raw metadata at ${key}`);
    }
    assertExactObject(
      key,
      object,
      {
        customMetadata: inboundRawMessageCustomMetadata({
          envelopeFrom: object.customMetadata["envelope-from"],
          envelopeTo,
          inboundIngestId: ingestId,
          mailboxId,
          rawSize,
          receivedAt,
        }),
        httpMetadata: { contentType: "message/rfc822" },
        objectType: "raw-message",
      },
      "mailbox-orphan-in-flight"
    );
    if (
      key !== inboundRawMessageObjectKey(ingestId) ||
      object.bytes.byteLength !== rawSize
    ) {
      throw new Error(
        `restore archive has a non-canonical raw object at ${key}`
      );
    }
    return;
  }

  if (object.objectType === "inbound-attachment") {
    const ingestId = object.customMetadata["inbound-ingest-id"];
    const sourceIndex = decimalInteger(
      object.customMetadata["attachment-index"],
      "attachment-index metadata"
    );
    const size = decimalInteger(
      object.customMetadata["attachment-size"],
      "attachment-size metadata"
    );
    const receivedAt = decimalInteger(
      object.customMetadata["received-at"],
      "received-at metadata"
    );
    const contentSha256 = Schema.decodeUnknownSync(Sha256Digest)(
      object.customMetadata["content-sha256"]
    );
    const metadataSha256 = Schema.decodeUnknownSync(Sha256Digest)(
      object.customMetadata["attachment-metadata-sha256"]
    );
    const { contentType } = object.httpMetadata;
    if (ingestId === undefined || contentType === undefined) {
      throw new Error(
        `restore archive has incomplete attachment metadata at ${key}`
      );
    }
    assertExactObject(
      key,
      object,
      {
        customMetadata: inboundAttachmentCustomMetadata({
          contentSha256,
          inboundIngestId: ingestId,
          mailboxId,
          metadataSha256,
          receivedAt,
          size,
          sourceIndex,
        }),
        httpMetadata: { contentType },
        objectType: "inbound-attachment",
      },
      "mailbox-orphan-in-flight"
    );
    if (
      key !== inboundAttachmentObjectKey(ingestId, sourceIndex) ||
      object.bytes.byteLength !== size ||
      sha256(object.bytes) !== contentSha256
    ) {
      throw new Error(
        `restore archive has a non-canonical attachment object at ${key}`
      );
    }
    return;
  }

  const attachmentId = object.customMetadata["attachment-id"];
  const draftId = object.customMetadata["draft-id"];
  const size = decimalInteger(
    object.customMetadata["attachment-size"],
    "attachment-size metadata"
  );
  const expiresAt = decimalInteger(
    object.customMetadata["reservation-expires-at"],
    "reservation-expires-at metadata"
  );
  const contentSha256 = Schema.decodeUnknownSync(Sha256Digest)(
    object.customMetadata["content-sha256"]
  );
  const { contentType } = object.httpMetadata;
  if (
    attachmentId === undefined ||
    draftId === undefined ||
    contentType === undefined
  ) {
    throw new Error(`restore archive has incomplete draft metadata at ${key}`);
  }
  assertExactObject(
    key,
    object,
    {
      customMetadata: draftAttachmentCustomMetadata({
        attachmentId,
        contentSha256,
        draftId,
        expiresAt,
        mailboxId,
        size,
      }),
      httpMetadata: { contentType },
      objectType: "draft-outbound-attachment",
    },
    "mailbox-orphan-in-flight"
  );
  if (
    key !== draftAttachmentObjectKey(attachmentId) ||
    object.bytes.byteLength !== size ||
    sha256(object.bytes) !== contentSha256
  ) {
    throw new Error(
      `restore archive has a non-canonical draft object at ${key}`
    );
  }
};

const assertOutboundSnapshotClosure = (
  database: DatabaseSync,
  mailboxId: string,
  objects: ReadonlyMap<string, RehearsalSourceObject>
) => {
  const rows = database
    .prepare(
      `SELECT a.id, a.draft_attachment_id, a.mime_type, a.size,
              a.content_sha256, da.mime_type AS reservation_mime_type,
              da.size AS reservation_size,
              da.content_sha256 AS reservation_content_sha256
       FROM attachment a
       JOIN draft_attachment da ON da.id = a.draft_attachment_id
       WHERE a.draft_attachment_id IS NOT NULL`
    )
    .all();
  for (const row of rows) {
    const draftAttachmentId = String(row.draft_attachment_id);
    const key = draftAttachmentObjectKey(draftAttachmentId);
    const snapshotLocator = Schema.decodeUnknownSync(
      OutboundDraftAttachmentLocation
    )({
      contentSha256: row.content_sha256,
      draftAttachmentId,
      mailboxId,
      mimeType: row.mime_type,
      size: row.size,
    });
    const reservationLocator = Schema.decodeUnknownSync(
      OutboundDraftAttachmentLocation
    )({
      contentSha256: row.reservation_content_sha256,
      draftAttachmentId,
      mailboxId,
      mimeType: row.reservation_mime_type,
      size: row.reservation_size,
    });
    const object = objects.get(key);
    if (object === undefined) {
      throw new Error(`restore archive is missing required object ${key}`);
    }
    if (
      canonicalJson(snapshotLocator) !== canonicalJson(reservationLocator) ||
      object.bytes.byteLength !== snapshotLocator.size ||
      sha256(object.bytes) !== snapshotLocator.contentSha256 ||
      !exactRecord(object.httpMetadata, {
        contentType: snapshotLocator.mimeType,
      })
    ) {
      throw new Error(
        `restore archive outbound attachment snapshot mismatch at ${String(row.id)}`
      );
    }
  }
};

const assertObjectClosure = (
  database: DatabaseSync,
  objects: ReadonlyMap<string, RehearsalSourceObject>
) => {
  const mailboxId = mailboxIdFrom(database);
  const required = new Map<
    string,
    {
      readonly customMetadata: Readonly<Record<string, string>>;
      readonly httpMetadata: Readonly<Record<string, string>>;
      readonly objectType: RehearsalSourceObject["objectType"];
    }
  >();

  for (const row of database
    .prepare("SELECT id FROM inbound_processing")
    .all()) {
    const inboundIngestId = String(row.id);
    const key = inboundRawMessageObjectKey(inboundIngestId);
    const object = objects.get(key);
    if (object === undefined) {
      throw new Error(`restore archive is missing required raw object ${key}`);
    }
    const rawSize = decimalInteger(
      object.customMetadata["raw-size"],
      "raw-size metadata"
    );
    const receivedAt = decimalInteger(
      object.customMetadata["received-at"],
      "received-at metadata"
    );
    const envelopeTo = object.customMetadata["envelope-to"];
    if (envelopeTo === undefined) {
      throw new Error(`restore archive has incomplete raw metadata at ${key}`);
    }
    required.set(key, {
      customMetadata: inboundRawMessageCustomMetadata({
        envelopeFrom: object.customMetadata["envelope-from"],
        envelopeTo,
        inboundIngestId,
        mailboxId,
        rawSize,
        receivedAt,
      }),
      httpMetadata: { contentType: "message/rfc822" },
      objectType: "raw-message",
    });
    if (object.bytes.byteLength !== rawSize) {
      throw new Error(`restore archive raw size mismatch at ${key}`);
    }
  }

  const inboundAttachments = database
    .prepare(
      `SELECT a.inbound_ingest_id, a.source_index, a.file_name, a.mime_type,
              a.size, a.content_id, a.disposition, m.received_at
       FROM attachment a
       JOIN message m ON m.id = a.message_id
       WHERE a.inbound_ingest_id IS NOT NULL`
    )
    .all();
  for (const row of inboundAttachments) {
    const inboundIngestId = String(row.inbound_ingest_id);
    const sourceIndex = Number(row.source_index);
    const key = inboundAttachmentObjectKey(inboundIngestId, sourceIndex);
    const object = objects.get(key);
    if (object === undefined) {
      throw new Error(
        `restore archive is missing required inbound attachment ${key}`
      );
    }
    const parsed = Schema.decodeUnknownSync(ParsedInboundAttachmentV1)({
      ...(row.content_id === null ? {} : { contentId: row.content_id }),
      disposition: row.disposition,
      fileName: row.file_name,
      index: sourceIndex,
      mimeType: row.mime_type,
      size: row.size,
    });
    const metadataSha256 = sha256(inboundAttachmentMetadataBytes(parsed));
    const contentSha256 = sha256(object.bytes);
    if (object.bytes.byteLength !== Number(row.size)) {
      throw new Error(
        `restore archive inbound attachment size mismatch at ${key}`
      );
    }
    required.set(key, {
      customMetadata: inboundAttachmentCustomMetadata({
        contentSha256,
        inboundIngestId,
        mailboxId,
        metadataSha256,
        receivedAt: Number(row.received_at),
        size: Number(row.size),
        sourceIndex,
      }),
      httpMetadata: { contentType: String(row.mime_type) },
      objectType: "inbound-attachment",
    });
  }

  const draftAttachments = database
    .prepare(
      `SELECT DISTINCT da.id, da.draft_id, da.mime_type, da.size,
                       da.content_sha256, da.expires_at
       FROM draft_attachment da
       LEFT JOIN attachment a ON a.draft_attachment_id = da.id
       WHERE da.status = 'stored' OR a.draft_attachment_id IS NOT NULL`
    )
    .all();
  for (const row of draftAttachments) {
    if (typeof row.content_sha256 !== "string") {
      throw new TypeError("outbound attachment locator has no content digest");
    }
    const attachmentId = String(row.id);
    const key = draftAttachmentObjectKey(attachmentId);
    const locator = Schema.decodeUnknownSync(OutboundDraftAttachmentLocation)({
      contentSha256: row.content_sha256,
      draftAttachmentId: attachmentId,
      mailboxId,
      mimeType: row.mime_type,
      size: row.size,
    });
    const object = objects.get(key);
    if (
      object !== undefined &&
      (object.bytes.byteLength !== locator.size ||
        sha256(object.bytes) !== locator.contentSha256)
    ) {
      throw new Error(
        `restore archive draft attachment blob mismatch at ${key}`
      );
    }
    required.set(key, {
      customMetadata: draftAttachmentCustomMetadata({
        attachmentId,
        contentSha256: locator.contentSha256,
        draftId: String(row.draft_id),
        expiresAt: Number(row.expires_at),
        mailboxId,
        size: locator.size,
      }),
      httpMetadata: { contentType: locator.mimeType },
      objectType: "draft-outbound-attachment",
    });
  }

  assertOutboundSnapshotClosure(database, mailboxId, objects);

  for (const [key, expected] of required) {
    const object = objects.get(key);
    if (object === undefined) {
      throw new Error(`restore archive is missing required object ${key}`);
    }
    assertExactObject(key, object, expected, "authoritative");
  }
  for (const [key, object] of objects) {
    if (!required.has(key)) {
      assertRecognizedOrphan(mailboxId, key, object);
    }
  }
};

const assertArchiveObjects = (
  manifest: LocalMailboxRestoreManifest,
  objects: ReadonlyMap<string, RehearsalSourceObject>
) => {
  const objectKeys = [...objects.keys()].sort(codeUnitCompare);
  const entryKeys = manifest.entries.map((entry) => entry.key);
  if (canonicalJson(objectKeys) !== canonicalJson(entryKeys)) {
    throw new Error(
      "restore archive is missing or contains unmanifested objects"
    );
  }
  for (const entry of manifest.entries) {
    const object = objects.get(entry.key);
    if (
      object === undefined ||
      !objectMatchesEntry(object, entry) ||
      object.classification !== entry.classification ||
      object.objectType !== entry.objectType
    ) {
      throw new Error(
        `restore archive object verification failed for ${entry.key}`
      );
    }
  }
};

const withArchiveDatabase = <A>(
  archive: LocalMailboxRestoreArchive,
  run: (database: DatabaseSync) => A
): A => {
  const database = new DatabaseSync(archive.snapshotPath, { readOnly: true });
  try {
    return run(database);
  } finally {
    database.close();
  }
};

const withArchiveDatabaseAsync = async <A>(
  archive: LocalMailboxRestoreArchive,
  run: (database: DatabaseSync) => Promise<A>
): Promise<A> => {
  const database = new DatabaseSync(archive.snapshotPath, { readOnly: true });
  try {
    return await run(database);
  } finally {
    database.close();
  }
};

export const captureLocalMailboxRestoreArchive = async (input: {
  readonly archiveDirectory: string;
  readonly backupSqlite?: (
    source: DatabaseSync,
    destinationPath: string
  ) => Promise<void>;
  readonly mailboxId: string;
  readonly objects: ReadonlyMap<string, RehearsalSourceObject>;
  readonly snapshot: DatabaseSync;
}): Promise<LocalMailboxRestoreArchive> => {
  const archiveDirectory = makeOwnedTemporaryDirectory(
    input.archiveDirectory,
    "mailbox-restore-"
  );
  const snapshotPath = path.join(archiveDirectory.directory, "snapshot.sqlite");
  const snapshotOwnership = createOwnedFile(snapshotPath);

  try {
    await (input.backupSqlite ?? backup)(input.snapshot, snapshotPath);
    assertOwnedRegularFile(
      snapshotPath,
      snapshotOwnership,
      "captured SQLite snapshot"
    );
    const snapshot = new DatabaseSync(snapshotPath, { readOnly: true });
    try {
      const schemaVersion = assertHealthy(snapshot);
      if (mailboxIdFrom(snapshot) !== input.mailboxId) {
        throw new Error(
          "source mailbox_metadata does not match capture mailbox ID"
        );
      }

      const objects = new Map(
        [...input.objects.entries()].map(([key, object]) => [
          key,
          copySourceObject(object),
        ])
      );
      assertObjectClosure(snapshot, objects);
      const entries = [...objects.entries()]
        .sort(([left], [right]) => codeUnitCompare(left, right))
        .map(([key, object]) => ({
          classification: object.classification,
          customMetadata: { ...object.customMetadata },
          httpMetadata: { ...object.httpMetadata },
          key,
          metadataSha256: objectMetadataSha256(object),
          objectType: object.objectType,
          sha256: sha256(object.bytes),
          size: object.bytes.byteLength,
        }));
      const digests = sqliteDigests(snapshot);
      const payload = {
        entries,
        mailboxIdSha256: sha256(input.mailboxId),
        mode: "local-rehearsal" as const,
        schemaVersion,
        sqliteRowsSha256: digests.rowsSha256,
        sqliteSchemaSha256: digests.schemaSha256,
        limitations: {
          cloudflare: "not-exercised" as const,
          durableObjectAlarm: "not-captured-requires-reconciliation" as const,
          manifestIntegrity: "self-digest-not-authenticity" as const,
          objectStorage: "in-memory-analog" as const,
          workflowState: "not-captured-requires-reconciliation" as const,
        },
      };
      const manifest = Schema.decodeUnknownSync(LocalMailboxRestoreManifest)({
        ...payload,
        overallSha256: sha256(manifestPayload(payload)),
      });
      let closed = false;
      return {
        close: () => {
          if (!closed) {
            closed = true;
            removeOwnedPath(
              archiveDirectory.directory,
              archiveDirectory.ownership,
              true
            );
          }
        },
        manifest,
        objects,
        snapshotPath,
      };
    } finally {
      snapshot.close();
    }
  } catch (error) {
    removeOwnedPath(
      archiveDirectory.directory,
      archiveDirectory.ownership,
      true
    );
    throw error;
  }
};

const verifyFts = (database: DatabaseSync) => {
  database.exec(
    "INSERT INTO message_search(message_search) VALUES('integrity-check')"
  );
  database.exec("DROP TABLE IF EXISTS temp.restore_message_search_vocab");
  database.exec(
    "CREATE VIRTUAL TABLE temp.restore_message_search_vocab USING fts5vocab(main, message_search, 'instance')"
  );
  const indexed = database
    .prepare(
      "SELECT DISTINCT doc FROM restore_message_search_vocab ORDER BY doc"
    )
    .all()
    .map((row) => row.doc);
  const active = database
    .prepare(
      "SELECT rowid FROM message WHERE deleted_at IS NULL ORDER BY rowid"
    )
    .all()
    .map((row) => row.rowid);
  const activeRows = new Set(active);
  if (indexed.some((rowid) => !activeRows.has(rowid))) {
    throw new Error(
      "restored FTS index contains a deleted or non-active message"
    );
  }
};

const rebuildAndVerifyFts = (database: DatabaseSync) => {
  database.exec("INSERT INTO message_search(message_search) VALUES('rebuild')");
  database.exec(`
    INSERT INTO message_search(
      message_search, rowid, subject, sender_json, recipients_json, snippet,
      text_body, html_body, to_json, cc_json, bcc_json
    )
    SELECT
      'delete', rowid, subject, coalesce(sender_json, ''), recipients_json,
      snippet, coalesce(text_body, ''), coalesce(html_body, ''), to_json,
      cc_json, bcc_json
    FROM message
    WHERE deleted_at IS NOT NULL
  `);
  verifyFts(database);
};

const rebuildAndVerifyFtsTransactionally = (database: DatabaseSync) => {
  database.exec("BEGIN IMMEDIATE");
  try {
    rebuildAndVerifyFts(database);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  verifyFts(database);
};

const assertDatabaseMatchesManifest = (
  database: DatabaseSync,
  manifest: LocalMailboxRestoreManifest
) => {
  const digests = sqliteDigests(database);
  if (
    digests.schemaVersion !== manifest.schemaVersion ||
    sha256(mailboxIdFrom(database)) !== manifest.mailboxIdSha256 ||
    digests.rowsSha256 !== manifest.sqliteRowsSha256 ||
    digests.schemaSha256 !== manifest.sqliteSchemaSha256
  ) {
    throw new Error("SQLite snapshot does not match restore manifest");
  }
  return digests;
};

const assertMigratedLegacyState = (
  database: DatabaseSync,
  sourceVersion: LegacyRestoreSchemaVersion
) => {
  assertHealthy(database, 18);
  if (sourceVersion < 14) {
    const archiveRow = database
      .prepare(
        "SELECT count(*) AS count FROM outbound_delivery WHERE archive_recipient IS NOT NULL"
      )
      .get();
    if (archiveRow?.count !== 0) {
      throw new Error(
        "legacy migration did not preserve archive recipient snapshot as null"
      );
    }
  }
  const replyToRow = database
    .prepare(
      "SELECT count(*) AS count FROM message WHERE reply_to_json IS NOT NULL"
    )
    .get();
  if (sourceVersion === 12 && replyToRow?.count !== 0) {
    throw new Error("v12 migration did not preserve legacy Reply-To as null");
  }
};

const assertCurrentDatabaseMatches = (
  database: DatabaseSync,
  mailboxIdSha256: string,
  expected: ReturnType<typeof sqliteDigests>
) => {
  const actual = sqliteDigests(database);
  if (
    actual.schemaVersion !== 18 ||
    sha256(mailboxIdFrom(database)) !== mailboxIdSha256 ||
    actual.rowsSha256 !== expected.rowsSha256 ||
    actual.schemaSha256 !== expected.schemaSha256
  ) {
    throw new Error("Migrated SQLite snapshot changed before publication");
  }
  return actual;
};

const migratedLegacyCompatibilityDigests = (
  database: DatabaseSync,
  sourceVersion: LegacyRestoreSchemaVersion
) => {
  assertMigratedLegacyState(database, sourceVersion);
  const rows = canonicalMailboxRows(database);
  const normalizedRows = {
    ...rows,
    mailbox_schema_migration: rows.mailbox_schema_migration?.map((row) =>
      typeof row.version === "bigint" && row.version > BigInt(sourceVersion)
        ? { ...row, applied_at: `<migration-${row.version}-applied-at>` }
        : row
    ),
  };
  return {
    rowCount: authoritativeTables.reduce(
      (count, table) => count + (rows[table]?.length ?? 0),
      0
    ),
    rowsSha256: sha256(canonicalJson(normalizedRows)),
    schemaVersion: 18 as const,
    schemaSha256: sha256(canonicalJson(canonicalMailboxSchema(database))),
  };
};

const assertMigratedLegacyCompatible = (
  database: DatabaseSync,
  mailboxIdSha256: string,
  expected: ReturnType<typeof migratedLegacyCompatibilityDigests>,
  sourceVersion: LegacyRestoreSchemaVersion
) => {
  const actual = migratedLegacyCompatibilityDigests(database, sourceVersion);
  if (
    sha256(mailboxIdFrom(database)) !== mailboxIdSha256 ||
    actual.rowsSha256 !== expected.rowsSha256 ||
    actual.schemaSha256 !== expected.schemaSha256
  ) {
    throw new Error("Migrated SQLite snapshot changed before publication");
  }
  return actual;
};

const deriveMigratedLegacyDigests = async (
  archive: LocalMailboxRestoreArchive,
  manifest: LocalMailboxRestoreManifest,
  parentDirectory: string
) => {
  const proofDirectory = makeOwnedTemporaryDirectory(
    parentDirectory,
    `.v${manifest.schemaVersion}-migration-proof-`
  );
  const proofPath = path.join(proofDirectory.directory, "mailbox.sqlite");
  const proofOwnership = createOwnedFile(proofPath);
  try {
    await withArchiveDatabaseAsync(archive, (snapshot) =>
      backup(snapshot, proofPath)
    );
    assertOwnedRegularFile(proofPath, proofOwnership, "legacy migration proof");
    const proof = new DatabaseSync(proofPath);
    try {
      assertDatabaseMatchesManifest(proof, manifest);
      applyMailboxMigrations(migrationStorage(proof));
      if (manifest.schemaVersion === 18) {
        throw new Error("current schema does not require migration proof");
      }
      assertMigratedLegacyState(proof, manifest.schemaVersion);
      rebuildAndVerifyFtsTransactionally(proof);
      const digests = migratedLegacyCompatibilityDigests(
        proof,
        manifest.schemaVersion
      );
      assertMigratedLegacyCompatible(
        proof,
        manifest.mailboxIdSha256,
        digests,
        manifest.schemaVersion
      );
      return digests;
    } finally {
      proof.close();
    }
  } finally {
    if (removeOwnedRegularFile(proofPath, proofOwnership)) {
      removeOwnedEmptyDirectory(
        proofDirectory.directory,
        proofDirectory.ownership
      );
    }
  }
};

const preflightExistingTarget = (
  targetPath: string,
  snapshotPath: string,
  manifest: LocalMailboxRestoreManifest,
  expectedCurrentDigests:
    | ReturnType<typeof sqliteDigests>
    | ReturnType<typeof migratedLegacyCompatibilityDigests>
): PathIdentity | undefined => {
  let ownership: PathIdentity;
  try {
    ownership = regularFileIdentity(targetPath, "destination SQLite");
  } catch (error) {
    if (isMissingPathError(error)) {
      return undefined;
    }
    throw error;
  }

  const snapshotIdentity = regularFileIdentity(
    snapshotPath,
    "archive SQLite snapshot"
  );
  if (identitiesMatch(ownership, snapshotIdentity)) {
    throw new Error("destination SQLite cannot be the archive snapshot");
  }
  const target = new DatabaseSync(targetPath, { readOnly: true });
  try {
    assertOwnedRegularFile(targetPath, ownership, "destination SQLite");
    if (manifest.schemaVersion === 18) {
      assertDatabaseMatchesManifest(target, manifest);
    } else {
      assertMigratedLegacyCompatible(
        target,
        manifest.mailboxIdSha256,
        expectedCurrentDigests as ReturnType<
          typeof migratedLegacyCompatibilityDigests
        >,
        manifest.schemaVersion
      );
    }
  } finally {
    target.close();
  }
  assertOwnedRegularFile(targetPath, ownership, "destination SQLite");
  return ownership;
};

// oxlint-disable-next-line eslint/complexity -- Versioned verification and no-clobber publication form one fail-closed restore procedure.
export const restoreLocalMailboxArchive = async (input: {
  readonly archive: LocalMailboxRestoreArchive;
  readonly beforePublish?: (stagingPath: string) => void;
  readonly destinationObjects: RehearsalObjectDestination;
  readonly targetMailboxId: string;
  readonly targetPath: string;
}): Promise<LocalMailboxRestoreEvidence> => {
  const { archive } = input;
  const manifest = assertManifest(archive.manifest);
  if (sha256(input.targetMailboxId) !== manifest.mailboxIdSha256) {
    throw new Error("local rehearsal cannot restore to a different mailbox ID");
  }

  const sourceDigests = withArchiveDatabase(archive, (snapshot) => {
    const digests = assertDatabaseMatchesManifest(snapshot, manifest);
    assertObjectClosure(snapshot, archive.objects);
    return digests;
  });
  assertArchiveObjects(manifest, archive.objects);
  const expectedCurrentDigests =
    manifest.schemaVersion === 18
      ? sourceDigests
      : await deriveMigratedLegacyDigests(
          archive,
          manifest,
          path.dirname(input.targetPath)
        );
  let restoredDigests = expectedCurrentDigests;

  const targetOwnership = preflightExistingTarget(
    input.targetPath,
    archive.snapshotPath,
    manifest,
    expectedCurrentDigests
  );

  for (const entry of manifest.entries) {
    const existing = await input.destinationObjects.get(entry.key);
    if (existing !== undefined && !objectMatchesEntry(existing, entry)) {
      throw new Error(`destination object drift at ${entry.key}`);
    }
  }

  for (const entry of manifest.entries) {
    const existing = await input.destinationObjects.get(entry.key);
    if (existing === undefined) {
      const object = archive.objects.get(entry.key);
      if (object === undefined) {
        throw new Error(`restore archive is missing object ${entry.key}`);
      }
      const outcome = await input.destinationObjects.putIfAbsent(
        entry.key,
        object
      );
      if (outcome === "exists") {
        const raced = await input.destinationObjects.get(entry.key);
        if (raced === undefined || !objectMatchesEntry(raced, entry)) {
          throw new Error(`destination object drift at ${entry.key}`);
        }
      }
    }
  }

  let restoreOutcome: "restored" | "already-restored" = "restored";
  if (targetOwnership) {
    assertOwnedRegularFile(
      input.targetPath,
      targetOwnership,
      "destination SQLite"
    );
    const target = new DatabaseSync(input.targetPath);
    try {
      assertOwnedRegularFile(
        input.targetPath,
        targetOwnership,
        "destination SQLite"
      );
      if (manifest.schemaVersion === 18) {
        assertDatabaseMatchesManifest(target, manifest);
      } else {
        assertMigratedLegacyCompatible(
          target,
          manifest.mailboxIdSha256,
          expectedCurrentDigests as ReturnType<
            typeof migratedLegacyCompatibilityDigests
          >,
          manifest.schemaVersion
        );
      }
      rebuildAndVerifyFtsTransactionally(target);
      restoredDigests =
        manifest.schemaVersion === 18
          ? assertDatabaseMatchesManifest(target, manifest)
          : (assertMigratedLegacyCompatible(
              target,
              manifest.mailboxIdSha256,
              expectedCurrentDigests as ReturnType<
                typeof migratedLegacyCompatibilityDigests
              >,
              manifest.schemaVersion
            ),
            sqliteDigests(target));
      verifyFts(target);
    } finally {
      target.close();
    }
    assertOwnedRegularFile(
      input.targetPath,
      targetOwnership,
      "destination SQLite"
    );
    restoreOutcome = "already-restored";
  } else {
    const stagingDirectory = makeOwnedTemporaryDirectory(
      path.dirname(input.targetPath),
      `.${path.basename(input.targetPath)}.staging-`
    );
    const stagingPath = path.join(stagingDirectory.directory, "mailbox.sqlite");
    const stagingOwnership = createOwnedFile(stagingPath);
    try {
      await withArchiveDatabaseAsync(archive, (snapshot) =>
        backup(snapshot, stagingPath)
      );
      assertOwnedRegularFile(stagingPath, stagingOwnership, "staged SQLite");
      const staged = new DatabaseSync(stagingPath);
      try {
        assertOwnedRegularFile(stagingPath, stagingOwnership, "staged SQLite");
        if (manifest.schemaVersion !== 18) {
          assertDatabaseMatchesManifest(staged, manifest);
          applyMailboxMigrations(migrationStorage(staged));
          assertMigratedLegacyState(staged, manifest.schemaVersion);
        }
        rebuildAndVerifyFtsTransactionally(staged);
        restoredDigests =
          manifest.schemaVersion === 18
            ? assertDatabaseMatchesManifest(staged, manifest)
            : (assertMigratedLegacyCompatible(
                staged,
                manifest.mailboxIdSha256,
                expectedCurrentDigests as ReturnType<
                  typeof migratedLegacyCompatibilityDigests
                >,
                manifest.schemaVersion
              ),
              sqliteDigests(staged));
        verifyFts(staged);
      } finally {
        staged.close();
      }
      assertOwnedRegularFile(stagingPath, stagingOwnership, "staged SQLite");
      input.beforePublish?.(stagingPath);
      assertOwnedRegularFile(stagingPath, stagingOwnership, "staged SQLite");
      const publicationCandidate = new DatabaseSync(stagingPath);
      try {
        assertOwnedRegularFile(stagingPath, stagingOwnership, "staged SQLite");
        if (manifest.schemaVersion === 18) {
          assertDatabaseMatchesManifest(publicationCandidate, manifest);
        } else {
          assertMigratedLegacyState(
            publicationCandidate,
            manifest.schemaVersion
          );
          assertCurrentDatabaseMatches(
            publicationCandidate,
            manifest.mailboxIdSha256,
            restoredDigests
          );
        }
        verifyFts(publicationCandidate);
      } finally {
        publicationCandidate.close();
      }
      assertOwnedRegularFile(stagingPath, stagingOwnership, "staged SQLite");
      try {
        // A same-filesystem hard link is an atomic, no-clobber publication.
        linkSync(stagingPath, input.targetPath);
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "EEXIST"
        ) {
          throw new Error("destination SQLite appeared during publication", {
            cause: error,
          });
        }
        throw error;
      }
    } finally {
      if (removeOwnedRegularFile(stagingPath, stagingOwnership)) {
        removeOwnedEmptyDirectory(
          stagingDirectory.directory,
          stagingDirectory.ownership
        );
      }
    }
  }

  return Schema.decodeUnknownSync(LocalMailboxRestoreEvidence)({
    archiveObjectCount: manifest.entries.length,
    authoritativeRowCount: sourceDigests.rowCount,
    mailboxIdSha256: manifest.mailboxIdSha256,
    manifestSha256: manifest.overallSha256,
    mode: "local-rehearsal",
    orphanInFlightObjectCount: manifest.entries.filter(
      (entry) => entry.classification === "mailbox-orphan-in-flight"
    ).length,
    restoreOutcome,
    schemaVersion: 18,
    sqliteRowsSha256: restoredDigests.rowsSha256,
    limitations: manifest.limitations,
  });
};
