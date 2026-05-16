-- Ensure every foreign-key constraint on the schema has the right ON DELETE
-- behaviour, regardless of how the initial schema actually ended up being
-- created. Idempotent: each alter drops the existing constraint (if any) and
-- recreates it with the correct action.
--
-- Cascade rules:
--   account_snapshots → accounts        : cascade  (snapshots are about that account)
--   videos             → accounts       : cascade  (videos belong to the account)
--   video_snapshots    → videos         : cascade  (metric history for that video)
--   apify_runs         → accounts       : set null (keep audit trail / billing data)

-- accounts -> account_snapshots
alter table public.account_snapshots
  drop constraint if exists account_snapshots_account_username_fkey;
alter table public.account_snapshots
  add constraint account_snapshots_account_username_fkey
  foreign key (account_username)
  references public.accounts(username)
  on delete cascade;

-- accounts -> videos
alter table public.videos
  drop constraint if exists videos_account_username_fkey;
alter table public.videos
  add constraint videos_account_username_fkey
  foreign key (account_username)
  references public.accounts(username)
  on delete cascade;

-- videos -> video_snapshots
alter table public.video_snapshots
  drop constraint if exists video_snapshots_video_shortcode_fkey;
alter table public.video_snapshots
  add constraint video_snapshots_video_shortcode_fkey
  foreign key (video_shortcode)
  references public.videos(shortcode)
  on delete cascade;

-- accounts -> apify_runs (the one that's biting us)
alter table public.apify_runs
  drop constraint if exists apify_runs_account_username_fkey;
alter table public.apify_runs
  add constraint apify_runs_account_username_fkey
  foreign key (account_username)
  references public.accounts(username)
  on delete set null;
