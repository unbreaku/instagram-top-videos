import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";

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
        "shortcode, url, type, posted_at, caption, hook, latest_views, latest_likes",
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
  }>;

  // Build day-bucketed snapshots (last snapshot of each calendar day).
  const byDay = new Map<string, { date: string; followers: number; capturedAt: string }>();
  for (const s of snaps) {
    const day = s.captured_at.slice(0, 10);
    const prev = byDay.get(day);
    if (!prev || s.captured_at > prev.capturedAt) {
      byDay.set(day, { date: day, followers: s.followers_count, capturedAt: s.captured_at });
    }
  }
  const dayList = [...byDay.values()].sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  // Compute deltas between consecutive days.
  const lifts: Array<{
    date: string;
    followers: number;
    delta: number | null;
    videos: typeof vids;
  }> = [];

  for (let i = 0; i < dayList.length; i++) {
    const day = dayList[i];
    const prev = i > 0 ? dayList[i - 1] : null;
    const delta = prev ? day.followers - prev.followers : null;
    // Find videos posted between prev.capturedAt and day.capturedAt.
    const windowStart = prev ? new Date(prev.capturedAt).getTime() : 0;
    const windowEnd = new Date(day.capturedAt).getTime();
    const dayVids = vids.filter((v) => {
      const t = new Date(v.posted_at).getTime();
      return t > windowStart && t <= windowEnd;
    });
    lifts.push({
      date: day.date,
      followers: day.followers,
      delta,
      videos: dayVids,
    });
  }

  // Return in reverse-chronological order (most recent first).
  lifts.reverse();
  return NextResponse.json({ lifts });
}
