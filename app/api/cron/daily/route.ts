import { NextResponse } from "next/server";
import { runSync } from "@/lib/apify";
import { ingestApifyItems } from "@/lib/ingest";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// How many latest posts to fetch per pinned account daily.
// Small enough to fit within Vercel Hobby's 60s function timeout.
const DAILY_POSTS_PER_ACCOUNT = 30;

/**
 * Vercel cron entrypoint. Configured in vercel.json to run once daily.
 * Iterates the pinned accounts and pulls the latest N posts to keep
 * follower counts and per-video metrics fresh.
 *
 * Auth: Vercel adds `Authorization: Bearer ${CRON_SECRET}` automatically.
 * We compare it to env to prevent the public from triggering scrapes.
 */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const expected = `Bearer ${process.env.CRON_SECRET || ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = getServerSupabase();
  const { data: pinned } = await sb
    .from("accounts")
    .select("username")
    .eq("is_pinned", true);

  const results: Array<{
    username: string;
    ok: boolean;
    added?: number;
    updated?: number;
    error?: string;
  }> = [];

  for (const { username } of pinned || []) {
    try {
      const items = await runSync(username, DAILY_POSTS_PER_ACCOUNT, true);
      const r = await ingestApifyItems(username, items);
      results.push({
        username,
        ok: true,
        added: r.videosAdded,
        updated: r.videosUpdated,
      });
    } catch (e) {
      results.push({
        username,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return NextResponse.json({
    ran_at: new Date().toISOString(),
    results,
  });
}
