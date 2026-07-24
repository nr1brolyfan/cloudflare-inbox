create table if not exists app_mailbox_bootstrap_intent_cutover (
  id integer primary key check (id = 1),
  schema_version integer not null check (schema_version = 1)
);

create table if not exists app_mailbox_bootstrap_receipt_v1_intent (
  operation_id text primary key
    references app_mailbox_administration_receipt (operation_id)
      on update restrict on delete restrict,
  initial_address text not null,
  check (
    typeof(initial_address) = 'text'
    and length(initial_address) between 3 and 320
    and initial_address = trim(initial_address)
    and instr(initial_address, '@') between 2 and length(initial_address) - 2
    and instr(substr(initial_address, instr(initial_address, '@') + 1), '@') = 0
    and substr(initial_address, instr(initial_address, '@') + 1)
      = lower(substr(initial_address, instr(initial_address, '@') + 1))
  )
);

create table if not exists app_mailbox_bootstrap_receipt_v2 (
  operation_id text primary key
    references app_mailbox_administration_receipt (operation_id)
      on update restrict on delete restrict,
  initial_address text not null,
  schema_version integer not null,
  check (
    typeof(initial_address) = 'text'
    and length(initial_address) between 3 and 320
    and initial_address = trim(initial_address)
    and instr(initial_address, '@') between 2 and length(initial_address) - 2
    and instr(substr(initial_address, instr(initial_address, '@') + 1), '@') = 0
    and substr(initial_address, instr(initial_address, '@') + 1)
      = lower(substr(initial_address, instr(initial_address, '@') + 1))
  ),
  check (typeof(schema_version) = 'integer' and schema_version = 2)
);

create temp table app_mailbox_bootstrap_receipt_intent_preflight (
  valid integer not null check (valid = 1)
);

insert into app_mailbox_bootstrap_receipt_intent_preflight (valid)
select case when exists (
  select 1
    from app_mailbox_administration_receipt as receipt
   where (
       receipt.operation_kind = 'bootstrap-owner'
       and (
         receipt.expected_version is not null
         or receipt.schema_version <> 1
         or receipt.result_version <> 1
         or receipt.actor_user_id <> receipt.result_created_by_user_id
         or receipt.result_created_at <> receipt.result_updated_at
         or receipt.result_created_at <> receipt.committed_at
         or (
           (select count(*)
              from app_mailbox_bootstrap_receipt_v1_intent as legacy
             where legacy.operation_id = receipt.operation_id)
           +
           (select count(*)
              from app_mailbox_bootstrap_receipt_v2 as current
             where current.operation_id = receipt.operation_id)
         ) > 1
         or (
           not exists (select 1 from app_mailbox_bootstrap_intent_cutover)
           and not exists (
             select 1
               from app_mailbox_bootstrap_receipt_v1_intent as legacy
              where legacy.operation_id = receipt.operation_id
           )
           and not exists (
             select 1
               from app_mailbox_bootstrap_receipt_v2 as current
              where current.operation_id = receipt.operation_id
           )
           and not exists (
             select 1
               from app_mailbox_address as address
              where address.mailbox_id = receipt.mailbox_id
                and address.id = 'primary'
                and address.is_primary = 1
                and address.enabled = 1
                and address.version = 1
                and address.created_at = receipt.result_created_at
                and address.updated_at = receipt.result_created_at
                and instr(address.address, '@') between 2
                  and length(address.address) - 2
                and instr(substr(address.address,
                  instr(address.address, '@') + 1), '@') = 0
                and address.normalized_address =
                  substr(address.address, 1, instr(address.address, '@'))
                  || lower(substr(address.address,
                    instr(address.address, '@') + 1))
           )
         )
         or (
           exists (select 1 from app_mailbox_bootstrap_intent_cutover)
           and (
             (select count(*)
                from app_mailbox_bootstrap_receipt_v1_intent as legacy
               where legacy.operation_id = receipt.operation_id)
             +
             (select count(*)
                from app_mailbox_bootstrap_receipt_v2 as current
               where current.operation_id = receipt.operation_id)
           ) <> 1
         )
       )
     )
     or (
       receipt.operation_kind <> 'bootstrap-owner'
       and (
         exists (
           select 1
             from app_mailbox_bootstrap_receipt_v1_intent as legacy
            where legacy.operation_id = receipt.operation_id
         )
         or exists (
           select 1
             from app_mailbox_bootstrap_receipt_v2 as current
            where current.operation_id = receipt.operation_id
         )
       )
     )
) then 0 else 1 end;

insert into app_mailbox_bootstrap_receipt_v1_intent
  (operation_id, initial_address)
