-- Normalize transcript = '' (empty string) → NULL across the videos table.
--
-- Why: the analyze pipeline used to save '' when Deepgram returned an empty
-- response (silent video or fetch error). The stats endpoint counted those
-- as "pending" (via !!transcript in JS), but the drain worker used
-- `transcript IS NULL` which skipped them. Result: stats said 357 pending,
-- drain said 0 candidates, system looked frozen.
--
-- After this migration, both filters agree: a row is pending iff transcript
-- IS NULL. lib/analyze.ts already coerces '' → null on insert/update so no
-- new rows will reach the empty-string state going forward.
--
-- Also clear analyze_attempts on these rows so they become eligible for the
-- drain again (zombies with attempts >= 3 would still be filtered).

update public.videos
set transcript = null,
    analyze_attempts = 0,
    analyze_error = null
where transcript = '';
