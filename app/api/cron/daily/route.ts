import { NextResponse } from "next/server";
import { runSync } from "@/lib/apify";
import { ingestApifyItems } from "@/lib/ingest";
import { analyzeOneVideo } from "@/lib/analyze";
import { sweepStuckRuns } from "@/lib/sweep";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// How many backlog videos to analyze per cron run, per account. ~3s per
// video typical → 10 videos fits comfortably under the 45s analyze budget.
const ANALYZE_BACKFILL_PER_ACCOUNT = 10;
// Policy: transcribe EVERY video posted in the trailing 90-day window.
// Previously gated at 5k views, which silently skipped low-performing
// content the user still cared to compare. Cost is tiny (~$0.007 per
// video, one-time per video — transcripts are cached on the row).
const ANALYZE_WINDOW_DAYS = 90;

// How many latest posts to fetch per pinned account daily. Kept small to
// minimize Apify spend; manual "Refrescar histórico completo" exists in the UI
// for full re-scrapes.
const DAILY_POSTS_PER_ACCOUNT = 10;

// Soft-deleted accounts older than this get hard-deleted by the cron.
const SOFT_DELETE_RETENTION_DAYS = 30;

/**
 * Vercel cron entrypoint. Configured in vercel.json to run once daily.
 * Iterates the pinned accounts and pulls the latest N posts to keep
 * follower counts and per-video metrics fresh.
 *
 * Auth: Vercel adds `Authorization: Bearer ${CRON_SECRET}` automatically.
 * We compare it to env to prevent the public from triggering scrapes.
 */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const expected = `Bearer ${process.env.CRON_SECRET || ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = getServerSupabase();

  // First, reconcile any in-flight scrape runs that finished while no one was
  // polling them. This catches users who added an account and closed the tab
  // before the client-side polling ingested the dataset.
  const sweep = await sweepStuckRuns({ maxRuns: 10, deadlineMs: 15_000 });

  // Hard-delete soft-deleted accounts older than retention window. Cascades
  // handle videos/snapshots/runs automatically.
  const cutoff = new Date(
    Date.now() - SOFT_DELETE_RETENTION_DAYS * 86400 * 1000,
  ).toISOString();
  const { data: purged } = await sb
    .from("accounts")
    .delete()
    .lt("deleted_at", cutoff)
    .select("username");

  const { data: pinned } = await sb
    .from("accounts")
    .select("username")
    .eq("is_pinned", true)
    .is("deleted_at", null);

  const results: Array<{
    username: string;
    ok: boolean;
    added?: number;
    updated?: number;
    error?: string;
  }> = [];

  for (const { username } of pinned || []) {
    try {
      const items = await runSync(username, DAILY_POSTS_PER_ACCOUNT, true);
      const r = await ingestApifyItems(username, items);
      results.push({
        username,
        ok: true,
        added: r.videosAdded,
        updated: r.videosUpdated,
      });
    } catch (e) {
      results.push({
        username,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // Backlog analysis: process a small batch of unanalyzed top videos per
  // pinned account so the corpus eventually gets fully transcribed without
  // the user having to click anything. Time-boxed to fit the function budget.
  const analyzeResults: Array<{
    username: string;
    processed: number;
    skipped: number;
    failed: number;
  }> = [];
  const deadline = Date.now() + 45_000;
  for (const { username } of pinned || []) {
    if (Date.now() > deadline) break;
    let processed = 0;
    let skipped = 0;
    let failed = 0;
    // Plain .order() — { nullsFirst: false } in Supabase silently drops top
    // rows under certain limits. Secondary key for deterministic ties.
    const windowCutoff = new Date(
      Date.now() - ANALYZE_WINDOW_DAYS * 86400 * 1000,
    ).toISOString();
    const { data: candidates } = await sb
      .from("videos")
      .select("shortcode")
      .eq("account_username", username)
      .is("analyzed_at", null)
      .lt("analyze_attempts", 3)
      .not("video_url", "is", null)
      .gte("posted_at", windowCutoff)
      // Highest-view first so the most-watched / most-valuable videos get
      // transcribed first while the backlog drains. Null views sort last.
      .order("latest_views", { ascending: false })
      .order("shortcode", { ascending: true })
      .limit(ANALYZE_BACKFILL_PER_ACCOUNT);
    for (const c of candidates || []) {
      if (Date.now() > deadline) break;
      const r = await analyzeOneVideo(c.shortcode);
      if (r.ok && !r.skipped) processed++;
      else if (r.skipped) skipped++;
      else failed++;
    }
    analyzeResults.push({ username, processed, skipped, failed });
  }

  return NextResponse.json({
    ran_at: new Date().toISOString(),
    sweep,
    purged_accounts: (purged || []).map((p) => p.username),
    refresh: results,
    analyze: analyzeResults,
  });
}
