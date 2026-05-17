-- Atomic helpers so concurrent callers don't race on read-modify-write.
-- Idempotent: safe to re-run.

-- Atomically bump analyze_attempts and clear any previous error in one go.
-- Returns the new attempt count so the caller can decide whether to proceed.
create or replace function public.bump_analyze_attempts(p_shortcode text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_count integer;
begin
  update public.videos
     set analyze_attempts = coalesce(analyze_attempts, 0) + 1,
         analyze_error    = null
   where shortcode = p_shortcode
  returning analyze_attempts into new_count;
  return new_count;
end;
$$;

revoke execute on function public.bump_analyze_attempts(text) from public;
revoke execute on function public.bump_analyze_attempts(text) from anon;
revoke execute on function public.bump_analyze_attempts(text) from authenticated;
grant  execute on function public.bump_analyze_attempts(text) to service_role;
