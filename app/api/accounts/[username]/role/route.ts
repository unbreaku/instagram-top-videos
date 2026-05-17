import { NextResponse } from "next/server";
import { startRun } from "@/lib/apify";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: { username: string };
}

// Apify's instagram-scraper actor caps at ~999 posts per account regardless
// of what we ask for. The historical scrape just uses the highest practical
// limit and lets Apify return whatever it can find.
const HISTORICAL_LIMIT = 999;

/**
 * POST /api/accounts/[username]/role
 *
 * Body: { role: 'star' | 'guide' | null }
 *
 * - Setting 'star' demotes any existing star to 'guide' (the partial unique
 *   index would otherwise fail, but we do it explicitly so the transition
 *   is observable).
 * - Setting 'star' also kicks off an ASYNC deep historical scrape via Apify
 *   (~999 posts) so the dissection pipeline has the whole corpus to work on.
 *   The /api/scrape-account polling route handles ingest when the run
 *   finishes.
 * - Setting 'guide' or null is a plain UPDATE; no scrape side-effect.
 */
export async function POST(req: Request, { params }: Params) {
  const sb = getServerSupabase();
  const username = params.username.replace(/^@/, "").trim().toLowerCase();
  const body = (await req.json().catch(() => ({}))) as {
    role?: "star" | "guide" | null;
  };
  const role = body.role ?? null;
  if (role !== null && role !== "star" && role !== "guide") {
    return NextResponse.json(
      { error: "role must be 'star', 'guide', or null" },
      { status: 400 },
    );
  }

  // Verify the account exists.
  const { data: account, error: accErr } = await sb
    .from("accounts")
    .select("username, account_role")
    .eq("username", username)
    .maybeSingle();
  if (accErr || !account) {
    return NextResponse.json({ error: "Cuenta no encontrada" }, { status: 404 });
  }

  // If promoting to star, demote any existing star first.
  let demoted: string | null = null;
  if (role === "star") {
    const { data: existing } = await sb
      .from("accounts")
      .select("username")
      .eq("account_role", "star")
      .neq("username", username)
      .maybeSingle();
    if (existing?.username) {
      demoted = existing.username;
      await sb
        .from("accounts")
        .update({ account_role: "guide" })
        .eq("username", demoted);
    }
  }

  // Apply the role change.
  const { error: updErr } = await sb
    .from("accounts")
    .update({ account_role: role })
    .eq("username", username);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  // Side-effect: when a star is set, fire an async historical scrape so the
  // dissection pipeline has full data. We don't await — the run ID gets
  // tracked in apify_runs and the client can poll via the existing
  // /api/scrape-account/[runId] endpoint.
  let scrape_run_id: string | null = null;
  if (role === "star") {
    try {
      const { runId, datasetId } = await startRun(
        username,
        HISTORICAL_LIMIT,
        true,
      );
      await sb.from("apify_runs").insert({
        run_id: runId,
        dataset_id: datasetId,
        account_username: username,
        status: "RUNNING",
        kind: "historical_star",
        started_at: new Date().toISOString(),
      });
      scrape_run_id = runId;
    } catch (e) {
      // Don't fail the role update if the scrape kickoff fails — user can
      // retry the scrape from the UI.
      console.error("star scrape kickoff failed:", e);
    }
  }

  return NextResponse.json({
    ok: true,
    username,
    role,
    demoted,
    scrape_run_id,
  });
}
