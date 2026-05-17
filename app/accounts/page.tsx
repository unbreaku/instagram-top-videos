"use client";

import { useEffect, useState } from "react";

interface Account {
  username: string;
  is_pinned: boolean;
  video_count: number;
  posts_count: number | null;
  posts_in_db: number;
  followers_latest: number | null;
  profile_pic_url?: string | null;
  display_name?: string | null;
  deleted_at?: string | null;
  status?: {
    scrape_active: boolean;
    last_run_status: string | null;
    last_run_started_at: string | null;
    last_run_error: string | null;
    pending_analysis: number;
  };
}

function ageMin(iso: string | null | undefined): number {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 60000;
}

interface MigrationStatus {
  name: string;
  applied_at: string | null;
  duration_ms: number | null;
  applies_via: "manual" | "auto";
}

interface MigrationListResponse {
  bootstrap_needed: boolean;
  migrations: MigrationStatus[];
  instructions?: string;
}

interface PreviewPost {
  shortcode: string;
  type: string | null;
  posted_at: string | null;
  thumbnail_url: string | null;
  url: string | null;
  views: number | null;
  likes: number | null;
}

interface PreviewResponse {
  username: string;
  display_name: string | null;
  bio: string | null;
  profile_pic_url: string | null;
  followers: number | null;
  following: number | null;
  posts_count: number | null;
  recent_posts: PreviewPost[];
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("es-ES").format(n);
}

