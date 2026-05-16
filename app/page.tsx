"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface Account {
  username: string;
  display_name: string | null;
  is_pinned: boolean;
  last_full_scrape_at: string | null;
  video_count: number;
  followers_latest: number | null;
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("es-CO").format(n);
}

function relativeTime(iso: string | null): string {
  if (!iso) return "nunca";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "ahora mismo";
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h}h`;
  const d = Math.floor(h / 24);
  return `hace ${d}d`;
}

export default function Page() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    const res = await fetch("/api/accounts");
    const j = await res.json();
    setAccounts(j.accounts || []);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  const pinned = accounts.filter((a) => a.is_pinned);
  const other = accounts.filter((a) => !a.is_pinned);

  return (
    <main className="mx-auto max-w-7xl px-4 py-10">
      <header className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="mt-2 text-sm text-zinc-600">
            Cuentas que estás observando. El cron diario a las 6:00 AM refresca
            las cuentas fijadas.
          </p>
        </div>
        <Link
          href="/accounts"
          className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50"
        >
          Administrar cuentas →
        </Link>
      </header>

      {loading && (
        <p className="text-sm text-zinc-500">Cargando…</p>
      )}

      {!loading && pinned.length === 0 && other.length === 0 && (
        <div className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-600">
          Todavía no hay cuentas. Agrega una en{" "}
          <Link href="/accounts" className="text-blue-600 hover:underline">
            Cuentas
          </Link>
          .
        </div>
      )}

      {pinned.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Fijadas
          </h2>
          <AccountGrid accounts={pinned} />
        </section>
      )}

      {other.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Otras
          </h2>
          <AccountGrid accounts={other} />
        </section>
      )}
    </main>
  );
}

function AccountGrid({ accounts }: { accounts: Account[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {accounts.map((a) => (
        <Link
          key={a.username}
          href={`/account/${a.username}`}
          className="block rounded-xl border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-zinc-400"
        >
          <div className="flex items-baseline justify-between">
            <h3 className="text-lg font-semibold">@{a.username}</h3>
            {a.is_pinned && (
              <span className="text-xs text-amber-600">★ fijada</span>
            )}
          </div>
          {a.display_name && (
            <p className="mt-0.5 text-sm text-zinc-600">{a.display_name}</p>
          )}
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-zinc-500">
                Followers
              </dt>
              <dd className="font-medium tabular-nums">
                {fmt(a.followers_latest)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-zinc-500">
                Videos
              </dt>
              <dd className="font-medium tabular-nums">
                {fmt(a.video_count)}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-zinc-500">
            Último scrape: {relativeTime(a.last_full_scrape_at)}
          </p>
        </Link>
      ))}
    </div>
  );
}
