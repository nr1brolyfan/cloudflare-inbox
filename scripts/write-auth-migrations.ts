import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import authPackage from "@effect-auth/core/package.json" with { type: "json" };
import { authStorageMigrations } from "@effect-auth/core/StorageMigrations";

const outputDirectory = fileURLToPath(
  new URL("../migrations/control-plane", import.meta.url)
);
const checkOnly = process.argv.includes("--check");
const passkeyEnrollmentReceiptTableSql = `create table if not exists app_passkey_enrollment_receipt (
  operation_id text primary key,
  mode text not null,
  actor_user_id text not null,
  challenge_id text not null,
  recovery_identity_id text not null,
  recovery_identity_version integer not null,
  client_intent_digest text not null,
  verified_intent_digest text not null,
  credential_record_id text not null unique,
  readback_secret_hash text,
  replacement_identity_id text,
  resulting_session_id text,
  resulting_code_set_id text,
  resulting_code_count integer,
  committed_at integer not null,
  schema_version integer not null,
  check (
    length(operation_id) = 36
    and operation_id = lower(trim(operation_id))
    and substr(operation_id, 9, 1) = '-'
    and substr(operation_id, 14, 1) = '-'
    and substr(operation_id, 15, 1) = '4'
    and substr(operation_id, 19, 1) = '-'
    and substr(operation_id, 20, 1) in ('8', '9', 'a', 'b')
    and substr(operation_id, 24, 1) = '-'
    and length(replace(operation_id, '-', '')) = 32
    and replace(operation_id, '-', '') not glob '*[^0-9a-f]*'
  ),
  check (mode in ('normal', 'recovery-remediation')),
  check (
    length(actor_user_id) between 1 and 128
    and actor_user_id = trim(actor_user_id)
    and length(challenge_id) between 1 and 128
    and length(recovery_identity_id) between 1 and 128
    and recovery_identity_version >= 1
  ),
  check (
    length(client_intent_digest) = 43
    and client_intent_digest not glob '*[^A-Za-z0-9_-]*'
    and length(verified_intent_digest) = 43
    and verified_intent_digest not glob '*[^A-Za-z0-9_-]*'
    and length(credential_record_id) between 1 and 256
  ),
  check (
    committed_at >= 0 and schema_version = 1
    and ((mode = 'normal'
      and readback_secret_hash is null
      and replacement_identity_id is null
      and resulting_session_id is null
      and resulting_code_set_id is null
      and resulting_code_count is null)
    or (mode = 'recovery-remediation'
      and length(readback_secret_hash) = 43
      and readback_secret_hash not glob '*[^A-Za-z0-9_-]*'
      and length(replacement_identity_id) between 1 and 128
      and length(resulting_session_id) between 1 and 128
      and length(resulting_code_set_id) between 1 and 128
      and resulting_code_count = 10))
  )
);`;
const passkeyEnrollmentReceiptBindingSql = `create trigger if not exists app_passkey_enrollment_receipt_binding
before insert on app_passkey_enrollment_receipt
when not exists (
  select 1 from auth_passkey_credential
   where id = new.credential_record_id
     and user_id = new.actor_user_id
     and created_at = new.committed_at
)
or not exists (
  select 1 from auth_verification
   where id = new.challenge_id
     and type = 'passkey-registration'
     and subject = new.actor_user_id
     and consumed_at = new.committed_at
     and json_valid(metadata)
     and json_extract(metadata, '$.operationId') = new.operation_id
     and json_extract(metadata, '$.recoveryIdentityId') = new.recovery_identity_id
     and json_extract(metadata, '$.recoveryIdentityVersion') = new.recovery_identity_version
     and json_extract(metadata, '$.authorization') = case new.mode
       when 'normal' then 'step-up' else 'recovery-remediation' end
     and ((new.mode = 'normal'
       and json_type(metadata, '$.readbackSecretHash') is null)
       or (new.mode = 'recovery-remediation'
         and json_extract(metadata, '$.readbackSecretHash') = new.readback_secret_hash))
)
or not exists (
  select 1 from auth_audit_log
   where id = 'passkey-enrollment:' || new.operation_id
     and user_id = new.actor_user_id
     and actor_user_id = new.actor_user_id
     and type = 'app.passkey.enrolled'
     and occurred_at = new.committed_at
     and created_at = new.committed_at
     and json_valid(event)
     and json_extract(event, '$.payload.operationId') = new.operation_id
     and json_extract(event, '$.payload.credentialRecordId') = new.credential_record_id
)
or (new.mode = 'recovery-remediation' and (
  not exists (
    select 1 from auth_user_identity
     where id = new.replacement_identity_id
       and user_id = new.actor_user_id
       and kind = 'recovery-passkey'
       and is_primary_login = 1
       and verified_at = new.committed_at
       and revoked_at is null
  )
  or not exists (
    select 1 from auth_user_identity
     where user_id = new.actor_user_id
       and replaced_by_id = new.replacement_identity_id
       and revoked_at >= new.committed_at
  )
  or not exists (
    select 1 from auth_session
     where id = new.resulting_session_id
       and user_id = new.actor_user_id
       and created_at = new.committed_at
       and revoked_at is null
       and json_valid(metadata)
       and json_extract(metadata, '$.__effectAuthSession.metadata.purpose') = 'account-recovery-completed'
       and json_type(metadata, '$.__effectAuthSession.claims.requirements') is null
  )
  or (select count(*) from auth_recovery_code
       where user_id = new.actor_user_id
         and created_at = new.committed_at
         and used_at is null
         and revoked_at is null
         and json_valid(metadata)
         and json_extract(metadata, '$.purpose') = 'account-recovery-completed'
       and json_extract(metadata, '$.setId') = new.resulting_code_set_id)
       != new.resulting_code_count
  or exists (
    select 1 from auth_recovery_code
     where json_valid(metadata)
       and json_extract(metadata, '$.setId') = new.resulting_code_set_id
       and (user_id != new.actor_user_id
         or created_at != new.committed_at
         or used_at is not null
         or revoked_at is not null
         or metadata != json_object(
           'purpose', 'account-recovery-completed',
           'setId', new.resulting_code_set_id))
  )
  or not exists (
    select 1 from auth_audit_log
     where id = 'account-recovery-completed:' || new.operation_id
       and user_id = new.actor_user_id
       and actor_user_id = new.actor_user_id
       and type = 'app.account_recovery.completed'
       and occurred_at = new.committed_at
       and created_at = new.committed_at
       and json_valid(event)
       and json_extract(event, '$.payload.operationId') = new.operation_id
       and json_extract(event, '$.payload.credentialRecordId') = new.credential_record_id
       and json_extract(event, '$.payload.codeCount') = new.resulting_code_count
  )
))
begin
  select raise(abort, 'invalid passkey enrollment receipt binding');
end;`;
const passkeyRevocationTableSql = `create table if not exists app_passkey_credential_revocation (
  operation_id text primary key,
  user_id text not null check (length(user_id) between 1 and 128 and user_id = trim(user_id)),
  credential_record_id text not null unique
    check (length(credential_record_id) between 1 and 256 and credential_record_id = trim(credential_record_id)),
  credential_created_at integer not null check (credential_created_at >= 0),
  credential_last_used_at integer,
  revoked_at integer not null check (revoked_at >= credential_created_at),
  check (
    length(operation_id) = 36
    and operation_id = lower(trim(operation_id))
    and substr(operation_id, 9, 1) = '-'
    and substr(operation_id, 14, 1) = '-'
    and substr(operation_id, 15, 1) = '4'
    and substr(operation_id, 19, 1) = '-'
    and substr(operation_id, 20, 1) in ('8', '9', 'a', 'b')
    and substr(operation_id, 24, 1) = '-'
    and length(replace(operation_id, '-', '')) = 32
    and replace(operation_id, '-', '') not glob '*[^0-9a-f]*'
  ),
  check (
    credential_last_used_at is null
    or credential_last_used_at between credential_created_at and revoked_at
  ),
  foreign key (credential_record_id)
    references auth_passkey_credential (id) on delete restrict
);`;
const passkeyRevocationSchemaSql = `${passkeyRevocationTableSql}

create index if not exists app_passkey_credential_revocation_user_operation_idx
  on app_passkey_credential_revocation (user_id, operation_id);

create trigger if not exists app_passkey_credential_revocation_binding
before insert on app_passkey_credential_revocation
when not exists (
  select 1 from auth_passkey_credential
   where id = new.credential_record_id
     and user_id = new.user_id
     and created_at = new.credential_created_at
     and last_used_at is new.credential_last_used_at
     and revoked_at = new.revoked_at
)
begin
  select raise(abort, 'invalid passkey revocation receipt binding');
end;

create trigger if not exists app_passkey_credential_revocation_no_update
before update on app_passkey_credential_revocation
begin
  select raise(abort, 'passkey revocation receipts are immutable');
end;

create trigger if not exists app_passkey_credential_revocation_no_delete
before delete on app_passkey_credential_revocation
begin
  select raise(abort, 'passkey revocation receipts are retained');
end;

create trigger if not exists app_passkey_credential_revocation_no_replace
before insert on app_passkey_credential_revocation
when exists (
  select 1 from app_passkey_credential_revocation
   where operation_id = new.operation_id
      or credential_record_id = new.credential_record_id
)
begin
  select raise(abort, 'passkey revocation receipts are immutable');
end;`;
const migrationPreludes = new Map<string, string>([
  [
    "0035_auth_audit_log_cardinality",
    [
      "-- App triggers created by later historical migrations must not follow the scratch rename.",
      "drop trigger if exists app_account_recovery_completion_receipt_binding;",
      "drop trigger if exists app_passkey_enrollment_receipt_binding;",
      "drop trigger if exists app_first_owner_password_enrollment_binding;",
      "",
    ].join("\n"),
  ],
  [
    "0039_auth_passkey_credential_hardening",
    [
      "-- Detach app receipts so their FK and trigger do not follow the scratch rename.",
      passkeyEnrollmentReceiptTableSql,
      "",
      "drop trigger if exists app_passkey_enrollment_receipt_binding;",
      "",
      passkeyRevocationTableSql,
      "",
      `create table auth_passkey_credential_revocation_rebind as
select * from app_passkey_credential_revocation where false;`,
      `insert into auth_passkey_credential_revocation_rebind
select * from app_passkey_credential_revocation;`,
      "drop table app_passkey_credential_revocation;",
      "",
    ].join("\n"),
  ],
]);
const migrationPostludes = new Map<string, string>([
  [
    "0039_auth_passkey_credential_hardening",
    [
      "",
      "-- Restore app receipts against the hardened parent in the same transaction.",
      passkeyEnrollmentReceiptBindingSql,
      "",
      passkeyRevocationSchemaSql,
      "",
      `insert into app_passkey_credential_revocation
select * from auth_passkey_credential_revocation_rebind;`,
      "drop table auth_passkey_credential_revocation_rebind;",
    ].join("\n"),
  ],
]);
const patchedMigrationFiles = new Set(
  [...migrationPreludes.keys(), ...migrationPostludes.keys()].map(
    (id) => `${id}.sql`
  )
);

