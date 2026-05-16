import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const USERNAME_RE = /^[a-z0-9_.]{1,30}$/i;

export async function GET(req: Request) {
  const sb = getServerSupabase();
  const { searchParams } = new URL(req.url);
  const includeDeleted = searchParams.get("include_deleted") === "1";

  let q = sb
    .from("accounts")
    .select("*")
    .order("is_pinned", { ascending: false })
    .order("username", { ascending: true });
  if (!includeDeleted) q = q.is("deleted_at", null);
  const { data: accounts, error } = await q;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  // Augment with latest follower count + video count
  const usernames = (accounts || []).map((a) => a.username);
  const [videoCounts, latestSnaps] = await Promise.all([
    Promise.all(
      usernames.map((u) =>
        sb
          .from("videos")
          .select("shortcode", { count: "exact", head: true })
          .eq("account_username", u)
          .then(({ count }) => ({ u, count: count ?? 0 })),
      ),
    ),
    Promise.all(
      usernames.map((u) =>
        sb
          .from("account_snapshots")
          .select("captured_at, followers_count, posts_count")
          .eq("account_username", u)
          .order("captured_at", { ascending: false })
          .limit(1)
          .maybeSingle()
          .then(({ data }) => ({
            u,
            followers: data?.followers_count ?? null,
            posts_ig: data?.posts_count ?? null,
          })),
      ),
    ),
  ]);
  const countMap = new Map(videoCounts.map((c) => [c.u, c.count]));
  const snapMap = new Map(
    latestSnaps.map((s) => [s.u, { followers: s.followers, posts_ig: s.posts_ig }]),
  );

  return NextResponse.json({
    accounts: (accounts || []).map((a) => {
      const snap = snapMap.get(a.username);
      const inDb = countMap.get(a.username) ?? 0;
      return {
        ...a,
        // posts_count is what Instagram itself reports on the profile header.
        // posts_in_db is what Apify managed to actually fetch — bounded by the
        // public-API pagination cap.
        posts_count: snap?.posts_ig ?? null,
        posts_in_db: inDb,
        // Kept for backward compatibility with old callers.
        video_count: inDb,
        followers_latest: snap?.followers ?? null,
      };
    }),
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    username?: string;
    is_pinned?: boolean;
  };
  const username = (body.username || "")
    .replace(/^@/, "")
    .trim()
    .toLowerCase();
  if (!USERNAME_RE.test(username))
    return NextResponse.json(
      { error: "Username inválido" },
      { status: 400 },
    );
  const sb = getServerSupabase();
  // Upsert — and if the row was previously soft-deleted, undelete it.
  const { error } = await sb.from("accounts").upsert({
    username,
    is_pinned: Boolean(body.is_pinned),
    deleted_at: null,
  });
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, username });
}
