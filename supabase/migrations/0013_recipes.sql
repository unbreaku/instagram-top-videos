-- Recipes cache + experiment tracking.
--
-- recipes_payload: the full output of the recipes engine for the current
-- star. Cached because each generation costs ~\$1 of Sonnet. Refreshed
-- on demand from the UI when the user wants new suggestions.
--
-- recipe_experiments: tracks which recipes the user actually applied and
-- the rough outcome. Used later to learn which kinds of recipes work for
-- this particular star (feedback loop).

alter table public.accounts
  add column if not exists recipes_payload jsonb;

create table if not exists public.recipe_experiments (
  id uuid primary key default gen_random_uuid(),
  star_username text not null references public.accounts(username) on delete cascade,
  recipe_title text not null,
  recipe_payload jsonb not null,
  marked_at timestamptz not null default now(),
  state text not null default 'planned' check (state in ('planned', 'published', 'discarded')),
  posted_video_shortcode text,
  notes text
);

create index if not exists recipe_experiments_star_idx
  on public.recipe_experiments (star_username, marked_at desc);
