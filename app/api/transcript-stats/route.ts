import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Transcript / analysis backlog stats per account.
 *
 * Strategy: COUNT queries, not row fetches.
 *
 * Previous version paginated through the videos table fetching the
 * `transcript` column. Transcripts are multi-KB text blobs; once the
 * response payload approached Supabase's ~6MB limit, the API silently
 * truncated and the loop's `if (rows.length < PAGE) break` thought it was
 * the last page. Result: a real 510-transcripts/199-pending state was
 * being reported as 189-done/357-pending, which then broke the drain UX
 * and caused the user to chase ghosts for an hour.
 *
 * Now we run small HEAD-count queries per account × per state. ~5 accounts
 * × 4 counts each = ~20 round-trips, no row data transferred. Numbers are
 * exact and align with /api/transcript-debug.
 */
const DEEPGRAM_USD_PER_MIN = 0.0058;
const ANTHROPIC_USD_PER_VIDEO = 0.0025;
const WINDOW_DAYS = 90;

const NO_AUDIO_SENTINEL = "[sin audio detectable]";

interface AccountStats {
  username: string;
  videos_total: number; // all posts in window
  videos_with_audio: number; // has video_url
  transcripts_done: number; // has a real (non-sentinel) transcript
  transcripts_no_audio: number; // marked with the no-audio sentinel
  transcripts_pending: number; // no transcript + attempts<3 + has audio
  transcripts_failed: number; // no transcript + attempts>=3 + has audio
  estimated_minutes: number;
  estimated_cost_usd: number;
}

