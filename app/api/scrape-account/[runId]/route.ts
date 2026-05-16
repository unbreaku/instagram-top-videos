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

// If the run has been "RUNNING" longer than this, the dataset is almost
// certainly ready even if Apify's status endpoint hasn't caught up. We try
// the dataset fetch as a self-healing fallback so the user never needs to
// hit a "force" button.
const STUCK_RUNNING_THRESHOLD_MS = 4 * 60 * 1000;

/**
 * Polls Apify for run status. When the run reaches SUCCEEDED (or the dataset
 * is ready), ingests dataset items and marks the run finished. Idempotent.
 *
 * Self-healing: if Apify reports RUNNING for too long, we attempt the
 * dataset fetch directly. If items are present, we ingest and finalize the
 * row. This avoids manual recovery when Apify's status read is stale.
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

  // Already finished — return cached.
  if (row.status === "SUCCEEDED" || row.status === "FAILED") {
    return NextResponse.json({
      status: row.status,
      videos_added: row.videos_added,
      videos_updated: row.videos_updated,
      finished_at: row.finished_at,
      error: row.error,
    });
  }

  let liveStatus = "RUNNING";
  let liveError: string | null = null;
  try {
    liveStatus = (await getRunStatus(runId)).status;
  } catch (e) {
    liveError = e instanceof Error ? e.message : String(e);
  }

  const startedMs = row.started_at ? new Date(row.started_at).getTime() : 0;
  const ageMs = Date.now() - startedMs;
  const shouldAttemptIngest =
    liveStatus === "SUCCEEDED" || ageMs > STUCK_RUNNING_THRESHOLD_MS;

  if (shouldAttemptIngest) {
    try {
      const items = await fetchDataset(row.dataset_id || "");
      if (items.length === 0 && liveStatus !== "SUCCEEDED") {
        // Dataset empty AND status not done yet — really still running.
        return NextResponse.json({ status: liveStatus, items: 0 });
      }
      const ingest = await ingestApifyItems(
        row.account_username || "",
        items,
      );
      await sb
        .from("apify_runs")
        .update({
          status: "SUCCEEDED",
          finished_at: new Date().toISOString(),
          videos_added: ingest.videosAdded,
          videos_updated: ingest.videosUpdated,
        })
        .eq("run_id", runId);
      return NextResponse.json({
        status: "SUCCEEDED",
        videos_added: ingest.videosAdded,
        videos_updated: ingest.videosUpdated,
        items: items.length,
        recovered: liveStatus !== "SUCCEEDED" ? true : undefined,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // If Apify says SUCCEEDED but dataset fails, mark FAILED.
      if (liveStatus === "SUCCEEDED") {
        await sb
          .from("apify_runs")
          .update({
            status: "FAILED",
            finished_at: new Date().toISOString(),
            error: msg,
          })
          .eq("run_id", runId);
        return NextResponse.json({ status: "FAILED", error: msg });
      }
      // Otherwise (we were just trying to recover), keep it as RUNNING; the
      // next poll will retry.
      return NextResponse.json({
        status: liveStatus,
        warning: `recovery attempt failed: ${msg}`,
      });
    }
  }

  if (
    liveStatus === "FAILED" ||
    liveStatus === "ABORTED" ||
    liveStatus === "TIMED-OUT"
  ) {
    await sb
      .from("apify_runs")
      .update({
        status: liveStatus,
        finished_at: new Date().toISOString(),
        error: liveError,
      })
      .eq("run_id", runId);
    return NextResponse.json({ status: liveStatus });
  }

  return NextResponse.json({
    status: liveStatus,
    ...(liveError ? { warning: liveError } : {}),
  });
}
