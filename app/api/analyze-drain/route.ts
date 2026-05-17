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
const BATCH_PER_CALL = 10;
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

  const sb = getServerSupabase();
  const windowCutoff = new Date(
    Date.now() - WINDOW_DAYS * 86400 * 1000,
  ).toISOString();

  // Prevent the user from kicking off a parallel chain by reloading and
  // clicking again. If any video has been analyzed in the last 2 minutes,
  // there's almost certainly an active chain in flight — refuse user-initiated
  // calls (depth=0) and let the existing chain finish. Internal self-chained
  // calls (depth>0) always pass because they ARE the active chain.
  if (depth === 0) {
    const recentCutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { count: recentCount } = await sb
      .from("videos")
      .select("shortcode", { count: "exact", head: true })
      .gte("analyzed_at", recentCutoff);
    if ((recentCount ?? 0) > 0) {
      return NextResponse.json({
        already_running: true,
        recent_analyses_2min: recentCount,
        message:
          "Ya hay un drenado en curso. Esperá unos minutos y revisá los conteos.",
      });
    }
  }

  // Filter on TRANSCRIPT (not analyzed_at) because that's what stats counts
  // as "pending" and what the user actually cares about. Using analyzed_at
  // would silently skip videos where a previous run set analyzed_at but the
  // transcript came back empty/null (e.g. Deepgram returned 200 with empty
  // body, then Anthropic still ran on the empty transcript and we set
  // analyzed_at). Those zombies have transcript=null forever.
  let q = sb
    .from("videos")
    .select("shortcode, account_username")
    .is("transcript", null)
    .lt("analyze_attempts", 3)
    .not("video_url", "is", null)
    .gte("posted_at", windowCutoff)
    .order("latest_views", { ascending: false })
    .order("shortcode", { ascending: true })
    .limit(BATCH_PER_CALL);
  if (account) q = q.eq("account_username", account);

  const { data: candidates, error } = await q;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  const results: Array<{
    shortcode: string;
    account: string;
    ok: boolean;
    error?: string;
  }> = [];
  for (const c of candidates || []) {
    // Pass force:true so videos that previously had analyzed_at set with
    // null transcript (Deepgram empty response zombies) get a fresh try.
    // analyzeOneVideo only re-calls Deepgram when transcript is null, so
    // force doesn't waste money on videos that already have one.
    const r = await analyzeOneVideo(c.shortcode, { force: true });
    results.push({
      shortcode: c.shortcode,
      account: c.account_username,
      ok: r.ok,
      error: r.error,
      skipped: r.skipped,
    });
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
  // safety cap. Fire-and-forget so this response returns immediately.
  let chained = false;
  if ((remaining ?? 0) > 0 && depth + 1 < maxChain) {
    const proto = req.headers.get("x-forwarded-proto") || "https";
    const host = req.headers.get("host");
    if (host && process.env.CRON_SECRET) {
      const nextUrl = new URL(`${proto}://${host}/api/analyze-drain`);
      if (account) nextUrl.searchParams.set("account", account);
      nextUrl.searchParams.set("max_chain", String(maxChain));
      nextUrl.searchParams.set("_depth", String(depth + 1));
      // No await — let the runtime tear down this invocation while the new
      // one boots. Vercel keeps the outgoing fetch alive long enough to
      // establish the next function instance.
      fetch(nextUrl.toString(), {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
      }).catch(() => {});
      chained = true;
    }
  }

  return NextResponse.json({
    processed: results.length,
    remaining: remaining ?? null,
    chained,
    depth,
    account: account || null,
    results,
  });
}
