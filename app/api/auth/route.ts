import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 30 day cookie. Adjust freely.
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export async function POST(req: Request) {
  const expected = process.env.OWNER_PASSWORD;
  if (!expected) {
    return NextResponse.json(
      { error: "OWNER_PASSWORD env var not set. Auth disabled." },
      { status: 500 },
    );
  }

  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body invalid" }, { status: 400 });
  }

  const got = (body.password || "").toString();
  if (got !== expected) {
    return NextResponse.json({ error: "Password incorrecto" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set("owner_token", got, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
  return res;
}

// Logout
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete("owner_token");
  return res;
}