export async function GET() {
  const sb = getServerSupabase();
  const cutoff = new Date(
    Date.now() - WINDOW_DAYS * 86400 * 1000,
  ).toISOString();
  // Star bypass: the star account is supposed to be analyzed on its FULL
  // corpus (Pablo has posts from 2024 that fall outside the 90d window —
  // those still count toward his DNA and transcript stats). Everyone else
  // uses the standard 90d window for cost predictability.
  const STAR_CUTOFF = "2000-01-01T00:00:00.000Z";

  // Seed from accounts so accounts with 0 videos still render with zeros.
  // Pull account_role at the same time so we can apply the star bypass.
  const { data: accounts, error: accErr } = await sb
    .from("accounts")
    .select("username, account_role")
    .is("deleted_at", null)
    .eq("is_hidden", false)
    .order("username", { ascending: true });
  if (accErr) {
    return NextResponse.json({ error: accErr.message }, { status: 500 });
  }
  const userList = (accounts || []) as Array<{
    username: string;
    account_role: string | null;
  }>;
  const cutoffFor = (u: string) =>
    userList.find((a) => a.username === u)?.account_role === "star"
      ? STAR_CUTOFF
      : cutoff;
  const usernames = userList.map((a) => a.username);

  // Helper: run a HEAD count with a filter callback. Avoids fetching any row
  // data, just gets `count` back from PostgREST. Multi-MB transcripts never
  // touch the wire. Per-account cutoff respects the star bypass.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function count(username: string, apply: (q: any) => any): Promise<number> {
    let q: any = sb
      .from("videos")
      .select("shortcode", { count: "exact", head: true })
      .eq("account_username", username)
      .gte("posted_at", cutoffFor(username));
    q = apply(q);
    const { count: c } = await q;
    return c ?? 0;
  }

  async function sumPendingMinutes(username: string): Promise<number> {
    const { data } = await sb
      .from("videos")
      .select("duration_seconds")
      .eq("account_username", username)
      .gte("posted_at", cutoffFor(username))
      .not("video_url", "is", null)
      .is("transcript", null)
      .lt("analyze_attempts", 3);
    if (!data) return 0;
    return data.reduce(
      (s, r) =>
        s + ((r as { duration_seconds: number | null }).duration_seconds ?? 45) / 60,
      0,
    );
  }

  // Fan out 4 counts + 1 duration-sum per account in parallel.
  const stats: AccountStats[] = await Promise.all(
    usernames.map(async (u) => {
      const [
        videos_total,
        videos_with_audio,
        transcripts_done_total, // includes both real transcripts AND no-audio sentinel
        transcripts_no_audio,
        transcripts_pending,
        transcripts_failed,
        pendingMinutes,
      ] = await Promise.all([
        count(u, (q) => q),
        count(u, (q) => q.not("video_url", "is", null)),
        count(u, (q) => q.not("transcript", "is", null).neq("transcript", "")),
        count(u, (q) => q.eq("transcript", NO_AUDIO_SENTINEL)),
        count(u, (q) =>
          q
            .not("video_url", "is", null)
            .is("transcript", null)
            .lt("analyze_attempts", 3),
        ),
        count(u, (q) =>
          q
            .not("video_url", "is", null)
            .is("transcript", null)
            .gte("analyze_attempts", 3),
        ),
        sumPendingMinutes(u),
      ]);
      // Subtract the sentinel rows from the "done" headline so it shows ONLY
      // real transcripts. The sentinel rows are surfaced separately as
      // transcripts_no_audio.
      const transcripts_done = transcripts_done_total - transcripts_no_audio;
      const estimated_cost_usd = +(
        pendingMinutes * DEEPGRAM_USD_PER_MIN +
        transcripts_pending * ANTHROPIC_USD_PER_VIDEO
      ).toFixed(2);
      return {
        username: u,
        videos_total,
        videos_with_audio,
        transcripts_done,
        transcripts_no_audio,
        transcripts_pending,
        transcripts_failed,
        estimated_minutes: +pendingMinutes.toFixed(1),
        estimated_cost_usd,
      };
    }),
  );

  stats.sort((a, b) => b.transcripts_pending - a.transcripts_pending);

  const totals = {
    videos_total: stats.reduce((s, x) => s + x.videos_total, 0),
    videos_with_audio: stats.reduce((s, x) => s + x.videos_with_audio, 0),
    transcripts_done: stats.reduce((s, x) => s + x.transcripts_done, 0),
    transcripts_no_audio: stats.reduce(
      (s, x) => s + x.transcripts_no_audio,
      0,
    ),
    transcripts_pending: stats.reduce((s, x) => s + x.transcripts_pending, 0),
    transcripts_failed: stats.reduce((s, x) => s + x.transcripts_failed, 0),
    estimated_cost_usd: +stats
      .reduce((s, x) => s + x.estimated_cost_usd, 0)
      .toFixed(2),
  };

  // Heartbeat: if any video was analyzed in the last 5 minutes, the drain
  // chain is almost certainly still running. The UI uses this to render a
  // "drenando..." indicator instead of the button, so a page reload doesn't
  // tempt the user into clicking again and spawning a parallel chain.
  const recentCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { count: recentAnalyses } = await sb
    .from("videos")
    .select("shortcode", { count: "exact", head: true })
    .gte("analyzed_at", recentCutoff);
  const { data: lastRow } = await sb
    .from("videos")
    .select("analyzed_at")
    .not("analyzed_at", "is", null)
    .order("analyzed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // "Actividad reciente": last 20 videos that the back has touched. Doesn't
  // fetch the transcript column to avoid the payload-truncation trap.
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: recentRows } = await sb
    .from("videos")
    .select(
      "shortcode, account_username, analyzed_at, transcribed_at, analyze_error, analyze_attempts",
    )
    .or(
      `analyzed_at.gte.${oneHourAgo},transcribed_at.gte.${oneHourAgo},analyze_error.not.is.null`,
    )
    .order("analyzed_at", { ascending: false, nullsFirst: false })
    .limit(20);
  const recentActivity = (recentRows || []).map((r) => {
    const ts =
      (r as { analyzed_at: string | null }).analyzed_at ||
      (r as { transcribed_at: string | null }).transcribed_at ||
      null;
    const err = (r as { analyze_error: string | null }).analyze_error;
    const attempts =
      (r as { analyze_attempts: number | null }).analyze_attempts ?? 0;
    // We don't have transcript here (deliberately) so we infer status from
    // the error and attempts.
    const status: "ok" | "error" | "pending" = err
      ? "error"
      : ts
        ? "ok"
        : "pending";
    return {
      shortcode: (r as { shortcode: string }).shortcode,
      account: (r as { account_username: string }).account_username,
      ts,
      status,
      attempts,
      error: err ? err.slice(0, 180) : null,
    };
  });

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
    drain: {
      recent_analyses_window_min: 5,
      recent_analyses: recentAnalyses ?? 0,
      last_analyzed_at: lastRow?.analyzed_at ?? null,
      is_active: (recentAnalyses ?? 0) > 0,
    },
    recent_activity: recentActivity,
  });
}
