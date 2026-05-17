-- DNA dissection cache for star accounts.
--
-- The dissection is expensive (~\$0.50-\$2 Sonnet call) and the output is
-- stable as long as the corpus doesn't change much. We cache the full
-- JSON on the account row so the /star page reads it in one query and
-- only re-runs the LLM when the user explicitly asks for a refresh.
--
-- JSONB so we can query nested fields later (e.g. for the recipes engine
-- comparing star pillars vs guide patterns).

alter table public.accounts
  add column if not exists star_dissection jsonb;
