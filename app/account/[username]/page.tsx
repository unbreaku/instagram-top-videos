"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import { scoreLabel, scoreVideoForCopy, type ScoreBreakdown } from "@/lib/recommend";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface Video {
  shortcode: string;
  type: string | null;
  caption: string | null;
  posted_at: string | null;
  url: string;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  latest_views: number | null;
  latest_likes: number | null;
  latest_comments: number | null;
  hook: string | null;
  cta: string | null;
  format_tags: string[] | null;
  analyzed_at: string | null;
  transcript: string | null;
  estimated_followers: number | null;
}

interface Snapshot {
  captured_at: string;
  followers_count: number | null;
  posts_count: number | null;
  videos_count: number | null;
}

interface AccountDetail {
  account: {
    username: string;
    display_name: string | null;
    is_pinned: boolean;
    last_full_scrape_at: string | null;
    profile_pic_url?: string | null;
    bio?: string | null;
  };
  snapshots: Snapshot[];
}

interface DailyLift {
  date: string;
  followers: number;
  delta: number | null;
  videos: Array<{
    shortcode: string;
    url: string;
    type: string | null;
    posted_at: string;
    caption: string | null;
    hook: string | null;
    latest_views: number | null;
    latest_likes: number | null;
    latest_comments: number | null;
    impact: number;
    share: number;
    attributed_followers: number | null;
  }>;
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("es-ES").format(n);
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-ES", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    timeZone: "Europe/Madrid",
  });
}

function truncate(s: string, n = 100): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

type SortKey =
  | "views"
  | "likes"
  | "comments"
  | "posted"
  | "estimated_followers"
  | "score";

const TYPE_OPTIONS = ["Todos", "Reel", "Video", "IGTV", "Image", "Sidecar", "Other"];

interface FilterState {
  type: string;
  dateFrom: string;
  dateTo: string;
  minViews: number;
  minLikes: number;
  minComments: number;
  search: string;
  tags: string[]; // multi-select
  onlyAnalyzed: boolean;
  onlyWithVideo: boolean; // hide images / sidecars
  bestToCopy: boolean; // show only score >= 55 ("Recomendado" or better)
}

const EMPTY_FILTERS: FilterState = {
  type: "Todos",
  dateFrom: "",
  dateTo: "",
  minViews: 0,
  minLikes: 0,
  minComments: 0,
  search: "",
  tags: [],
  onlyAnalyzed: false,
  onlyWithVideo: false,
  bestToCopy: false,
};

