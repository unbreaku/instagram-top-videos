-- Defensive normalization. The first migrations were run by hand against a
-- SQL editor that may have had pre-existing example text appended, which
-- could have aborted partway through. This migration re-asserts every
-- column, index, constraint, and RLS setting the application depends on.
-- Everything is `if not exists` / idempotent — if your schema is already
-- correct this migration is a no-op.

-- ============================================================================
-- TABLES (no-ops if already present)
-- ============================================================================

create table if not exists public.accounts (
  username    text primary key,
  created_at  timestamptz not null default now()
);

create table if not exists public.account_snapshots (
  id                serial primary key,
  account_username  text not null,
  captured_at       timestamptz not null default now()
);

create table if not exists public.videos (
  shortcode         text primary key,
  account_username  text not null,
  url               text not null,
  first_seen_at     timestamptz not null default now()
);

create table if not exists public.video_snapshots (
  id                serial primary key,
  video_shortcode   text not null,
  captured_at       timestamptz not null default now()
);

create table if not exists public.apify_runs (
  run_id      text primary key,
  status      text not null default 'RUNNING',
  started_at  timestamptz not null default now()
);

create table if not exists public.format_clusters (
  id           serial primary key,
  cluster_kind text not null,
  created_at   timestamptz not null default now()
);

-- ============================================================================
-- COLUMNS — adds anything missing without touching existing data.
-- ============================================================================

alter table public.accounts add column if not exists display_name        text;
alter table public.accounts add column if not exists bio                 text;
alter table public.accounts add column if not exists is_pinned           boolean not null default false;
alter table public.accounts add column if not exists last_full_scrape_at timestamptz;
alter table public.accounts add column if not exists deleted_at          timestamptz;

alter table public.account_snapshots add column if not exists followers_count bigint;
alter table public.account_snapshots add column if not exists following_count bigint;
alter table public.account_snapshots add column if not exists posts_count     bigint;
alter table public.account_snapshots add column if not exists videos_count    bigint;

alter table public.videos add column if not exists type                text;
alter table public.videos add column if not exists caption             text;
alter table public.videos add column if not exists posted_at           timestamptz;
alter table public.videos add column if not exists thumbnail_url       text;
alter table public.videos add column if not exists duration_seconds    integer;
alter table public.videos add column if not exists latest_views        bigint;
alter table public.videos add column if not exists latest_likes        bigint;
alter table public.videos add column if not exists latest_comments     bigint;
alter table public.videos add column if not exists latest_captured_at  timestamptz;
alter table public.videos add column if not exists transcript          text;
alter table public.videos add column if not exists transcript_lang     text;
alter table public.videos add column if not exists transcribed_at      timestamptz;
alter table public.videos add column if not exists cta                 text;
alter table public.videos add column if not exists hook                text;
alter table public.videos add column if not exists format_tags         text[];
alter table public.videos add column if not exists analyzed_at         timestamptz;
alter table public.videos add column if not exists video_url           text;
alter table public.videos add column if not exists analyze_attempts    integer not null default 0;
alter table public.videos add column if not exists analyze_error       text;

alter table public.video_snapshots add column if not exists views    bigint;
alter table public.video_snapshots add column if not exists likes    bigint;
alter table public.video_snapshots add column if not exists comments bigint;

alter table public.apify_runs add column if not exists account_username text;
alter table public.apify_runs add column if not exists kind             text;
alter table public.apify_runs add column if not exists finished_at      timestamptz;
alter table public.apify_runs add column if not exists videos_added     integer;
alter table public.apify_runs add column if not exists videos_updated   integer;
alter table public.apify_runs add column if not exists error            text;
alter table public.apify_runs add column if not exists dataset_id       text;

alter table public.format_clusters add column if not exists label          text;
alter table public.format_clusters add column if not exists description    text;
alter table public.format_clusters add column if not exists example_videos text[];

-- ============================================================================
-- FOREIGN KEYS — re-assert exact ON DELETE behaviour.
-- ============================================================================

alter table public.account_snapshots
  drop constraint if exists account_snapshots_account_username_fkey;
alter table public.account_snapshots
  add constraint account_snapshots_account_username_fkey
  foreign key (account_username) references public.accounts(username) on delete cascade;

alter table public.videos
  drop constraint if exists videos_account_username_fkey;
alter table public.videos
  add constraint videos_account_username_fkey
  foreign key (account_username) references public.accounts(username) on delete cascade;

alter table public.video_snapshots
  drop constraint if exists video_snapshots_video_shortcode_fkey;
alter table public.video_snapshots
  add constraint video_snapshots_video_shortcode_fkey
  foreign key (video_shortcode) references public.videos(shortcode) on delete cascade;

alter table public.apify_runs
  drop constraint if exists apify_runs_account_username_fkey;
alter table public.apify_runs
  add constraint apify_runs_account_username_fkey
  foreign key (account_username) references public.accounts(username) on delete set null;

-- ============================================================================
-- INDEXES (every read path the app uses).
-- ============================================================================

create index if not exists accounts_is_pinned_idx
  on public.accounts (is_pinned) where is_pinned = true;
create index if not exists accounts_active_idx
  on public.accounts (username) where deleted_at is null;
create index if not exists accounts_deleted_at_idx
  on public.accounts (deleted_at) where deleted_at is not null;

create index if not exists account_snapshots_account_time_idx
  on public.account_snapshots (account_username, captured_at desc);

create index if not exists videos_account_views_idx
  on public.videos (account_username, latest_views desc nulls last);
create index if not exists videos_posted_at_idx
  on public.videos (posted_at desc);
create index if not exists videos_format_tags_idx
  on public.videos using gin (format_tags);
create index if not exists videos_unanalyzed_idx
  on public.videos (account_username, latest_views desc nulls last)
  where analyzed_at is null and analyze_attempts < 3;

create index if not exists video_snapshots_video_time_idx
  on public.video_snapshots (video_shortcode, captured_at desc);

create index if not exists apify_runs_account_started_idx
  on public.apify_runs (account_username, started_at desc);

-- ============================================================================
-- ROW LEVEL SECURITY — required because we only access via service_role.
-- ============================================================================

alter table public.accounts          enable row level security;
alter table public.account_snapshots enable row level security;
alter table public.videos            enable row level security;
alter table public.video_snapshots   enable row level security;
alter table public.apify_runs        enable row level security;
alter table public.format_clusters   enable row level security;
