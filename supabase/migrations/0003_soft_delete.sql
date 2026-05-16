-- Soft delete with 30-day retention.
-- Idempotent: safe to re-run.

alter table public.accounts
  add column if not exists deleted_at timestamptz;

-- Partial index so active-account lookups stay snappy without scanning soft-deleted rows.
create index if not exists accounts_active_idx
  on public.accounts (username) where deleted_at is null;

-- Convenience index for the cleanup job that hard-deletes expired soft-deletes.
create index if not exists accounts_deleted_at_idx
  on public.accounts (deleted_at) where deleted_at is not null;
