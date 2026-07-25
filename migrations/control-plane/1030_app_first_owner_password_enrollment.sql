-- JOB-BOOT-002 is forward-only. A manual reapply must fail before changing
-- the immutable enrollment seal or its generation manifest.
create temp table app_first_owner_password_enrollment_entry_preflight (
  valid integer not null check (valid = 1)
);

insert into app_first_owner_password_enrollment_entry_preflight (valid)
select case when
  not exists (select 1 from sqlite_master
    where name glob 'app_first_owner_password_enrollment*')
  and (select count(*) from app_organization_lifecycle_generation) = 1
  and exists (select 1 from app_organization_lifecycle_generation
    where id = 1 and schema_version = 1)
  and not exists (select 1 from pragma_foreign_key_check)
then 1 else 0 end;

drop table app_first_owner_password_enrollment_entry_preflight;

create table app_first_owner_password_enrollment (
  singleton_key integer primary key,
  operation_id text not null unique,
  actor_user_id text not null,
  session_id text not null,
  login_identity_id text not null,
  credential_id text not null unique,
  proof_type text not null,
  proof_verified_at integer not null,
  password_intent_digest text not null,
  committed_at integer not null,
  schema_version integer not null,
  foreign key (actor_user_id) references auth_user(id)
    on update restrict on delete restrict,
  foreign key (login_identity_id) references auth_user_identity(id)
    on update restrict on delete restrict,
  foreign key (credential_id) references auth_credential(id)
    on update restrict on delete restrict,
  constraint app_first_owner_password_enrollment_singleton_check check (
    singleton_key = 1
  ),
  constraint app_first_owner_password_enrollment_operation_id_check check (
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
  constraint app_first_owner_password_enrollment_identity_check check (
    length(actor_user_id) between 1 and 128
    and actor_user_id = trim(actor_user_id)
    and length(session_id) between 1 and 128
    and session_id = trim(session_id)
    and length(login_identity_id) between 1 and 128
    and login_identity_id = trim(login_identity_id)
    and length(credential_id) between 1 and 128
    and credential_id = trim(credential_id)
  ),
  constraint app_first_owner_password_enrollment_proof_check check (
    proof_type in ('email_otp', 'magic_link')
    and typeof(proof_verified_at) = 'integer'
    and proof_verified_at between 0 and committed_at
  ),
  constraint app_first_owner_password_enrollment_digest_check check (
    length(password_intent_digest) = 43
    and password_intent_digest not glob '*[^A-Za-z0-9_-]*'
  ),
  constraint app_first_owner_password_enrollment_result_check check (
    typeof(committed_at) = 'integer'
    and committed_at between 0 and 9007199254740991
    and schema_version = 1
  )
);

create index app_first_owner_password_enrollment_actor_operation_idx
  on app_first_owner_password_enrollment (actor_user_id, operation_id);

create trigger app_first_owner_password_enrollment_binding
before insert on app_first_owner_password_enrollment
when not exists (
  select 1 from auth_user_identity
   where id = new.login_identity_id
     and user_id = new.actor_user_id
     and scope_type = 'global'
     and scope_id = 'global'
     and kind = 'email'
     and verified_at is not null
     and is_primary_login = 1
     and revoked_at is null
     and replaced_by_id is null
)
or not exists (
  select 1 from auth_credential
   where id = new.credential_id
     and user_id = new.actor_user_id
     and type = 'password'
     and password_hash is not null
     and created_at = new.committed_at
     and updated_at = new.committed_at
     and revoked_at is null
     and metadata is null
)
or not exists (
  select 1 from auth_session
   where id = new.session_id
     and user_id = new.actor_user_id
     and revoked_at is null
     and expires_at > new.committed_at
     and (
       metadata is null
       or (json_valid(metadata) and json_type(metadata) = 'object' and (
         json_type(metadata, '$.__effectAuthSession') is null
         or (
           json_type(metadata, '$.__effectAuthSession') = 'object'
           and json_type(metadata, '$.__effectAuthSession.version') = 'integer'
           and json_extract(metadata, '$.__effectAuthSession.version') = 1
           and (
             json_type(metadata, '$.__effectAuthSession.claims') is null
             or json_type(metadata, '$.__effectAuthSession.claims') = 'object'
           )
           and (
             json_type(metadata,
               '$.__effectAuthSession.claims.requirements') is null
             or (
               json_type(metadata,
                 '$.__effectAuthSession.claims.requirements') = 'array'
               and json_array_length(metadata,
                 '$.__effectAuthSession.claims.requirements') = 0
             )
           )
           and json_type(metadata,
             '$.__effectAuthSession.claims.recoveryEnrollment') is null
           and json_type(metadata,
             '$.__effectAuthSession.claims.recoveryRemediation') is null
         )
       ))
     )
     and json_valid(authentication_events)
     and json_type(authentication_events) = 'array'
     and json_array_length(authentication_events) <= 32
     and exists (
       select 1 from json_each(authentication_events) event
        where json_type(event.value, '$.version') = 'integer'
          and json_extract(event.value, '$.version') = 1
          and json_extract(event.value, '$.type') = new.proof_type
          and json_type(event.value, '$.identityId') = 'text'
          and json_extract(event.value, '$.identityId') = new.login_identity_id
          and json_type(event.value, '$.verifiedAt') = 'integer'
          and json_extract(event.value, '$.verifiedAt') = new.proof_verified_at
          and json_extract(event.value, '$.verifiedAt') between
            new.committed_at - 300000 and new.committed_at
     )
)
or (select count(*) from auth_audit_log
   where id = 'first-owner-password-enrollment:' || new.operation_id
     and user_id = new.actor_user_id
     and actor_user_id = new.actor_user_id
     and type = 'app.first_owner.password_enrolled'
     and occurred_at = new.committed_at
     and created_at = new.committed_at
     and json_valid(event)
     and json_extract(event, '$.version') = 1
     and json_extract(event, '$.actor.type') = 'user'
     and json_extract(event, '$.actor.userId') = new.actor_user_id
     and json_extract(event, '$.actor.sessionId') = new.session_id
     and json_extract(event, '$.subject.type') = 'user'
     and json_extract(event, '$.subject.userId') = new.actor_user_id
     and json_extract(event, '$.occurredAt') = new.committed_at
     and json_extract(event, '$.payload.operationId') = new.operation_id
     and json_extract(event, '$.payload.credentialId') = new.credential_id
     and json_extract(event, '$.payload.proofType') = new.proof_type
     and json_extract(event, '$.payload.proofVerifiedAt') = new.proof_verified_at
     and (select count(*) from json_each(event, '$.payload')) = 4
     and (select count(*) from json_each(event)) = 6
) != 1
begin
  select raise(abort, 'invalid first-owner password enrollment binding');
end;

create trigger app_first_owner_password_enrollment_no_update
before update on app_first_owner_password_enrollment
begin
  select raise(abort, 'first-owner password enrollment is immutable');
end;

create trigger app_first_owner_password_enrollment_no_delete
before delete on app_first_owner_password_enrollment
begin
  select raise(abort, 'first-owner password enrollment is retained');
end;

create trigger app_first_owner_password_enrollment_no_replace
before insert on app_first_owner_password_enrollment
when exists (select 1 from app_first_owner_password_enrollment
  where singleton_key = new.singleton_key
     or operation_id = new.operation_id
     or credential_id = new.credential_id)
begin
  select raise(abort, 'first-owner password enrollment is sealed');
end;

create table app_first_owner_password_enrollment_generation (
  id integer primary key check (id = 1),
  schema_version integer not null check (schema_version = 1),
  artifact_sql_json text not null
    check (json_valid(artifact_sql_json) and json_type(artifact_sql_json) = 'array'),
  foreign_key_json text not null
    check (json_valid(foreign_key_json) and json_type(foreign_key_json) = 'array')
);

create trigger app_first_owner_password_enrollment_generation_no_replace
before insert on app_first_owner_password_enrollment_generation
when exists (select 1 from app_first_owner_password_enrollment_generation
  where id = new.id)
begin
  select raise(abort, 'first-owner password enrollment generation is sealed');
end;

create trigger app_first_owner_password_enrollment_generation_no_update
before update on app_first_owner_password_enrollment_generation
begin
  select raise(abort, 'first-owner password enrollment generation is immutable');
end;

create trigger app_first_owner_password_enrollment_generation_no_delete
before delete on app_first_owner_password_enrollment_generation
begin
  select raise(abort, 'first-owner password enrollment generation is retained');
end;

insert into app_first_owner_password_enrollment_generation
  (id, schema_version, artifact_sql_json, foreign_key_json)
select 1, 1,
  (select json_group_array(json_object(
    'type', type, 'name', name, 'tbl_name', tbl_name, 'sql', sql
  )) from (select type, name, tbl_name, sql from sqlite_master where name in (
    'app_first_owner_password_enrollment',
    'app_first_owner_password_enrollment_actor_operation_idx',
    'app_first_owner_password_enrollment_binding',
    'app_first_owner_password_enrollment_no_update',
    'app_first_owner_password_enrollment_no_delete',
    'app_first_owner_password_enrollment_no_replace',
    'app_first_owner_password_enrollment_generation',
    'app_first_owner_password_enrollment_generation_no_replace',
    'app_first_owner_password_enrollment_generation_no_update',
    'app_first_owner_password_enrollment_generation_no_delete'
  ) order by type, name)),
  (select json_group_array(json_object(
    'id', id, 'seq', seq, 'table', "table", 'from', "from", 'to', "to",
    'on_update', on_update, 'on_delete', on_delete, 'match', match
  )) from (select * from pragma_foreign_key_list(
    'app_first_owner_password_enrollment') order by id, seq));

create temp table app_first_owner_password_enrollment_postflight (
  valid integer not null check (valid = 1)
);

insert into app_first_owner_password_enrollment_postflight (valid)
select case when
  (select count(*) from app_first_owner_password_enrollment_generation) = 1
  and exists (select 1 from app_first_owner_password_enrollment_generation
    where id = 1 and schema_version = 1
      and json_array_length(artifact_sql_json) = 10
      and json_array_length(foreign_key_json) = 3)
  and not exists (select 1 from pragma_foreign_key_check)
then 1 else 0 end;

drop table app_first_owner_password_enrollment_postflight;
