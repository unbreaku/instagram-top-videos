-- Re-dedupe snapshots, this time by Europe/Madrid calendar day.
--
-- Previous migration 0008 deduped by America/Bogota day. Now that the
-- whole system is on Madrid time (UTC+1/+2 vs Bogotá UTC-5, a 6-7 hour
-- shift), some snapshots that were "different Bogotá days" might collapse
-- into the same Madrid day, and we'd be back to multiple rows per
-- displayed day.
--
-- Example: a snapshot at 2026-05-16 23:30 UTC is:
--   - Bogotá: May 16, 18:30 (Saturday)
--   - Madrid: May 17, 01:30 (Sunday)
-- And another at 2026-05-17 02:00 UTC is:
--   - Bogotá: May 16, 21:00 (still Saturday)
--   - Madrid: May 17, 04:00 (still Sunday)
-- Under Bogotá dedup, both rows survived (different Madrid days but same
-- Bogotá day, so... actually no, same Bogotá day → only one survives).
-- The reverse case is what bites us: rows that the Bogotá dedup kept as
-- "different days" but Madrid sees as "same day".
--
-- This migration:
--   1) Keeps the latest snapshot per (account_username, Madrid day)
--   2) Same for video_snapshots
-- Safe to re-run.

with day_keepers as (
  select distinct on (account_username, (captured_at at time zone 'Europe/Madrid')::date)
    id
  from public.account_snapshots
  order by
    account_username,
    (captured_at at time zone 'Europe/Madrid')::date,
    captured_at desc
)
delete from public.account_snapshots
where id not in (select id from day_keepers);

with video_day_keepers as (
  select distinct on (video_shortcode, (captured_at at time zone 'Europe/Madrid')::date)
    id
  from public.video_snapshots
  order by
    video_shortcode,
    (captured_at at time zone 'Europe/Madrid')::date,
    captured_at desc
)
delete from public.video_snapshots
where id not in (select id from video_day_keepers);
