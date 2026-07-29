-- Generated from @effect-auth/core@0.1.0-alpha.20.
-- Do not edit manually; run `bun run generate:auth-migrations`.

update auth_domain_verification
set proof_token = 'effect-auth-invalid-domain-proof-v1',
    revoked_at = case
      when status = 'pending' then coalesce(revoked_at, created_at)
      else revoked_at
    end,
    status = case
      when status = 'pending' then 'revoked'
      else status
    end;