export default function AccountPage({
  params,
}: {
  params: { username: string };
}) {
  const [detail, setDetail] = useState<AccountDetail | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [lifts, setLifts] = useState<DailyLift[]>([]);
  const [loading, setLoading] = useState(true);
  // Default to most-recent first so when the user opens an account they see
  // the new posts at the top (and notice today's data right away). They can
  // still click any column header to re-sort.
  const [sort, setSort] = useState<SortKey>("posted");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const [tagSearch, setTagSearch] = useState("");
  // Format tags that appear in 2+ creators — strong template signal.
  const [sharedTags, setSharedTags] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [aRes, vRes, lRes] = await Promise.all([
        fetch(`/api/accounts/${params.username}`),
        fetch(`/api/accounts/${params.username}/videos?sort=posted&limit=1000`),
        fetch(`/api/accounts/${params.username}/lifts`),
      ]);
      const a = await aRes.json();
      const v = await vRes.json();
      const l = await lRes.json();
      if (cancelled) return;
      setDetail(a);
      setVideos(v.videos || []);
      setLifts(l.lifts || []);
      setLoading(false);

      // Fire-and-forget the formats fetch to know which tags are shared across
      // creators. Used by the Best-to-Copy scorer.
      fetch("/api/formats")
        .then((r) => r.json())
        .then((j) => {
          if (cancelled) return;
          const set = new Set<string>();
          (j.shared_tags || []).forEach((t: { tag: string }) =>
            set.add(t.tag),
          );
          setSharedTags(set);
        })
        .catch(() => {});
    })();
    return () => {
      cancelled = true;
    };
  }, [params.username]);

  // Close tag dropdown on outside click.
  useEffect(() => {
    if (!tagDropdownOpen) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as HTMLElement;
      if (!t.closest?.("[data-tag-dropdown]")) setTagDropdownOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [tagDropdownOpen]);

  // Available tags inferred from the data — fed into the multi-select.
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const v of videos) (v.format_tags || []).forEach((t) => set.add(t));
    return [...set].sort();
  }, [videos]);

  // Pre-compute the Best-to-Copy score for every video — used both for sort
  // and for the dedicated column.
  const maxAccountViews = useMemo(
    () => Math.max(0, ...videos.map((v) => v.latest_views || 0)),
    [videos],
  );
  const scores = useMemo(() => {
    const m = new Map<string, ScoreBreakdown>();
    for (const v of videos) {
      m.set(v.shortcode, scoreVideoForCopy(v, maxAccountViews, sharedTags));
    }
    return m;
  }, [videos, maxAccountViews, sharedTags]);

  const filtered = useMemo(() => {
    const sLower = filters.search.toLowerCase().trim();
    const from = filters.dateFrom ? new Date(filters.dateFrom).getTime() : null;
    const to = filters.dateTo
      ? new Date(filters.dateTo).getTime() + 86400000
      : null;
    return videos.filter((v) => {
      if (filters.type !== "Todos" && (v.type || "Other") !== filters.type)
        return false;
      if (filters.onlyWithVideo && !["Reel", "Video", "IGTV"].includes(v.type || ""))
        return false;
      if (filters.onlyAnalyzed && !v.analyzed_at) return false;
      if (filters.minViews && (v.latest_views || 0) < filters.minViews)
        return false;
      if (filters.minLikes && (v.latest_likes || 0) < filters.minLikes)
        return false;
      if (filters.minComments && (v.latest_comments || 0) < filters.minComments)
        return false;
      if (v.posted_at) {
        const t = new Date(v.posted_at).getTime();
        if (from && t < from) return false;
        if (to && t > to) return false;
      } else if (from || to) {
        return false;
      }
      if (filters.tags.length > 0) {
        const vt = new Set(v.format_tags || []);
        if (!filters.tags.every((t) => vt.has(t))) return false;
      }
      if (filters.bestToCopy) {
        const s = scores.get(v.shortcode);
        if (!s || s.total < 55) return false;
      }
      if (sLower) {
        const hay = [
          v.caption,
          v.hook,
          v.cta,
          ...(v.format_tags || []),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(sLower)) return false;
      }
      return true;
    });
  }, [videos, filters, scores]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const arr = [...filtered];
    arr.sort((a, b) => {
      let av: number, bv: number;
      switch (sort) {
        case "posted":
          av = a.posted_at ? new Date(a.posted_at).getTime() : 0;
          bv = b.posted_at ? new Date(b.posted_at).getTime() : 0;
          break;
        case "likes":
          av = a.latest_likes || 0;
          bv = b.latest_likes || 0;
          break;
        case "comments":
          av = a.latest_comments || 0;
          bv = b.latest_comments || 0;
          break;
        case "estimated_followers":
          av = a.estimated_followers ?? -Infinity;
          bv = b.estimated_followers ?? -Infinity;
          break;
        case "score":
          av = scores.get(a.shortcode)?.total ?? -Infinity;
          bv = scores.get(b.shortcode)?.total ?? -Infinity;
          break;
        case "views":
        default:
          av = a.latest_views || 0;
          bv = b.latest_views || 0;
      }
      return (av - bv) * dir;
    });
    return arr;
  }, [filtered, sort, sortDir, scores]);

  function toggleSort(k: SortKey) {
    if (sort === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(k);
      setSortDir(k === "posted" ? "desc" : "desc");
    }
  }

  const chartData = useMemo(() => {
    if (!detail) return [];
    // Dedupe snapshots by Madrid calendar day — keep the latest snapshot
    // of each day. This protects against the historical situation where
    // multiple manual refreshes inflated the count of "days" in the chart.
    const dayFmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Madrid",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const byDay = new Map<
      string,
      { capturedAt: string; followers: number }
    >();
    for (const s of detail.snapshots) {
      if (typeof s.followers_count !== "number") continue;
      const day = dayFmt.format(new Date(s.captured_at));
      const prev = byDay.get(day);
      if (!prev || s.captured_at > prev.capturedAt) {
        byDay.set(day, {
          capturedAt: s.captured_at,
          followers: s.followers_count,
        });
      }
    }
    return [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => ({
        date: new Date(v.capturedAt).toLocaleDateString("es-ES", {
          month: "short",
          day: "2-digit",
          timeZone: "Europe/Madrid",
        }),
        followers: v.followers,
      }));
  }, [detail]);

  if (loading) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-10 text-sm text-zinc-500">
        Cargando @{params.username}…
      </main>
    );
  }

  if (!detail) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-10">
        <p className="text-sm text-red-600">Cuenta no encontrada.</p>
        <Link href="/" className="text-sm text-blue-600 hover:underline">
          ← Volver al dashboard
        </Link>
      </main>
    );
  }

  const visibleAttribTotal = sorted.reduce(
    (s, v) => s + (v.estimated_followers || 0),
    0,
  );

  return (
    <main className="mx-auto max-w-7xl px-4 py-10">
      <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-900">
        ← Dashboard
      </Link>
      <header className="mt-2 mb-8 flex items-start gap-4">
        {detail.account.profile_pic_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/proxy-image?url=${encodeURIComponent(detail.account.profile_pic_url)}`}
            alt={detail.account.username}
            className="h-16 w-16 rounded-full object-cover shadow-inner"
          />
        ) : null}
        <div className="flex-1">
          <h1 className="text-3xl font-bold tracking-tight">
            @{detail.account.username}
          </h1>
          {detail.account.display_name && (
            <p className="mt-1 text-zinc-600">{detail.account.display_name}</p>
          )}
        </div>
        <div className="text-right text-sm text-zinc-500">
          {(() => {
            const lastSnap = [...detail.snapshots]
              .filter((s) => typeof s.posts_count === "number")
              .sort((a, b) => b.captured_at.localeCompare(a.captured_at))[0];
            const ig = lastSnap?.posts_count ?? null;
            if (ig != null) {
              return (
                <>
                  <div className="text-base font-semibold text-zinc-900">
                    {fmt(ig)} posts (IG)
                  </div>
                  {videos.length < ig && (
                    <div
                      className="text-[11px] text-zinc-400"
                      title="Diferencia por techo de paginación del actor o posts archivados/fijados que IG cuenta pero no devuelve en su feed pública."
                    >
                      {fmt(videos.length)} en BD
                    </div>
                  )}
                </>
              );
            }
            return <>{fmt(videos.length)} posts en BD</>;
          })()}
        </div>
      </header>

      <Stats90d
        videos={videos}
        snapshots={detail.snapshots}
        chartData={chartData}
        totalInDb={videos.length}
      />


      {lifts.length > 1 && (
        <section className="mb-10">
          <details className="rounded-xl border border-zinc-200 bg-white shadow-sm">
            <summary className="cursor-pointer p-4 text-sm font-semibold uppercase tracking-wide text-zinc-500 hover:bg-zinc-50">
              Crecimiento diario · followers atribuidos ({lifts.length} días)
              <span className="ml-2 text-[10px] font-normal normal-case text-zinc-400">
                Click para expandir/cerrar
              </span>
            </summary>
            <div className="border-t border-zinc-100 p-4 space-y-3">
              <div className="rounded-lg bg-zinc-50 p-3 text-xs leading-relaxed text-zinc-700">
                <p className="mb-1 font-semibold text-zinc-800">
                  ¿Qué hace este panel?
                </p>
                <p className="mb-2">
                  Cada fila es <strong>un día calendario en horario Madrid</strong>.
                  Tomamos dos snapshots (ayer y hoy), calculamos Δ followers,
                  y lo repartimos entre los posts publicados en esa ventana
                  proporcional a su <strong>impacto</strong> (vistas + likes×5 +
                  comments×25 para videos; likes×25 + comments×100 para fotos).
                  Así una foto que sumó likes igual recibe parte del crédito,
                  no solo el reel con más vistas.
                </p>
                <p className="text-zinc-500">
                  <strong>—</strong> = sin medición (no hay snapshot previo, p.
                  ej. primer día de la cuenta) · <strong>0</strong> = post
                  publicado pero impacto marginal frente a los demás del día.
                </p>
              </div>
              <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
                <table className="w-full border-collapse text-sm">
                  <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                    <tr>
                      <th className="px-3 py-2">Fecha</th>
                      <th className="px-3 py-2 text-right">Followers</th>
                      <th className="px-3 py-2 text-right">Δ followers</th>
                      <th className="px-3 py-2">Reparto entre posts del día</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lifts.map((l) => (
                      <tr
                        key={l.date}
                        className="border-t border-zinc-100 align-top hover:bg-zinc-50"
                      >
                        <td className="whitespace-nowrap px-3 py-2 text-zinc-700">
                          {l.date}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {fmt(l.followers)}
                        </td>
                        <td
                          className={`px-3 py-2 text-right tabular-nums font-semibold ${
                            l.delta == null
                              ? "text-zinc-400"
                              : l.delta > 0
                                ? "text-emerald-700"
                                : l.delta < 0
                                  ? "text-red-700"
                                  : "text-zinc-600"
                          }`}
                        >
                          {l.delta == null
                            ? "—"
                            : `${l.delta > 0 ? "+" : ""}${fmt(l.delta)}`}
                        </td>
                        <td className="px-3 py-2">
                          {l.videos.length === 0 ? (
                            <span className="text-xs text-zinc-400">
                              ningún post publicado este día
                            </span>
                          ) : (
                            <ul className="space-y-1.5">
                              {l.videos.map((v) => {
                                const pct = Math.round(v.share * 100);
                                const att = v.attributed_followers;
                                return (
                                  <li
                                    key={v.shortcode}
                                    className="flex items-start gap-2 text-xs"
                                  >
                                    <span
                                      className={`shrink-0 rounded px-1.5 py-0.5 font-mono tabular-nums ${
                                        att == null
                                          ? "bg-zinc-100 text-zinc-400"
                                          : att > 0
                                            ? "bg-emerald-50 text-emerald-700"
                                            : att < 0
                                              ? "bg-red-50 text-red-700"
                                              : "bg-zinc-100 text-zinc-500"
                                      }`}
                                      title={`Impacto: ${fmt(v.impact)} (${pct}% del día)`}
                                    >
                                      {att == null
                                        ? "—"
                                        : `${att > 0 ? "+" : ""}${fmt(att)}`}
                                    </span>
                                    <span className="text-zinc-400">
                                      {pct}%
                                    </span>
                                    <a
                                      href={v.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-blue-600 hover:underline"
                                    >
                                      {v.type || "Post"} ·{" "}
                                      {v.latest_views == null
                                        ? "sin views"
                                        : `${fmt(v.latest_views)} vistas`}
                                      {" · "}
                                      {fmt(v.latest_likes)} likes
                                    </a>
                                    {v.hook && (
                                      <span className="text-zinc-600">
                                        — {v.hook.length > 80
                                          ? v.hook.slice(0, 79) + "…"
                                          : v.hook}
                                      </span>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </details>
        </section>
      )}

      <section>
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Posts ({sorted.length} de {videos.length})
          </h2>
        </div>

        <details className="mb-4 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <summary className="cursor-pointer text-sm font-semibold text-zinc-700">
            🏆 Cómo funciona el score Best to Copy
          </summary>
          <div className="mt-3 grid gap-3 text-xs text-zinc-700 sm:grid-cols-3">
            <div className="rounded-md bg-zinc-50 p-3">
              <div className="font-semibold text-zinc-900">
                1. Performance (peso 55%)
              </div>
              <div className="mt-1 text-zinc-600">
                vistas del post ÷ vistas del top de la cuenta. Así no
                penalizamos cuentas chicas — un Reel con 100k en una cuenta
                que máx llega a 120k es 0.83.
              </div>
            </div>
            <div className="rounded-md bg-zinc-50 p-3">
              <div className="font-semibold text-zinc-900">
                2. Reproducibilidad (peso 30%)
              </div>
              <div className="mt-1 text-zinc-600">
                Tiene transcript = 0.4 · hook = 0.3 · CTA = 0.2 · format_tags
                = 0.1. Sin estas piezas no sirve para copiar.
              </div>
            </div>
            <div className="rounded-md bg-zinc-50 p-3">
              <div className="font-semibold text-zinc-900">
                3. Validación cross-creator (peso 15%)
              </div>
              <div className="mt-1 text-zinc-600">
                % de sus format_tags que también usan OTRAS cuentas. Si
                varios creadores usan el mismo patrón = template real, no
                accidente.
              </div>
            </div>
          </div>
          <div className="mt-3 rounded-md bg-zinc-50 p-3 font-mono text-xs text-zinc-700">
            score = (0.55 × performance + 0.30 × reproducibilidad + 0.15 ×
            cross) × 100
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-[11px]">
            <span className="text-emerald-700">🏆 75+ Imperdible</span>
            <span className="text-emerald-600">✨ 55+ Recomendado</span>
            <span className="text-amber-700">👀 35+ Mirar</span>
            <span className="text-zinc-400">· &lt;35 Saltar</span>
          </div>
          <p className="mt-2 text-[11px] text-zinc-500">
            Hover sobre el número en la columna <em>Score copy</em> de cada
            fila te da el desglose exacto: cuánto aportó cada componente y
            qué le falta a ese post para subir.
          </p>
        </details>

        {/* FILTER PANEL */}
        <div className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col text-xs">
            <span className="mb-1 font-medium uppercase text-zinc-500">Tipo</span>
            <select
              value={filters.type}
              onChange={(e) =>
                setFilters({ ...filters, type: e.target.value })
              }
              className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
            >
              {TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-xs">
            <span className="mb-1 font-medium uppercase text-zinc-500">Desde</span>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) =>
                setFilters({ ...filters, dateFrom: e.target.value })
              }
              className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col text-xs">
            <span className="mb-1 font-medium uppercase text-zinc-500">Hasta</span>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) =>
                setFilters({ ...filters, dateTo: e.target.value })
              }
              className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col text-xs">
            <span className="mb-1 font-medium uppercase text-zinc-500">
              Buscar (caption · hook · CTA)
            </span>
            <input
              type="text"
              value={filters.search}
              onChange={(e) =>
                setFilters({ ...filters, search: e.target.value })
              }
              placeholder="palabra clave…"
              className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col text-xs">
            <span className="mb-1 font-medium uppercase text-zinc-500">
              Vistas mín
            </span>
            <input
              type="number"
              min={0}
              value={filters.minViews}
              onChange={(e) =>
                setFilters({ ...filters, minViews: Number(e.target.value) || 0 })
              }
              className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col text-xs">
            <span className="mb-1 font-medium uppercase text-zinc-500">
              Likes mín
            </span>
            <input
              type="number"
              min={0}
              value={filters.minLikes}
              onChange={(e) =>
                setFilters({ ...filters, minLikes: Number(e.target.value) || 0 })
              }
              className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col text-xs">
            <span className="mb-1 font-medium uppercase text-zinc-500">
              Comentarios mín
            </span>
            <input
              type="number"
              min={0}
              value={filters.minComments}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  minComments: Number(e.target.value) || 0,
                })
              }
              className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
            />
          </label>
          <div className="flex flex-col gap-1 text-xs">
            <span className="font-medium uppercase text-zinc-500">Misc</span>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={filters.onlyAnalyzed}
                onChange={(e) =>
                  setFilters({ ...filters, onlyAnalyzed: e.target.checked })
                }
              />
              <span>Solo analizados</span>
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={filters.onlyWithVideo}
                onChange={(e) =>
                  setFilters({ ...filters, onlyWithVideo: e.target.checked })
                }
              />
              <span>Solo videos (excluye fotos)</span>
            </label>
            <label
              className="inline-flex items-center gap-2 rounded bg-amber-50 px-1.5 py-0.5"
              title="Muestra solo posts con score ≥ 55: performance arriba del promedio + análisis completo (transcript+hook+CTA) + formato validado por otras cuentas."
            >
              <input
                type="checkbox"
                checked={filters.bestToCopy}
                onChange={(e) => {
                  setFilters({ ...filters, bestToCopy: e.target.checked });
                  if (e.target.checked) {
                    setSort("score");
                    setSortDir("desc");
                  }
                }}
              />
              <span className="font-medium text-amber-900">
                🏆 Best to copy (recomendados)
              </span>
            </label>
          </div>
          {allTags.length > 0 && (
            <div className="col-span-full" data-tag-dropdown>
              <span className="mb-1 block text-xs font-medium uppercase text-zinc-500">
                Format tags (todos los seleccionados deben estar)
              </span>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setTagDropdownOpen((v) => !v)}
                  className="flex w-full items-center justify-between rounded-md border border-zinc-300 bg-white px-3 py-2 text-left text-sm hover:bg-zinc-50"
                >
                  <span className="truncate">
                    {filters.tags.length === 0
                      ? "Cualquier formato"
                      : filters.tags.length <= 3
                        ? filters.tags.join(", ")
                        : `${filters.tags.length} seleccionados`}
                  </span>
                  <span className="ml-2 text-zinc-400">{tagDropdownOpen ? "▲" : "▼"}</span>
                </button>
                {tagDropdownOpen && (
                  <div className="absolute left-0 right-0 z-20 mt-1 max-h-80 overflow-hidden rounded-md border border-zinc-200 bg-white shadow-lg">
                    <div className="border-b border-zinc-100 p-2">
                      <input
                        type="text"
                        value={tagSearch}
                        onChange={(e) => setTagSearch(e.target.value)}
                        placeholder="Buscar formato…"
                        className="w-full rounded border border-zinc-200 px-2 py-1 text-xs focus:border-zinc-900 focus:outline-none"
                        autoFocus
                      />
                      <div className="mt-1 flex justify-between text-[10px] text-zinc-500">
                        <button
                          type="button"
                          onClick={() => setFilters({ ...filters, tags: [] })}
                          className="text-blue-600 hover:underline"
                          disabled={filters.tags.length === 0}
                        >
                          Limpiar selección ({filters.tags.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => setTagDropdownOpen(false)}
                          className="text-zinc-600 hover:underline"
                        >
                          Cerrar
                        </button>
                      </div>
                    </div>
                    <ul className="max-h-64 overflow-y-auto py-1 text-sm">
                      {allTags
                        .filter((t) =>
                          tagSearch
                            ? t.toLowerCase().includes(tagSearch.toLowerCase())
                            : true,
                        )
                        .map((t) => {
                          const checked = filters.tags.includes(t);
                          return (
                            <li key={t}>
                              <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-zinc-50">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() =>
                                    setFilters({
                                      ...filters,
                                      tags: checked
                                        ? filters.tags.filter((x) => x !== t)
                                        : [...filters.tags, t],
                                    })
                                  }
                                  className="h-3 w-3"
                                />
                                <span className="font-mono text-xs text-zinc-700">
                                  {t}
                                </span>
                              </label>
                            </li>
                          );
                        })}
                      {allTags.filter((t) =>
                        tagSearch
                          ? t.toLowerCase().includes(tagSearch.toLowerCase())
                          : true,
                      ).length === 0 && (
                        <li className="px-3 py-2 text-xs text-zinc-400">
                          Sin coincidencias.
                        </li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="col-span-full flex justify-between text-xs text-zinc-500">
            <span>
              Suma estimada de followers atribuidos al subset filtrado:{" "}
              <strong className="text-zinc-800">{fmt(visibleAttribTotal)}</strong>
            </span>
            <button
              onClick={() => setFilters(EMPTY_FILTERS)}
              className="text-blue-600 hover:underline"
            >
              Limpiar filtros
            </button>
          </div>
        </div>

        {sorted.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-600">
            Ningún post coincide con los filtros actuales.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <Th
                    label="Fecha"
                    k="posted"
                    sortKey={sort}
                    dir={sortDir}
                    onClick={toggleSort}
                  />
                  <th className="px-3 py-2">Tipo</th>
                  <Th
                    label="Vistas"
                    k="views"
                    sortKey={sort}
                    dir={sortDir}
                    onClick={toggleSort}
                    align="right"
                  />
                  <Th
                    label="Likes"
                    k="likes"
                    sortKey={sort}
                    dir={sortDir}
                    onClick={toggleSort}
                    align="right"
                  />
                  <Th
                    label="Coments"
                    k="comments"
                    sortKey={sort}
                    dir={sortDir}
                    onClick={toggleSort}
                    align="right"
                  />
                  <Th
                    label="Δ Followers est."
                    k="estimated_followers"
                    sortKey={sort}
                    dir={sortDir}
                    onClick={toggleSort}
                    align="right"
                  />
                  <Th
                    label="Score copy"
                    k="score"
                    sortKey={sort}
                    dir={sortDir}
                    onClick={toggleSort}
                    align="right"
                  />
                  <th className="px-3 py-2">Análisis / Caption</th>
                  <th className="px-3 py-2">Link</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((v) => {
                  const isOpen = expanded.has(v.shortcode);
                  const hasDetail =
                    !!v.transcript || !!v.hook || !!v.cta || !!v.caption;
                  return (
                    <React.Fragment key={v.shortcode}>
                      <tr className="border-t border-zinc-100 hover:bg-zinc-50">
                        <td className="whitespace-nowrap px-3 py-2 text-zinc-600">
                          {fmtDate(v.posted_at)}
                        </td>
                        <td className="px-3 py-2">{v.type || "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {fmt(v.latest_views)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {fmt(v.latest_likes)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {fmt(v.latest_comments)}
                        </td>
                        <td
                          className={`px-3 py-2 text-right tabular-nums ${
                            v.estimated_followers == null
                              ? "text-zinc-400"
                              : v.estimated_followers > 0
                                ? "text-emerald-700"
                                : v.estimated_followers < 0
                                  ? "text-red-700"
                                  : "text-zinc-600"
                          }`}
                          title={`Followers estimados que generó este post.
Reparto = Δ followers del día × (impacto del post / impacto total del día).
Impacto = vistas + likes×5 + comments×25 (videos) o likes×25 + comments×100 (fotos sin views).

Símbolos:
  +N  → recibió N followers
  0   → publicado en ventana medible pero impacto marginal
  —   → no medible (publicado antes del primer snapshot, o sin snapshot vecino)`}
                        >
                          {v.estimated_followers == null
                            ? "—"
                            : `${v.estimated_followers > 0 ? "+" : ""}${fmt(v.estimated_followers)}`}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {(() => {
                            const s = scores.get(v.shortcode);
                            if (!s) return <span className="text-zinc-400">—</span>;
                            const lbl = scoreLabel(s.total);
                            const tooltip = [
                              `Score: ${s.total}/100`,
                              `Performance: ${Math.round(s.performance * 100)}/100`,
                              `Reproducibilidad: ${Math.round(s.reproducibility * 100)}/100`,
                              `Validación cross-creator: ${Math.round(s.cross_creator * 100)}/100`,
                              "",
                              ...s.reasons.map((r) => `✓ ${r}`),
                              ...s.warnings.map((w) => `⚠ ${w}`),
                            ].join("\n");
                            return (
                              <span
                                className={`inline-flex items-center gap-1 tabular-nums ${lbl.color}`}
                                title={tooltip}
                              >
                                <span>{lbl.emoji}</span>
                                <span className="font-semibold">{s.total}</span>
                              </span>
                            );
                          })()}
                        </td>
                        <td
                          className="max-w-md px-3 py-2 text-zinc-700"
                          title={v.caption || ""}
                        >
                          {v.hook && (
                            <div className="mb-1 text-xs font-semibold text-zinc-900">
                              🎣 {v.hook}
                            </div>
                          )}
                          <div className="text-zinc-700">
                            {truncate(v.caption || "", 120)}
                          </div>
                          {v.cta && (
                            <div className="mt-1 text-xs italic text-zinc-600">
                              → {v.cta}
                            </div>
                          )}
                          {v.format_tags && v.format_tags.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {v.format_tags.map((t) => (
                                <span
                                  key={t}
                                  className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600"
                                >
                                  {t}
                                </span>
                              ))}
                            </div>
                          )}
                          {hasDetail && (
                            <button
                              type="button"
                              onClick={() => {
                                const next = new Set(expanded);
                                if (isOpen) next.delete(v.shortcode);
                                else next.add(v.shortcode);
                                setExpanded(next);
                              }}
                              className="mt-2 text-[11px] text-blue-600 hover:underline"
                            >
                              {isOpen ? "▲ Ocultar transcript" : "▼ Ver transcript / detalle"}
                            </button>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <a
                            href={v.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-600 hover:underline"
                          >
                            Ver
                          </a>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-zinc-50">
                          <td colSpan={9} className="px-3 py-4">
                            <div className="space-y-3 text-sm">
                              {v.hook && (
                                <Block label="Hook">{v.hook}</Block>
                              )}
                              {v.cta && (
                                <Block label="CTA">{v.cta}</Block>
                              )}
                              {v.caption && (
                                <Block label="Caption original">{v.caption}</Block>
                              )}
                              <Block label="Transcript">
                                {v.transcript ? (
                                  <span className="whitespace-pre-wrap">
                                    {v.transcript}
                                  </span>
                                ) : (
                                  <span className="text-zinc-400">
                                    Sin transcript. {v.analyzed_at
                                      ? "(El video probablemente no tiene audio detectable o el URL de Apify expiró antes de la transcripción.)"
                                      : "Dale 'Analizar pendientes' para procesarlo."}
                                  </span>
                                )}
                              </Block>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function Stats90d({
  videos,
  snapshots,
  chartData,
  totalInDb,
}: {
  videos: Video[];
  snapshots: Snapshot[];
  chartData: Array<{ date: string; followers: number | null }>;
  totalInDb: number;
}) {
  const cutoff = Date.now() - 90 * 86400 * 1000;
  const inWindow = videos.filter((v) => {
    if (!v.posted_at) return false;
    return new Date(v.posted_at).getTime() >= cutoff;
  });
  const totalViews = inWindow.reduce((s, v) => s + (v.latest_views || 0), 0);
  const totalLikes = inWindow.reduce((s, v) => s + (v.latest_likes || 0), 0);
  const totalComments = inWindow.reduce(
    (s, v) => s + (v.latest_comments || 0),
    0,
  );
  const postsPerDay = inWindow.length / 90;
  const avgViews = inWindow.length > 0 ? totalViews / inWindow.length : 0;
  const avgLikes = inWindow.length > 0 ? totalLikes / inWindow.length : 0;
  const engagementRate =
    totalViews > 0 ? ((totalLikes + totalComments) / totalViews) * 100 : 0;
  const topPost =
    inWindow.length > 0
      ? [...inWindow].sort(
          (a, b) => (b.latest_views || 0) - (a.latest_views || 0),
        )[0]
      : null;

  // Follower delta in window — use snapshots inside the window.
  const snaps = snapshots
    .filter((s) => typeof s.followers_count === "number")
    .sort((a, b) => a.captured_at.localeCompare(b.captured_at));
  const inWindowSnaps = snaps.filter(
    (s) => new Date(s.captured_at).getTime() >= cutoff,
  );
  let followerDelta: number | null = null;
  if (inWindowSnaps.length >= 2) {
    followerDelta =
      (inWindowSnaps[inWindowSnaps.length - 1].followers_count || 0) -
      (inWindowSnaps[0].followers_count || 0);
  }

  // Most recent snapshot's posts_count reflects what Instagram itself reports
  // on the profile header (includes archived/pinned items some scrapers miss).
  const lastSnap = snaps[snaps.length - 1];
  const igPostsCount = lastSnap?.posts_count ?? null;
  const gap =
    typeof igPostsCount === "number" ? igPostsCount - totalInDb : null;

  return (
    <section className="mb-10 grid gap-6 lg:grid-cols-3">
      {chartData.length >= 1 ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm lg:col-span-2">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
              Crecimiento de followers
            </h2>
            {chartData.length === 1 ? (
              <div className="text-right text-xs">
                <div className="text-zinc-900 font-semibold">
                  {fmt(chartData[0].followers || 0)}
                </div>
                <div className="text-zinc-500">
                  primer día capturado — vuelve mañana para ver Δ
                </div>
              </div>
            ) : (() => {
              const first = chartData[0].followers || 0;
              const last = chartData[chartData.length - 1].followers || 0;
              const delta = last - first;
              return (
                <div className="text-right text-xs">
                  <div className="text-zinc-500">
                    {fmt(first)} → <strong className="text-zinc-900">{fmt(last)}</strong>
                  </div>
                  <div
                    className={
                      delta > 0
                        ? "text-emerald-700"
                        : delta < 0
                          ? "text-red-700"
                          : "text-zinc-500"
                    }
                  >
                    {delta > 0 ? "+" : ""}
                    {fmt(delta)} en {chartData.length} días
                  </div>
                </div>
              );
            })()}
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#f1f5f9" strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  width={56}
                  // Auto-zoom to the data range with a small margin so daily
                  // changes of ±200 over a 700k baseline are actually visible
                  // (the default 0-base scale made the line look flat).
                  domain={[
                    (dataMin: number) => Math.floor(dataMin * 0.999),
                    (dataMax: number) => Math.ceil(dataMax * 1.001),
                  ]}
                  tickFormatter={(v) =>
                    new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(v as number)
                  }
                />
                <Tooltip
                  formatter={(v: number) => [fmt(v), "Followers"]}
                  labelClassName="text-xs"
                />
                <Line
                  type="monotone"
                  dataKey="followers"
                  stroke="#0ea5e9"
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: "#0ea5e9", strokeWidth: 0 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-[11px] text-zinc-500">
            Cada punto = snapshot del cron diario. El eje Y está auto-zooomeado
            al rango de tu cuenta para que veas variaciones chicas.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-zinc-300 p-4 text-center text-xs text-zinc-500 lg:col-span-2">
          Sin snapshots todavía. Refrescá la cuenta o esperá al cron diario.
        </div>
      )}

      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Últimos 90 días
        </h2>
        <p className="mb-3 text-[10px] text-zinc-500">
          Pasa el cursor sobre cada label para ver cómo se calcula.
        </p>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <Stat90
            label="Posts"
            value={fmt(inWindow.length)}
            formula="cuenta videos + fotos + carruseles"
          />
          <Stat90
            label="Posts / día"
            value={postsPerDay.toFixed(1)}
            formula="posts ÷ 90"
          />
          <Stat90
            label="Δ Followers"
            value={
              followerDelta == null
                ? "—"
                : `${followerDelta > 0 ? "+" : ""}${fmt(followerDelta)}`
            }
            positive={followerDelta != null ? followerDelta > 0 : undefined}
            formula="último snap − primer snap"
          />
          <Stat90
            label="Engagement"
            value={`${engagementRate.toFixed(2)}%`}
            formula="(likes + comments) ÷ vistas × 100"
          />
          <Stat90
            label="Vistas totales"
            value={fmt(totalViews)}
            formula="Σ vistas de cada post"
          />
          <Stat90
            label="Vistas / post"
            value={fmt(Math.round(avgViews))}
            formula="vistas ÷ posts"
          />
          <Stat90
            label="Likes totales"
            value={fmt(totalLikes)}
            formula="Σ likes de cada post"
          />
          <Stat90
            label="Likes / post"
            value={fmt(Math.round(avgLikes))}
            formula="likes ÷ posts"
          />
        </dl>
        {topPost && (
          <div className="mt-3 border-t border-zinc-100 pt-3 text-xs">
            <div className="text-zinc-500">Mejor post del período:</div>
            <a
              href={topPost.url}
              target="_blank"
              rel="noreferrer"
              className="mt-1 block truncate font-medium text-blue-600 hover:underline"
              title={topPost.hook || topPost.caption || topPost.shortcode}
            >
              {topPost.hook || topPost.caption || topPost.shortcode}
            </a>
            <div className="text-zinc-500">
              {fmt(topPost.latest_views)} vistas · {fmtDate(topPost.posted_at)}
            </div>
          </div>
        )}
        {gap != null && gap > 0 && (
          <div
            className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900"
            title={`Instagram reporta ${igPostsCount} posts pero Apify devolvió solo ${totalInDb}. La diferencia (${gap}) suelen ser posts archivados, fijados (pinned), o más allá del techo de paginación del actor.`}
          >
            <strong>Faltan {gap} posts vs IG:</strong> tenemos {totalInDb} pero
            Instagram reporta {igPostsCount}. Suelen ser archivados, pinned, o
            posts antiguos más allá del techo del scraper.
          </div>
        )}
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-zinc-500 hover:text-zinc-800">
            ⓘ Cómo se calculan estas métricas
          </summary>
          <div className="mt-2 space-y-2 rounded-md bg-zinc-50 p-3 text-zinc-700">
            <p>
              <strong>Período:</strong> ahora menos 90 días. Posts más viejos no
              entran.
            </p>
            <p>
              <strong>Δ Followers:</strong> solo se calcula con snapshots
              capturados por el cron diario. El primer día tienes una sola
              captura, no se puede medir delta hasta que pase el segundo cron.
            </p>
            <p>
              <strong>Δ Followers atribuible a cada post (en la tabla
              abajo):</strong>{" "}
              por cada ventana entre dos snapshots consecutivos del cron, tomo
              el cambio de followers (ej. +200 en 24h) y lo distribuyo entre
              los posts publicados en esa ventana ponderado por vistas. Si un
              post se llevó el 80% de las vistas, recibe 80% del crédito.{" "}
              <em>
                Esto es una heurística: Instagram no expone qué post causó
                cada nuevo seguidor.
              </em>{" "}
              Los posts publicados ANTES del primer snapshot no tienen
              atribución (—).
            </p>
            <p>
              <strong>Por qué pueden faltar posts vs IG:</strong> el actor
              público de Apify capta hasta ~600 posts por cuenta por límites
              de paginación de Instagram. Para cuentas grandes (700+ posts)
              vas a tener un gap permanente. Para cuentas chicas (1–5 posts
              de diferencia) suele ser por posts archivados o fijados que IG
              cuenta pero no devuelve en su feed pública.
            </p>
          </div>
        </details>
      </div>
    </section>
  );
}

function Stat90({
  label,
  value,
  positive,
  formula,
}: {
  label: string;
  value: string;
  positive?: boolean;
  /** A short, always-visible formula shown under the value. */
  formula?: string;
}) {
  const color =
    positive === true
      ? "text-emerald-700"
      : positive === false
        ? "text-red-700"
        : "text-zinc-900";
  return (
    <div className="rounded-md bg-zinc-50 p-2">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div className={`font-semibold tabular-nums ${color}`}>{value}</div>
      {formula && (
        <div className="mt-0.5 text-[9px] leading-tight text-zinc-400">
          {formula}
        </div>
      )}
    </div>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div className="rounded-md border border-zinc-200 bg-white p-3 text-sm text-zinc-800">
        {children}
      </div>
    </div>
  );
}

function Th({
  label,
  k,
  sortKey,
  dir,
  onClick,
  align,
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  dir: "asc" | "desc";
  onClick: (k: SortKey) => void;
  align?: "right";
}) {
  const active = sortKey === k;
  return (
    <th
      onClick={() => onClick(k)}
      className={`cursor-pointer select-none px-3 py-2 ${
        align === "right" ? "text-right" : ""
      } ${active ? "text-zinc-900" : ""}`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active && <span>{dir === "asc" ? "▲" : "▼"}</span>}
      </span>
    </th>
  );
}
