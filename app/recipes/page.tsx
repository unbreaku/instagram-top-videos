"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface Recipe {
  title: string;
  premise: string;
  format_suggestion: string;
  hook_template: string;
  why: string;
  confidence: number;
  source_guides: string[];
  format_tag: string | null;
}

interface GapAnalysis {
  star_top_format_tags: Array<{ tag: string; count: number; avg_views: number }>;
  guides_top_format_tags: Array<{ tag: string; count: number; avg_views: number }>;
  star_missing_tags: Array<{ tag: string; guide_avg_views: number; guide_count: number; guides: string[] }>;
  star_strong_tags: Array<{ tag: string; star_avg_views: number; star_count: number }>;
}

interface RecipesPayload {
  recipes: Recipe[];
  gap_analysis: GapAnalysis;
  generated_at: string;
  llm_model: string;
  star_post_count: number;
  guide_post_count: number;
}

interface ApiResponse {
  account: {
    username: string;
    display_name: string | null;
    profile_pic_url: string | null;
  };
  recipes: RecipesPayload | null;
  warning?: string | null;
}

interface ReadinessRow {
  username: string;
  pending: number;
  done: number;
}

function fmt(n: number): string {
  return new Intl.NumberFormat("es-ES").format(n);
}

function confidenceLabel(c: number): { color: string; label: string } {
  if (c >= 75)
    return {
      color: "bg-emerald-100 text-emerald-800 border-emerald-300",
      label: "Alta confianza",
    };
  if (c >= 50)
    return {
      color: "bg-amber-100 text-amber-800 border-amber-300",
      label: "Media confianza",
    };
  return {
    color: "bg-zinc-100 text-zinc-600 border-zinc-300",
    label: "Especulativa",
  };
}

