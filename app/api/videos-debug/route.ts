import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One-off debug endpoint to verify that what the videos endpoint returns
 * matches what's in the DB. Returns the first 3 videos of an account with
 * the exact same SELECT used by /api/accounts/[username]/videos, plus
 * computed flags so we can see if the badge logic would fail.
 *
 * Will delete this after the bug is found.
 */
export async function GET(req: Request) {
  const sb = getServerSupabase();
  const url = new URL(req.url);
  const username = url.searchParams.get("u") || "pablocasasa";

  const { data, error } = await sb
    .from("videos")
    .select(
      "shortcode, type, posted_at, video_url, transcript, hook, analyzed_at, analyze_attempts, format_tags",
    )
    .eq("account_username", username)
    .order("posted_at", { ascending: false, nullsFirst: false })
    .limit(3);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Surface what the front-end's transcriptStatus() would compute.
  const NO_AUDIO = "[sin audio detectable]";
  const computed = (data || []).map((v) => {
    const video = v as {
      shortcode: string;
      video_url: string | null;
      transcript: string | null;
      hook: string | null;
      analyze_attempts: number | null;
      analyzed_at: string | null;
      format_tags: unknown;
    };
    let status: string;
    if (video.video_url === null) status = "no_video";
    else if (video.transcript === NO_AUDIO) status = "no_audio";
    else if (video.transcript && video.transcript.length > 0) status = "done";
    else if ((video.analyze_attempts ?? 0) >= 3) status = "failed";
    else status = "pending";
    return {
      shortcode: video.shortcode,
      transcript_present: !!video.transcript,
      transcript_length: video.transcript?.length ?? null,
      transcript_first_20_chars: video.transcript?.slice(0, 20) ?? null,
      video_url_present: !!video.video_url,
      hook_present: !!video.hook,
      analyze_attempts: video.analyze_attempts,
      analyzed_at: video.analyzed_at,
      format_tags_type: Array.isArray(video.format_tags)
        ? "array"
        : typeof video.format_tags,
      format_tags_length: Array.isArray(video.format_tags)
        ? video.format_tags.length
        : null,
      computed_status: status,
    };
  });

  return NextResponse.json({ username, computed, raw_count: (data || []).length });
}
