"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const returnTo = sp.get("returnTo") || "/accounts";
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Login falló");
      // Hard reload so middleware picks up the cookie.
      window.location.href = returnTo;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-sm px-4 py-20">
      <h1 className="text-2xl font-bold tracking-tight">Acceso</h1>
      <p className="mt-2 text-sm text-zinc-600">
        Esta zona está restringida porque dispara llamadas a Apify, Deepgram y
        Claude que cuestan plata. Pega la contraseña del dueño.
      </p>
      <form
        onSubmit={submit}
        className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm"
      >
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-zinc-700">
            Contraseña
          </span>
          <input
            type="password"
            value={password}
            autoFocus
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
          />
        </label>
        {error && (
          <p className="mt-2 text-sm text-red-600">{error}</p>
        )}
        <button
          type="submit"
          disabled={loading || !password}
          className="mt-4 w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {loading ? "Entrando…" : "Entrar"}
        </button>
      </form>
      <p className="mt-4 text-xs text-zinc-500">
        Solo necesario una vez por dispositivo (cookie dura 30 días).
      </p>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="px-4 py-20 text-sm">Cargando…</div>}>
      <LoginForm />
    </Suspense>
  );
}
