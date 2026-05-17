"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

interface OverallTag {
  tag: string;
  count: number;
  accounts: number;
  total_views: number;
  avg_views: number;
  total_likes: number;
  avg_likes: number;
  examples: string[];
}

interface SharedAccount {
  username: string;
  count: number;
  avg_views: number;
  examples: string[];
}

interface SharedTag {
  tag: string;
  total_count: number;
  accounts_used: number;
  accounts: SharedAccount[];
}

interface HeatmapCell {
  count: number;
  avg_views: number;
}

interface HeatmapData {
  accounts: string[];
  tags: string[];
  cells: HeatmapCell[][]; // [tagIndex][accountIndex]
}

interface HookRow {
  hook: string | null;
  account: string;
  shortcode: string;
  url: string;
  views: number | null;
}
interface CtaRow {
  cta: string | null;
  account: string;
  shortcode: string;
  url: string;
  views: number | null;
}

interface FormatsResponse {
  total_videos: number;
  total_accounts: number;
  total_formats: number;
  total_views: number;
  avg_views_per_video: number;
  overall: OverallTag[];
  shared_tags: SharedTag[];
  heatmap: HeatmapData;
  top_hooks: HookRow[];
  top_ctas: CtaRow[];
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("es-ES").format(n);
}
function compact(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

// Color scale for the heatmap based on avg_views magnitude.
function heatColor(avgViews: number, max: number): string {
  if (avgViews <= 0 || max <= 0) return "#f4f4f5"; // zinc-100
  const t = Math.min(1, Math.log10(avgViews + 1) / Math.log10(max + 1));
  // Light yellow → strong amber.
  const r = Math.round(255 - 130 * t);
  const g = Math.round(235 - 130 * t);
  const b = Math.round(150 - 130 * t);
  return `rgb(${r},${g},${b})`;
}

export default function FormatsPage() {
  const [data, setData] = useState<FormatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [minViews, setMinViews] = useState(0);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/formats?min_views=${minViews}`)
      .then((r) => r.json())
      .then((j) => {
        setData(j);
        setLoading(false);
      });
  }, [minViews]);

  const topByAvgViews = useMemo(() => {
    if (!data) return [] as OverallTag[];
    return [...data.overall]
      .filter((o) => o.count >= 2) // need at least 2 examples for the avg to mean anything
      .sort((a, b) => b.avg_views - a.avg_views)
      .slice(0, 15);
  }, [data]);

  const bubbleData = useMemo(() => {
    if (!data) return [] as Array<{ x: number; y: number; z: number; tag: string }>;
    return data.overall
      .filter((o) => o.count >= 2)
      .map((o) => ({
        x: o.count,
        y: o.avg_views,
        z: Math.max(50, Math.sqrt(o.total_views) * 0.5),
        tag: o.tag,
      }));
  }, [data]);

  const heatMax = useMemo(() => {
    if (!data?.heatmap) return 0;
    let max = 0;
    for (const row of data.heatmap.cells)
      for (const cell of row) if (cell.avg_views > max) max = cell.avg_views;
    return max;
  }, [data]);

  return (
    <main className="mx-auto max-w-7xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Formatos · BI</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Qué patrones estructurales (hook · CTA · mecánica) están funcionando
          y cuáles comparten varios creadores — pista fuerte de plantilla.
        </p>
      </header>

      <div className="mb-6 flex items-center gap-3 text-sm">
        <label>
          Vistas mínimas por video:&nbsp;
          <select
            value={minViews}
            onChange={(e) => setMinViews(Number(e.target.value))}
            className="rounded-md border border-zinc-300 px-2 py-1"
          >
            <option value={0}>Todos</option>
            <option value={10000}>≥ 10k</option>
            <option value={50000}>≥ 50k</option>
            <option value={100000}>≥ 100k</option>
            <option value={500000}>≥ 500k</option>
          </select>
        </label>
      </div>

      {loading && <p className="text-sm text-zinc-500">Cargando…</p>}

      {data && (
        <>
          {/* KPI ROW */}
          <section className="mb-10 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Kpi label="Videos analizados" value={fmt(data.total_videos)} />
            <Kpi label="Cuentas" value={fmt(data.total_accounts)} />
            <Kpi label="Formatos únicos" value={fmt(data.total_formats)} />
            <Kpi
              label="Vistas promedio / video"
              value={compact(data.avg_views_per_video)}
            />
          </section>

          {/* TOP BY AVG VIEWS */}
          <section className="mb-10 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-zinc-500">
              Top 15 formatos por vistas promedio
            </h2>
            <p className="mb-3 text-xs text-zinc-500">
              Los que cuando se usan, en promedio, viralizan más. Filtrados a
              formatos usados ≥ 2 veces.
            </p>
            <div className="h-96 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={topByAvgViews}
                  layout="vertical"
                  margin={{ top: 5, right: 16, left: 16, bottom: 5 }}
                >
                  <CartesianGrid stroke="#f1f5f9" />
                  <XAxis
                    type="number"
                    tickFormatter={(v) => compact(v as number)}
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis
                    type="category"
                    dataKey="tag"
                    width={180}
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip
                    formatter={(v: number) => fmt(v)}
                    labelClassName="text-xs"
                  />
                  <Bar dataKey="avg_views" fill="#f59e0b" radius={[0, 4, 4, 0]}>
                    {topByAvgViews.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={entry.accounts > 1 ? "#d97706" : "#fbbf24"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              <span className="mr-3 inline-flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded bg-amber-600" />{" "}
                compartido por varias cuentas
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded bg-amber-400" />{" "}
                única cuenta
              </span>
            </p>
          </section>

          {/* SCATTER: COUNT vs AVG VIEWS */}
          <section className="mb-10 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-zinc-500">
              Frecuencia × Performance
            </h2>
            <p className="mb-3 text-xs text-zinc-500">
              Eje X = cuántas veces se usó el formato. Eje Y = vistas promedio.
              Tamaño del círculo = vistas totales generadas. Los formatos en la
              esquina superior derecha son los más ganadores: muy usados Y muy
              vistos.
            </p>
            <div className="h-96 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 10, right: 20, bottom: 30, left: 20 }}>
                  <CartesianGrid stroke="#f1f5f9" />
                  <XAxis
                    type="number"
                    dataKey="x"
                    name="Cantidad usos"
                    tick={{ fontSize: 11 }}
                    label={{
                      value: "Usos",
                      position: "insideBottom",
                      offset: -10,
                      style: { fontSize: 11, fill: "#71717a" },
                    }}
                  />
                  <YAxis
                    type="number"
                    dataKey="y"
                    name="Vistas promedio"
                    tickFormatter={(v) => compact(v as number)}
                    tick={{ fontSize: 11 }}
                  />
                  <ZAxis type="number" dataKey="z" range={[40, 400]} />
                  <Tooltip
                    cursor={{ strokeDasharray: "3 3" }}
                    content={({ active, payload }) => {
                      if (!active || !payload || !payload.length) return null;
                      const p = payload[0].payload as {
                        tag: string;
                        x: number;
                        y: number;
                      };
                      return (
                        <div className="rounded-md border border-zinc-200 bg-white p-2 text-xs shadow">
                          <div className="font-mono font-semibold">{p.tag}</div>
                          <div>{p.x} usos</div>
                          <div>{fmt(p.y)} vistas promedio</div>
                        </div>
                      );
                    }}
                  />
                  <Scatter data={bubbleData} fill="#0ea5e9" fillOpacity={0.6} />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* HEATMAP */}
          {data.heatmap.accounts.length > 0 && data.heatmap.tags.length > 0 && (
            <section className="mb-10 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
              <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-zinc-500">
                Heatmap · Cuentas × Formatos (top 30)
              </h2>
              <p className="mb-3 text-xs text-zinc-500">
                Intensidad del color = vistas promedio de los videos de esa
                cuenta que usaron ese formato. Cuadros oscuros en varias
                columnas = patrón cross-creator.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-10 bg-white px-2 py-1 text-left font-mono">
                        formato
                      </th>
                      {data.heatmap.accounts.map((u) => (
                        <th
                          key={u}
                          className="px-2 py-1 text-center text-zinc-600"
                        >
                          @{u}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.heatmap.tags.map((tag, ti) => (
                      <tr key={tag}>
                        <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-2 py-1 font-mono text-zinc-700">
                          {tag}
                        </td>
                        {data.heatmap.accounts.map((u, ai) => {
                          const c = data.heatmap.cells[ti][ai];
                          return (
                            <td
                              key={u}
                              className="px-1 py-1 text-center"
                              style={{ background: heatColor(c.avg_views, heatMax) }}
                              title={`@${u} · ${tag}: ${c.count} videos, promedio ${fmt(c.avg_views)} vistas`}
                            >
                              {c.count > 0 ? (
                                <span className="text-zinc-800">{c.count}</span>
                              ) : (
                                <span className="text-zinc-300">·</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* SHARED FORMATS */}
          <section className="mb-10">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
              Formatos compartidos entre cuentas ({data.shared_tags.length})
            </h2>
            {data.shared_tags.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-600">
                Aún no hay coincidencias. Necesitas ≥ 2 cuentas con videos
                analizados.
              </div>
            ) : (
              <div className="space-y-3">
                {data.shared_tags.map((s) => (
                  <details
                    key={s.tag}
                    className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm"
                  >
                    <summary className="cursor-pointer">
                      <span className="rounded bg-amber-100 px-2 py-0.5 text-sm font-medium text-amber-800">
                        {s.tag}
                      </span>
                      <span className="ml-3 text-sm text-zinc-600">
                        {s.accounts_used} cuentas · {s.total_count} usos total
                      </span>
                    </summary>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {s.accounts.map((a) => (
                        <div
                          key={a.username}
                          className="rounded-md border border-zinc-100 p-3"
                        >
                          <div className="font-medium">@{a.username}</div>
                          <div className="text-xs text-zinc-500">
                            {a.count} videos · {fmt(a.avg_views)} vistas promedio
                          </div>
                          <ul className="mt-2 space-y-0.5 text-xs">
                            {a.examples.map((sc) => (
                              <li key={sc}>
                                <a
                                  href={`https://www.instagram.com/p/${sc}/`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-blue-600 hover:underline"
                                >
                                  /p/{sc}
                                </a>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            )}
          </section>

          {/* TOP HOOKS + CTAS */}
          <section className="mb-10 grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
                Top 25 hooks (por vistas)
              </h2>
              <ol className="space-y-3 text-sm">
                {data.top_hooks.map((h, i) => (
                  <li key={i} className="border-l-2 border-amber-400 pl-3">
                    <div className="font-medium text-zinc-900">"{h.hook}"</div>
                    <div className="text-xs text-zinc-500">
                      <a
                        href={h.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        @{h.account}
                      </a>{" "}
                      · {fmt(h.views)} vistas
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
                Top 25 CTAs (por vistas)
              </h2>
              <ol className="space-y-3 text-sm">
                {data.top_ctas.map((c, i) => (
                  <li key={i} className="border-l-2 border-sky-400 pl-3">
                    <div className="font-medium text-zinc-900">"{c.cta}"</div>
                    <div className="text-xs text-zinc-500">
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        @{c.account}
                      </a>{" "}
                      · {fmt(c.views)} vistas
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          {/* RAW TABLE */}
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
              Tabla completa
            </h2>
            <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-3 py-2">Formato</th>
                    <th className="px-3 py-2 text-right">Usos</th>
                    <th className="px-3 py-2 text-right">Cuentas</th>
                    <th className="px-3 py-2 text-right">Vistas promedio</th>
                    <th className="px-3 py-2 text-right">Vistas totales</th>
                  </tr>
                </thead>
                <tbody>
                  {data.overall.map((t) => (
                    <tr
                      key={t.tag}
                      className="border-t border-zinc-100 hover:bg-zinc-50"
                    >
                      <td className="px-3 py-2 font-mono text-zinc-800">
                        {t.tag}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {t.count}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {t.accounts}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {fmt(t.avg_views)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-zinc-500">
                        {fmt(t.total_views)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="text-xs uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
