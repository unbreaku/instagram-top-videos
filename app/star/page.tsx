"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface StarDissection {
  voice: {
    tone: string;
    register: string;
    vocabulary_signature: string[];
    summary: string;
  };
  pillars: Array<{
    theme: string;
    percentage: number;
    sample_hooks: string[];
  }>;
  hooks: {
    patterns: string[];
    best_examples: Array<{ hook: string; views: number; shortcode: string }>;
  };
  ctas: {
    patterns: string[];
    coverage_percentage: number;
  };
  format_mix: {
    reels_pct: number;
    sidecar_pct: number;
    image_pct: number;
    other_pct: number;
  };
  cadence: {
    posts_per_week: number;
    total_posts_analyzed: number;
    window_days: number;
  };
  dna_summary: string;
  generated_at: string;
  source_post_count: number;
  llm_model: string;
}

interface ApiResponse {
  account: {
    username: string;
    display_name: string | null;
    profile_pic_url: string | null;
  };
  dissection: StarDissection | null;
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("es-ES").format(n);
}

function proxied(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  return `/api/proxy-image?url=${encodeURIComponent(url)}`;
}

export default function StarPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/star/dissect");
      const j = await r.json();
      if (!r.ok) setError(j.error || `HTTP ${r.status}`);
      else setData(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function runDissection() {
    if (
      !confirm(
        "Correr análisis DNA de la cuenta estrella ahora.\n\n• Llama a Claude Sonnet sobre el corpus completo (top 100 posts).\n• Costo: ~$0.50-$2.\n• Toma 30-60 segundos.\n\n¿Continuar?",
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/star/dissect", { method: "POST" });
      const j = await r.json();
      if (!r.ok) {
        setError(j.error || `HTTP ${r.status}`);
      } else {
        setData(j);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading)
    return (
      <main className="mx-auto max-w-5xl px-4 py-10 text-sm text-zinc-500">
        Cargando disección…
      </main>
    );

  if (error || !data) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10">
        <Link href="/" className="text-sm text-blue-600 hover:underline">
          ← Dashboard
        </Link>
        <h1 className="mt-4 text-2xl font-semibold">Cuenta estrella</h1>
        <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {error ||
            "No hay disección todavía. Asegurate de tener una cuenta marcada como ⭐ Estrella en /accounts."}
        </div>
        {data && (
          <button
            onClick={runDissection}
            disabled={busy}
            className="mt-4 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {busy ? "Analizando…" : "Correr análisis ahora"}
          </button>
        )}
      </main>
    );
  }

  const { account, dissection } = data;

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <Link href="/" className="text-sm text-blue-600 hover:underline">
        ← Dashboard
      </Link>

      <header className="mt-4 flex items-center gap-4">
        {account.profile_pic_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={proxied(account.profile_pic_url)}
            alt={account.username}
            className="h-16 w-16 rounded-full object-cover ring-2 ring-amber-400"
          />
        )}
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">@{account.username}</h1>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-900">
              ⭐ Estrella
            </span>
          </div>
          <p className="text-sm text-zinc-500">
            {account.display_name || "Cuenta estrella"} · Disección DNA
          </p>
        </div>
        <button
          onClick={runDissection}
          disabled={busy}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {busy ? "Analizando…" : dissection ? "Re-correr análisis" : "Correr análisis ahora"}
        </button>
      </header>

      {!dissection ? (
        <div className="mt-8 rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600">
          <p className="font-medium text-zinc-900">
            Todavía no se corrió la disección DNA.
          </p>
          <p className="mt-2">
            Hacé click en &quot;Correr análisis ahora&quot; arriba. Vamos a
            tomar los top 100 posts de @{account.username} y pasarlos por
            Claude Sonnet para extraer: voz, pilares temáticos, hooks
            recurrentes, CTAs, formato mix y cadence.
          </p>
        </div>
      ) : (
        <>
          {/* HEADLINE */}
          <section className="mt-8 rounded-xl border-2 border-amber-200 bg-gradient-to-br from-amber-50 to-white p-6">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-700">
              DNA Summary
            </h2>
            <p className="text-base leading-relaxed text-zinc-900">
              {dissection.dna_summary}
            </p>
            <p className="mt-3 text-[11px] text-zinc-500">
              Generado {new Date(dissection.generated_at).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })} · {dissection.source_post_count} posts analizados · modelo {dissection.llm_model}
            </p>
          </section>

          {/* VOICE */}
          <section className="mt-8 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-500">
              Voz
            </h2>
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <div className="text-xs text-zinc-500">Tono</div>
                <div className="mt-1 text-lg font-semibold text-zinc-900">
                  {dissection.voice.tone || "—"}
                </div>
              </div>
              <div className="md:col-span-2">
                <div className="text-xs text-zinc-500">Registro</div>
                <div className="mt-1 text-sm text-zinc-700">
                  {dissection.voice.register || "—"}
                </div>
              </div>
            </div>
            <div className="mt-4">
              <div className="text-xs text-zinc-500">Palabras-firma</div>
              {dissection.voice.vocabulary_signature.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {dissection.voice.vocabulary_signature.map((w) => (
                    <span
                      key={w}
                      className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-mono text-zinc-700"
                    >
                      {w}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-sm text-zinc-400">
                  Sin firma léxica distintiva detectada.
                </p>
              )}
            </div>
            <p className="mt-4 rounded-md bg-zinc-50 p-3 text-sm text-zinc-700">
              {dissection.voice.summary}
            </p>
          </section>

          {/* PILLARS */}
          <section className="mt-8 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-500">
              Pilares temáticos
            </h2>
            <ul className="space-y-4">
              {dissection.pillars.map((p, i) => (
                <li key={i}>
                  <div className="flex items-baseline justify-between">
                    <span className="font-semibold text-zinc-900">
                      {p.theme}
                    </span>
                    <span className="text-sm font-mono text-zinc-500">
                      {p.percentage}%
                    </span>
                  </div>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-zinc-100">
                    <div
                      className="h-full bg-amber-400"
                      style={{ width: `${p.percentage}%` }}
                    />
                  </div>
                  {p.sample_hooks.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-xs text-zinc-600">
                      {p.sample_hooks.map((h, j) => (
                        <li key={j} className="italic">
                          &ldquo;{h}&rdquo;
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </section>

          {/* HOOKS + CTAs */}
          <section className="mt-8 grid gap-6 md:grid-cols-2">
            <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-500">
                Patrones de hook
              </h2>
              <ul className="space-y-2 text-sm text-zinc-700">
                {dissection.hooks.patterns.map((p, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-amber-500">🎣</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
              {dissection.hooks.best_examples.length > 0 && (
                <>
                  <h3 className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                    Mejores hooks reales
                  </h3>
                  <ul className="space-y-2">
                    {dissection.hooks.best_examples.slice(0, 5).map((e) => (
                      <li
                        key={e.shortcode}
                        className="text-xs text-zinc-600"
                      >
                        <a
                          href={`https://www.instagram.com/p/${e.shortcode}/`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-600 hover:underline"
                        >
                          {fmt(e.views)} vistas
                        </a>{" "}
                        — &ldquo;{e.hook}&rdquo;
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-500">
                Patrones de CTA
              </h2>
              <p className="mb-3 text-xs text-zinc-500">
                ~{dissection.ctas.coverage_percentage}% de los posts tienen una
                CTA explícita.
              </p>
              <ul className="space-y-2 text-sm text-zinc-700">
                {dissection.ctas.patterns.map((p, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-emerald-500">→</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* FORMAT + CADENCE */}
          <section className="mt-8 grid gap-6 md:grid-cols-2">
            <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-500">
                Mix de formato
              </h2>
              <ul className="space-y-2 text-sm">
                {[
                  { label: "Reels / videos", pct: dissection.format_mix.reels_pct, color: "bg-blue-500" },
                  { label: "Sidecar (carruseles)", pct: dissection.format_mix.sidecar_pct, color: "bg-purple-500" },
                  { label: "Foto individual", pct: dissection.format_mix.image_pct, color: "bg-pink-500" },
                  { label: "Otro", pct: dissection.format_mix.other_pct, color: "bg-zinc-400" },
                ].map((f) => (
                  <li key={f.label}>
                    <div className="flex justify-between">
                      <span className="text-zinc-700">{f.label}</span>
                      <span className="font-mono text-zinc-500">{f.pct}%</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
                      <div
                        className={`h-full ${f.color}`}
                        style={{ width: `${f.pct}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-500">
                Cadence
              </h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-zinc-500">Posts / semana</div>
                  <div className="mt-1 text-3xl font-semibold text-zinc-900">
                    {dissection.cadence.posts_per_week}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500">Posts analizados</div>
                  <div className="mt-1 text-3xl font-semibold text-zinc-900">
                    {dissection.cadence.total_posts_analyzed}
                  </div>
                </div>
                <div className="col-span-2">
                  <div className="text-xs text-zinc-500">Período</div>
                  <div className="mt-1 text-sm text-zinc-700">
                    {dissection.cadence.window_days} días
                  </div>
                </div>
              </div>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
