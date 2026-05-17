import { NextResponse } from "next/server";
import { analyzeOneVideo } from "@/lib/analyze";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * "Drain the analyze backlog" worker.
 *
 * Each invocation processes up to BATCH_PER_CALL videos and then, if more
 * pending work remains, fires a fire-and-forget POST to itself so the chain
 * keeps going without the caller's browser staying open. This is the closest
 * we get to a background job on Vercel serverless without an external queue.
 *
 * Auth: dual-mode. Either
 *   - a valid OWNER_PASSWORD cookie (user clicked the button in /accounts), or
 *   - Authorization: Bearer ${CRON_SECRET} (the chained self-call, or the
 *     refresh-account hook that triggers a drain after ingest)
 *
 * Query params:
 *   ?account=<username>   Optional. Drain only this account's backlog.
 *   ?max_chain=<n>        Safety cap on chained self-invocations (default 50,
 *                          → 50 batches × 10 videos = up to 500 videos drained
 *                          per top-level kick. With a real backlog of 296 that
 *                          finishes in ~30 batches → ~3-5 min wall-clock).
 *   ?_depth=<n>           Internal: current chain depth. Not user-facing.
 */
// We grab a big slice of videos and process them in parallel waves. Per-video
// budget is ~5-15s (Deepgram + Anthropic), so serially we'd fit ~10 in the
// 60s function timeout. With CONCURRENCY=5 parallel calls per wave, we fit
// ~40-50 per call instead. Higher concurrency risks hitting Anthropic /
// Deepgram per-tenant rate limits.
const FETCH_PER_CALL = 50;
const CONCURRENCY = 5;
// Stop launching new work after this elapsed time so we have headroom to
// dispatch the chain before Vercel kills us at 60s.
const SOFT_DEADLINE_MS = 45_000;
const WINDOW_DAYS = 90;

