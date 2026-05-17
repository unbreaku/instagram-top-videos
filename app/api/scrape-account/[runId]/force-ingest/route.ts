import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Removed by policy: the system should heal itself, not depend on a "force"
// button. /api/sweep-runs (manual) and the daily cron's sweepStuckRuns() call
// reconcile any in-flight Apify run automatically.
//
// Kept as a 410 stub so older clients get a clean error instead of crashing.
export async function POST() {
  return NextResponse.json(
    {
      error:
        "Este endpoint fue removido. Las ingestas atascadas se reconcilian solas via /api/sweep-runs o el cron diario.",
    },
    { status: 410 },
  );
}
