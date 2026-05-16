import { fetchDataset, getRunStatus } from "./apify";
import { ingestApifyItems } from "./ingest";
import { getServerSupabase } from "./supabase";

export interface SweepResult {
  swept: number;
  ingested: number;
  failed: number;
  details: Array<{
    run_id: string;
    account: string | null;
    status: string;
    videos_added?: number;
    videos_updated?: number;
    error?: string;
  }>;
}

/**
 * Reconciles every apify_runs row in a non-terminal state with what Apify
 * actually thinks. Ingests datasets that succeeded, marks failed runs failed.
 *
 * Time-boxed so it fits in a Vercel serverless invocation. Safe to call
 * repeatedly — already-finished runs are skipped immediately.
 */
export async function sweepStuckRuns(opts: {
  maxRuns?: number;
  deadlineMs?: number;
} = {}): Promise<SweepResult> {
  const sb = getServerSupabase();
  const maxRuns = opts.maxRuns ?? 10;
  const deadline = Date.now() + (opts.deadlineMs ?? 50_000);

  const { data: rows } = await sb
    .from("apify_runs")
    .select("*")
    .in("status", ["RUNNING", "READY"])
    .order("started_at", { ascending: true })
    .limit(maxRuns);

  const result: SweepResult = {
    swept: rows?.length ?? 0,
    ingested: 0,
    failed: 0,
    details: [],
  };

  for (const row of rows || []) {
    if (Date.now() > deadline) break;

    // Orphaned runs (account was hard-deleted between scrape kickoff and
    // ingest) can't go anywhere. Mark them failed and move on instead of
    // tripping a FK violation every sweep.
    if (!row.account_username) {
      await sb
        .from("apify_runs")
        .update({
          status: "FAILED",
          finished_at: new Date().toISOString(),
          error: "Account was deleted before the run could ingest.",
        })
        .eq("run_id", row.run_id);
      result.failed += 1;
      result.details.push({
        run_id: row.run_id,
        account: null,
        status: "FAILED",
        error: "orphan (account deleted)",
      });
      continue;
    }

    let live;
    try {
      live = await getRunStatus(row.run_id);
    } catch (e) {
      result.details.push({
        run_id: row.run_id,
        account: row.account_username,
        status: "POLL_ERROR",
        error: e instanceof Error ? e.message : String(e),
      });
      continue;
    }

    if (live.status === "RUNNING" || live.status === "READY") {
      // Still genuinely running on Apify — leave it for the next sweep.
      result.details.push({
        run_id: row.run_id,
        account: row.account_username,
        status: live.status,
      });
      continue;
    }

    if (live.status === "SUCCEEDED") {
      try {
        const items = await fetchDataset(row.dataset_id || "");
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
          .eq("run_id", row.run_id);
        result.ingested += 1;
        result.details.push({
          run_id: row.run_id,
          account: row.account_username,
          status: "SUCCEEDED",
          videos_added: ingest.videosAdded,
          videos_updated: ingest.videosUpdated,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await sb
          .from("apify_runs")
          .update({
            status: "FAILED",
            finished_at: new Date().toISOString(),
            error: msg,
          })
          .eq("run_id", row.run_id);
        result.failed += 1;
        result.details.push({
          run_id: row.run_id,
          account: row.account_username,
          status: "FAILED",
          error: msg,
        });
      }
    } else {
      // FAILED / ABORTED / TIMED-OUT
      await sb
        .from("apify_runs")
        .update({
          status: live.status,
          finished_at: new Date().toISOString(),
        })
        .eq("run_id", row.run_id);
      result.failed += 1;
      result.details.push({
        run_id: row.run_id,
        account: row.account_username,
        status: live.status,
      });
    }
  }

  return result;
}
