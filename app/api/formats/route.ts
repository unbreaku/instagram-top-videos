import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Aggregate format_tags across all analyzed videos in the DB.
 * Returns the top tags overall + a per-account breakdown so you can spot
 * patterns the creators share.
 */
export async function GET(req: Request) {
  const sb = getServerSupabase();
  const { searchParams } = new URL(req.url);
  const minViews = Number(searchParams.get("min_views") ?? 0);

  // We use analyzed_at IS NOT NULL because Supabase's REST API treats
  // array-column IS NULL queries inconsistently. analyzed_at is a clean
  // timestamp set the moment we successfully store format_tags.
  let q = sb
    .from("videos")
    .select("account_username, format_tags, latest_views, hook, cta, shortcode, url")
    .not("analyzed_at", "is", null);
  if (minViews > 0) q = q.gte("latest_views", minViews);
  const { data: videos, error } = await q;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  // Tally tags overall and per account.
  const overall = new Map<string, { count: number; views: number }>();
  const perAccount = new Map<
    string,
    Map<string, { count: number; views: number; examples: string[] }>
  >();

  for (const v of videos || []) {
    const tags = (v.format_tags as string[]) || [];
    const views = (v.latest_views as number) || 0;
    for (const tag of tags) {
      const o = overall.get(tag) || { count: 0, views: 0 };
      o.count += 1;
      o.views += views;
      overall.set(tag, o);

      let acc = perAccount.get(v.account_username);
      if (!acc) {
        acc = new Map();
        perAccount.set(v.account_username, acc);
      }
      const a = acc.get(tag) || { count: 0, views: 0, examples: [] };
      a.count += 1;
      a.views += views;
      if (a.examples.length < 3) a.examples.push(v.shortcode);
      acc.set(tag, a);
    }
  }

  const overallSorted = [...overall.entries()]
    .map(([tag, { count, views }]) => ({
      tag,
      count,
      total_views: views,
      avg_views: Math.round(views / count),
    }))
    .sort((a, b) => b.count - a.count);

  // Tags that appear in BOTH accounts (intersection across creators).
  const usernames = [...perAccount.keys()];
  const sharedTags: Array<{
    tag: string;
    accounts: Array<{
      username: string;
      count: number;
      avg_views: number;
      examples: string[];
    }>;
  }> = [];

  if (usernames.length >= 2) {
    const tagSets = usernames.map((u) => new Set(perAccount.get(u)!.keys()));
    const shared = [...tagSets[0]].filter((tag) =>
      tagSets.every((s) => s.has(tag)),
    );
    for (const tag of shared) {
      sharedTags.push({
        tag,
        accounts: usernames.map((u) => {
          const a = perAccount.get(u)!.get(tag)!;
          return {
            username: u,
            count: a.count,
            avg_views: Math.round(a.views / a.count),
            examples: a.examples,
          };
        }),
      });
    }
    sharedTags.sort((a, b) => {
      const ca = a.accounts.reduce((s, x) => s + x.count, 0);
      const cb = b.accounts.reduce((s, x) => s + x.count, 0);
      return cb - ca;
    });
  }

  return NextResponse.json({
    total_videos: videos?.length ?? 0,
    overall: overallSorted.slice(0, 50),
    shared_tags: sharedTags.slice(0, 50),
  });
}
