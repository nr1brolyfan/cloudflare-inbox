create trigger if not exists auth_verification_recovery_safe_email_insert
before insert on auth_verification
when new.type in (
  'email-otp', 'magic-link', 'reset-password', 'email-verification'
)
begin
  select case when new.metadata is null or not json_valid(new.metadata)
    then raise(abort, 'recovery-safe email challenge has invalid binding') end;
  select case when
    coalesce(json_type(
      new.metadata,
      case new.type
        when 'email-otp' then '$.emailNormalizedValue'
        when 'magic-link' then '$.emailNormalizedValue'
        when 'reset-password' then '$.normalizedValue'
        when 'email-verification' then '$.expectedNormalizedValue'
      end
    ), '') <> 'text'
    or length(trim(json_extract(
      new.metadata,
      case new.type
        when 'email-otp' then '$.emailNormalizedValue'
        when 'magic-link' then '$.emailNormalizedValue'
        when 'reset-password' then '$.normalizedValue'
        when 'email-verification' then '$.expectedNormalizedValue'
      end
    ))) = 0
    or json_extract(
      new.metadata,
      case new.type
        when 'email-otp' then '$.emailNormalizedValue'
        when 'magic-link' then '$.emailNormalizedValue'
        when 'reset-password' then '$.normalizedValue'
        when 'email-verification' then '$.expectedNormalizedValue'
      end
    ) <> trim(json_extract(
      new.metadata,
      case new.type
        when 'email-otp' then '$.emailNormalizedValue'
        when 'magic-link' then '$.emailNormalizedValue'
        when 'reset-password' then '$.normalizedValue'
        when 'email-verification' then '$.expectedNormalizedValue'
      end
    ))
    then raise(abort, 'recovery-safe email challenge has invalid binding') end;
  select case when exists (
    select 1
      from app_mailbox_address
     where lower(normalized_address) = lower(json_extract(
       new.metadata,
       case new.type
         when 'email-otp' then '$.emailNormalizedValue'
         when 'magic-link' then '$.emailNormalizedValue'
         when 'reset-password' then '$.normalizedValue'
         when 'email-verification' then '$.expectedNormalizedValue'
       end
     ))
  ) then raise(abort, 'email challenge conflicts with mailbox route') end;
end;

create trigger if not exists auth_verification_recovery_safe_email_update
before update on auth_verification
when new.type in (
  'email-otp', 'magic-link', 'reset-password', 'email-verification'
)
begin
  select case when new.metadata is null or not json_valid(new.metadata)
    then raise(abort, 'recovery-safe email challenge has invalid binding') end;
  select case when
    coalesce(json_type(
      new.metadata,
      case new.type
        when 'email-otp' then '$.emailNormalizedValue'
        when 'magic-link' then '$.emailNormalizedValue'
        when 'reset-password' then '$.normalizedValue'
        when 'email-verification' then '$.expectedNormalizedValue'
      end
    ), '') <> 'text'
    or length(trim(json_extract(
      new.metadata,
      case new.type
        when 'email-otp' then '$.emailNormalizedValue'
        when 'magic-link' then '$.emailNormalizedValue'
        when 'reset-password' then '$.normalizedValue'
        when 'email-verification' then '$.expectedNormalizedValue'
      end
    ))) = 0
    or json_extract(
      new.metadata,
      case new.type
        when 'email-otp' then '$.emailNormalizedValue'
        when 'magic-link' then '$.emailNormalizedValue'
        when 'reset-password' then '$.normalizedValue'
        when 'email-verification' then '$.expectedNormalizedValue'
      end
    ) <> trim(json_extract(
      new.metadata,
      case new.type
        when 'email-otp' then '$.emailNormalizedValue'
        when 'magic-link' then '$.emailNormalizedValue'
        when 'reset-password' then '$.normalizedValue'
        when 'email-verification' then '$.expectedNormalizedValue'
      end
    ))
    then raise(abort, 'recovery-safe email challenge has invalid binding') end;
  select case when exists (
    select 1
      from app_mailbox_address
     where lower(normalized_address) = lower(json_extract(
       new.metadata,
       case new.type
         when 'email-otp' then '$.emailNormalizedValue'
         when 'magic-link' then '$.emailNormalizedValue'
         when 'reset-password' then '$.normalizedValue'
         when 'email-verification' then '$.expectedNormalizedValue'
       end
     ))
  ) then raise(abort, 'email challenge conflicts with mailbox route') end;
end;

