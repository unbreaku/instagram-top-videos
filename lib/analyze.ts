/**
 * One-video pipeline: transcript + structured analysis + DB write.
 * Used by /api/analyze-pending and /api/videos/[shortcode]/analyze.
 */

import { analyzeVideo } from "./anthropic";
import { refreshSingleVideo } from "./apify";
import { transcribeUrl } from "./deepgram";
import { getServerSupabase } from "./supabase";

/**
 * Sentinel value stored in `videos.transcript` when Deepgram successfully
 * fetched the audio but found nothing to transcribe (silent video, only music,
 * no detectable speech). Marking the row this way:
 *
 *   - Stops the drain from looping forever (transcript IS NOT NULL).
 *   - Lets stats / UI categorize these as "sin audio" instead of "fallidos".
 *   - Distinguishes from a real failure (kept in analyze_error).
 *
 * User-facing — keep the string stable since UI checks for equality.
 */
export const NO_AUDIO_SENTINEL = "[sin audio detectable]";

export interface AnalyzeOneResult {
  shortcode: string;
  ok: boolean;
  skipped?: "no_video_url" | "already_analyzed" | "no_audio";
  hook?: string;
  cta?: string;
  format_tags?: string[];
  error?: string;
  url_refreshed?: boolean;
}

/**
 * Deepgram REMOTE_CONTENT_ERROR (and other "can't fetch URL" failures) mean
 * the Instagram CDN URL has expired. Tokens are time-limited and typically
 * die 6-24h after the original scrape. When we see this, we re-scrape the
 * single post via Apify (~$0.005) to get a fresh URL and retry Deepgram once.
 */
function isExpiredUrlError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes("remote_content_error") ||
    lower.includes("remote server hosting the media") ||
    lower.includes(" 403") ||
    lower.includes("forbidden")
  );
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

  // Atomic increment via a SECURITY DEFINER function — avoids the race when
  // two callers (cron + manual UI loop, for example) both read attempts=2
  // and both write 3, silently allowing a 4th retry past the cap.
  await sb.rpc("bump_analyze_attempts", { p_shortcode: shortcode });

  let transcript = video.transcript;
  let transcriptLang: string | null = null;
  let urlRefreshed = false;
  let videoUrl: string | null = video.video_url;
  try {
    if (!transcript && videoUrl) {
      try {
        const t = await transcribeUrl(videoUrl);
        transcript = t.transcript;
        transcriptLang = t.language;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Auto-recovery: if Deepgram says the Instagram CDN URL is dead,
        // re-scrape just this one post via Apify to get a fresh URL, then
        // retry transcription ONCE. Avoids losing videos to expired tokens.
        if (isExpiredUrlError(msg)) {
          const fresh = await refreshSingleVideo(shortcode);
          if (fresh?.videoUrl && fresh.videoUrl !== videoUrl) {
            videoUrl = fresh.videoUrl;
            urlRefreshed = true;
            await sb
              .from("videos")
              .update({ video_url: videoUrl })
              .eq("shortcode", shortcode);
            const t2 = await transcribeUrl(videoUrl);
            transcript = t2.transcript;
            transcriptLang = t2.language;
          } else {
            // Refresh didn't give us a new URL (post deleted? private? actor
            // returned nothing). Re-throw the original Deepgram error.
            throw e;
          }
        } else {
          throw e;
        }
      }
      // If Deepgram succeeded but returned no detectable speech (silent video,
      // music-only, etc.), store the sentinel so the drain doesn't keep
      // retrying forever. The sentinel makes `transcript IS NOT NULL` true,
      // taking the row out of the pending queue.
      const cleaned = (transcript || "").trim();
      const finalTranscript = cleaned || NO_AUDIO_SENTINEL;
      transcript = finalTranscript;
      await sb
        .from("videos")
        .update({
          transcript: finalTranscript,
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
    return { shortcode, ok: false, error: msg, url_refreshed: urlRefreshed };
  }

  // Short-circuit: if the transcript is the no-audio sentinel, there's
  // nothing for Anthropic to analyze. Mark the row as analyzed (so attempt
  // tracking stops) with a single sentinel format_tag the UI can recognize.
  if (transcript === NO_AUDIO_SENTINEL) {
    await sb
      .from("videos")
      .update({
        hook: null,
        cta: null,
        format_tags: ["sin_audio"],
        analyzed_at: new Date().toISOString(),
        analyze_error: null,
      })
      .eq("shortcode", shortcode);
    return {
      shortcode,
      ok: true,
      skipped: "no_audio",
      url_refreshed: urlRefreshed,
    };
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
    url_refreshed: urlRefreshed,
  };
}
