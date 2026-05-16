import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: { username: string };
}

export async function GET(req: Request, { params }: Params) {
  const sb = getServerSupabase();
  const username = params.username.replace(/^@/, "").trim().toLowerCase();
  const { searchParams } = new URL(req.url);
  const sort = searchParams.get("sort") || "views";
  const order =
    searchParams.get("order") === "asc" ? { ascending: true } : { ascending: false };
  const limit = Math.min(Number(searchParams.get("limit") || 100), 500);

  const sortCol: Record<string, string> = {
    views: "latest_views",
    likes: "latest_likes",
    comments: "latest_comments",
    posted: "posted_at",
  };
  const col = sortCol[sort] || "latest_views";

  const { data, error } = await sb
    .from("videos")
    .select(
      "shortcode, account_username, type, caption, posted_at, url, thumbnail_url, duration_seconds, latest_views, latest_likes, latest_comments, latest_captured_at, transcript, cta, hook, format_tags, analyzed_at",
    )
    .eq("account_username", username)
    .order(col, order)
    .limit(limit);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ videos: data || [] });
}
