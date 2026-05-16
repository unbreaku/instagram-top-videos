import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Instagram Tracker",
  description:
    "Observa cuentas de Instagram, rastrea crecimiento de followers y métricas por video.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body className="min-h-screen antialiased">
        <header className="border-b border-zinc-200 bg-white">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
            <Link
              href="/"
              className="text-sm font-semibold tracking-tight text-zinc-900"
            >
              Instagram Tracker
            </Link>
            <nav className="flex items-center gap-4 text-sm text-zinc-600">
              <Link href="/" className="hover:text-zinc-900">
                Dashboard
              </Link>
              <Link href="/accounts" className="hover:text-zinc-900">
                Cuentas
              </Link>
              <Link href="/formats" className="hover:text-zinc-900">
                Formatos
              </Link>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
