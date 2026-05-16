-- Store Instagram profile picture URL so the dashboard can render it.
-- The URL is a signed CDN URL that expires after ~1 week; we refresh it on
-- every scrape/refresh so it stays valid for pinned accounts.
alter table public.accounts add column if not exists profile_pic_url text;
