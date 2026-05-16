import { NextResponse } from "next/server";
import { fetchDataset, getRunStatus } from "@/lib/apify";
import { ingestApifyItems } from "@/lib/ingest";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Params {
  params: { runId: string };
}

/**
 * Polls Apify for run status. When the run succeeds, ingests dataset items
 * into the DB and marks the run row as finished. Idempotent: subsequent
 * polls after ingest return the row directly.
 */
export async function GET(_req: Request, { params }: Params) {
  const sb = getServerSupabase();
  const { runId } = params;

  const { data: row } = await sb
    .from("apify_runs")
    .select("*")
    .eq("run_id", runId)
    .maybeSingle();
  if (!row)
    return NextResponse.json({ error: "Run not found" }, { status: 404 });

  // If already finished, return cached info.
  if (row.status === "SUCCEEDED" || row.status === "FAILED") {
    return NextResponse.json({
      status: row.status,
      videos_added: row.videos_added,
      videos_updated: row.videos_updated,
      finished_at: row.finished_at,
      error: row.error,
    });
  }

  let live;
  try {
    live = await getRunStatus(runId);
  } catch (e) {
    return NextResponse.json(
      { status: row.status || "RUNNING", warning: String(e) },
      { status: 200 },
    );
  }

  if (live.status === "SUCCEEDED") {
    try {
      const items = await fetchDataset(row.dataset_id || "");
      const ingestResult = await ingestApifyItems(
        row.account_username || "",
        items,
      );
      await sb
        .from("apify_runs")
        .update({
          status: "SUCCEEDED",
          finished_at: new Date().toISOString(),
          videos_added: ingestResult.videosAdded,
          videos_updated: ingestResult.videosUpdated,
        })
        .eq("run_id", runId);
      return NextResponse.json({
        status: "SUCCEEDED",
        videos_added: ingestResult.videosAdded,
        videos_updated: ingestResult.videosUpdated,
      });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      await sb
        .from("apify_runs")
        .update({
          status: "FAILED",
          finished_at: new Date().toISOString(),
          error: errMsg,
        })
        .eq("run_id", runId);
      return NextResponse.json({ status: "FAILED", error: errMsg });
    }
  }

  if (
    live.status === "FAILED" ||
    live.status === "ABORTED" ||
    live.status === "TIMED-OUT"
  ) {
    await sb
      .from("apify_runs")
      .update({
        status: live.status,
        finished_at: new Date().toISOString(),
      })
      .eq("run_id", runId);
    return NextResponse.json({ status: live.status });
  }

  return NextResponse.json({ status: live.status });
}
