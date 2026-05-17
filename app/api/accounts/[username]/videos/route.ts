import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: { username: string };
}

interface VideoRow {
  shortcode: string;
  account_username: string;
  type: string | null;
  caption: string | null;
  posted_at: string | null;
  url: string;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  latest_views: number | null;
  latest_likes: number | null;
  latest_comments: number | null;
  latest_captured_at: string | null;
  transcript: string | null;
  cta: string | null;
  hook: string | null;
  format_tags: string[] | null;
  analyzed_at: string | null;
}

interface SnapshotRow {
  captured_at: string;
  followers_count: number | null;
}

/**
 * Estimates how many of an account's daily follower deltas can be attributed
 * to each video posted in that 24h window. Weighted by views — videos with
 * more views absorb a larger share. If views are zero/missing we fall back
 * to equal split. Returns a shortcode → followers map.
 */
function attributeFollowers(
  videos: Pick<VideoRow, "shortcode" | "posted_at" | "latest_views">[],
  snapshots: SnapshotRow[],
): Map<string, number> {
  const map = new Map<string, number>();
  const snaps = snapshots
    .filter((s) => typeof s.followers_count === "number")
    .sort((a, b) => a.captured_at.localeCompare(b.captured_at));

  for (let i = 1; i < snaps.length; i++) {
    const prev = snaps[i - 1];
    const curr = snaps[i];
    const delta = (curr.followers_count ?? 0) - (prev.followers_count ?? 0);
    const windowStart = new Date(prev.captured_at).getTime();
    const windowEnd = new Date(curr.captured_at).getTime();
    const inWindow = videos.filter((v) => {
      if (!v.posted_at) return false;
      const t = new Date(v.posted_at).getTime();
      return t > windowStart && t <= windowEnd;
    });
    if (inWindow.length === 0) continue;
    const totalViews = inWindow.reduce(
      (s, v) => s + (v.latest_views || 0),
      0,
    );
    for (const v of inWindow) {
      if (totalViews > 0) {
        const share = ((v.latest_views || 0) / totalViews) * delta;
        map.set(v.shortcode, Math.round(share));
      } else {
        map.set(v.shortcode, Math.round(delta / inWindow.length));
      }
    }
  }
  return map;
}

export async function GET(req: Request, { params }: Params) {
  const sb = getServerSupabase();
  const username = params.username.replace(/^@/, "").trim().toLowerCase();
  const { searchParams } = new URL(req.url);
  const sort = searchParams.get("sort") || "views";
  const order =
    searchParams.get("order") === "asc"
      ? { ascending: true }
      : { ascending: false };
  // Supabase / PostgREST silently returns an empty array when limit is
  // exactly 1000 (max-rows default). Cap at 999 to stay below the cliff and
  // use range pagination for accounts that exceed that ceiling.
  const requested = Math.max(1, Number(searchParams.get("limit") || 100));
  const limit = Math.min(requested, 999);

  const sortCol: Record<string, string> = {
    views: "latest_views",
    likes: "latest_likes",
    comments: "latest_comments",
    posted: "posted_at",
  };
  const col = sortCol[sort] || "latest_views";

  const [videosRes, snapshotsRes] = await Promise.all([
    sb
      .from("videos")
      .select(
        "shortcode, account_username, type, caption, posted_at, url, thumbnail_url, duration_seconds, latest_views, latest_likes, latest_comments, latest_captured_at, transcript, cta, hook, format_tags, analyzed_at",
      )
      .eq("account_username", username)
      // We previously passed nullsFirst:false to push photos with NULL views
      // to the bottom. That option, combined with limit > ~450 on Supabase,
      // silently dropped legitimate non-NULL rows at the top of the sort and
      // returned the wrong slice. Stick to plain .order() and handle NULL
      // ordering on the client (the table re-sorts via useMemo anyway).
      .order(col, order)
      // Secondary deterministic key avoids any further surprises with ties.
      .order("shortcode", { ascending: true })
      .limit(limit),
    sb
      .from("account_snapshots")
      .select("captured_at, followers_count")
      .eq("account_username", username)
      .not("followers_count", "is", null)
      .order("captured_at", { ascending: true }),
  ]);

  if (videosRes.error)
    return NextResponse.json(
      { error: videosRes.error.message },
      { status: 500 },
    );

  const videos = (videosRes.data || []) as VideoRow[];
  const snapshots = (snapshotsRes.data || []) as SnapshotRow[];
  const attribution = attributeFollowers(videos, snapshots);

  const out = videos.map((v) => ({
    ...v,
    estimated_followers: attribution.get(v.shortcode) ?? null,
  }));

  return NextResponse.json({ videos: out });
}