select receipt.operation_id, address.normalized_address
  from app_mailbox_administration_receipt as receipt
  join app_mailbox_address as address
    on address.mailbox_id = receipt.mailbox_id
   and address.id = 'primary'
   and address.is_primary = 1
   and address.enabled = 1
   and address.version = 1
   and address.created_at = receipt.result_created_at
   and address.updated_at = receipt.result_created_at
   and instr(address.address, '@') between 2 and length(address.address) - 2
   and instr(substr(address.address, instr(address.address, '@') + 1), '@') = 0
   and address.normalized_address =
     substr(address.address, 1, instr(address.address, '@'))
     || lower(substr(address.address, instr(address.address, '@') + 1))
 where receipt.operation_kind = 'bootstrap-owner'
   and receipt.expected_version is null
   and receipt.schema_version = 1
   and receipt.result_version = 1
   and receipt.actor_user_id = receipt.result_created_by_user_id
   and receipt.result_created_at = receipt.result_updated_at
   and receipt.result_created_at = receipt.committed_at
   and not exists (select 1 from app_mailbox_bootstrap_intent_cutover)
   and not exists (
     select 1
       from app_mailbox_bootstrap_receipt_v1_intent as legacy
      where legacy.operation_id = receipt.operation_id
   )
   and not exists (
     select 1
       from app_mailbox_bootstrap_receipt_v2 as current
      where current.operation_id = receipt.operation_id
   );

insert into app_mailbox_bootstrap_intent_cutover (id, schema_version)
select 1, 1
 where not exists (select 1 from app_mailbox_bootstrap_intent_cutover);

delete from app_mailbox_bootstrap_receipt_intent_preflight;

insert into app_mailbox_bootstrap_receipt_intent_preflight (valid)
select case when exists (
  select 1
    from app_mailbox_administration_receipt as receipt
   where (
       receipt.operation_kind = 'bootstrap-owner'
       and (
         (select count(*)
            from app_mailbox_bootstrap_receipt_v1_intent as legacy
           where legacy.operation_id = receipt.operation_id)
         +
         (select count(*)
            from app_mailbox_bootstrap_receipt_v2 as current
           where current.operation_id = receipt.operation_id)
       ) <> 1
     )
     or (
       receipt.operation_kind <> 'bootstrap-owner'
       and (
         exists (
           select 1
             from app_mailbox_bootstrap_receipt_v1_intent as legacy
            where legacy.operation_id = receipt.operation_id
         )
         or exists (
           select 1
             from app_mailbox_bootstrap_receipt_v2 as current
            where current.operation_id = receipt.operation_id
         )
       )
     )
) then 0 else 1 end;

drop table app_mailbox_bootstrap_receipt_intent_preflight;

create trigger if not exists app_mailbox_bootstrap_intent_cutover_no_insert
before insert on app_mailbox_bootstrap_intent_cutover
begin
  select raise(abort, 'mailbox bootstrap intent cutover is sealed');
end;

create trigger if not exists app_mailbox_bootstrap_intent_cutover_no_update
before update on app_mailbox_bootstrap_intent_cutover
begin
  select raise(abort, 'mailbox bootstrap intent cutover is immutable');
end;

create trigger if not exists app_mailbox_bootstrap_intent_cutover_no_delete
before delete on app_mailbox_bootstrap_intent_cutover
begin
  select raise(abort, 'mailbox bootstrap intent cutover is retained');
end;

create trigger if not exists app_mailbox_bootstrap_receipt_v1_intent_binding
before insert on app_mailbox_bootstrap_receipt_v1_intent
when not exists (select 1 from app_mailbox_bootstrap_intent_cutover)
or exists (
  select 1
    from app_mailbox_bootstrap_receipt_v2 as current
   where current.operation_id = new.operation_id
)
or not exists (
  select 1
    from app_mailbox_administration_receipt as receipt
    join app_mailbox_address as address
      on address.mailbox_id = receipt.mailbox_id
     and address.id = 'primary'
     and address.is_primary = 1
     and address.enabled = 1
     and address.version = 1
     and address.created_at = receipt.result_created_at
     and address.updated_at = receipt.result_created_at
     and instr(address.address, '@') between 2 and length(address.address) - 2
     and instr(substr(address.address, instr(address.address, '@') + 1), '@') = 0
     and address.normalized_address = new.initial_address
     and address.normalized_address =
       substr(address.address, 1, instr(address.address, '@'))
       || lower(substr(address.address, instr(address.address, '@') + 1))
   where receipt.operation_id = new.operation_id
     and receipt.operation_kind = 'bootstrap-owner'
     and receipt.expected_version is null
     and receipt.schema_version = 1
     and receipt.result_version = 1
     and receipt.actor_user_id = receipt.result_created_by_user_id
     and receipt.result_created_at = receipt.result_updated_at
     and receipt.result_created_at = receipt.committed_at
)
begin
  select raise(abort, 'invalid legacy mailbox bootstrap intent binding');
end;

create trigger if not exists app_mailbox_bootstrap_receipt_v1_intent_no_replace
before insert on app_mailbox_bootstrap_receipt_v1_intent
when exists (
  select 1 from app_mailbox_bootstrap_receipt_v1_intent
   where operation_id = new.operation_id
)
begin
  select raise(abort, 'legacy mailbox bootstrap intents are immutable');
