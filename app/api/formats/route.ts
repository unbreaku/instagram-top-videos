import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface VideoForFormats {
  shortcode: string;
  account_username: string;
  format_tags: string[] | null;
  latest_views: number | null;
  latest_likes: number | null;
  hook: string | null;
  cta: string | null;
  url: string;
}

/**
 * Returns aggregated insights about format_tags so the /formats page can
 * surface which structural patterns drive results, both per-account and
 * across the whole observed set.
 */
export async function GET(req: Request) {
  const sb = getServerSupabase();
  const { searchParams } = new URL(req.url);
  const minViews = Number(searchParams.get("min_views") ?? 0);

  let q = sb
    .from("videos")
    .select(
      "shortcode, account_username, format_tags, latest_views, latest_likes, hook, cta, url",
    )
    .not("analyzed_at", "is", null);
  if (minViews > 0) q = q.gte("latest_views", minViews);
  const { data, error } = await q;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  const videos = (data || []) as VideoForFormats[];

  // Per-tag aggregates across the whole observed set.
  interface OverallEntry {
    tag: string;
    count: number;
    accounts: Set<string>;
    totalViews: number;
    totalLikes: number;
    examples: string[];
  }
  const overallMap = new Map<string, OverallEntry>();
  // Per-account-per-tag aggregates (for heatmap + shared analysis).
  const accTagMap = new Map<string, OverallEntry>(); // key = `${u}::${tag}`

  for (const v of videos) {
    const tags = v.format_tags || [];
    const views = v.latest_views || 0;
    const likes = v.latest_likes || 0;
    for (const tag of tags) {
      let o = overallMap.get(tag);
      if (!o) {
        o = { tag, count: 0, accounts: new Set(), totalViews: 0, totalLikes: 0, examples: [] };
        overallMap.set(tag, o);
      }
      o.count += 1;
      o.accounts.add(v.account_username);
      o.totalViews += views;
      o.totalLikes += likes;
      if (o.examples.length < 5) o.examples.push(v.shortcode);

      const key = `${v.account_username}::${tag}`;
      let at = accTagMap.get(key);
      if (!at) {
        at = {
          tag,
          count: 0,
          accounts: new Set([v.account_username]),
          totalViews: 0,
          totalLikes: 0,
          examples: [],
        };
        accTagMap.set(key, at);
      }
      at.count += 1;
      at.totalViews += views;
      at.totalLikes += likes;
      if (at.examples.length < 3) at.examples.push(v.shortcode);
    }
  }

  const overall = [...overallMap.values()]
    .map((o) => ({
      tag: o.tag,
      count: o.count,
      accounts: o.accounts.size,
      total_views: o.totalViews,
      avg_views: o.count > 0 ? Math.round(o.totalViews / o.count) : 0,
      total_likes: o.totalLikes,
      avg_likes: o.count > 0 ? Math.round(o.totalLikes / o.count) : 0,
      examples: o.examples,
    }))
    .sort((a, b) => b.count - a.count);

  const usernames = [...new Set(videos.map((v) => v.account_username))].sort();

  // Heatmap matrix: account × tag → { count, avg_views }. Only top 30 tags by
  // total count to keep the matrix readable.
  const topTags = overall.slice(0, 30).map((o) => o.tag);
  const heatmap = {
    accounts: usernames,
    tags: topTags,
    cells: topTags.map((tag) =>
      usernames.map((u) => {
        const at = accTagMap.get(`${u}::${tag}`);
        return at
          ? {
              count: at.count,
              avg_views: at.count > 0 ? Math.round(at.totalViews / at.count) : 0,
            }
          : { count: 0, avg_views: 0 };
      }),
    ),
  };

  // Tags shared across ≥2 accounts. Strong signal of a template.
  const shared = overall
    .filter((o) => o.accounts >= 2)
    .map((o) => ({
      tag: o.tag,
      total_count: o.count,
      accounts_used: o.accounts,
      accounts: usernames
        .map((u) => {
          const at = accTagMap.get(`${u}::${o.tag}`);
          return at
            ? {
                username: u,
                count: at.count,
                avg_views:
                  at.count > 0 ? Math.round(at.totalViews / at.count) : 0,
                examples: at.examples,
              }
            : null;
        })
        .filter((x): x is NonNullable<typeof x> => x !== null && x.count > 0),
    }))
    .sort((a, b) => b.total_count - a.total_count);

  // Top hooks / CTAs by views.
  const topHooks = videos
    .filter((v) => v.hook)
    .sort((a, b) => (b.latest_views || 0) - (a.latest_views || 0))
    .slice(0, 25)
    .map((v) => ({
      hook: v.hook,
      account: v.account_username,
      shortcode: v.shortcode,
      url: v.url,
      views: v.latest_views,
    }));
  const topCtas = videos
    .filter((v) => v.cta)
    .sort((a, b) => (b.latest_views || 0) - (a.latest_views || 0))
    .slice(0, 25)
    .map((v) => ({
      cta: v.cta,
      account: v.account_username,
      shortcode: v.shortcode,
      url: v.url,
      views: v.latest_views,
    }));

  const totalViews = videos.reduce((s, v) => s + (v.latest_views || 0), 0);
  const avgViewsPerVideo =
    videos.length > 0 ? Math.round(totalViews / videos.length) : 0;

  return NextResponse.json({
    total_videos: videos.length,
    total_accounts: usernames.length,
    total_formats: overall.length,
    total_views: totalViews,
    avg_views_per_video: avgViewsPerVideo,
    overall,
    shared_tags: shared,
    heatmap,
    top_hooks: topHooks,
    top_ctas: topCtas,
  });
}
