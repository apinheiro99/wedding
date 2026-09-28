"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Footer } from "./Footer";

const TABS = [
  ["/admin", "Visão geral"], ["/admin/users", "Usuários"], ["/admin/media", "Mídias"],
  ["/admin/packages", "ZIPs"], ["/admin/jobs", "Jobs"], ["/admin/settings", "Configurações"],
] as const;

export function AdminShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [ok, setOk] = useState(false);
  useEffect(() => { api("/api/admin/ping").then(() => setOk(true)).catch(() => router.replace("/admin/login")); }, [router]);
  if (!ok) return <div className="grid min-h-dvh place-items-center"><span className="h-5 w-5 animate-spin rounded-full border-2 border-amber border-r-transparent" /></div>;
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line/60 bg-ivory/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 md:px-8">
          <div className="flex items-center gap-3">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-ink text-xs font-bold text-amber">A</span>
            <span className="font-serif text-lg">Administração</span>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/photos" className="btn-ghost btn-sm">Ver o site</Link>
            <button className="btn-sm rounded-full px-3 text-sm text-muted hover:text-ink" onClick={async () => { await api("/api/admin/auth/logout", { method: "POST" }); router.replace("/"); }}>Sair</button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 pb-2 md:px-8 [scrollbar-width:none]" aria-label="Admin">
          {TABS.map(([href, label]) => {
            const active = href === "/admin" ? path === "/admin" : path.startsWith(href);
            return <Link key={href} href={href} aria-current={active ? "page" : undefined}
              className={`shrink-0 rounded-full px-4 py-1.5 text-sm transition ${active ? "bg-ink text-ivory" : "text-muted hover:bg-ivory-deep hover:text-ink"}`}>{label}</Link>;
          })}
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">{children}</main>
      <Footer className="pb-8" />
    </div>
  );
}

export function StatCard({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "danger" | "sage" | "amber" }) {
  const c = tone === "danger" ? "text-danger" : tone === "sage" ? "text-sage" : tone === "amber" ? "text-amber" : "";
  return (
    <div className="card p-5">
      <p className="text-xs uppercase tracking-wider text-muted">{label}</p>
      <p className={`mt-2 font-serif text-3xl tabular-nums ${c}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Badge({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "sage" | "amber" | "danger" | "terra" }) {
  const map = { muted: "bg-ivory-deep text-muted", sage: "bg-sage-soft text-sage", amber: "bg-amber-soft text-amber", danger: "bg-danger-soft text-danger", terra: "bg-terra-soft text-terra" };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${map[tone]}`}>{children}</span>;
}
