import { NextResponse } from "next/server";
import { sweepStuckRuns } from "@/lib/sweep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Reconciles all in-flight Apify runs without depending on the user keeping
 * a page open. Used by:
 *   - the manual ••• → "Sincronizar trabajos pendientes" button
 *   - the daily cron (which also calls sweepStuckRuns())
 *
 * Auth: same gate as the other mutating endpoints (OWNER_PASSWORD cookie).
 */
export async function POST() {
  const result = await sweepStuckRuns({ maxRuns: 15, deadlineMs: 50_000 });
  return NextResponse.json(result);
}
