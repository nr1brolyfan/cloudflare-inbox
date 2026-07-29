-- Generated from @effect-auth/core@0.1.0-alpha.20.
-- Do not edit manually; run `bun run generate:auth-migrations`.

alter table auth_passkey_credential add column name text;
