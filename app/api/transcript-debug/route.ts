import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Diagnostic endpoint: returns the EXACT breakdown of video states in the
 * 90-day window so we can tell whether "357 pendientes" means
 *   - 357 with transcript IS NULL (drain should pick them up), or
 *   - 357 with transcript = '' (drain skips, need self-heal), or
 *   - 357 with attempts >= 3 (drain skips, need retry-failed), or
 *   - some mix.
 *
 * Honest about what's in the DB. No interpretation.
 */
const WINDOW_DAYS = 90;

export async function GET() {
  const sb = getServerSupabase();
  const windowCutoff = new Date(
    Date.now() - WINDOW_DAYS * 86400 * 1000,
  ).toISOString();

  async function count(filter: (q: any) => any): Promise<number> {
    let q = sb
      .from("videos")
      .select("shortcode", { count: "exact", head: true })
      .gte("posted_at", windowCutoff);
    q = filter(q);
    const { count } = await q;
    return count ?? 0;
  }

  const [
    total_in_window,
    with_audio,
    no_audio,
    transcript_set,
    transcript_null,
    transcript_empty,
    attempts_0,
    attempts_1,
    attempts_2,
    attempts_3_plus,
    drain_candidates,
  ] = await Promise.all([
    count((q) => q),
    count((q) => q.not("video_url", "is", null)),
    count((q) => q.is("video_url", null)),
    count((q) => q.not("transcript", "is", null).neq("transcript", "")),
    count((q) => q.is("transcript", null)),
    count((q) => q.eq("transcript", "")),
    count((q) => q.eq("analyze_attempts", 0)),
    count((q) => q.eq("analyze_attempts", 1)),
    count((q) => q.eq("analyze_attempts", 2)),
    count((q) => q.gte("analyze_attempts", 3)),
    count((q) =>
      q
        .is("transcript", null)
        .lt("analyze_attempts", 3)
        .not("video_url", "is", null),
    ),
  ]);

  return NextResponse.json({
    window_days: WINDOW_DAYS,
    window_cutoff: windowCutoff,
    counts: {
      total_in_window,
      with_audio,
      no_audio,
      transcript_set,
      transcript_null,
      transcript_empty,
      attempts_0,
      attempts_1,
      attempts_2,
      attempts_3_plus,
      drain_would_match: drain_candidates,
    },
    notes: {
      drain_filter:
        "transcript IS NULL AND analyze_attempts < 3 AND video_url IS NOT NULL AND posted_at >= window_cutoff",
      explanation:
        "If 'pending' count from /api/transcript-stats disagrees with 'drain_would_match', the bug is in the filter alignment. transcript_empty > 0 means the inline self-heal didn't run yet.",
    },
  });
}
