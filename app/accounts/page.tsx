"use client";

import { useEffect, useState } from "react";

interface Account {
  username: string;
  is_pinned: boolean;
  video_count: number;
  followers_latest: number | null;
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [newUsername, setNewUsername] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/accounts");
    const j = await res.json();
    setAccounts(j.accounts || []);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function addAccount(e: React.FormEvent) {
    e.preventDefault();
    const username = newUsername.replace(/^@/, "").trim().toLowerCase();
    if (!username) return;
    setBusy("add");
    setMsg(null);
    const res = await fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, is_pinned: false }),
    });
    const j = await res.json();
    setBusy(null);
    if (!res.ok) setMsg(j.error || `Error ${res.status}`);
    else {
      setNewUsername("");
      refresh();
    }
  }

  async function togglePin(u: string, current: boolean) {
    setBusy(`pin-${u}`);
    await fetch(`/api/accounts/${u}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_pinned: !current }),
    });
    setBusy(null);
    refresh();
  }

  async function removeAccount(u: string) {
    if (!confirm(`¿Borrar @${u} y todos sus datos?`)) return;
    setBusy(`del-${u}`);
    await fetch(`/api/accounts/${u}`, { method: "DELETE" });
    setBusy(null);
    refresh();
  }

  async function scrapeHistory(u: string) {
    setBusy(`scrape-${u}`);
    setMsg(null);
    const res = await fetch("/api/scrape-account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: u }),
    });
    const j = await res.json();
    if (!res.ok) {
      setBusy(null);
      setMsg(j.error || `Error ${res.status}`);
      return;
    }
    setMsg(
      `Scrape iniciado para @${u}. Esto puede tardar de 2 a 10 minutos según el tamaño del historial. Hago polling cada 10s.`,
    );
    // Poll until done
    const runId = j.run_id;
    let tries = 0;
    while (tries < 180) {
      tries++;
      await new Promise((r) => setTimeout(r, 10_000));
      const sRes = await fetch(`/api/scrape-account/${runId}`);
      const s = await sRes.json();
      setMsg(
        `@${u}: ${s.status}${s.videos_added !== undefined ? ` — ${s.videos_added} nuevos, ${s.videos_updated} actualizados` : ""}`,
      );
      if (
        s.status === "SUCCEEDED" ||
        s.status === "FAILED" ||
        s.status === "ABORTED" ||
        s.status === "TIMED-OUT"
      ) {
        break;
      }
    }
    setBusy(null);
    refresh();
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-3xl font-bold tracking-tight">Cuentas</h1>
      <p className="mt-2 text-sm text-zinc-600">
        Agrega cuentas, fija las que quieras observar diariamente y dispara
        scrapes de historial completo.
      </p>

      <form
        onSubmit={addAccount}
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
          disabled={busy === "add"}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {busy === "add" ? "Agregando…" : "Agregar"}
        </button>
      </form>

      {msg && (
        <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700">
          {msg}
        </div>
      )}

      <ul className="mt-6 divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white shadow-sm">
        {accounts.map((a) => (
          <li key={a.username} className="flex items-center gap-3 p-4">
            <button
              onClick={() => togglePin(a.username, a.is_pinned)}
              disabled={busy === `pin-${a.username}`}
              title={a.is_pinned ? "Quitar de fijadas" : "Fijar"}
              className={`text-lg ${a.is_pinned ? "text-amber-500" : "text-zinc-300 hover:text-zinc-500"}`}
            >
              ★
            </button>
            <div className="flex-1">
              <div className="font-medium">@{a.username}</div>
              <div className="text-xs text-zinc-500">
                {a.video_count} videos
              </div>
            </div>
            <button
              onClick={() => scrapeHistory(a.username)}
              disabled={busy?.startsWith("scrape-")}
              className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-50"
            >
              {busy === `scrape-${a.username}`
                ? "Scrapeando…"
                : "Scrape histórico"}
            </button>
            <button
              onClick={() => removeAccount(a.username)}
              disabled={busy === `del-${a.username}`}
              className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
            >
              Borrar
            </button>
          </li>
        ))}
        {accounts.length === 0 && (
          <li className="p-6 text-center text-sm text-zinc-500">
            No hay cuentas aún.
          </li>
        )}
      </ul>
    </main>
  );
}