function proxied(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  return `/api/proxy-image?url=${encodeURIComponent(url)}`;
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [newUsername, setNewUsername] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [addPinned, setAddPinned] = useState(true);
  const [progress, setProgress] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [migrations, setMigrations] = useState<MigrationListResponse | null>(
    null,
  );
  const [transcriptStats, setTranscriptStats] = useState<{
    totals: {
      videos_total: number;
      videos_with_audio: number;
      transcripts_done: number;
      transcripts_pending: number;
      transcripts_failed: number;
      estimated_cost_usd: number;
    };
    accounts: Array<{
      username: string;
      transcripts_done: number;
      transcripts_pending: number;
      transcripts_failed: number;
      estimated_minutes: number;
      estimated_cost_usd: number;
    }>;
    drain: {
      recent_analyses_window_min: number;
      recent_analyses: number;
      last_analyzed_at: string | null;
      is_active: boolean;
    };
  } | null>(null);
  // Last response from /api/analyze-drain, kept for in-page diagnostics so
  // the user doesn't need to open DevTools.
  const [lastDrainResponse, setLastDrainResponse] = useState<{
    processed?: number;
    remaining?: number | null;
    chained?: boolean;
    already_running?: boolean;
    message?: string;
    error?: string;
    results?: Array<{
      shortcode: string;
      account: string;
      ok: boolean;
      error?: string;
      skipped?: string;
    }>;
    at?: string; // when we received this response
  } | null>(null);

  async function refresh() {
    const res = await fetch("/api/accounts");
    const j = await res.json();
    setAccounts(j.accounts || []);
  }
  async function loadMigrations() {
    const res = await fetch("/api/migrate");
    const j = await res.json();
    setMigrations(j);
  }
  async function loadTranscriptStats() {
    try {
      const res = await fetch("/api/transcript-stats");
      const j = await res.json();
      setTranscriptStats(j);
    } catch {
      // non-fatal; panel just won't render.
    }
  }

  useEffect(() => {
    refresh();
    loadMigrations();
    loadTranscriptStats();
  }, []);

  // Poll-refresh while any background scrape is active so badges update on
  // their own without the user having to mash refresh.
  useEffect(() => {
    const anyActive = accounts.some((a) => a.status?.scrape_active);
    if (!anyActive) return;
    const id = setInterval(refresh, 15_000);
    return () => clearInterval(id);
  }, [accounts]);

  // Auto-poll the transcript stats while the drain chain is active, so the
  // user sees pending counts ticking down without manual reloads.
  useEffect(() => {
    if (!transcriptStats?.drain?.is_active) return;
    const id = setInterval(loadTranscriptStats, 8_000);
    return () => clearInterval(id);
  }, [transcriptStats?.drain?.is_active]);

  useEffect(() => {
    if (!openMenu) return;
    function onDoc() {
      setOpenMenu(null);
    }
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [openMenu]);

  // ---------- VERIFY + ADD FLOW ----------

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    const username = newUsername.replace(/^@/, "").trim().toLowerCase();
    if (!username) return;
    setVerifying(true);
    setVerifyError(null);
    setPreview(null);
    try {
      const res = await fetch("/api/accounts/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `Error ${res.status}`);
      setPreview(j);
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : String(err));
    } finally {
      setVerifying(false);
    }
  }

  function cancelPreview() {
    setPreview(null);
    setVerifyError(null);
    setNewUsername("");
  }

  async function pollScrape(runId: string): Promise<{ ok: boolean; msg: string }> {
    for (let tries = 0; tries < 120; tries++) {
      await new Promise((r) => setTimeout(r, 8_000));
      const sRes = await fetch(`/api/scrape-account/${runId}`);
      const s = await sRes.json();
      if (s.status === "SUCCEEDED") {
        return {
          ok: true,
          msg: `Scrape completo: ${s.videos_added ?? 0} nuevos, ${s.videos_updated ?? 0} actualizados.`,
        };
      }
      if (["FAILED", "ABORTED", "TIMED-OUT"].includes(s.status)) {
        return { ok: false, msg: `Scrape ${s.status}: ${s.error || ""}` };
      }
      setProgress(`Scrape en progreso (${s.status})…`);
    }
    return { ok: false, msg: "Scrape excedió timeout de espera." };
  }

  async function analyzeLoop(username: string) {
    let total = 0;
    let safety = 0;
    while (safety++ < 100) {
      setProgress(`Analizando lote (Deepgram + Claude)… ${total} procesados hasta ahora`);
      const r = await fetch(
        `/api/analyze-pending?account=${username}&batch=5`,
        { method: "POST" },
      );
      const j = await r.json();
      if (!r.ok) {
        setProgress(`Error en analyze: ${j.error || r.status}`);
        return;
      }
      total += j.processed || 0;
      if (!j.processed || j.processed === 0) break;
      if (j.remaining === 0) break;
    }
    setProgress(`Análisis terminado. Total procesados: ${total}.`);
  }

  async function confirmAdd() {
    if (!preview) return;
    setBusyAction("add");
    setProgress("Creando cuenta…");
    try {
      const r1 = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: preview.username, is_pinned: addPinned }),
      });
      const j1 = await r1.json();
      if (!r1.ok) throw new Error(j1.error || `Add ${r1.status}`);

      setProgress("Disparando scrape histórico completo (3–10 min)…");
      const r2 = await fetch("/api/scrape-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: preview.username }),
      });
      const j2 = await r2.json();
      if (!r2.ok) throw new Error(j2.error || `Scrape kickoff ${r2.status}`);

      const scrapeResult = await pollScrape(j2.run_id);
      if (!scrapeResult.ok) {
        setProgress(scrapeResult.msg);
      } else {
        setProgress(`${scrapeResult.msg} Iniciando análisis automático…`);
        await analyzeLoop(preview.username);
      }
      cancelPreview();
      refresh();
    } catch (err) {
      setProgress(`Error: ${err instanceof Error ? err.message : err}`);
    } finally {
      setBusyAction(null);
    }
  }

  // ---------- EXISTING ACCOUNT ACTIONS ----------

  async function togglePin(u: string, current: boolean) {
    setBusyAction(`pin-${u}`);
    await fetch(`/api/accounts/${u}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_pinned: !current }),
    });
    setBusyAction(null);
    refresh();
  }

  async function refreshRecent(u: string) {
    setOpenMenu(null);
    setBusyAction(`refresh-${u}`);
    setMsg(`Refrescando últimos 10 posts de @${u}…`);
    const res = await fetch("/api/refresh-account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: u, limit: 10 }),
    });
    const j = await res.json();
    setBusyAction(null);
    if (!res.ok) setMsg(`Error: ${j.error || res.status}`);
    else
      setMsg(
        `@${u}: ${j.videosAdded} nuevos, ${j.videosUpdated} actualizados (${j.postsTotal} posts totales).`,
      );
    refresh();
  }

  async function scrapeFullHistory(u: string) {
    setOpenMenu(null);
    setBusyAction(`scrape-${u}`);
    setMsg(`Scrape histórico iniciado para @${u}. Tarda 3–10 min.`);
    const res = await fetch("/api/scrape-account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: u }),
    });
    const j = await res.json();
    if (!res.ok) {
      setBusyAction(null);
      setMsg(j.error || `Error ${res.status}`);
      return;
    }
    const result = await pollScrape(j.run_id);
    setMsg(result.msg);
    if (result.ok) await analyzeLoop(u);
    setBusyAction(null);
    refresh();
  }

  async function softDelete(u: string) {
    setOpenMenu(null);
    if (
      !confirm(
        `Borrar @${u}? Los datos quedan retenidos 30 días por si quieres recuperarlos.`,
      )
    )
      return;
    setBusyAction(`del-${u}`);
    const res = await fetch(`/api/accounts/${u}`, { method: "DELETE" });
    const j = await res.json();
    setBusyAction(null);
    if (!res.ok) setMsg(`Error: ${j.error || res.status}`);
    else setMsg(`@${u} borrada (retención 30 días).`);
    refresh();
  }

  async function sweepRuns() {
    setBusyAction("sweep");
    setMsg("Reconciliando trabajos pendientes con Apify…");
    const res = await fetch("/api/sweep-runs", { method: "POST" });
    const j = await res.json();
    setBusyAction(null);
    if (!res.ok) setMsg(`Error: ${j.error || res.status}`);
    else
      setMsg(
        `Sweep: revisé ${j.swept}, ingerí ${j.ingested}, fallaron ${j.failed}.`,
      );
    refresh();
  }

  async function applyMigrations() {
    setBusyAction("migrate");
    setMsg("Aplicando migraciones pendientes…");
    const res = await fetch("/api/migrate", { method: "POST" });
    const j = await res.json();
    setBusyAction(null);
    if (!res.ok) setMsg(`Error: ${j.error || res.status}`);
    else {
      const applied = (j.results || []).filter(
        (r: { status: string }) => r.status === "applied",
      );
      const failed = (j.results || []).filter(
        (r: { status: string }) => r.status === "failed",
      );
      if (failed.length > 0)
        setMsg(
          `Migración falló en: ${failed.map((f: { name: string; error?: string }) => `${f.name} (${f.error || "?"})`).join(", ")}`,
        );
      else if (applied.length === 0) setMsg("Sin migraciones pendientes. Schema al día.");
      else
        setMsg(`Aplicadas: ${applied.map((a: { name: string }) => a.name).join(", ")}`);
    }
    loadMigrations();
  }

  async function hardDelete(u: string) {
    setOpenMenu(null);
    if (
      !confirm(
        `BORRADO PERMANENTE de @${u}. Esto elimina todos los videos, snapshots y análisis YA. ¿Seguro?`,
      )
    )
      return;
    setBusyAction(`del-${u}`);
    const res = await fetch(`/api/accounts/${u}?hard=1`, { method: "DELETE" });
    const j = await res.json();
    setBusyAction(null);
    if (!res.ok) setMsg(`Error: ${j.error || res.status}`);
    else setMsg(`@${u} eliminada permanentemente.`);
    refresh();
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-3xl font-bold tracking-tight">Cuentas</h1>
      <p className="mt-2 text-sm text-zinc-600">
        Agrega una cuenta. Primero te muestro un preview para que confirmes que
        es la correcta. Después scrapeo histórico y analizo automáticamente
        todos los videos con audio detectable.
      </p>

      {/* ADD FORM */}
      {!preview ? (
        <form
          onSubmit={verify}
          className="mt-6 flex gap-2 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm"
        >
          <input
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            placeholder="username (sin @)"
            className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
          />
          <button
            type="submit"
            disabled={verifying || !newUsername.trim()}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {verifying ? "Verificando…" : "Verificar"}
          </button>
        </form>
      ) : (
        <PreviewCard
          preview={preview}
          addPinned={addPinned}
          onTogglePinned={() => setAddPinned((v) => !v)}
          onCancel={cancelPreview}
          onConfirm={confirmAdd}
          busy={busyAction === "add"}
        />
      )}

      {verifyError && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {verifyError}
        </div>
      )}

      {progress && (
        <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
          {progress}
        </div>
      )}

      {msg && (
        <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700">
          {msg}
        </div>
      )}

      {/* SWEEP BUTTON */}
      {accounts.some(
        (a) => a.status?.scrape_active || (a.status?.pending_analysis ?? 0) > 0,
      ) && (
        <div className="mt-4 flex items-center justify-between rounded-md border border-blue-200 bg-blue-50 p-3 text-sm">
          <div className="text-blue-900">
            Hay trabajos en background. La página se refresca sola cada 15s.
          </div>
          <button
            onClick={sweepRuns}
            disabled={busyAction === "sweep"}
            className="rounded-md border border-blue-300 bg-white px-3 py-1.5 text-xs hover:bg-blue-100 disabled:opacity-50"
          >
            {busyAction === "sweep"
              ? "Sincronizando…"
              : "Sincronizar trabajos pendientes"}
          </button>
        </div>
      )}

      {/* EXISTING ACCOUNTS LIST */}
      <ul className="mt-6 divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white shadow-sm">
        {accounts.map((a) => (
          <li key={a.username} className="flex items-center gap-3 p-4">
            <button
              onClick={() => togglePin(a.username, a.is_pinned)}
              disabled={busyAction === `pin-${a.username}`}
              title={a.is_pinned ? "Quitar de fijadas" : "Fijar"}
              className={`text-lg ${a.is_pinned ? "text-amber-500" : "text-zinc-300 hover:text-zinc-500"}`}
            >
              ★
            </button>
            {a.profile_pic_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={proxied(a.profile_pic_url)}
                alt={a.username}
                className="h-10 w-10 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-200 text-xs text-zinc-500">
                ?
              </div>
            )}
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">@{a.username}</span>
                {a.status?.scrape_active && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-800"
                    title={`Scrape ${a.status.last_run_status} en Apify desde hace ${Math.round(ageMin(a.status.last_run_started_at))} min. Si pasaron > 10 min, dale a 'Sincronizar trabajos pendientes' arriba.`}
                  >
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-600" />
                    Scrapeando ({Math.round(ageMin(a.status.last_run_started_at))} min)
                  </span>
                )}
                {a.status &&
                  !a.status.scrape_active &&
                  a.status.pending_analysis > 0 && (
                    <span
                      className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800"
                      title="Videos con video_url y +5k vistas que aún no pasaron por Deepgram+Claude. El cron diario procesa 6 por cuenta; podés acelerar con 'Continuar analizando pendientes' en el menú •••."
                    >
                      {a.status.pending_analysis} sin analizar
                    </span>
                  )}
                {a.status?.last_run_status === "FAILED" && (
                  <span
                    className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-800"
                    title={a.status.last_run_error || "Último scrape falló"}
                  >
                    último scrape ✗
                  </span>
                )}
              </div>
              <div
                className="text-xs text-zinc-500"
                title={
                  a.posts_count != null && a.posts_in_db < a.posts_count
                    ? `Instagram reporta ${a.posts_count} posts. Tenemos ${a.posts_in_db} en BD (gap por techo del scraper).`
                    : undefined
                }
              >
                {fmt(a.posts_count ?? a.posts_in_db)} posts (IG)
                {a.posts_count != null && a.posts_in_db < a.posts_count && (
                  <span className="ml-1 text-zinc-400">
                    · {a.posts_in_db} en BD
                  </span>
                )}{" "}
                · {fmt(a.followers_latest)} followers
              </div>
            </div>

            {busyAction?.startsWith(`refresh-${a.username}`) ||
            busyAction?.startsWith(`scrape-${a.username}`) ||
            busyAction?.startsWith(`del-${a.username}`) ? (
              <span className="text-xs text-zinc-500">Trabajando…</span>
            ) : null}

            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenMenu(openMenu === a.username ? null : a.username);
                }}
                className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50"
                title="Acciones"
              >
                •••
              </button>
              {openMenu === a.username && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute right-0 z-10 mt-1 w-64 overflow-hidden rounded-md border border-zinc-200 bg-white shadow-lg"
                >
                  <button
                    onClick={() => refreshRecent(a.username)}
                    className="block w-full px-4 py-2 text-left text-sm hover:bg-zinc-50"
                  >
                    Refrescar últimos 10 posts
                  </button>
                  <button
                    onClick={() => scrapeFullHistory(a.username)}
                    className="block w-full px-4 py-2 text-left text-sm hover:bg-zinc-50"
                  >
                    Re-scrape histórico + re-analizar
                  </button>
                  <button
                    onClick={async () => {
                      setOpenMenu(null);
                      setBusyAction(`analyze-${a.username}`);
                      setMsg(
                        `Analizando backlog de @${a.username}… esto puede tardar minutos según cuántos quedan.`,
                      );
                      await analyzeLoop(a.username);
                      setBusyAction(null);
                      setMsg(progress || "Análisis completado");
                      refresh();
                    }}
                    className="block w-full px-4 py-2 text-left text-sm hover:bg-zinc-50"
                  >
                    Continuar analizando pendientes
                  </button>
                  <div className="border-t border-zinc-100" />
                  <button
                    onClick={() => softDelete(a.username)}
                    className="block w-full px-4 py-2 text-left text-sm text-amber-700 hover:bg-amber-50"
                  >
                    Borrar (retención 30 días)
                  </button>
                  <button
                    onClick={() => hardDelete(a.username)}
                    className="block w-full px-4 py-2 text-left text-sm text-red-700 hover:bg-red-50"
                  >
                    Borrar permanentemente
                  </button>
                </div>
              )}
            </div>
          </li>
        ))}
        {accounts.length === 0 && (
          <li className="p-6 text-center text-sm text-zinc-500">
            No hay cuentas aún.
          </li>
        )}
      </ul>

      {transcriptStats && (
        <section className="mt-12">
          <details className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm" open>
            <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-zinc-500">
              Estado de transcripts ·{" "}
              <span className="text-emerald-700">
                {transcriptStats.totals.transcripts_done} hechos
              </span>
              {" · "}
              <span className="text-amber-700">
                {transcriptStats.totals.transcripts_pending} pendientes
              </span>
              {transcriptStats.totals.transcripts_failed > 0 && (
                <>
                  {" · "}
                  <span className="text-red-700">
                    {transcriptStats.totals.transcripts_failed} fallidos
                  </span>
                </>
              )}
              {" · costo ~$"}
              {transcriptStats.totals.estimated_cost_usd.toFixed(2)} para limpiar pendientes
            </summary>
            <div className="mt-4 space-y-3">
              <p className="rounded-md bg-zinc-50 p-3 text-xs leading-relaxed text-zinc-600">
                Política activa: <strong>todos los videos de los últimos
                90 días, sin filtro de vistas mínimo</strong>. Los transcripts
                existentes no se vuelven a procesar (se leen de la BD).
                Costo = Deepgram $0.0058/min + Claude Haiku $0.0025/video.
              </p>
              {transcriptStats.drain?.is_active ? (
                <div className="flex items-center gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-3">
                  <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                  <div className="flex-1 text-sm text-emerald-900">
                    <strong>Drenando en background…</strong>{" "}
                    <span className="text-emerald-700">
                      {transcriptStats.drain.recent_analyses} videos analizados
                      en últimos {transcriptStats.drain.recent_analyses_window_min} min ·{" "}
                      {transcriptStats.totals.transcripts_pending} pendientes
                    </span>
                    <div className="mt-1 text-xs text-emerald-700">
                      Refrescando cada 8s. Podés cerrar esta pestaña — la
                      cadena sigue corriendo en Vercel hasta terminar.
                      {transcriptStats.drain.last_analyzed_at && (
                        <>
                          {" · Último: "}
                          {new Date(
                            transcriptStats.drain.last_analyzed_at,
                          ).toLocaleTimeString("es-ES", {
                            timeZone: "Europe/Madrid",
                          })}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                transcriptStats.totals.transcripts_pending > 0 && (
                  <div className="flex items-center gap-3">
                    <button
                      onClick={async () => {
                        setBusyAction("drain");
                        setMsg(
                          `Iniciando drenaje (${transcriptStats.totals.transcripts_pending} pendientes, ~$${transcriptStats.totals.estimated_cost_usd.toFixed(2)})…`,
                        );
                        try {
                          const r = await fetch("/api/analyze-drain", {
                            method: "POST",
                          });
                          const j = await r.json();
                          setLastDrainResponse({
                            ...j,
                            at: new Date().toISOString(),
                          });
                          if (j.already_running) {
                            setMsg(
                              "Ya hay un drenado en curso. El indicador verde aparecerá en ~30s y la página se va a auto-refrescar.",
                            );
                          } else if (r.ok) {
                            setMsg(
                              `Drenado arrancado. Lote inicial: ${j.processed} videos. La cadena sigue en background — esta página se va a auto-refrescar cada 8s.`,
                            );
                          } else {
                            setMsg(`Error: ${j.error || "desconocido"}`);
                          }
                          loadTranscriptStats();
                        } catch (e) {
                          setLastDrainResponse({
                            error: e instanceof Error ? e.message : String(e),
                            at: new Date().toISOString(),
                          });
                          setMsg(
                            `Error: ${e instanceof Error ? e.message : String(e)}`,
                          );
                        } finally {
                          setBusyAction(null);
                        }
                      }}
                      disabled={busyAction === "drain"}
                      className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                    >
                      {busyAction === "drain"
                        ? "Arrancando…"
                        : `Drenar ${transcriptStats.totals.transcripts_pending} pendientes ahora`}
                    </button>
                    <button
                      onClick={loadTranscriptStats}
                      className="rounded-md border border-zinc-300 px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-50"
                    >
                      Refrescar conteos
                    </button>
                  </div>
                )
              )}
              {lastDrainResponse && (
                <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs">
                  <div className="mb-2 font-semibold uppercase tracking-wide text-zinc-600">
                    Diagnóstico del último drenado ·{" "}
                    {lastDrainResponse.at &&
                      new Date(lastDrainResponse.at).toLocaleTimeString(
                        "es-ES",
                        { timeZone: "Europe/Madrid" },
                      )}
                  </div>
                  {lastDrainResponse.already_running ? (
                    <p className="text-amber-700">
                      ⚠ Backend respondió:{" "}
                      <strong>already_running</strong> — había una cadena viva,
                      no arrancó otra.
                    </p>
                  ) : lastDrainResponse.error ? (
                    <p className="text-red-700">
                      ❌ Error: <code>{lastDrainResponse.error}</code>
                    </p>
                  ) : (
                    <>
                      <p className="text-zinc-700">
                        Procesados en este lote:{" "}
                        <strong>{lastDrainResponse.processed ?? 0}</strong>{" "}
                        · Restantes:{" "}
                        <strong>
                          {lastDrainResponse.remaining ?? "?"}
                        </strong>{" "}
                        · Auto-chained:{" "}
                        <strong>{lastDrainResponse.chained ? "sí" : "no"}</strong>
                      </p>
                      {lastDrainResponse.results &&
                        lastDrainResponse.results.length > 0 && (
                          <ul className="mt-2 space-y-1">
                            {lastDrainResponse.results.map((r, i) => (
                              <li key={i} className="font-mono">
                                {r.ok ? "✅" : "❌"} @{r.account} / {r.shortcode}
                                {r.skipped && (
                                  <span className="ml-2 text-amber-700">
                                    [skipped: {r.skipped}]
                                  </span>
                                )}
                                {r.error && (
                                  <span className="ml-2 text-red-700">
                                    [{r.error.slice(0, 120)}]
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      {lastDrainResponse.processed === 0 &&
                        !lastDrainResponse.already_running && (
                          <p className="mt-2 text-amber-700">
                            ⚠ <strong>Cero videos procesados.</strong> Probables
                            causas: (a) ningún video matchea los filtros
                            (transcript IS NULL + video_url + posted_at &lt;= 90d
                            + attempts &lt; 3), (b) todos fallaron antes de
                            empezar. Mandame este texto y reviso.
                          </p>
                        )}
                    </>
                  )}
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                    <tr>
                      <th className="px-3 py-2">Cuenta</th>
                      <th className="px-3 py-2 text-right">Transcriptos</th>
                      <th className="px-3 py-2 text-right">Pendientes (90d)</th>
                      <th className="px-3 py-2 text-right">Fallidos</th>
                      <th className="px-3 py-2 text-right">Min audio</th>
                      <th className="px-3 py-2 text-right">Costo USD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transcriptStats.accounts.map((a) => (
                      <tr key={a.username} className="border-t border-zinc-100">
                        <td className="px-3 py-2 font-mono text-zinc-700">
                          @{a.username}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-emerald-700">
                          {a.transcripts_done}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-amber-700">
                          {a.transcripts_pending}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-red-700">
                          {a.transcripts_failed || "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-zinc-500">
                          {a.estimated_minutes.toFixed(1)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-zinc-900">
                          ${a.estimated_cost_usd.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-zinc-300 bg-zinc-50 font-semibold">
                      <td className="px-3 py-2 text-zinc-700">Total</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {transcriptStats.totals.transcripts_done}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {transcriptStats.totals.transcripts_pending}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {transcriptStats.totals.transcripts_failed || "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">—</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        ${transcriptStats.totals.estimated_cost_usd.toFixed(2)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </details>
        </section>
      )}

      {migrations && (
        <section className="mt-12">
          <details className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-zinc-500">
              Schema ·{" "}
              {
                migrations.migrations.filter(
                  (m) => !m.applied_at && m.applies_via === "auto",
                ).length
              }{" "}
              pendientes
            </summary>
            <div className="mt-4">
              {migrations.bootstrap_needed ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <strong>Setup inicial requerido.</strong>{" "}
                  {migrations.instructions || ""}
                </div>
              ) : (
                <button
                  onClick={applyMigrations}
                  disabled={busyAction === "migrate"}
                  className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
                >
                  {busyAction === "migrate" ? "Aplicando…" : "Aplicar migraciones pendientes"}
                </button>
              )}
              <ul className="mt-4 divide-y divide-zinc-100 text-sm">
                {migrations.migrations.map((m) => (
                  <li
                    key={m.name}
                    className="flex items-center justify-between py-2"
                  >
                    <span className="font-mono text-zinc-700">{m.name}</span>
                    <span className="text-xs text-zinc-500">
                      {m.applies_via === "manual" && !m.applied_at
                        ? "manual (bootstrap)"
                        : m.applied_at
                          ? `aplicada ${new Date(m.applied_at).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}${m.duration_ms ? ` · ${m.duration_ms}ms` : ""}`
                          : "pendiente"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </details>
        </section>
      )}
    </main>
  );
}

function PreviewCard({
  preview,
  addPinned,
  onTogglePinned,
  onCancel,
  onConfirm,
  busy,
}: {
  preview: PreviewResponse;
  addPinned: boolean;
  onTogglePinned: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  return (
    <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
        ¿Es esta la cuenta correcta?
      </h2>
      <div className="flex items-start gap-4">
        {preview.profile_pic_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={proxied(preview.profile_pic_url)}
            alt={preview.username}
            className="h-20 w-20 rounded-full object-cover shadow-inner"
          />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-zinc-200 text-zinc-500">
            ?
          </div>
        )}
        <div className="flex-1">
          <div className="text-lg font-semibold">
            @{preview.username}
            {preview.display_name && (
              <span className="ml-2 text-base font-normal text-zinc-600">
                · {preview.display_name}
              </span>
            )}
          </div>
          {preview.bio && (
            <p className="mt-1 whitespace-pre-line text-sm text-zinc-600">
              {preview.bio}
            </p>
          )}
          <div className="mt-2 grid grid-cols-3 gap-3 text-xs">
            <Stat label="Followers" value={fmt(preview.followers)} />
            <Stat label="Following" value={fmt(preview.following)} />
            <Stat label="Posts (IG)" value={fmt(preview.posts_count)} />
          </div>
        </div>
      </div>

      {preview.recent_posts.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
            Últimos posts
          </div>
          <div className="flex gap-2">
            {preview.recent_posts.map((p) => (
              <a
                key={p.shortcode}
                href={p.url || "#"}
                target="_blank"
                rel="noreferrer"
                className="block w-1/3 overflow-hidden rounded-md border border-zinc-200"
              >
                {p.thumbnail_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={proxied(p.thumbnail_url)}
                    alt={p.shortcode}
                    className="h-32 w-full object-cover"
                  />
                ) : (
                  <div className="flex h-32 w-full items-center justify-center bg-zinc-100 text-xs text-zinc-400">
                    sin preview
                  </div>
                )}
                <div className="p-1 text-[10px] text-zinc-500">
                  {p.type || "Post"} · {fmt(p.views)} vistas
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 flex items-center justify-between">
        <label className="inline-flex items-center gap-2 text-sm text-zinc-700">
          <input
            type="checkbox"
            checked={addPinned}
            onChange={onTogglePinned}
          />
          Fijar (el cron diario refrescará esta cuenta)
        </label>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm hover:bg-zinc-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {busy
              ? "Procesando…"
              : "Agregar, scrapear historial y analizar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-zinc-50 p-2">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}
