import { NextResponse } from "next/server";
import { runSync } from "@/lib/apify";
import { ingestApifyItems } from "@/lib/ingest";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const USERNAME_RE = /^[a-z0-9_.]{1,30}$/i;
const DEFAULT_LIMIT = 10;

/**
 * Synchronous "refresh latest N" scrape. Used by the UI's quick refresh
 * button. Same shape as a single iteration of the daily cron — pulls profile
 * data + last N posts, ingests, returns result.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    username?: string;
    limit?: number;
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
  const limit = Math.min(Math.max(Number(body.limit) || DEFAULT_LIMIT, 1), 50);

  const sb = getServerSupabase();
  await sb
    .from("accounts")
    .upsert({ username, deleted_at: null }, { onConflict: "username" });

  try {
    const items = await runSync(username, limit, true);
    const r = await ingestApifyItems(username, items);

    // Kick off the analyze drain for THIS account in the background. Brand-new
    // videos from this refresh land in the DB with analyzed_at=null and would
    // otherwise wait for tomorrow's cron. Fire-and-forget so the user's
    // refresh button returns immediately.
    try {
      const proto = req.headers.get("x-forwarded-proto") || "https";
      const host = req.headers.get("host");
      if (host && process.env.CRON_SECRET) {
        const drainUrl = new URL(
          `${proto}://${host}/api/analyze-drain?account=${encodeURIComponent(username)}`,
        );
        fetch(drainUrl.toString(), {
          method: "POST",
          headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
        }).catch(() => {});
      }
    } catch {
      // Drain trigger is best-effort — never let it break the refresh response.
    }

    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
