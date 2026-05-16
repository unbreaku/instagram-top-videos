import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: { username: string };
}

function clean(u: string): string {
  return u.replace(/^@/, "").trim().toLowerCase();
}

export async function GET(_req: Request, { params }: Params) {
  const sb = getServerSupabase();
  const username = clean(params.username);
  const [{ data: account }, { data: snapshots }] = await Promise.all([
    sb.from("accounts").select("*").eq("username", username).maybeSingle(),
    sb
      .from("account_snapshots")
      .select("captured_at, followers_count, posts_count, videos_count")
      .eq("account_username", username)
      .order("captured_at", { ascending: true }),
  ]);
  if (!account)
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  return NextResponse.json({ account, snapshots: snapshots || [] });
}

export async function PATCH(req: Request, { params }: Params) {
  const sb = getServerSupabase();
  const username = clean(params.username);
  const body = (await req.json().catch(() => ({}))) as {
    is_pinned?: boolean;
  };
  const update: Record<string, unknown> = {};
  if (typeof body.is_pinned === "boolean") update.is_pinned = body.is_pinned;
  if (Object.keys(update).length === 0)
    return NextResponse.json({ ok: true });
  const { error } = await sb
    .from("accounts")
    .update(update)
    .eq("username", username);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: Params) {
  const sb = getServerSupabase();
  const username = clean(params.username);
  const { error } = await sb
    .from("accounts")
    .delete()
    .eq("username", username);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
