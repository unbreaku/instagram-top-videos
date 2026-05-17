import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const USERNAME_RE = /^[a-z0-9_.]{1,30}$/i;

export async function GET(req: Request) {
  const sb = getServerSupabase();
  const { searchParams } = new URL(req.url);
  const includeDeleted = searchParams.get("include_deleted") === "1";

  // We deliberately do NOT order by account_role at the SQL level — if the
  // 0011 migration hasn't been applied yet (or the column otherwise doesn't
  // exist), ORDER BY a missing column makes the entire query return zero
  // rows, which made the dashboard appear empty after the schema pivot.
  // We sort the star to the top in JS after fetching, defensive against
  // either the column missing or all rows being NULL.
  let q = sb
    .from("accounts")
    .select("*")
    .order("is_pinned", { ascending: false })
    .order("username", { ascending: true });
  if (!includeDeleted) q = q.is("deleted_at", null);
  const { data: accounts, error } = await q;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  // Augment with latest follower count, video count, AND background-job status
  // so the UI can render badges without a separate roundtrip per account.
  const usernames = (accounts || []).map((a) => a.username);
  const [videoCounts, latestSnaps, lastRuns, pendingAnalyses] = await Promise.all(
    [
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
      Promise.all(
        usernames.map((u) =>
          sb
            .from("apify_runs")
            .select("run_id, status, started_at, error")
            .eq("account_username", u)
            .order("started_at", { ascending: false })
            .limit(1)
            .maybeSingle()
            .then(({ data }) => ({ u, run: data })),
        ),
      ),
      Promise.all(
        usernames.map((u) =>
          sb
            .from("videos")
            .select("shortcode", { count: "exact", head: true })
            .eq("account_username", u)
            .is("analyzed_at", null)
            .not("video_url", "is", null)
            // Match the analyze-pending / cron policy: trailing 90 days,
            // no minimum-views threshold. Counts what the backlog actually
            // contains under current rules.
            .gte(
              "posted_at",
              new Date(Date.now() - 90 * 86400 * 1000).toISOString(),
            )
            .then(({ count }) => ({ u, count: count ?? 0 })),
        ),
      ),
    ],
  );
  const countMap = new Map(videoCounts.map((c) => [c.u, c.count]));
  const snapMap = new Map(
    latestSnaps.map((s) => [s.u, { followers: s.followers, posts_ig: s.posts_ig }]),
  );
  const runMap = new Map(lastRuns.map((r) => [r.u, r.run]));
  const pendingMap = new Map(pendingAnalyses.map((p) => [p.u, p.count]));

  const augmented = (accounts || []).map((a) => {
    const snap = snapMap.get(a.username);
    const inDb = countMap.get(a.username) ?? 0;
    const run = runMap.get(a.username);
    const isActive =
      !!run && (run.status === "RUNNING" || run.status === "READY");
    return {
      ...a,
      posts_count: snap?.posts_ig ?? null,
      posts_in_db: inDb,
      video_count: inDb,
      followers_latest: snap?.followers ?? null,
      status: {
        scrape_active: isActive,
        last_run_status: run?.status ?? null,
        last_run_started_at: run?.started_at ?? null,
        last_run_error: run?.error ?? null,
        pending_analysis: pendingMap.get(a.username) ?? 0,
      },
    };
  });

  // Sort star first (defensive: reads account_role optional chain, treats
  // missing column as null). Pinned tier is already enforced at the SQL
  // level. This is a stable JS sort, so within each tier the alphabetical
  // order from the SQL query is preserved.
  augmented.sort((a, b) => {
    const aStar = a.account_role === "star" ? 0 : 1;
    const bStar = b.account_role === "star" ? 0 : 1;
    return aStar - bStar;
  });

  return NextResponse.json({ accounts: augmented });
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
  // Insert-or-undelete without clobbering existing flags. An UPSERT would
  // overwrite is_pinned with whatever the caller sent (or `false` by default),
  // silently un-pinning an account that the user re-typed in the verify form.
  const { data: existing } = await sb
    .from("accounts")
    .select("username, is_pinned, deleted_at")
    .eq("username", username)
    .maybeSingle();

  if (!existing) {
    const { error } = await sb.from("accounts").insert({
      username,
      is_pinned: Boolean(body.is_pinned),
    });
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    // Only touch is_pinned if the caller explicitly provided it.
    const update: Record<string, unknown> = { deleted_at: null };
    if (typeof body.is_pinned === "boolean") update.is_pinned = body.is_pinned;
    const { error } = await sb
      .from("accounts")
      .update(update)
      .eq("username", username);
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, username });
}
