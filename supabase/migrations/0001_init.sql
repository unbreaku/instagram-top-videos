-- Instagram Tracker — initial schema
-- Run this in Supabase SQL Editor on a fresh project.
-- Idempotent: safe to re-run.

-- ============================================================================
-- accounts: one row per Instagram handle we're observing
-- ============================================================================
create table if not exists public.accounts (
  username                 text primary key,
  display_name             text,
  bio                      text,
  is_pinned                boolean not null default false,
  last_full_scrape_at      timestamptz,
  created_at               timestamptz not null default now()
);

create index if not exists accounts_is_pinned_idx
  on public.accounts (is_pinned) where is_pinned = true;

-- ============================================================================
-- account_snapshots: time-series of profile metrics (followers, etc.)
-- One row per "we checked this account" event. The daily cron appends one.
-- ============================================================================
create table if not exists public.account_snapshots (
  id                serial primary key,
  account_username  text not null references public.accounts(username) on delete cascade,
  captured_at       timestamptz not null default now(),
  followers_count   bigint,
  following_count   bigint,
  posts_count       bigint,
  videos_count      bigint
);

create index if not exists account_snapshots_account_time_idx
  on public.account_snapshots (account_username, captured_at desc);

-- ============================================================================
-- videos: one row per Instagram video/reel we've ever seen
-- ============================================================================
create table if not exists public.videos (
  shortcode             text primary key,
  account_username      text not null references public.accounts(username) on delete cascade,
  type                  text,             -- 'Reel' | 'Video' | 'IGTV' | 'Other'
  caption               text,
  posted_at             timestamptz,
  url                   text not null,
  thumbnail_url         text,
  duration_seconds      integer,
  first_seen_at         timestamptz not null default now(),
  -- Latest snapshot values, denormalized for fast list/sort queries.
  latest_views          bigint,
  latest_likes          bigint,
  latest_comments       bigint,
  latest_captured_at    timestamptz,
  -- Phase 2 enrichments.
  transcript            text,
  transcript_lang       text,
  transcribed_at        timestamptz,
  cta                   text,
  hook                  text,
  format_tags           text[],
  analyzed_at           timestamptz
);

create index if not exists videos_account_views_idx
  on public.videos (account_username, latest_views desc nulls last);

create index if not exists videos_posted_at_idx
  on public.videos (posted_at desc);

create index if not exists videos_format_tags_idx
  on public.videos using gin (format_tags);

-- ============================================================================
-- video_snapshots: time-series of metrics per video
-- The daily cron appends one row per pinned account's recent videos so we can
-- chart views/likes growth over time.
-- ============================================================================
create table if not exists public.video_snapshots (
  id                serial primary key,
  video_shortcode   text not null references public.videos(shortcode) on delete cascade,
  captured_at       timestamptz not null default now(),
  views             bigint,
  likes             bigint,
  comments          bigint
);

create index if not exists video_snapshots_video_time_idx
  on public.video_snapshots (video_shortcode, captured_at desc);

-- ============================================================================
-- apify_runs: history of Apify runs we kicked off (for full-history scrapes)
-- ============================================================================
create table if not exists public.apify_runs (
  run_id             text primary key,
  account_username   text references public.accounts(username) on delete set null,
  kind               text,                       -- 'full_history' | 'daily_snapshot'
  status             text not null default 'RUNNING',
  started_at         timestamptz not null default now(),
  finished_at        timestamptz,
  videos_added       integer,
  videos_updated     integer,
  error              text,
  dataset_id         text
);

create index if not exists apify_runs_account_started_idx
  on public.apify_runs (account_username, started_at desc);

-- ============================================================================
-- Row-Level Security
-- We only access these tables from server-side code using the service-role key,
-- which bypasses RLS. Enabling RLS without policies means no anonymous access,
-- which is what we want.
-- ============================================================================
alter table public.accounts          enable row level security;
alter table public.account_snapshots enable row level security;
alter table public.videos            enable row level security;
alter table public.video_snapshots   enable row level security;
alter table public.apify_runs        enable row level security;