create trigger if not exists auth_verification_recovery_safe_email_immutable
before update of type, subject, secret_hash, expires_at, metadata
on auth_verification
when (
  old.type in (
    'email-otp', 'magic-link', 'reset-password', 'email-verification'
  )
  or new.type in (
    'email-otp', 'magic-link', 'reset-password', 'email-verification'
  )
)
and (
  old.type is not new.type
  or old.subject is not new.subject
  or old.secret_hash is not new.secret_hash
  or old.expires_at is not new.expires_at
  or old.metadata is not new.metadata
)
begin
  select raise(abort, 'recovery-safe email challenge binding is immutable');
end;

create trigger if not exists app_mailbox_address_email_challenge_insert
before insert on app_mailbox_address
when exists (
  select 1
    from auth_verification
   where type in (
     'email-otp', 'magic-link', 'reset-password', 'email-verification'
   )
     and consumed_at is not null
     and expires_at > cast(unixepoch('subsec') * 1000 as integer)
     and case
       when metadata is null or not json_valid(metadata) then 1
       when coalesce(json_type(
         metadata,
         case type
           when 'email-otp' then '$.emailNormalizedValue'
           when 'magic-link' then '$.emailNormalizedValue'
           when 'reset-password' then '$.normalizedValue'
           when 'email-verification' then '$.expectedNormalizedValue'
         end
       ), '') <> 'text' then 1
       when length(trim(json_extract(
         metadata,
         case type
           when 'email-otp' then '$.emailNormalizedValue'
           when 'magic-link' then '$.emailNormalizedValue'
           when 'reset-password' then '$.normalizedValue'
           when 'email-verification' then '$.expectedNormalizedValue'
         end
       ))) = 0 then 1
       when json_extract(
         metadata,
         case type
           when 'email-otp' then '$.emailNormalizedValue'
           when 'magic-link' then '$.emailNormalizedValue'
           when 'reset-password' then '$.normalizedValue'
           when 'email-verification' then '$.expectedNormalizedValue'
         end
       ) <> trim(json_extract(
         metadata,
         case type
           when 'email-otp' then '$.emailNormalizedValue'
           when 'magic-link' then '$.emailNormalizedValue'
           when 'reset-password' then '$.normalizedValue'
           when 'email-verification' then '$.expectedNormalizedValue'
         end
       )) then 1
       else lower(json_extract(
         metadata,
         case type
           when 'email-otp' then '$.emailNormalizedValue'
           when 'magic-link' then '$.emailNormalizedValue'
           when 'reset-password' then '$.normalizedValue'
           when 'email-verification' then '$.expectedNormalizedValue'
         end
       )) = lower(new.normalized_address)
     end
)
begin
  select raise(abort, 'mailbox route conflicts with active email challenge');
end;

create trigger if not exists app_mailbox_address_email_challenge_update
before update of normalized_address on app_mailbox_address
when exists (
  select 1
    from auth_verification
   where type in (
     'email-otp', 'magic-link', 'reset-password', 'email-verification'
   )
     and consumed_at is not null
     and expires_at > cast(unixepoch('subsec') * 1000 as integer)
     and case
       when metadata is null or not json_valid(metadata) then 1
       when coalesce(json_type(
         metadata,
         case type
           when 'email-otp' then '$.emailNormalizedValue'
           when 'magic-link' then '$.emailNormalizedValue'
           when 'reset-password' then '$.normalizedValue'
           when 'email-verification' then '$.expectedNormalizedValue'
         end
       ), '') <> 'text' then 1
       when length(trim(json_extract(
         metadata,
         case type
           when 'email-otp' then '$.emailNormalizedValue'
           when 'magic-link' then '$.emailNormalizedValue'
           when 'reset-password' then '$.normalizedValue'
           when 'email-verification' then '$.expectedNormalizedValue'
         end
       ))) = 0 then 1
       when json_extract(
         metadata,
         case type
           when 'email-otp' then '$.emailNormalizedValue'
           when 'magic-link' then '$.emailNormalizedValue'
           when 'reset-password' then '$.normalizedValue'
           when 'email-verification' then '$.expectedNormalizedValue'
         end
       ) <> trim(json_extract(
         metadata,
         case type
           when 'email-otp' then '$.emailNormalizedValue'
           when 'magic-link' then '$.emailNormalizedValue'
           when 'reset-password' then '$.normalizedValue'
           when 'email-verification' then '$.expectedNormalizedValue'
         end
       )) then 1
       else lower(json_extract(
         metadata,
         case type
           when 'email-otp' then '$.emailNormalizedValue'
           when 'magic-link' then '$.emailNormalizedValue'
           when 'reset-password' then '$.normalizedValue'
           when 'email-verification' then '$.expectedNormalizedValue'
         end
       )) = lower(new.normalized_address)
     end
)
begin
  select raise(abort, 'mailbox route conflicts with active email challenge');
end;
