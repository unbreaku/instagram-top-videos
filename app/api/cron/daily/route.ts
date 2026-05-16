import { NextResponse } from "next/server";
import { runSync } from "@/lib/apify";
import { ingestApifyItems } from "@/lib/ingest";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// How many latest posts to fetch per pinned account daily. Kept small to
// minimize Apify spend; manual "Refrescar histórico completo" exists in the UI
// for full re-scrapes.
const DAILY_POSTS_PER_ACCOUNT = 10;

// Soft-deleted accounts older than this get hard-deleted by the cron.
const SOFT_DELETE_RETENTION_DAYS = 30;

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
  // Hard-delete soft-deleted accounts older than retention window. Cascades
  // handle videos/snapshots/runs automatically.
  const cutoff = new Date(
    Date.now() - SOFT_DELETE_RETENTION_DAYS * 86400 * 1000,
  ).toISOString();
  const { data: purged } = await sb
    .from("accounts")
    .delete()
    .lt("deleted_at", cutoff)
    .select("username");

  const { data: pinned } = await sb
    .from("accounts")
    .select("username")
    .eq("is_pinned", true)
    .is("deleted_at", null);

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
    purged_accounts: (purged || []).map((p) => p.username),
    results,
  });
}