export default function RecipesPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [starReadiness, setStarReadiness] = useState<ReadinessRow | null>(null);
  const [guideTotalPending, setGuideTotalPending] = useState(0);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [rRes, statsRes] = await Promise.all([
        fetch("/api/recipes"),
        fetch("/api/transcript-stats"),
      ]);
      const rJ = await rRes.json();
      const sJ = await statsRes.json();
      if (!rRes.ok) setError(rJ.error || `HTTP ${rRes.status}`);
      else setData(rJ);

      // Compute readiness: star block + guide soft warning
      if (statsRes.ok && rJ?.account?.username) {
        const me = (sJ.accounts ?? []).find(
          (a: { username: string }) => a.username === rJ.account.username,
        );
        if (me) {
          setStarReadiness({
            username: me.username,
            pending: me.transcripts_pending ?? 0,
            done: me.transcripts_done ?? 0,
          });
        }
        const guidesPending = (sJ.accounts ?? [])
          .filter((a: { username: string }) => a.username !== rJ.account.username)
          .reduce(
            (s: number, a: { transcripts_pending?: number }) =>
              s + (a.transcripts_pending ?? 0),
            0,
          );
        setGuideTotalPending(guidesPending);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function generate() {
    if (
      !confirm(
        "Generar nuevas recetas ahora.\n\n• Cruza el DNA de la estrella con patrones de los guides (top 200 posts estrella, top 400 guides 90d).\n• Costo: ~$1-2 de Sonnet.\n• Toma 30-60 segundos.\n\n¿Continuar?",
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/recipes", { method: "POST" });
      const j = await r.json();
      if (!r.ok) setError(j.error || `HTTP ${r.status}`);
      else setData(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading)
    return (
      <main className="mx-auto max-w-5xl px-4 py-10 text-sm text-zinc-500">
        Cargando recetas…
      </main>
    );

  if (error || !data) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10">
        <Link href="/" className="text-sm text-blue-600 hover:underline">
          ← Dashboard
        </Link>
        <h1 className="mt-4 text-2xl font-semibold">Recetas</h1>
        <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {error || "Necesitás una cuenta estrella con disección DNA. Andá a /accounts y /star primero."}
        </div>
      </main>
    );
  }

  const { account, recipes: payload } = data;

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <Link href="/" className="text-sm text-blue-600 hover:underline">
        ← Dashboard
      </Link>

      <header className="mt-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">
            Recetas para @{account.username}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Patrones que los guides usan exitosamente y que la estrella puede
            probar. Cada receta es un experimento accionable con evidencia.
          </p>
        </div>
        <button
          onClick={generate}
          disabled={busy || (starReadiness !== null && starReadiness.pending > 0)}
          title={
            starReadiness && starReadiness.pending > 0
              ? `Faltan ${starReadiness.pending} transcripts del star. Drená primero.`
              : undefined
          }
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Generando…" : payload ? "Regenerar recetas" : "Generar recetas ahora"}
        </button>
      </header>

      {/* READINESS gate */}
      {starReadiness && starReadiness.pending > 0 && (
        <section className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm">
          <p className="font-semibold text-amber-900">
            ⚠ Faltan {starReadiness.pending} transcripts de la cuenta estrella
          </p>
          <p className="mt-1 text-amber-800">
            Las recetas se construyen sobre el DNA del star. Sin esos transcripts el DNA queda parcial.{" "}
            <a href="/star" className="underline">
              Andá a /star
            </a>{" "}
            para drenarlos.
          </p>
        </section>
      )}
      {starReadiness?.pending === 0 && guideTotalPending > 0 && (
        <section className="mt-6 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600">
          ℹ {guideTotalPending} transcripts de guides pendientes. Las recetas
          funcionan igual pero la cobertura del análisis de gaps no es 100%.{" "}
          <a href="/accounts" className="underline">
            Drenar guides en /accounts
          </a>
          .
        </section>
      )}
      {payload && data?.warning && (
        <section className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          ⚠ {data.warning}
        </section>
      )}

      {!payload ? (
        <div className="mt-8 rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600">
          <p className="font-medium text-zinc-900">
            Todavía no se generaron recetas.
          </p>
          <p className="mt-2">
            Click &quot;Generar recetas ahora&quot;. Vamos a cruzar el DNA de
            @{account.username} con los patrones más fuertes de las cuentas
            guide.
          </p>
        </div>
      ) : (
        <>
          <p className="mt-4 text-[11px] text-zinc-500">
            Generado{" "}
            {new Date(payload.generated_at).toLocaleString("es-ES", {
              timeZone: "Europe/Madrid",
            })}{" "}
            · {payload.star_post_count} posts estrella +{" "}
            {payload.guide_post_count} posts guide · modelo {payload.llm_model}
          </p>

          {/* RECIPES */}
          <section className="mt-8 space-y-6">
            {payload.recipes.length === 0 && (
              <div className="rounded-md border border-zinc-200 bg-white p-6 text-sm text-zinc-500">
                El modelo no generó recetas. Probá regenerar o asegurate de
                tener más posts analizados con format_tags.
              </div>
            )}
            {payload.recipes.map((r, i) => {
              const cl = confidenceLabel(r.confidence);
              return (
                <article
                  key={i}
                  className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm"
                >
                  <header className="mb-3 flex items-start justify-between gap-4">
                    <div>
                      <div className="text-xs font-mono text-zinc-400">
                        Receta #{i + 1}
                      </div>
                      <h3 className="mt-1 text-lg font-semibold text-zinc-900">
                        {r.title}
                      </h3>
                    </div>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${cl.color}`}
                      title={`${r.confidence}/100`}
                    >
                      {cl.label} · {r.confidence}
                    </span>
                  </header>

                  <p className="text-sm italic text-zinc-700">{r.premise}</p>

                  <div className="mt-4 space-y-3">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                        Cómo hacerla
                      </div>
                      <p className="mt-1 text-sm text-zinc-800">
                        {r.format_suggestion}
                      </p>
                    </div>

                    <div className="rounded-md bg-amber-50 p-3">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                        Hook sugerido (en tu voz)
                      </div>
                      <p className="mt-1 text-sm font-medium text-amber-900">
                        🎣 &ldquo;{r.hook_template}&rdquo;
                      </p>
                    </div>

                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                        Por qué
                      </div>
                      <p className="mt-1 text-sm text-zinc-700">{r.why}</p>
                    </div>

                    {(r.source_guides.length > 0 || r.format_tag) && (
                      <div className="flex flex-wrap items-center gap-2 pt-2 text-[11px] text-zinc-500">
                        {r.format_tag && (
                          <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono">
                            {r.format_tag}
                          </span>
                        )}
                        {r.source_guides.length > 0 && (
                          <span>
                            Inspirado por:{" "}
                            {r.source_guides.map((g) => `@${g}`).join(", ")}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </section>

          {/* GAP ANALYSIS */}
          <section className="mt-12">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
              Datos duros que generaron las recetas
            </h2>

            <div className="mt-4 grid gap-6 md:grid-cols-2">
              <div className="rounded-xl border border-zinc-200 bg-white p-5">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-emerald-700">
                  ✓ Donde la estrella ya rinde
                </h3>
                {payload.gap_analysis.star_strong_tags.length === 0 ? (
                  <p className="text-sm text-zinc-500">
                    No hay format_tags donde la estrella rinda &gt;1.5× su
                    promedio. Quizás todavía es temprano para detectar
                    patrones.
                  </p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {payload.gap_analysis.star_strong_tags.map((t) => (
                      <li
                        key={t.tag}
                        className="flex items-center justify-between border-b border-zinc-100 pb-1 last:border-0"
                      >
                        <span className="font-mono text-zinc-800">{t.tag}</span>
                        <span className="text-xs text-zinc-500">
                          {t.star_count} posts · avg {fmt(t.star_avg_views)} views
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-xl border border-zinc-200 bg-white p-5">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-amber-700">
                  ⚡ Gaps: guides usan, estrella no
                </h3>
                {payload.gap_analysis.star_missing_tags.length === 0 ? (
                  <p className="text-sm text-zinc-500">
                    No hay gaps grandes: la estrella ya cubre los formatos
                    fuertes de los guides.
                  </p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {payload.gap_analysis.star_missing_tags
                      .slice(0, 10)
                      .map((t) => (
                        <li
                          key={t.tag}
                          className="border-b border-zinc-100 pb-2 last:border-0"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-zinc-800">
                              {t.tag}
                            </span>
                            <span className="text-xs text-zinc-500">
                              avg {fmt(t.guide_avg_views)} views
                            </span>
                          </div>
                          <div className="mt-0.5 text-[11px] text-zinc-500">
                            {t.guide_count} posts en{" "}
                            {t.guides.map((g) => `@${g}`).join(", ")}
                          </div>
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
