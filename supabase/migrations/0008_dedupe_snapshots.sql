-- Snapshots should represent ONE point per day per account, not one per
-- refresh button press. Multiple manual refreshes earlier today inflated
-- the "Δ followers in N days" calculation and littered the chart.
--
-- This migration:
--   1) Deletes duplicate account_snapshots, keeping the latest per
--      (account_username, Bogotá day).
--   2) Same for video_snapshots, keeping the latest per
--      (video_shortcode, Bogotá day).
--
-- It is safe to re-run (becomes a no-op once the rows are unique).
-- Going forward, lib/ingest.ts upserts by day so duplicates won't
-- reappear, but we keep this migration as a janitorial fallback.

with day_keepers as (
  select distinct on (account_username, (captured_at at time zone 'America/Bogota')::date)
    id
  from public.account_snapshots
  order by
    account_username,
    (captured_at at time zone 'America/Bogota')::date,
    captured_at desc
)
delete from public.account_snapshots
where id not in (select id from day_keepers);

with video_day_keepers as (
  select distinct on (video_shortcode, (captured_at at time zone 'America/Bogota')::date)
    id
  from public.video_snapshots
  order by
    video_shortcode,
    (captured_at at time zone 'America/Bogota')::date,
    captured_at desc
)
delete from public.video_snapshots
where id not in (select id from video_day_keepers);
