"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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

type SortKey = "views" | "likes" | "comments" | "posted";

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
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeMsg, setAnalyzeMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [aRes, vRes, lRes] = await Promise.all([
        fetch(`/api/accounts/${params.username}`),
        fetch(`/api/accounts/${params.username}/videos?sort=${sort}&limit=500`),
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
  }, [params.username, sort]);

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

  return (
    <main className="mx-auto max-w-7xl px-4 py-10">
      <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-900">
        ← Dashboard
      </Link>
      <header className="mt-2 mb-8 flex items-baseline justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            @{detail.account.username}
          </h1>
          {detail.account.display_name && (
            <p className="mt-1 text-zinc-600">{detail.account.display_name}</p>
          )}
        </div>
        <div className="text-right text-sm text-zinc-500">
          {videos.length} videos en DB
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
          <p className="mb-3 text-xs text-zinc-500">
            Cada fila es un día medido por el cron. El delta es la diferencia
            de followers vs el día anterior. Los videos listados son los
            publicados en esa ventana — probablemente responsables del lift.
          </p>
          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2 text-right">Followers</th>
                  <th className="px-3 py-2 text-right">Δ followers</th>
                  <th className="px-3 py-2">Videos publicados</th>
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
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Videos
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
                  // Refresh table
                  const vRes = await fetch(
                    `/api/accounts/${params.username}/videos?sort=${sort}&limit=500`,
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
            <label className="text-sm text-zinc-600">
              Ordenar por&nbsp;
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="rounded-md border border-zinc-300 px-2 py-1 text-sm"
              >
                <option value="views">Vistas</option>
                <option value="likes">Likes</option>
                <option value="comments">Comentarios</option>
                <option value="posted">Fecha</option>
              </select>
            </label>
          </div>
        </div>
        {analyzeMsg && (
          <div className="mb-3 rounded-md border border-zinc-200 bg-zinc-50 p-2 text-xs text-zinc-700">
            {analyzeMsg}
          </div>
        )}

        {videos.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-600">
            No hay videos guardados para esta cuenta. Ve a{" "}
            <Link href="/accounts" className="text-blue-600 hover:underline">
              Cuentas
            </Link>{" "}
            y dale &quot;Scrape histórico&quot;.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2 text-right">Vistas</th>
                  <th className="px-3 py-2 text-right">Likes</th>
                  <th className="px-3 py-2 text-right">Comments</th>
                  <th className="px-3 py-2">Caption</th>
                  <th className="px-3 py-2">Link</th>
                </tr>
              </thead>
              <tbody>
                {videos.map((v) => (
                  <tr
                    key={v.shortcode}
                    className="border-t border-zinc-100 hover:bg-zinc-50"
                  >
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
                      className="max-w-md px-3 py-2 text-zinc-700"
                      title={v.caption || ""}
                    >
                      {v.hook && (
                        <div className="mb-1 text-xs font-semibold text-zinc-900">
                          🎣 {v.hook}
                        </div>
                      )}
                      <div className="text-zinc-700">
                        {truncate(v.caption || "")}
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
