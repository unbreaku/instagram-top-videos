"use client";

import { useEffect, useRef, useState } from "react";

interface Account {
  username: string;
  is_pinned: boolean;
  video_count: number;
  followers_latest: number | null;
  deleted_at?: string | null;
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("es-CO").format(n);
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [newUsername, setNewUsername] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/accounts");
    const j = await res.json();
    setAccounts(j.accounts || []);
  }

  useEffect(() => {
    refresh();
  }, []);

  // Close menus when clicking outside.
  useEffect(() => {
    function onDocClick() {
      setOpenMenu(null);
    }
    if (openMenu) {
      document.addEventListener("click", onDocClick);
      return () => document.removeEventListener("click", onDocClick);
    }
  }, [openMenu]);

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

  async function refreshRecent(u: string) {
    setOpenMenu(null);
    setBusy(`refresh-${u}`);
    setMsg(`Refrescando últimos 10 posts de @${u}…`);
    const res = await fetch("/api/refresh-account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: u, limit: 10 }),
    });
    const j = await res.json();
    setBusy(null);
    if (!res.ok) setMsg(`Error: ${j.error || res.status}`);
    else setMsg(`@${u}: ${j.videosAdded} nuevos, ${j.videosUpdated} actualizados (${j.postsTotal} posts totales).`);
    refresh();
  }

  async function scrapeFullHistory(u: string) {
    setOpenMenu(null);
    setBusy(`scrape-${u}`);
    setMsg(`Scrape histórico iniciado para @${u}. Puede tardar 3-10 min.`);
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
    const runId = j.run_id;
    for (let tries = 0; tries < 180; tries++) {
      await new Promise((r) => setTimeout(r, 10_000));
      const sRes = await fetch(`/api/scrape-account/${runId}`);
      const s = await sRes.json();
      setMsg(`@${u}: ${s.status}${s.videos_added !== undefined ? ` — ${s.videos_added} nuevos, ${s.videos_updated} actualizados` : ""}`);
      if (["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(s.status))
        break;
    }
    setBusy(null);
    refresh();
  }

  async function softDelete(u: string) {
    setOpenMenu(null);
    if (!confirm(`Borrar @${u}? Los datos quedan retenidos 30 días por si quieres recuperarlos.`))
      return;
    setBusy(`del-${u}`);
    const res = await fetch(`/api/accounts/${u}`, { method: "DELETE" });
    const j = await res.json();
    setBusy(null);
    if (!res.ok) setMsg(`Error: ${j.error || res.status}`);
    else setMsg(`@${u} borrada (retención 30 días).`);
    refresh();
  }

  async function hardDelete(u: string) {
    setOpenMenu(null);
    if (
      !confirm(
        `BORRADO PERMANENTE de @${u}. Esto elimina todos los videos, snapshots y análisis YA. ¿Seguro?`,
      )
    )
      return;
    setBusy(`del-${u}`);
    const res = await fetch(`/api/accounts/${u}?hard=1`, { method: "DELETE" });
    const j = await res.json();
    setBusy(null);
    if (!res.ok) setMsg(`Error: ${j.error || res.status}`);
    else setMsg(`@${u} eliminada permanentemente.`);
    refresh();
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-3xl font-bold tracking-tight">Cuentas</h1>
      <p className="mt-2 text-sm text-zinc-600">
        Agrega cuentas, fija las que quieras observar diariamente. El menú (•••)
        de cada cuenta tiene refresh y borrar. El cron diario refresca solo los
        últimos 10 posts de las fijadas.
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
                {a.video_count} videos · {fmt(a.followers_latest)} followers
              </div>
            </div>

            {busy?.startsWith(`refresh-${a.username}`) ||
            busy?.startsWith(`scrape-${a.username}`) ||
            busy?.startsWith(`del-${a.username}`) ? (
              <span className="text-xs text-zinc-500">Trabajando…</span>
            ) : null}

            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenMenu(openMenu === a.username ? null : a.username);
                }}
                className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50"
                title="Acciones"
              >
                •••
              </button>
              {openMenu === a.username && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute right-0 z-10 mt-1 w-64 overflow-hidden rounded-md border border-zinc-200 bg-white shadow-lg"
                >
                  <button
                    onClick={() => refreshRecent(a.username)}
                    className="block w-full px-4 py-2 text-left text-sm hover:bg-zinc-50"
                  >
                    Refrescar últimos 10 posts
                  </button>
                  <button
                    onClick={() => scrapeFullHistory(a.username)}
                    className="block w-full px-4 py-2 text-left text-sm hover:bg-zinc-50"
                  >
                    Refrescar histórico completo
                  </button>
                  <div className="border-t border-zinc-100" />
                  <button
                    onClick={() => softDelete(a.username)}
                    className="block w-full px-4 py-2 text-left text-sm text-amber-700 hover:bg-amber-50"
                  >
                    Borrar (retención 30 días)
                  </button>
                  <button
                    onClick={() => hardDelete(a.username)}
                    className="block w-full px-4 py-2 text-left text-sm text-red-700 hover:bg-red-50"
                  >
                    Borrar permanentemente
                  </button>
                </div>
              )}
            </div>
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
