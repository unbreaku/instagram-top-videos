import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");
const BOOTSTRAP_NAME = "0000_bootstrap";

interface MigrationStatus {
  name: string;
  applied_at: string | null;
  duration_ms: number | null;
  applies_via: "manual" | "auto";
}

interface MigrationResult {
  name: string;
  status: "skipped" | "applied" | "failed";
  duration_ms?: number;
  error?: string;
}

function listFiles(): string[] {
  try {
    return fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
  } catch (e) {
    throw new Error(
      `Cannot read ${MIGRATIONS_DIR}. Ensure supabase/migrations is bundled. (${
        e instanceof Error ? e.message : e
      })`,
    );
  }
}

async function bootstrapApplied(): Promise<boolean> {
  // The bootstrap creates the _migrations table itself, so to know whether
  // it's been run we have to attempt the read and treat the error as "no".
  const sb = getServerSupabase();
  const { error } = await sb.from("_migrations").select("name").limit(1);
  return !error;
}

/**
 * GET /api/migrate
 * Lists every migration file alongside whether it's been applied.
 * Does NOT execute anything.
 */
export async function GET() {
  let files: string[];
  try {
    files = listFiles();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  const ready = await bootstrapApplied();
  if (!ready) {
    return NextResponse.json({
      bootstrap_needed: true,
      migrations: files.map((f) => ({
        name: f.replace(/\.sql$/, ""),
        applied_at: null,
        duration_ms: null,
        applies_via: f === `${BOOTSTRAP_NAME}.sql` ? "manual" : "auto",
      })),
      instructions:
        `Antes de poder aplicar migraciones automáticamente: pega ` +
        `supabase/migrations/${BOOTSTRAP_NAME}.sql en el SQL Editor de ` +
        `Supabase y dale Run. Es por única vez por proyecto.`,
    });
  }

  const sb = getServerSupabase();
  const { data: applied } = await sb
    .from("_migrations")
    .select("name, applied_at, duration_ms");
  const appliedMap = new Map(
    (applied || []).map((r) => [
      r.name as string,
      { applied_at: r.applied_at as string, duration_ms: r.duration_ms as number | null },
    ]),
  );

  const migrations: MigrationStatus[] = files.map((f) => {
    const name = f.replace(/\.sql$/, "");
    const a = appliedMap.get(name);
    return {
      name,
      applied_at: a?.applied_at ?? null,
      duration_ms: a?.duration_ms ?? null,
      applies_via: name === BOOTSTRAP_NAME ? "manual" : "auto",
    };
  });

  return NextResponse.json({ bootstrap_needed: false, migrations });
}

/**
 * POST /api/migrate
 * Applies every pending migration (everything except 0000_bootstrap, which is
 * always manual) and records the result in the _migrations table.
 *
 * Idempotent: already-applied migrations are skipped. Migrations themselves
 * are written with `if not exists` / `drop ... if exists` patterns so re-runs
 * over a hand-applied schema do nothing destructive.
 */
export async function POST() {
  let files: string[];
  try {
    files = listFiles();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  const ready = await bootstrapApplied();
  if (!ready) {
    return NextResponse.json(
      {
        error:
          `Bootstrap missing. Pega supabase/migrations/${BOOTSTRAP_NAME}.sql ` +
          `en el SQL Editor de Supabase una vez y vuelve a intentar.`,
      },
      { status: 412 },
    );
  }

  const sb = getServerSupabase();
  const { data: applied } = await sb.from("_migrations").select("name");
  const appliedSet = new Set((applied || []).map((r) => r.name as string));

  const results: MigrationResult[] = [];
  for (const file of files) {
    const name = file.replace(/\.sql$/, "");
    if (name === BOOTSTRAP_NAME) {
      results.push({ name, status: "skipped" }); // bootstrap is manual-only
      continue;
    }
    if (appliedSet.has(name)) {
      results.push({ name, status: "skipped" });
      continue;
    }

    let sql: string;
    try {
      sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    } catch (e) {
      results.push({
        name,
        status: "failed",
        error: `Cannot read file: ${e instanceof Error ? e.message : e}`,
      });
      break;
    }

    const start = Date.now();
    const { error: execErr } = await sb.rpc("exec_sql", { sql });
    const ms = Date.now() - start;
    if (execErr) {
      results.push({
        name,
        status: "failed",
        duration_ms: ms,
        error: execErr.message,
      });
      // Stop on first failure — keeps migrations strictly in order.
      break;
    }

    const { error: trackErr } = await sb
      .from("_migrations")
      .insert({ name, duration_ms: ms });
    if (trackErr) {
      results.push({
        name,
        status: "failed",
        duration_ms: ms,
        error: `Applied but tracking insert failed: ${trackErr.message}`,
      });
      break;
    }

    results.push({ name, status: "applied", duration_ms: ms });
  }

  return NextResponse.json({ results });
}
