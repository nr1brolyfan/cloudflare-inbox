-- Generated from @effect-auth/core@0.1.0-alpha.20.
-- Do not edit manually; run `bun run generate:auth-migrations`.

create table if not exists auth_security_timeline_cardinality_migration_guard (
  version integer primary key check (version = 1)
);
insert into auth_security_timeline_cardinality_migration_guard (version) values (1);

create table if not exists auth_security_timeline_quarantine (
  id text, user_id text, type text, category text, severity text,
  occurred_at integer, summary text, actor text, request text, metadata text,
  canonical_event text, canonical_metadata text, metadata_bytes integer,
  reason text not null
);

insert into auth_security_timeline_quarantine (
  id, user_id, type, category, severity, occurred_at, summary,
  actor, request, metadata, canonical_event, canonical_metadata, metadata_bytes,
  reason
)
select id, user_id, type, category, severity, occurred_at, summary,
  actor, request, metadata, null, null, null, 'requires-runtime-normalization'
from auth_security_timeline;

alter table auth_security_timeline rename to auth_security_timeline_unconstrained;

create table auth_security_timeline (
  id text primary key check (typeof(id) = 'text' and length(cast(id as blob)) between 1 and 256),
  user_id text not null check (typeof(user_id) = 'text' and length(cast(user_id as blob)) between 1 and 256),
  type text not null check (type in (
    'auth.login.succeeded','auth.login.failed','auth.session.revoked','auth.session.assurance_changed','auth.session.step_up_completed','auth.session.primary_reauthenticated','auth.session.recovery_remediation.entered','auth.session.recovery_remediation.completed','auth.risk.assessed','auth.policy.denied','auth.identity.added','auth.identity.replaced','auth.identity.revoked','auth.identity.primary_changed','auth.oauth.account.linked','auth.oauth.account.unlinked','auth.oauth.link_confirmation.started','auth.oauth.link_confirmation.confirmed','auth.oauth.provider_token.refreshed','auth.oauth.provider_token.revoked','auth.passkey.credential.revoked','auth.totp.enrollment.started','auth.totp.factor.confirmed','auth.totp.factor.verified','auth.totp.factor.revoked','auth.recovery_code.generated','auth.recovery_code.verified','auth.recovery_code.revoked','auth.api_key.created','auth.api_key.verified','auth.api_key.revoked','auth.api_key.verification_failed','auth.refresh_token.issued','auth.refresh_token.rotated','auth.refresh_token.reuse_detected','auth.refresh_token.revoked','auth.incident_action.executed','auth.jwt.introspected','auth.jwt.revoked','auth.permission_definition.created','auth.permission_definition.updated','auth.permission_definition.disabled','auth.permission_definition.enabled','auth.permission_definition.deleted','auth.role_definition.created','auth.role_definition.updated','auth.role_definition.disabled','auth.role_definition.enabled','auth.role_definition.deleted','auth.permission.granted','auth.permission.revoked','auth.role.granted','auth.role.revoked','auth.role_permission.assigned','auth.role_permission.removed'
  )),
  category text not null check (category in ('api_key','auth','authorization','incident','identity','jwt','mfa','oauth','policy','refresh_token','risk','session')),
  severity text not null check (severity in ('info','warning','critical')),
  occurred_at integer not null check (typeof(occurred_at) = 'integer' and occurred_at between 0 and 9007199254740991),
  summary text not null check (typeof(summary) = 'text' and length(cast(summary as blob)) between 1 and 128),
  actor text, request text, metadata text,
  canonical_event text not null check (
    json_valid(canonical_event) = 1 and
    json_extract(canonical_event, '$.id') is id and
    json_extract(canonical_event, '$.userId') is user_id and
    json_extract(canonical_event, '$.type') is type and
    json_extract(canonical_event, '$.category') is category and
    json_extract(canonical_event, '$.severity') is severity and
    json_extract(canonical_event, '$.occurredAt') is occurred_at and
    json_extract(canonical_event, '$.summary') is summary
  ),
  canonical_metadata text,
  normalization_version integer not null check (normalization_version = 1),
  event_bytes integer not null check (typeof(event_bytes) = 'integer' and event_bytes between 1 and 32768 and event_bytes = length(cast(canonical_event as blob))),
  metadata_bytes integer not null check (typeof(metadata_bytes) = 'integer' and metadata_bytes between 0 and 16384),
  check (
    (metadata is null and canonical_metadata is null and metadata_bytes = 0) or
    (metadata is not null and canonical_metadata = metadata and json_valid(canonical_metadata) = 1 and metadata_bytes = length(cast(canonical_metadata as blob)))
  ),
  check (actor is null or json_valid(actor) = 1),
  check (request is null or json_valid(request) = 1)
);

drop table auth_security_timeline_unconstrained;

create index auth_security_timeline_user_occurred_at_idx on auth_security_timeline (user_id, occurred_at, id);
create index auth_security_timeline_occurred_at_idx on auth_security_timeline (occurred_at, id);
create index auth_security_timeline_user_type_idx on auth_security_timeline (user_id, type, occurred_at, id);
create index auth_security_timeline_user_category_idx on auth_security_timeline (user_id, category, occurred_at, id);
