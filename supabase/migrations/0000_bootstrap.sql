-- BOOTSTRAP — RUN THIS ONCE PER PROJECT, MANUALLY, IN THE SUPABASE SQL EDITOR.
-- After this, every other migration is applied by POST /api/migrate.
-- Idempotent: safe to re-run.

-- Tracks which migration files have been applied.
create table if not exists public._migrations (
  name        text primary key,
  applied_at  timestamptz not null default now(),
  duration_ms integer
);

-- Runs arbitrary SQL on behalf of our server. SECURITY DEFINER → runs with
-- the function owner's privileges (postgres). We only let the service_role
-- key call it — so anon clients can NEVER trigger schema changes even if
-- they somehow obtain a JWT.
create or replace function public.exec_sql(sql text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  execute sql;
end;
$$;

revoke execute on function public.exec_sql(text) from public;
revoke execute on function public.exec_sql(text) from anon;
revoke execute on function public.exec_sql(text) from authenticated;
grant  execute on function public.exec_sql(text) to service_role;
