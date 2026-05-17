import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Transcript / analysis backlog stats per account.
 *
 * Returns enough numbers to make an informed call on whether to lower the
 * view threshold or expand the time window without spending money blind.
 *
 * Per-account counts:
 *   - videos_total        every row in `videos` (includes photos/sidecars)
 *   - videos_with_audio   has video_url (transcribable)
 *   - transcripts_done    has transcript stored (won't be re-fetched)
 *   - transcripts_pending under the PROPOSED policy:
 *                           transcript IS NULL
 *                           AND video_url IS NOT NULL
 *                           AND analyze_attempts < 3
 *                           AND posted_at >= NOW() - 90 days
 *   - transcripts_failed  analyze_attempts >= 3 (gave up; won't retry on cron)
 *   - estimated_minutes   sum of duration_seconds for pending videos / 60
 *   - estimated_cost_usd  pending_minutes * $0.0058 (Deepgram PAYG)
 *                          + pending_count * $0.0025 (Anthropic Haiku per video)
 */
const DEEPGRAM_USD_PER_MIN = 0.0058;
const ANTHROPIC_USD_PER_VIDEO = 0.0025;
const WINDOW_DAYS = 90;

interface AccountStats {
  username: string;
  videos_total: number;
  videos_with_audio: number;
  transcripts_done: number;
  transcripts_pending: number;
  transcripts_failed: number;
  estimated_minutes: number;
  estimated_cost_usd: number;
}

export async function GET() {
  const sb = getServerSupabase();
  const cutoff = new Date(
    Date.now() - WINDOW_DAYS * 86400 * 1000,
  ).toISOString();

  // Pull just the columns we need. Single round trip for the whole table.
  // For 5k-10k videos this is well under the 6MB PostgREST response budget.
  const { data, error } = await sb
    .from("videos")
    .select(
      "account_username, video_url, transcript, analyze_attempts, duration_seconds, posted_at",
    )
    .order("account_username", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const byUser = new Map<string, AccountStats>();
  const blank = (u: string): AccountStats => ({
    username: u,
    videos_total: 0,
    videos_with_audio: 0,
    transcripts_done: 0,
    transcripts_pending: 0,
    transcripts_failed: 0,
    estimated_minutes: 0,
    estimated_cost_usd: 0,
  });

  for (const v of data || []) {
    const u = (v as { account_username: string }).account_username;
    if (!u) continue;
    if (!byUser.has(u)) byUser.set(u, blank(u));
    const s = byUser.get(u)!;
    const hasAudio = !!(v as { video_url: string | null }).video_url;
    const hasTranscript = !!(v as { transcript: string | null }).transcript;
    const attempts =
      (v as { analyze_attempts: number | null }).analyze_attempts ?? 0;
    const posted = (v as { posted_at: string | null }).posted_at;
    const inWindow = posted ? posted >= cutoff : false;
    const duration =
      (v as { duration_seconds: number | null }).duration_seconds ?? 45;

    s.videos_total += 1;
    if (hasAudio) s.videos_with_audio += 1;
    if (hasTranscript) s.transcripts_done += 1;
    if (hasAudio && !hasTranscript && attempts >= 3) s.transcripts_failed += 1;

    // PROPOSED policy: pending = transcribable + not yet done + retries left
    // + within the 90-day window.
    if (hasAudio && !hasTranscript && attempts < 3 && inWindow) {
      s.transcripts_pending += 1;
      s.estimated_minutes += duration / 60;
    }
  }

  for (const s of byUser.values()) {
    s.estimated_cost_usd = +(
      s.estimated_minutes * DEEPGRAM_USD_PER_MIN +
      s.transcripts_pending * ANTHROPIC_USD_PER_VIDEO
    ).toFixed(2);
    s.estimated_minutes = +s.estimated_minutes.toFixed(1);
  }

  const stats = [...byUser.values()].sort(
    (a, b) => b.transcripts_pending - a.transcripts_pending,
  );

  const totals = {
    videos_total: stats.reduce((s, x) => s + x.videos_total, 0),
    videos_with_audio: stats.reduce((s, x) => s + x.videos_with_audio, 0),
    transcripts_done: stats.reduce((s, x) => s + x.transcripts_done, 0),
    transcripts_pending: stats.reduce((s, x) => s + x.transcripts_pending, 0),
    transcripts_failed: stats.reduce((s, x) => s + x.transcripts_failed, 0),
    estimated_cost_usd: +stats
      .reduce((s, x) => s + x.estimated_cost_usd, 0)
      .toFixed(2),
  };

  return NextResponse.json({
    policy: {
      window_days: WINDOW_DAYS,
      min_views: 0,
      attempts_cap: 3,
      deepgram_usd_per_min: DEEPGRAM_USD_PER_MIN,
      anthropic_usd_per_video: ANTHROPIC_USD_PER_VIDEO,
    },
    totals,
    accounts: stats,
  });
}
