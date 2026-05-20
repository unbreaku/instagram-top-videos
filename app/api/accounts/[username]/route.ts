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
    is_hidden?: boolean;
  };
  const update: Record<string, unknown> = {};
  if (typeof body.is_pinned === "boolean") update.is_pinned = body.is_pinned;
  // is_hidden is UI-only — the cron, snapshot capture, and drain pipelines
  // intentionally ignore it. So toggling 'Ocultar' on an account doesn't
  // affect data freshness, only what shows up in the dashboard.
  if (typeof body.is_hidden === "boolean") update.is_hidden = body.is_hidden;
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

/**
 * DELETE /api/accounts/[username]
 *
 *   default        → SOFT delete: sets deleted_at = now(). Daily cron hard-deletes
 *                    accounts whose deleted_at is older than 30 days.
 *   ?hard=1        → HARD delete immediately. Cascades wipe videos, snapshots, runs.
 *   ?restore=1     → undelete (clears deleted_at).
 */
export async function DELETE(req: Request, { params }: Params) {
  const sb = getServerSupabase();
  const username = clean(params.username);
  const { searchParams } = new URL(req.url);
  const hard = searchParams.get("hard") === "1";
  const restore = searchParams.get("restore") === "1";

  if (restore) {
    const { error } = await sb
      .from("accounts")
      .update({ deleted_at: null })
      .eq("username", username);
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, restored: true });
  }

  if (hard) {
    const { error } = await sb
      .from("accounts")
      .delete()
      .eq("username", username);
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, hard: true });
  }

  // Soft delete: keep data for 30 days so we can restore if needed.
  const { error } = await sb
    .from("accounts")
    .update({ deleted_at: new Date().toISOString(), is_pinned: false })
    .eq("username", username);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    ok: true,
    soft: true,
    note: "Datos retenidos 30 días. Usa ?hard=1 para borrar ya, o ?restore=1 para recuperar.",
  });
}
