import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Resets `analyze_attempts` and clears `analyze_error` for all videos that
 * hit the 3-attempt cap in the trailing 90-day window. After this they
 * become candidates for the drain again, and the new auto-refetch logic in
 * lib/analyze.ts (which re-scrapes via Apify on Deepgram REMOTE_CONTENT_ERROR)
 * gets a chance to rescue them.
 *
 * No transcripts/analyses are deleted — only the "tried 3 times, gave up"
 * counter and last-error string are cleared. Videos that already have
 * `transcript IS NOT NULL` aren't picked up by the drain anyway, so this
 * is safe to call repeatedly.
 *
 * Auth: relies on the middleware POST protection on /api/retry-failed.
 */
const WINDOW_DAYS = 90;

export async function POST() {
  const sb = getServerSupabase();
  const windowCutoff = new Date(
    Date.now() - WINDOW_DAYS * 86400 * 1000,
  ).toISOString();

  const { data, error } = await sb
    .from("videos")
    .update({ analyze_attempts: 0, analyze_error: null })
    .gte("analyze_attempts", 3)
    .or("transcript.is.null,transcript.eq.")
    .not("video_url", "is", null)
    .gte("posted_at", windowCutoff)
    .select("shortcode");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    reset: (data || []).length,
    shortcodes: (data || []).map((d) => d.shortcode),
  });
}
