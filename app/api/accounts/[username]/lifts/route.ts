import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { attributeDelta, postImpact } from "@/lib/impact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: { username: string };
}

/**
 * Computes follower-lift-per-day for an account and attributes each day's
 * delta to the videos posted in that 24h window. Useful for spotting which
 * specific reel drove a follower spike.
 */
export async function GET(_req: Request, { params }: Params) {
  const sb = getServerSupabase();
  const username = params.username.replace(/^@/, "").trim().toLowerCase();

  const [{ data: snapshots }, { data: videos }] = await Promise.all([
    sb
      .from("account_snapshots")
      .select("captured_at, followers_count")
      .eq("account_username", username)
      .not("followers_count", "is", null)
      .order("captured_at", { ascending: true }),
    sb
      .from("videos")
      .select(
        "shortcode, url, type, posted_at, caption, hook, latest_views, latest_likes, latest_comments",
      )
      .eq("account_username", username)
      .not("posted_at", "is", null)
      .order("posted_at", { ascending: false }),
  ]);

  const snaps = (snapshots || []) as Array<{
    captured_at: string;
    followers_count: number;
  }>;
  const vids = (videos || []) as Array<{
    shortcode: string;
    url: string;
    type: string | null;
    posted_at: string;
    caption: string | null;
    hook: string | null;
    latest_views: number | null;
    latest_likes: number | null;
    latest_comments: number | null;
  }>;

  // Build day-bucketed snapshots (last snapshot of each calendar day).
  // We bucket by the user's local day (Europe/Madrid, CET/CEST with DST)
  // instead of raw UTC. Otherwise a cron firing at 23:00 UTC would get
  // bucketed into the previous calendar day from the user's perspective,
  // and the dashboard would show empty / shifted days.
  const tzFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const localDay = (iso: string) => tzFormatter.format(new Date(iso)); // YYYY-MM-DD

  const byDay = new Map<string, { date: string; followers: number; capturedAt: string }>();
  for (const s of snaps) {
    const day = localDay(s.captured_at);
    const prev = byDay.get(day);
    if (!prev || s.captured_at > prev.capturedAt) {
      byDay.set(day, { date: day, followers: s.followers_count, capturedAt: s.captured_at });
    }
  }
  const dayList = [...byDay.values()].sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  // Compute deltas between consecutive days, and within each day split the
  // delta across that day's posts using the composite impact score (so a
  // photo with 0 views still gets a share if it earned likes/comments).
  // Each video entry includes:
  //   - impact:   the raw score used for the split (debug-visible)
  //   - share:    fraction of the day's delta (0..1, useful for "weight" bars)
  //   - attributed_followers: integer followers attributed to this post
  //                           (null on day 1 — no prev snapshot to diff against)
  type DayVideo = (typeof vids)[number] & {
    impact: number;
    share: number;
    attributed_followers: number | null;
  };
  const lifts: Array<{
    date: string;
    followers: number;
    delta: number | null;
    videos: DayVideo[];
  }> = [];

  for (let i = 0; i < dayList.length; i++) {
    const day = dayList[i];
    const prev = i > 0 ? dayList[i - 1] : null;
    const delta = prev ? day.followers - prev.followers : null;
    const windowStart = prev ? new Date(prev.capturedAt).getTime() : 0;
    const windowEnd = new Date(day.capturedAt).getTime();
    const dayVids = vids.filter((v) => {
      const t = new Date(v.posted_at).getTime();
      return t > windowStart && t <= windowEnd;
    });
    // If we have a delta, split it; otherwise impact/share are still useful
    // for showing relative weight even without a follower number.
    const shares =
      delta != null && dayVids.length > 0
        ? attributeDelta(delta, dayVids)
        : new Map<string, number>();
    const totalImpact = dayVids.reduce((s, v) => s + postImpact(v), 0);
    const enriched: DayVideo[] = dayVids.map((v) => {
      const imp = postImpact(v);
      return {
        ...v,
        impact: imp,
        share: totalImpact > 0 ? imp / totalImpact : 1 / Math.max(1, dayVids.length),
        attributed_followers: delta != null ? (shares.get(v.shortcode) ?? 0) : null,
      };
    });
    lifts.push({
      date: day.date,
      followers: day.followers,
      delta,
      videos: enriched,
    });
  }

  // Return in reverse-chronological order (most recent first).
  lifts.reverse();
  return NextResponse.json({ lifts });
}
