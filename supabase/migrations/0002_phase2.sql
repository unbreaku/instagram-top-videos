-- Phase 2: transcript + format analysis
-- Idempotent: safe to re-run.

-- Direct video URL from Apify (time-limited Instagram CDN URL). We store it
-- so we can pipe the audio to a transcription service. After ~1h it expires;
-- we'd need to re-scrape to refresh it.
alter table public.videos
  add column if not exists video_url text;

-- Track which videos we've already tried to analyze so we don't burn money
-- re-analyzing or hammer failed ones forever.
alter table public.videos
  add column if not exists analyze_attempts integer not null default 0;
alter table public.videos
  add column if not exists analyze_error text;

create index if not exists videos_unanalyzed_idx
  on public.videos (account_username, latest_views desc nulls last)
  where analyzed_at is null and analyze_attempts < 3;

-- ============================================================================
-- format_clusters: groups of similar hooks/CTAs across creators.
-- Phase 2.5 will populate these via embedding similarity. Left empty for now.
-- ============================================================================
create table if not exists public.format_clusters (
  id              serial primary key,
  cluster_kind    text not null,      -- 'hook' | 'cta' | 'format'
  label           text,               -- human-readable name
  description     text,
  example_videos  text[],             -- shortcodes
  created_at      timestamptz not null default now()
);
alter table public.format_clusters enable row level security;
