import { NextResponse } from "next/server";
import { analyzeOneVideo } from "@/lib/analyze";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Params {
  params: { shortcode: string };
}

/**
 * Manually trigger analysis for a single video.
 * Useful for debugging or when the user wants to re-analyze with `?force=1`.
 */
export async function POST(req: Request, { params }: Params) {
  const { searchParams } = new URL(req.url);
  const force = searchParams.get("force") === "1";
  const result = await analyzeOneVideo(params.shortcode, { force });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
