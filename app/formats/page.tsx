"use client";

import { useEffect, useState } from "react";

interface OverallTag {
  tag: string;
  count: number;
  total_views: number;
  avg_views: number;
}

interface SharedAccount {
  username: string;
  count: number;
  avg_views: number;
  examples: string[];
}

interface SharedTag {
  tag: string;
  accounts: SharedAccount[];
}

interface FormatsResponse {
  total_videos: number;
  overall: OverallTag[];
  shared_tags: SharedTag[];
}

function fmt(n: number): string {
  return new Intl.NumberFormat("es-CO").format(n);
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

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Formatos</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Patrones de estructura (hook + CTA + mecánica) detectados sobre los
          videos analizados. Los <strong>compartidos</strong> son los formatos
          que usan varias cuentas — pista fuerte de que son plantillas que
          alguien vende.
        </p>
      </header>

      <div className="mb-6 flex items-center gap-3 text-sm">
        <label>
          Vistas mínimas:&nbsp;
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
        {data && (
          <span className="text-zinc-500">
            Analizando {data.total_videos} videos.
          </span>
        )}
      </div>

      {loading && <p className="text-sm text-zinc-500">Cargando…</p>}

      {data && (
        <>
          <section className="mb-12">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
              Formatos compartidos entre cuentas
            </h2>
            {data.shared_tags.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-600">
                Aún no hay coincidencias entre cuentas. Necesitas al menos 2
                cuentas con videos analizados.
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
                        Usado por {s.accounts.length} cuentas (
                        {s.accounts.map((a) => `@${a.username} ×${a.count}`).join(", ")}
                        )
                      </span>
                    </summary>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {s.accounts.map((a) => (
                        <div
                          key={a.username}
                          className="rounded-md border border-zinc-100 p-3"
                        >
                          <div className="font-medium">@{a.username}</div>
                          <div className="text-xs text-zinc-500">
                            {a.count} videos · promedio {fmt(a.avg_views)} vistas
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

          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
              Todos los formatos detectados
            </h2>
            <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-3 py-2">Formato</th>
                    <th className="px-3 py-2 text-right">Videos</th>
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
                        {fmt(t.avg_views)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-zinc-500">
                        {fmt(t.total_views)}
                      </td>
                    </tr>
                  ))}
                  {data.overall.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center text-zinc-500">
                        Aún no hay videos analizados.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
