-- is_hidden flag for "show in UI" vs "completely deleted".
--
-- Different from deleted_at (soft delete, stops cron + scrape + drain):
--   is_hidden = true  → only hidden from dashboard / accounts list.
--                       Cron still refreshes them, snapshots keep capturing,
--                       posts keep being analyzed. Used for demos / sharing.
--   deleted_at != null → account is going away in 30 days; cron skips it.
--
-- Why a partial index: we'll mostly query "WHERE is_hidden = false" so the
-- common case stays fast; the rare "WHERE is_hidden = true" lookup is
-- backed by this partial index without bloating the rest of the table.

alter table public.accounts
  add column if not exists is_hidden boolean not null default false;

create index if not exists accounts_is_hidden_idx
  on public.accounts(is_hidden)
  where is_hidden = true;
