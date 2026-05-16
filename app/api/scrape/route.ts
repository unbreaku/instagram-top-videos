import { NextResponse } from "next/server";
import { scrapeTopVideosForAccount } from "@/lib/apify";
import type { ScrapeRequest, ScrapeResponse, VideoRow } from "@/lib/types";

// Apify sync calls can take up to ~5 min. On Vercel, this requires a Pro plan
// for true long-running requests; on the Hobby plan we cap at 60s and the
// route may timeout for very large accounts. The actor itself keeps running.
export const maxDuration = 300;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseUsernames(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const clean = raw.replace(/^@/, "").trim().toLowerCase();
    if (!clean) continue;
    // Instagram usernames: letters, numbers, underscores, periods, up to 30 chars
    if (!/^[a-z0-9_.]{1,30}$/i.test(clean)) continue;
    if (seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out.slice(0, 10); // hard cap to protect Apify spend
}

export async function POST(req: Request) {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) {
    return NextResponse.json(
      {
        error:
          "APIFY_API_TOKEN no está configurado. Agrégalo en Vercel → Project Settings → Environment Variables (o en .env.local para correr localmente).",
      },
      { status: 500 },
    );
  }

  let body: ScrapeRequest;
  try {
    body = (await req.json()) as ScrapeRequest;
  } catch {
    return NextResponse.json(
      { error: "Body inválido: se esperaba JSON." },
      { status: 400 },
    );
  }

  const usernames = parseUsernames(body.usernames);
  if (usernames.length === 0) {
    return NextResponse.json(
      {
        error:
          "No se reconoció ninguna cuenta. Manda un array `usernames` con handles válidos (sin el @).",
      },
      { status: 400 },
    );
  }

  const topN = Math.min(Math.max(body.topN ?? 20, 1), 50);
  const resultsLimit = Math.max(
    topN,
    Number(process.env.APIFY_RESULTS_LIMIT ?? 80),
  );

  // Run accounts in parallel to keep total wall-time low.
  const settled = await Promise.allSettled(
    usernames.map((u) =>
      scrapeTopVideosForAccount(u, {
        topN,
        resultsLimit,
        apiToken: token,
      }),
    ),
  );

  const results: VideoRow[] = [];
  const perAccount: ScrapeResponse["perAccount"] = [];

  settled.forEach((r, i) => {
    const username = usernames[i];
    if (r.status === "fulfilled") {
      results.push(...r.value);
      perAccount.push({ username, videoCount: r.value.length });
    } else {
      perAccount.push({
        username,
        videoCount: 0,
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      });
    }
  });

  // Default sort: views descending across all accounts.
  results.sort((a, b) => b.views - a.views);

  const payload: ScrapeResponse = {
    results,
    perAccount,
    fetchedAt: new Date().toISOString(),
  };
  return NextResponse.json(payload);
}
