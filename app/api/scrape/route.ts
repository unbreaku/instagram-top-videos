import { NextResponse } from "next/server";

export const runtime = "nodejs";

// The legacy on-demand scraper has been replaced by per-account endpoints:
//   POST /api/scrape-account     — kick off a full-history scrape
//   GET  /api/scrape-account/:id — poll for status
//   GET  /api/accounts/:u/videos — read persisted results
//
// This handler stays as a redirect to keep old callers from 404ing.
export async function POST() {
  return NextResponse.json(
    {
      error:
        "Este endpoint cambió. Usa POST /api/scrape-account con { username }.",
    },
    { status: 410 },
  );
}

export async function GET() {
  return NextResponse.json(
    {
      error:
        "Este endpoint cambió. Usa GET /api/accounts/[username]/videos.",
    },
    { status: 410 },
  );
}
