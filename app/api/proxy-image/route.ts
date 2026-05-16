import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Only allow images from Instagram / Facebook CDN. Prevents the proxy from
// being abused as an open relay to arbitrary URLs.
function isAllowedHost(hostname: string): boolean {
  return (
    /(^|\.)cdninstagram\.com$/.test(hostname) ||
    /(^|\.)fbcdn\.net$/.test(hostname) ||
    hostname === "instagram.com" ||
    hostname === "www.instagram.com"
  );
}

/**
 * GET /api/proxy-image?url=<encoded Instagram CDN URL>
 *
 * Instagram CDN refuses direct hotlinking from third-party origins, which is
 * why the dashboard's <img src> was failing. We fetch server-side (no CORS
 * relevance) and stream the bytes back with aggressive caching. The host
 * allowlist prevents this from becoming an SSRF or open proxy.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const target = searchParams.get("url");
  if (!target) {
    return NextResponse.json({ error: "Missing url" }, { status: 400 });
  }
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return NextResponse.json({ error: "Bad protocol" }, { status: 400 });
  }
  if (!isAllowedHost(parsed.hostname)) {
    return NextResponse.json(
      { error: `Host not allowed: ${parsed.hostname}` },
      { status: 400 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(parsed.toString(), {
      headers: {
        // Pose as a real browser so Instagram returns the bytes.
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Fetch failed: ${e instanceof Error ? e.message : e}` },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    return NextResponse.json(
      { error: `Upstream ${upstream.status}` },
      { status: 502 },
    );
  }

  const ct = upstream.headers.get("content-type") || "image/jpeg";
  const buf = await upstream.arrayBuffer();
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": ct,
      // Long cache so we don't pay the round-trip on every page load. The CDN
      // URL itself rotates whenever the account refreshes, so freshness is
      // controlled at that level.
      "Cache-Control": "public, max-age=86400, s-maxage=86400, immutable",
    },
  });
}
