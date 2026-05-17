-- Account roles for the BI pivot: there is ONE 'star' account whose growth
-- we are trying to engineer (Pablo Casasa). Every other tracked account is
-- a 'guide' — a competitor / inspiration whose patterns we mine for
-- "recipes" the star can copy. NULL = unset (treated as guide implicitly).
--
-- We enforce single-star at the schema level via a partial unique index so
-- the application can never end up with two stars by accident.

alter table public.accounts
  add column if not exists account_role text;

-- Partial unique index: at most one row may have account_role = 'star'.
-- Guides and NULLs are unconstrained.
create unique index if not exists accounts_one_star_only
  on public.accounts ((account_role))
  where account_role = 'star';

-- A check constraint to keep the field tidy. NULL still allowed.
do $$
begin
  if not exists (
    select 1 from information_schema.check_constraints
    where constraint_name = 'accounts_role_valid'
  ) then
    alter table public.accounts
      add constraint accounts_role_valid
      check (account_role is null or account_role in ('star', 'guide'));
  end if;
end$$;
