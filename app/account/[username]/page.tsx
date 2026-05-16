"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
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
  }>;
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("es-CO").format(n);
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-CO", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function truncate(s: string, n = 100): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

type SortKey = "views" | "likes" | "comments" | "posted" | "estimated_followers";

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
  const [sort, setSort] = useState<SortKey>("views");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeMsg, setAnalyzeMsg] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const [tagSearch, setTagSearch] = useState("");

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
  }, [videos, filters]);

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
        case "views":
        default:
          av = a.latest_views || 0;
          bv = b.latest_views || 0;
      }
      return (av - bv) * dir;
    });
    return arr;
  }, [filtered, sort, sortDir]);

  function toggleSort(k: SortKey) {
    if (sort === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(k);
      setSortDir(k === "posted" ? "desc" : "desc");
    }
  }

  const chartData = useMemo(() => {
    if (!detail) return [];
    return detail.snapshots
      .filter((s) => typeof s.followers_count === "number")
      .map((s) => ({
        date: new Date(s.captured_at).toLocaleDateString("es-CO", {
          month: "short",
          day: "2-digit",
        }),
        followers: s.followers_count,
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
          {videos.length} posts en DB
        </div>
      </header>

      {chartData.length > 1 && (
        <section className="mb-10 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Crecimiento de followers
          </h2>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} width={70} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="followers"
                  stroke="#18181b"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {lifts.length > 1 && (
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Crecimiento diario · videos atribuibles
          </h2>
          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2 text-right">Followers</th>
                  <th className="px-3 py-2 text-right">Δ followers</th>
                  <th className="px-3 py-2">Posts publicados</th>
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
                      className={`px-3 py-2 text-right tabular-nums ${
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
                        <span className="text-xs text-zinc-400">ninguno</span>
                      ) : (
                        <ul className="space-y-1">
                          {l.videos.map((v) => (
                            <li key={v.shortcode} className="text-xs">
                              <a
                                href={v.url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-blue-600 hover:underline"
                              >
                                {v.type || "Post"} ·{" "}
                                {fmt(v.latest_views)} vistas
                              </a>
                              {v.hook && (
                                <span className="text-zinc-600">
                                  {" — "}
                                  {v.hook.length > 80
                                    ? v.hook.slice(0, 79) + "…"
                                    : v.hook}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Posts ({sorted.length} de {videos.length})
          </h2>
          <div className="flex items-center gap-3">
            <button
              onClick={async () => {
                setAnalyzing(true);
                setAnalyzeMsg("Analizando lote de 5…");
                try {
                  const r = await fetch(
                    `/api/analyze-pending?account=${params.username}&batch=5`,
                    { method: "POST" },
                  );
                  const j = await r.json();
                  setAnalyzeMsg(
                    `Procesados ${j.processed}, quedan ${j.remaining ?? "?"} por analizar.`,
                  );
                  const vRes = await fetch(
                    `/api/accounts/${params.username}/videos?sort=posted&limit=1000`,
                  );
                  setVideos((await vRes.json()).videos || []);
                } catch (e) {
                  setAnalyzeMsg(`Error: ${e instanceof Error ? e.message : e}`);
                } finally {
                  setAnalyzing(false);
                }
              }}
              disabled={analyzing}
              className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-50"
            >
              {analyzing ? "Analizando…" : "Analizar pendientes"}
            </button>
          </div>
        </div>
        {analyzeMsg && (
          <div className="mb-3 rounded-md border border-zinc-200 bg-zinc-50 p-2 text-xs text-zinc-700">
            {analyzeMsg}
          </div>
        )}

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
                          title="Followers estimados generados por este post (atribución proporcional a vistas dentro de su ventana de snapshot)"
                        >
                          {v.estimated_followers == null
                            ? "—"
                            : `${v.estimated_followers > 0 ? "+" : ""}${fmt(v.estimated_followers)}`}
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
                          <td colSpan={8} className="px-3 py-4">
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
