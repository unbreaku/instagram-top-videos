"use client";

import { useMemo, useState } from "react";
import type { ScrapeResponse, VideoRow } from "@/lib/types";

const DEFAULT_USERNAMES = "andresbilbao, dylanrosemberg";

type SortKey = "views" | "likes" | "comments" | "timestamp" | "username";
type SortDir = "asc" | "desc";

function formatNumber(n: number): string {
  return new Intl.NumberFormat("es-CO").format(n);
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("es-CO", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function truncate(s: string, n = 120): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function toCsv(rows: VideoRow[]): string {
  const headers = [
    "username",
    "views",
    "likes",
    "comments",
    "timestamp",
    "type",
    "duration_seconds",
    "url",
    "caption",
  ];
  const escape = (v: unknown): string => {
    const s = v === undefined || v === null ? "" : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.username,
        r.views,
        r.likes,
        r.comments,
        r.timestamp,
        r.type,
        r.durationSeconds ?? "",
        r.url,
        r.caption.replace(/\s+/g, " ").trim(),
      ]
        .map(escape)
        .join(","),
    );
  }
  return lines.join("\n");
}

function downloadCsv(rows: VideoRow[]) {
  const csv = toCsv(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `instagram-top-videos-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function Page() {
  const [usernamesText, setUsernamesText] = useState(DEFAULT_USERNAMES);
  const [topN, setTopN] = useState(20);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ScrapeResponse | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("views");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [accountFilter, setAccountFilter] = useState<string>("__all__");

  const filteredSorted = useMemo(() => {
    if (!data) return [] as VideoRow[];
    const filtered =
      accountFilter === "__all__"
        ? data.results
        : data.results.filter((r) => r.username === accountFilter);
    const dir = sortDir === "asc" ? 1 : -1;
    const sorted = [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "number" && typeof bv === "number") {
        return (av - bv) * dir;
      }
      return String(av).localeCompare(String(bv)) * dir;
    });
    return sorted;
  }, [data, sortKey, sortDir, accountFilter]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "username" ? "asc" : "desc");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    setData(null);
    setAccountFilter("__all__");
    try {
      const usernames = usernamesText
        .split(/[\s,]+/)
        .map((s) => s.replace(/^@/, "").trim())
        .filter(Boolean);
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usernames, topN }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || `Error ${res.status}`);
      }
      setData(json as ScrapeResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">
          Instagram Top Videos
        </h1>
        <p className="mt-2 text-sm text-zinc-600">
          Escribe uno o varios handles, elige cuántos top videos quieres por
          cuenta y obtén una tabla ordenable con vistas, likes, comentarios,
          fecha y caption.
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm"
      >
        <div className="grid gap-4 md:grid-cols-[1fr_140px_auto] md:items-end">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-zinc-700">
              Cuentas (separadas por coma o espacio)
            </span>
            <input
              type="text"
              value={usernamesText}
              onChange={(e) => setUsernamesText(e.target.value)}
              placeholder="andresbilbao, dylanrosemberg"
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-zinc-700">
              Top N por cuenta
            </span>
            <input
              type="number"
              min={1}
              max={50}
              value={topN}
              onChange={(e) => setTopN(Number(e.target.value) || 20)}
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
            />
          </label>
          <button
            type="submit"
            disabled={loading}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Scrapeando…" : "Obtener videos"}
          </button>
        </div>
        <p className="mt-3 text-xs text-zinc-500">
          Usa la API de Apify (
          <code className="rounded bg-zinc-100 px-1 py-0.5">
            apify/instagram-scraper
          </code>
          ). Cada corrida tiene un costo pequeño en tu cuenta de Apify (~USD
          0.005 por cada 10 posts revisados).
        </p>
      </form>

      {error && (
        <div className="mt-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <strong>Error:</strong> {error}
        </div>
      )}

      {loading && (
        <div className="mt-6 rounded-md border border-zinc-200 bg-white p-4 text-sm text-zinc-600">
          Esto puede tardar entre 30 y 120 segundos según la cantidad de cuentas
          y posts. No cierres la ventana.
        </div>
      )}

      {data && (
        <section className="mt-8">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-600">
              <span>
                <strong>{data.results.length}</strong> videos encontrados
              </span>
              <span className="text-zinc-300">·</span>
              <span>
                Actualizado {new Date(data.fetchedAt).toLocaleString("es-CO")}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm text-zinc-600">
                Cuenta:&nbsp;
                <select
                  value={accountFilter}
                  onChange={(e) => setAccountFilter(e.target.value)}
                  className="rounded-md border border-zinc-300 px-2 py-1 text-sm"
                >
                  <option value="__all__">Todas</option>
                  {data.perAccount.map((p) => (
                    <option key={p.username} value={p.username}>
                      @{p.username} ({p.videoCount})
                    </option>
                  ))}
                </select>
              </label>
              <button
                onClick={() => downloadCsv(filteredSorted)}
                className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50"
              >
                Exportar CSV
              </button>
            </div>
          </div>

          {data.perAccount.some((p) => p.error) && (
            <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <strong>Algunas cuentas fallaron:</strong>
              <ul className="mt-1 list-disc pl-5">
                {data.perAccount
                  .filter((p) => p.error)
                  .map((p) => (
                    <li key={p.username}>
                      @{p.username}: {p.error}
                    </li>
                  ))}
              </ul>
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <Th
                    label="Cuenta"
                    sortKey="username"
                    activeKey={sortKey}
                    dir={sortDir}
                    onClick={toggleSort}
                  />
                  <Th
                    label="Vistas"
                    sortKey="views"
                    activeKey={sortKey}
                    dir={sortDir}
                    onClick={toggleSort}
                    align="right"
                  />
                  <Th
                    label="Likes"
                    sortKey="likes"
                    activeKey={sortKey}
                    dir={sortDir}
                    onClick={toggleSort}
                    align="right"
                  />
                  <Th
                    label="Comentarios"
                    sortKey="comments"
                    activeKey={sortKey}
                    dir={sortDir}
                    onClick={toggleSort}
                    align="right"
                  />
                  <Th
                    label="Fecha"
                    sortKey="timestamp"
                    activeKey={sortKey}
                    dir={sortDir}
                    onClick={toggleSort}
                  />
                  <th className="px-3 py-2">Caption</th>
                  <th className="px-3 py-2">Link</th>
                </tr>
              </thead>
              <tbody>
                {filteredSorted.map((r, i) => (
                  <tr
                    key={`${r.url}-${i}`}
                    className="border-t border-zinc-100 hover:bg-zinc-50"
                  >
                    <td className="px-3 py-2 font-medium">@{r.username}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatNumber(r.views)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatNumber(r.likes)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatNumber(r.comments)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-zinc-600">
                      {formatDate(r.timestamp)}
                    </td>
                    <td
                      className="max-w-md px-3 py-2 text-zinc-700"
                      title={r.caption}
                    >
                      {truncate(r.caption)}
                    </td>
                    <td className="px-3 py-2">
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        Ver
                      </a>
                    </td>
                  </tr>
                ))}
                {filteredSorted.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-3 py-6 text-center text-zinc-500"
                    >
                      No hay videos para mostrar.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <footer className="mt-12 text-xs text-zinc-500">
        Construido con Next.js, desplegable en Vercel. Datos vía Apify Instagram
        Scraper.
      </footer>
    </main>
  );
}

function Th({
  label,
  sortKey,
  activeKey,
  dir,
  onClick,
  align,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  dir: SortDir;
  onClick: (k: SortKey) => void;
  align?: "right";
}) {
  const isActive = activeKey === sortKey;
  return (
    <th
      onClick={() => onClick(sortKey)}
      className={`cursor-pointer select-none px-3 py-2 ${
        align === "right" ? "text-right" : ""
      } ${isActive ? "text-zinc-900" : ""}`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {isActive && <span>{dir === "asc" ? "▲" : "▼"}</span>}
      </span>
    </th>
  );
}
