import { NextResponse } from "next/server";
import { analyzeOneVideo } from "@/lib/analyze";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Params {
  params: { shortcode: string };
}

/**
 * Per-video force button (••• menu in the videos table).
 *
 * Resets transcript/analysis state so the next analyze run starts fresh:
 *   - transcript → NULL (forgets the no-audio sentinel, empty string, or
 *     previous transcript)
 *   - analyze_attempts → 0 (lifts the 3-attempt cap)
 *   - analyze_error → NULL
 *   - analyzed_at → NULL (so analyzeOneVideo doesn't short-circuit)
 *
 * Then runs analyzeOneVideo synchronously with force=true. Returns the
 * result so the UI can show success/failure inline.
 *
 * Cost: ~$0.007 (one Deepgram + one Anthropic call) plus possibly $0.005
 * if the auto-refetch via Apify kicks in.
 */
export async function POST(_req: Request, { params }: Params) {
  const shortcode = params.shortcode.trim();
  if (!shortcode) {
    return NextResponse.json({ error: "shortcode requerido" }, { status: 400 });
  }

  const sb = getServerSupabase();

  // Reset state so the analyze pipeline starts from a clean slate.
  const { error: resetErr } = await sb
    .from("videos")
    .update({
      transcript: null,
      transcript_lang: null,
      transcribed_at: null,
      analyzed_at: null,
      analyze_attempts: 0,
      analyze_error: null,
      hook: null,
      cta: null,
      format_tags: null,
    })
    .eq("shortcode", shortcode);

  if (resetErr) {
    return NextResponse.json({ error: resetErr.message }, { status: 500 });
  }

  // Run the full pipeline. force=true ensures analyzeOneVideo doesn't bail
  // on "already analyzed" (even though we cleared analyzed_at, this is
  // defense-in-depth).
  const result = await analyzeOneVideo(shortcode, { force: true });

  return NextResponse.json({
    ok: result.ok,
    shortcode,
    skipped: result.skipped,
    hook: result.hook,
    cta: result.cta,
    format_tags: result.format_tags,
    url_refreshed: result.url_refreshed,
    error: result.error,
  });
}
