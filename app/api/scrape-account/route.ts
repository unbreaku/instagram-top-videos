import { NextResponse } from "next/server";
import { startRun } from "@/lib/apify";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const USERNAME_RE = /^[a-z0-9_.]{1,30}$/i;
// How many posts to ask Apify to scrape. ~5k covers most creators' lifetime.
const HISTORY_LIMIT = 5000;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { username?: string };
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
  // Make sure the account exists.
  await sb.from("accounts").upsert({ username }, { onConflict: "username" });

  try {
    const { runId, datasetId } = await startRun(
      username,
      HISTORY_LIMIT,
      true,
    );
    await sb.from("apify_runs").insert({
      run_id: runId,
      account_username: username,
      kind: "full_history",
      status: "RUNNING",
      dataset_id: datasetId,
    });
    return NextResponse.json({ run_id: runId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
