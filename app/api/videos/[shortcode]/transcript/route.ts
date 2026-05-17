import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: { shortcode: string };
}

/**
 * Fetches the full transcript for ONE video by shortcode.
 *
 * Why a per-video endpoint: the bulk /videos endpoint cannot include
 * transcript text without hitting Vercel's response chunking limits when
 * an account has 50+ videos. Pulling per-row on demand keeps the bulk
 * fetch slim and only loads the heavy field when the user expands a row.
 */
export async function GET(_req: Request, { params }: Params) {
  const sb = getServerSupabase();
  const shortcode = params.shortcode.trim();
  if (!shortcode) {
    return NextResponse.json({ error: "shortcode requerido" }, { status: 400 });
  }
  const { data, error } = await sb
    .from("videos")
    .select("shortcode, transcript, transcript_lang, transcribed_at")
    .eq("shortcode", shortcode)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "video no encontrado" }, { status: 404 });
  }
  return NextResponse.json({
    shortcode: (data as { shortcode: string }).shortcode,
    transcript: (data as { transcript: string | null }).transcript,
    transcript_lang: (data as { transcript_lang: string | null }).transcript_lang,
    transcribed_at: (data as { transcribed_at: string | null }).transcribed_at,
  });
}