function isAuthorized(req: Request): boolean {
  const auth = req.headers.get("authorization") || "";
  const cronSecret = process.env.CRON_SECRET || "";
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;

  // Cookie path (user-initiated). We do the same eq check the middleware does,
  // but here we have to parse the cookie ourselves because this route is
  // exempt from the middleware (so the internal bearer call can get through).
  const ownerPassword = process.env.OWNER_PASSWORD || "";
  if (!ownerPassword) return true; // gate disabled
  const cookie = req.headers.get("cookie") || "";
  const m = cookie.match(/(?:^|;\s*)owner_token=([^;]+)/);
  const token = m ? decodeURIComponent(m[1]) : "";
  return token.length > 0 && token === ownerPassword;
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const account = url.searchParams.get("account");
  const maxChain = Math.min(
    Math.max(Number(url.searchParams.get("max_chain") ?? 50), 1),
    200,
  );
  const depth = Number(url.searchParams.get("_depth") ?? 0);
  // PANIC MODE: ignore the attempts cap, reset failed videos, force re-run
  // of every video with video_url in the 90d window regardless of transcript
  // state. Use when normal drain is stuck and you don't trust the filters.
  const panic = url.searchParams.get("panic") === "1";

  const sb = getServerSupabase();
  const windowCutoff = new Date(
    Date.now() - WINDOW_DAYS * 86400 * 1000,
  ).toISOString();

  // Prevent the user from kicking off a parallel chain by reloading and
  // clicking again. If any video has been analyzed in the last 5 minutes,
  // there's almost certainly an active chain in flight — refuse user-initiated
  // calls (depth=0) and let the existing chain finish. Internal self-chained
  // calls (depth>0) always pass because they ARE the active chain.
  // Override: ?force=1 bypasses the guard (used by the 'Forzar reinicio'
  // button for when a chain is dead but the activity heartbeat hasn't expired
  // yet).
  const force = url.searchParams.get("force") === "1";
  if (depth === 0 && !force) {
    const recentCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { count: recentCount } = await sb
      .from("videos")
      .select("shortcode", { count: "exact", head: true })
      .gte("analyzed_at", recentCutoff);
    if ((recentCount ?? 0) > 0) {
      return NextResponse.json({
        already_running: true,
        recent_analyses_2min: recentCount,
        message:
          "Ya hay un drenado en curso. Esperá unos minutos y revisá los conteos. Si no avanza, usá 'Forzar reinicio'.",
      });
    }
  }

  // SELF-HEAL: normalize any transcript='' rows to NULL at the start of every
  // drain call. The stats endpoint uses !!transcript (treats '' as missing)
  // but the SQL filter `.is('transcript', null)` skips empty strings,
  // creating a ghost-pending state. This UPDATE makes both filters agree.
  //
  // It's cheap (only touches rows that are actually empty strings, usually 0
  // after the first call) and removes the dependency on a one-shot migration
  // being applied by the user. PostgREST's `.or()` with empty-string equality
  // proved unreliable, so we normalize the data instead of filtering both
  // shapes.
  let normalized = 0;
  try {
    const { data: normRows } = await sb
      .from("videos")
      .update({ transcript: null, analyze_attempts: 0, analyze_error: null })
      .eq("transcript", "")
      .select("shortcode");
    normalized = (normRows || []).length;
  } catch {
    // Non-fatal — the worst case is the drain still doesn't see them.
  }

  // PANIC: reset attempts on ALL videos in the 90d window so nothing is
  // blocked by previous failure caps. Then the query below picks them up.
  let panicReset = 0;
  if (panic && depth === 0) {
    const { data: r } = await sb
      .from("videos")
      .update({ analyze_attempts: 0, analyze_error: null })
      .gte("analyze_attempts", 1)
      .not("video_url", "is", null)
      .gte("posted_at", windowCutoff)
      .select("shortcode");
    panicReset = (r || []).length;
  }

  // Filter on TRANSCRIPT (not analyzed_at) because that's what stats counts
  // as "pending" and what the user actually cares about. Using analyzed_at
  // would silently skip videos where a previous run set analyzed_at but the
  // transcript came back empty/null (zombies).
  //
  // After the inline self-heal above, empty-string transcripts are already
  // normalized to NULL, so a plain .is("transcript", null) catches BOTH the
  // historically-NULL and historically-empty videos. We avoid PostgREST's
  // .or("transcript.eq.") because that syntax matched almost nothing in
  // practice (silent filter failure).
  let q = sb
    .from("videos")
    .select("shortcode, account_username")
    .not("video_url", "is", null)
    .gte("posted_at", windowCutoff)
    .is("transcript", null);
  if (!panic) {
    q = q.lt("analyze_attempts", 3);
  }
  if (account) q = q.eq("account_username", account);
  q = q
    .order("latest_views", { ascending: false })
    .order("shortcode", { ascending: true })
    .limit(FETCH_PER_CALL);

  const { data: candidates, error } = await q;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  // Process candidates in parallel waves of CONCURRENCY. This is the main
  // throughput lever — sequential ~10/min becomes ~50/min, so a 357-video
  // backlog drains in ~7 min wall-clock instead of ~35.
  const results: Array<{
    shortcode: string;
    account: string;
    ok: boolean;
    error?: string;
    skipped?: string;
  }> = [];
  const startMs = Date.now();
  const queue = [...(candidates || [])];
  while (queue.length > 0 && Date.now() - startMs < SOFT_DEADLINE_MS) {
    const wave = queue.splice(0, CONCURRENCY);
    const waveResults = await Promise.all(
      wave.map(async (c) => {
        // force:true so zombies (analyzed_at set, transcript null) get
        // retried. analyzeOneVideo only re-calls Deepgram when transcript is
        // null, so this doesn't double-charge videos that already have one.
        const r = await analyzeOneVideo(c.shortcode, { force: true });
        return {
          shortcode: c.shortcode,
          account: c.account_username,
          ok: r.ok,
          error: r.error,
          skipped: r.skipped,
        };
      }),
    );
    results.push(...waveResults);
  }

  // Count what's left after this batch.
  let remainingQ = sb
    .from("videos")
    .select("shortcode", { count: "exact", head: true })
    .is("transcript", null)
    .lt("analyze_attempts", 3)
    .not("video_url", "is", null)
    .gte("posted_at", windowCutoff);
  if (account) remainingQ = remainingQ.eq("account_username", account);
  const { count: remaining } = await remainingQ;

  // Chain a self-invocation if there's more work and we haven't bumped the
  // safety cap. We await the *kickoff* briefly (just enough to establish
  // the next HTTP connection) instead of pure fire-and-forget, because
  // Vercel sometimes kills outgoing fetches when the response returns.
  // The next function instance runs independently afterwards.
  let chained = false;
  let chainError: string | null = null;
  if ((remaining ?? 0) > 0 && depth + 1 < maxChain) {
    const proto = req.headers.get("x-forwarded-proto") || "https";
    const host = req.headers.get("host");
    if (host && process.env.CRON_SECRET) {
      const nextUrl = new URL(`${proto}://${host}/api/analyze-drain`);
      if (account) nextUrl.searchParams.set("account", account);
      if (panic) nextUrl.searchParams.set("panic", "1");
      nextUrl.searchParams.set("max_chain", String(maxChain));
      nextUrl.searchParams.set("_depth", String(depth + 1));
      // AbortController limits the wait to ~3s; we just need the connection
      // accepted (the new invocation runs to completion independently).
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3000);
      try {
        await fetch(nextUrl.toString(), {
          method: "POST",
          headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
          signal: ctrl.signal,
        });
        chained = true;
      } catch (e) {
        // AbortError is expected when the 3s timeout hits — by then Vercel
        // has accepted the request and the next function is running.
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("aborted") || msg.includes("AbortError")) {
          chained = true;
        } else {
          chainError = msg;
        }
      } finally {
        clearTimeout(t);
      }
    } else {
      chainError = "CRON_SECRET env var no configurada — chain no puede continuar";
    }
  }

  return NextResponse.json({
    processed: results.length,
    remaining: remaining ?? null,
    normalized_empty_transcripts: normalized,
    panic,
    panic_reset_attempts: panicReset,
    chained,
    chain_error: chainError,
    depth,
    account: account || null,
    elapsed_ms: Date.now() - startMs,
    results,
  });
}