const manifest = `${JSON.stringify(
  {
    database: "sqlite/d1",
    migrations: authStorageMigrations.map(({ id }) => id),
    package: "@effect-auth/core",
    version: authPackage.version,
  },
  null,
  2
)}\n`;
const generatedFiles = new Map<string, string>([
  ...authStorageMigrations.map((migration) => {
    const body = [
      migrationPreludes.get(migration.id),
      migration.sql,
      migrationPostludes.get(migration.id),
    ]
      .filter((sql): sql is string => sql !== undefined)
      .map((sql) => sql.trim())
      .join("\n\n");
    return [
      `${migration.id}.sql`,
      [
        `-- Generated from @effect-auth/core@${authPackage.version}.`,
        "-- Do not edit manually; run `bun run generate:auth-migrations`.",
        "",
        body,
        "",
      ].join("\n"),
    ] as const;
  }),
  ["effect-auth.json", manifest] as const,
]);

const migrationSql = (content: string) =>
  content.split("\n").slice(3).join("\n").trim();

const existingFiles = await readdir(outputDirectory).catch(() => []);
const staleFiles = existingFiles.filter(
  (file) => /^\d{4}_auth_.+\.sql$/u.test(file) && !generatedFiles.has(file)
);
const changedFiles: string[] = [];

