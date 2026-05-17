import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: { username: string };
}

/**
 * Returns everything you'd need to render a progress badge for an account:
 *   - latest scrape run (if any), its status, age, and last error
 *   - how many videos are pending analysis
 *   - how many have transcripts
 *   - whether a scrape kicked off in the last 24h is still RUNNING (we surface
 *     a yellow "trabajando" badge when so)
 *
 * Read-only, cheap, idempotent. Designed to be polled from the UI every
 * 10–15 seconds while a job is active.
 */
export async function GET(_req: Request, { params }: Params) {
  const sb = getServerSupabase();
  const username = params.username.replace(/^@/, "").trim().toLowerCase();

  const [accountRes, lastRunRes, totalRes, pendingRes, transcribedRes] =
    await Promise.all([
      sb
        .from("accounts")
        .select("username, last_full_scrape_at")
        .eq("username", username)
        .maybeSingle(),
      sb
        .from("apify_runs")
        .select("run_id, status, started_at, finished_at, error, videos_added, videos_updated, kind")
        .eq("account_username", username)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      sb
        .from("videos")
        .select("shortcode", { count: "exact", head: true })
        .eq("account_username", username),
      sb
        .from("videos")
        .select("shortcode", { count: "exact", head: true })
        .eq("account_username", username)
        .is("analyzed_at", null)
        .not("video_url", "is", null)
        // Same 90-day window as the cron / analyze-pending policy. Counts
        // ALL videos in window without a view threshold (we now transcribe
        // everything, cost is negligible at ~$0.007/video).
        .gte(
          "posted_at",
          new Date(Date.now() - 90 * 86400 * 1000).toISOString(),
        ),
      sb
        .from("videos")
        .select("shortcode", { count: "exact", head: true })
        .eq("account_username", username)
        .not("transcript", "is", null),
    ]);

  if (!accountRes.data)
    return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const run = lastRunRes.data;
  const isScrapeActive =
    run && (run.status === "RUNNING" || run.status === "READY");

  return NextResponse.json({
    username,
    last_full_scrape_at: accountRes.data.last_full_scrape_at,
    scrape: run
      ? {
          run_id: run.run_id,
          status: run.status,
          kind: run.kind,
          started_at: run.started_at,
          finished_at: run.finished_at,
          videos_added: run.videos_added,
          videos_updated: run.videos_updated,
          error: run.error,
          is_active: Boolean(isScrapeActive),
        }
      : null,
    videos: {
      total: totalRes.count ?? 0,
      with_transcript: transcribedRes.count ?? 0,
      pending_analysis: pendingRes.count ?? 0,
    },
  });
}
