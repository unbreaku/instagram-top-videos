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
// Only analyze videos with at least this many views — saves money on noise.
const MIN_VIEWS = 5000;

/**
 * Picks the next batch of unanalyzed videos (highest views first) and runs
 * the transcript + format analysis pipeline. Returns per-video results.
 *
 * Filterable with query params:
 *   ?account=<username>   Only analyze videos from this account
 *   ?min_views=<n>        Override default minimum view threshold
 *   ?batch=<n>            Override batch size (clamped 1..10)
 */
export async function POST(req: Request) {
  const sb = getServerSupabase();
  const { searchParams } = new URL(req.url);
  const account = searchParams.get("account");
  const minViews = Number(searchParams.get("min_views") ?? MIN_VIEWS);
  const batch = Math.min(Math.max(Number(searchParams.get("batch") ?? BATCH), 1), 10);

  let q = sb
    .from("videos")
    .select("shortcode, account_username, latest_views")
    .is("analyzed_at", null)
    .lt("analyze_attempts", 3)
    .not("video_url", "is", null)
    .gte("latest_views", minViews)
    .order("latest_views", { ascending: false, nullsFirst: false })
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
    .gte("latest_views", minViews);

  return NextResponse.json({
    processed: results.length,
    remaining: remaining ?? null,
    results,
  });
}
