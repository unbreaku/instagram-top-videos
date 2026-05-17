import { NextRequest, NextResponse } from "next/server";

/**
 * Owner-only gate.
 *
 * Anything that *spends money* (Apify scrapes, Deepgram transcripts, Claude
 * analysis) or mutates account state goes through here. Public read endpoints
 * stay open so the dashboard and per-account views can be shared.
 *
 * Auth model: a single shared password set in env as OWNER_PASSWORD. The
 * /login page sets a cookie called `owner_token` to that value. We compare
 * with constant-time-ish equality on every protected request.
 *
 * If OWNER_PASSWORD isn't set, the gate is disabled (useful for local dev or
 * during initial setup). The /login page makes that clear.
 */

const PROTECTED_PAGES = ["/accounts"];

interface ApiRule {
  method: string;
  pathPrefix: string;
}
const PROTECTED_API: ApiRule[] = [
  { method: "POST", pathPrefix: "/api/accounts" },
  { method: "PATCH", pathPrefix: "/api/accounts/" },
  { method: "DELETE", pathPrefix: "/api/accounts/" },
  { method: "POST", pathPrefix: "/api/scrape-account" },
  // /api/scrape-account/[runId] is GET-only but does ingest + writes.
  // Without this rule any anonymous visitor could trigger Apify dataset
  // fetches + Supabase writes simply by guessing run IDs.
  { method: "GET", pathPrefix: "/api/scrape-account/" },
  { method: "POST", pathPrefix: "/api/refresh-account" },
  { method: "POST", pathPrefix: "/api/accounts/preview" },
  { method: "POST", pathPrefix: "/api/analyze-pending" },
  { method: "POST", pathPrefix: "/api/videos/" },
  { method: "POST", pathPrefix: "/api/migrate" },
  { method: "GET", pathPrefix: "/api/migrate" },
  { method: "POST", pathPrefix: "/api/sweep-runs" },
];

function eq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function middleware(req: NextRequest) {
  const password = process.env.OWNER_PASSWORD;
  // No password configured — gate disabled (legacy / dev mode).
  if (!password) return NextResponse.next();

  const cookie = req.cookies.get("owner_token")?.value ?? "";
  const isAuthed = cookie.length > 0 && eq(cookie, password);

  const path = req.nextUrl.pathname;
  const method = req.method.toUpperCase();

  // Cron route is auth'd separately via CRON_SECRET — let it pass through here.
  if (path.startsWith("/api/cron/")) return NextResponse.next();

  // Page protection.
  if (PROTECTED_PAGES.some((p) => path === p || path.startsWith(p + "/"))) {
    if (!isAuthed) {
      const loginUrl = new URL("/login", req.url);
      loginUrl.searchParams.set("returnTo", path);
      return NextResponse.redirect(loginUrl);
    }
  }

  // API protection.
  const matched = PROTECTED_API.find(
    (r) => r.method === method && path.startsWith(r.pathPrefix),
  );
  if (matched && !isAuthed) {
    return NextResponse.json(
      { error: "Auth required. Visit /login and enter the owner password." },
      { status: 401 },
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/accounts/:path*", "/api/:path*"],
};
