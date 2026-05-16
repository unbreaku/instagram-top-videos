/**
 * One-video pipeline: transcript + structured analysis + DB write.
 * Used by /api/analyze-pending and /api/videos/[shortcode]/analyze.
 */

import { analyzeVideo } from "./anthropic";
import { transcribeUrl } from "./deepgram";
import { getServerSupabase } from "./supabase";

export interface AnalyzeOneResult {
  shortcode: string;
  ok: boolean;
  skipped?: "no_video_url" | "already_analyzed";
  hook?: string;
  cta?: string;
  format_tags?: string[];
  error?: string;
}

export async function analyzeOneVideo(
  shortcode: string,
  opts: { force?: boolean } = {},
): Promise<AnalyzeOneResult> {
  const sb = getServerSupabase();
  const { data: video, error } = await sb
    .from("videos")
    .select(
      "shortcode, video_url, caption, transcript, analyzed_at, analyze_attempts, duration_seconds",
    )
    .eq("shortcode", shortcode)
    .maybeSingle();

  if (error || !video) {
    return { shortcode, ok: false, error: error?.message || "Not found" };
  }
  if (video.analyzed_at && !opts.force) {
    return { shortcode, ok: true, skipped: "already_analyzed" };
  }
  if (!video.video_url) {
    return { shortcode, ok: false, skipped: "no_video_url" };
  }

  // Bump attempt counter up front so a crash doesn't loop us forever.
  await sb
    .from("videos")
    .update({
      analyze_attempts: (video.analyze_attempts || 0) + 1,
      analyze_error: null,
    })
    .eq("shortcode", shortcode);

  let transcript = video.transcript;
  let transcriptLang: string | null = null;
  try {
    if (!transcript) {
      const t = await transcribeUrl(video.video_url);
      transcript = t.transcript;
      transcriptLang = t.language;
      await sb
        .from("videos")
        .update({
          transcript: transcript || null,
          transcript_lang: transcriptLang,
          transcribed_at: new Date().toISOString(),
        })
        .eq("shortcode", shortcode);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb
      .from("videos")
      .update({ analyze_error: `transcribe: ${msg.slice(0, 400)}` })
      .eq("shortcode", shortcode);
    return { shortcode, ok: false, error: msg };
  }

  let analysis;
  try {
    analysis = await analyzeVideo({
      caption: video.caption,
      transcript,
      durationSeconds: video.duration_seconds,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb
      .from("videos")
      .update({ analyze_error: `analyze: ${msg.slice(0, 400)}` })
      .eq("shortcode", shortcode);
    return { shortcode, ok: false, error: msg };
  }

  await sb
    .from("videos")
    .update({
      hook: analysis.hook || null,
      cta: analysis.cta || null,
      format_tags: analysis.format_tags.length ? analysis.format_tags : null,
      analyzed_at: new Date().toISOString(),
      analyze_error: null,
    })
    .eq("shortcode", shortcode);

  return {
    shortcode,
    ok: true,
    hook: analysis.hook,
    cta: analysis.cta,
    format_tags: analysis.format_tags,
  };
}
