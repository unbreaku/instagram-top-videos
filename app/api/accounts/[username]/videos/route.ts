import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { attributeDelta } from "@/lib/impact";

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
  video_url: string | null;
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
  analyze_attempts: number | null;
}

interface SnapshotRow {
  captured_at: string;
  followers_count: number | null;
}

/**
 * Estimates how many of an account's daily follower deltas can be attributed
 * to each post in that snapshot window. Weighted by a composite IMPACT score
 * (views + likes + comments) — see lib/impact.ts — so that photo/sidecar
 * posts with no views still receive a share proportional to their engagement.
 *
 * Returns:
 *   - attribution: shortcode → integer followers attributed
 *   - inWindowSet: shortcodes that fell into at least one snapshot window.
 *     Posts NOT in this set should render as "—" (no measurement possible)
 *     instead of "0" (measurable but no impact). This distinction matters:
 *     a brand-new account with no prior snapshot can't attribute *any* of
 *     its historical posts, and lumping them in with "0" is misleading.
 */
function attributeFollowers(
  videos: Pick<
    VideoRow,
    "shortcode" | "posted_at" | "latest_views" | "latest_likes" | "latest_comments"
  >[],
  snapshots: SnapshotRow[],
): { attribution: Map<string, number>; inWindowSet: Set<string> } {
  const attribution = new Map<string, number>();
  const inWindowSet = new Set<string>();
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
    for (const v of inWindow) inWindowSet.add(v.shortcode);
    const shares = attributeDelta(delta, inWindow);
    // ACCUMULATE — a video that falls inside multiple snapshot windows
    // (e.g. when the cron runs more than once a day, or when "Refrescar
    // últimos 10" is hit several times in a row) should sum each window's
    // attributed share, not overwrite with only the last one.
    for (const [sc, share] of shares) {
      const cur = attribution.get(sc) ?? 0;
      attribution.set(sc, cur + share);
    }
  }
  return { attribution, inWindowSet };
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
        "shortcode, account_username, type, caption, posted_at, url, video_url, thumbnail_url, duration_seconds, latest_views, latest_likes, latest_comments, latest_captured_at, transcript, cta, hook, format_tags, analyzed_at, analyze_attempts",
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
  // DEBUG: log first video's transcript state so we can see what Supabase
  // returned directly without any mapping. Delete after diagnosing.
  if (videos[0]) {
    console.log("[videos-route]", {
      limit,
      total_returned: videos.length,
      first_shortcode: videos[0].shortcode,
      first_transcript_present: !!videos[0].transcript,
      first_transcript_length: videos[0].transcript?.length ?? null,
      first_hook_present: !!videos[0].hook,
      first_analyze_attempts: videos[0].analyze_attempts,
      first_video_url_present: !!videos[0].video_url,
    });
  }
  const snapshots = (snapshotsRes.data || []) as SnapshotRow[];
  const { attribution, inWindowSet } = attributeFollowers(videos, snapshots);

  // estimated_followers semantics:
  //   number  → post fell in ≥1 snapshot window; this is its accumulated
  //             share (positive or negative or 0)
  //   null    → post pre-dates first snapshot, or falls between snapshots
  //             that never executed → attribution is "not measurable"
  // The client renders null as "—" and 0 as "0", which used to look the
  // same and led to "atribución no funciona" complaints.
  const out = videos.map((v) => ({
    ...v,
    estimated_followers: inWindowSet.has(v.shortcode)
      ? (attribution.get(v.shortcode) ?? 0)
      : null,
  }));

  return NextResponse.json({ videos: out });
}