for (const [file, content] of generatedFiles) {
  const path = `${outputDirectory}/${file}`;
  const existing = await readFile(path, "utf-8").catch(() => null);

  const unchangedHistoricalMigration =
    existing !== null &&
    file.endsWith(".sql") &&
    migrationSql(existing) === migrationSql(content);
  if (existing !== content && !unchangedHistoricalMigration) {
    changedFiles.push(file);
  }
}

if (checkOnly) {
  if (changedFiles.length > 0 || staleFiles.length > 0) {
    throw new Error(
      `Auth migrations are stale. Changed: ${changedFiles.join(", ") || "none"}; stale: ${staleFiles.join(", ") || "none"}`
    );
  }

  console.log(`Verified ${authStorageMigrations.length} auth migrations.`);
} else {
  await mkdir(outputDirectory, { recursive: true });

  for (const [file, content] of generatedFiles) {
    const path = `${outputDirectory}/${file}`;
    const existing = await readFile(path, "utf-8").catch(() => null);
    if (
      existing === null ||
      file === "effect-auth.json" ||
      patchedMigrationFiles.has(file)
    ) {
      await writeFile(path, content);
      continue;
    }
    if (migrationSql(existing) !== migrationSql(content)) {
      throw new Error(`Historical auth migration drift: ${file}`);
    }
  }

  if (staleFiles.length > 0) {
    throw new Error(
      `Refusing to delete historical auth migrations: ${staleFiles.join(", ")}`
    );
  }

  console.log(`Wrote ${authStorageMigrations.length} auth migrations.`);
}
