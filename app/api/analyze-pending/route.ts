import { NextResponse } from "next/server";
import { analyzeOneVideo } from "@/lib/analyze";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Max function time on Vercel Hobby is 60s. Allow up to that.
export const maxDuration = 60;

// Process this many videos per call. Transcribing + analyzing ~10s/video, so
// ~5 is safe within the 60s Vercel timeout.
const BATCH = 5;
// Trailing window of posts eligible for analysis. Matches the cron policy
// (lib/cron/daily/route.ts). The view-based threshold was removed — cost
// per video is ~$0.007 and we'd rather transcribe everything than skip
// content the user might want to compare.
const WINDOW_DAYS = 90;

/**
 * Picks the next batch of unanalyzed videos (highest views first) and runs
 * the transcript + format analysis pipeline. Returns per-video results.
 *
 * Filterable with query params:
 *   ?account=<username>   Only analyze videos from this account
 *   ?days=<n>             Override trailing window (default 90)
 *   ?batch=<n>            Override batch size (clamped 1..10)
 */
export async function POST(req: Request) {
  const sb = getServerSupabase();
  const { searchParams } = new URL(req.url);
  const account = searchParams.get("account");
  const days = Number(searchParams.get("days") ?? WINDOW_DAYS);
  const batch = Math.min(
    Math.max(Number(searchParams.get("batch") ?? BATCH), 1),
    10,
  );
  const windowCutoff = new Date(
    Date.now() - days * 86400 * 1000,
  ).toISOString();

  // We previously used { nullsFirst: false }, but in Supabase that option
  // combined with a high enough limit silently drops the top rows of the
  // sorted result. Plain .order() + a deterministic secondary key is safe.
  let q = sb
    .from("videos")
    .select("shortcode, account_username, latest_views")
    .is("analyzed_at", null)
    .lt("analyze_attempts", 3)
    .not("video_url", "is", null)
    .gte("posted_at", windowCutoff)
    .order("latest_views", { ascending: false })
    .order("shortcode", { ascending: true })
    .limit(batch);
  if (account) q = q.eq("account_username", account);

  const { data: candidates, error } = await q;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  const results = [];
  for (const v of candidates || []) {
    const r = await analyzeOneVideo(v.shortcode);
    results.push({ ...r, account: v.account_username, views: v.latest_views });
  }

  // Count what's left.
  const { count: remaining } = await sb
    .from("videos")
    .select("shortcode", { count: "exact", head: true })
    .is("analyzed_at", null)
    .lt("analyze_attempts", 3)
    .not("video_url", "is", null)
    .gte("posted_at", windowCutoff);

  return NextResponse.json({
    processed: results.length,
    remaining: remaining ?? null,
    results,
  });
}