end;

create trigger if not exists app_mailbox_bootstrap_receipt_v1_intent_no_update
before update on app_mailbox_bootstrap_receipt_v1_intent
begin
  select raise(abort, 'legacy mailbox bootstrap intents are immutable');
end;

create trigger if not exists app_mailbox_bootstrap_receipt_v1_intent_no_delete
before delete on app_mailbox_bootstrap_receipt_v1_intent
when not exists (
  select 1
    from app_mailbox_bootstrap_receipt_v2 as current
   where current.operation_id = old.operation_id
     and current.initial_address = old.initial_address
     and current.schema_version = 2
)
begin
  select raise(abort, 'legacy mailbox bootstrap intents are retained');
end;

-- Temporary ORG-006 rolling-deploy bridge: old writers gain V1 intent here.
create trigger if not exists app_mailbox_bootstrap_receipt_v1_intent_from_parent
after insert on app_mailbox_administration_receipt
when new.operation_kind = 'bootstrap-owner'
begin
  insert into app_mailbox_bootstrap_receipt_v1_intent
    (operation_id, initial_address)
  select new.operation_id, address.normalized_address
    from app_mailbox_address as address
   where address.mailbox_id = new.mailbox_id
     and address.id = 'primary'
     and address.is_primary = 1
     and address.enabled = 1
     and address.version = 1
     and address.created_at = new.result_created_at
     and address.updated_at = new.result_created_at
     and instr(address.address, '@') between 2 and length(address.address) - 2
     and instr(substr(address.address, instr(address.address, '@') + 1), '@') = 0
     and address.normalized_address =
       substr(address.address, 1, instr(address.address, '@'))
       || lower(substr(address.address, instr(address.address, '@') + 1))
     and new.expected_version is null
     and new.schema_version = 1
     and new.result_version = 1
     and new.actor_user_id = new.result_created_by_user_id
     and new.result_created_at = new.result_updated_at
     and new.result_created_at = new.committed_at;
  select case when not exists (
    select 1
      from app_mailbox_bootstrap_receipt_v1_intent as legacy
     where legacy.operation_id = new.operation_id
  ) then raise(abort, 'old bootstrap receipt could not bind durable intent') end;
end;

create trigger if not exists app_mailbox_bootstrap_receipt_v2_binding
before insert on app_mailbox_bootstrap_receipt_v2
when not exists (select 1 from app_mailbox_bootstrap_intent_cutover)
or not exists (
  select 1
    from app_mailbox_bootstrap_receipt_v1_intent as legacy
    join app_mailbox_administration_receipt as receipt
      on receipt.operation_id = legacy.operation_id
    join app_mailbox_address as address
      on address.mailbox_id = receipt.mailbox_id
     and address.id = 'primary'
     and address.is_primary = 1
     and address.address = new.initial_address
     and address.normalized_address = new.initial_address
   where legacy.operation_id = new.operation_id
     and legacy.initial_address = new.initial_address
     and receipt.operation_kind = 'bootstrap-owner'
     and receipt.expected_version is null
     and receipt.schema_version = 1
     and receipt.result_version = 1
     and receipt.actor_user_id = receipt.result_created_by_user_id
     and receipt.result_created_at = receipt.result_updated_at
     and receipt.result_created_at = receipt.committed_at
)
begin
  select raise(abort, 'invalid mailbox bootstrap v2 receipt promotion');
end;

create trigger if not exists app_mailbox_bootstrap_receipt_v2_promote
after insert on app_mailbox_bootstrap_receipt_v2
begin
  delete from app_mailbox_bootstrap_receipt_v1_intent
   where operation_id = new.operation_id
     and initial_address = new.initial_address;
  select case when exists (
    select 1
      from app_mailbox_bootstrap_receipt_v1_intent as legacy
     where legacy.operation_id = new.operation_id
  ) then raise(abort, 'mailbox bootstrap V2 promotion was incomplete') end;
end;

create trigger if not exists app_mailbox_bootstrap_receipt_v2_no_update
before update on app_mailbox_bootstrap_receipt_v2
begin
  select raise(abort, 'mailbox bootstrap v2 receipts are immutable');
end;

create trigger if not exists app_mailbox_bootstrap_receipt_v2_no_delete
before delete on app_mailbox_bootstrap_receipt_v2
begin
  select raise(abort, 'mailbox bootstrap v2 receipts are retained');
end;

create trigger if not exists app_mailbox_bootstrap_receipt_v2_no_replace
before insert on app_mailbox_bootstrap_receipt_v2
when exists (
  select 1 from app_mailbox_bootstrap_receipt_v2
   where operation_id = new.operation_id
)
begin
  select raise(abort, 'mailbox bootstrap v2 receipts are immutable');
end;
