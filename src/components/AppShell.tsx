"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { MeContext, type Me } from "@/lib/me";
import { useEvents } from "@/lib/events";
import { manager } from "@/lib/upload/manager";
import { Footer } from "./Footer";
import { UploadPill } from "./UploadPill";

const NAV = [
  { href: "/photos", label: "Fotos", icon: "M4 5h16v14H4z M4 15l4-4 4 4 3-3 5 5 M15 9h.01" },
  { href: "/upload", label: "Enviar", icon: "M12 16V4 M7 9l5-5 5 5 M4 20h16" },
  { href: "/downloads", label: "Downloads", icon: "M12 4v12 M7 11l5 5 5-5 M4 20h16" },
  { href: "/account", label: "Conta", icon: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 20c1.5-4 5-5 8-5s6.5 1 8 5" },
];

function Icon({ d, className = "h-5 w-5" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {d.split(" M").map((p, i) => <path key={i} d={(i ? "M" : "") + p} />)}
    </svg>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const router = useRouter();
  const path = usePathname();
  const load = useCallback(() => {
    api<Me>("/api/me").then(setMe).catch((e) => { if (e instanceof ApiError && e.status === 401) router.replace("/login"); });
  }, [router]);
  useEffect(load, [load]);

  if (!me) return <div className="min-h-dvh grid place-items-center text-muted"><span className="h-5 w-5 animate-spin rounded-full border-2 border-terra border-r-transparent" /></div>;

  return (
    <MeContext.Provider value={{ me, reload: load }}>
      <header className="sticky top-0 z-30 border-b border-line/60 bg-ivory/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 md:h-16 md:px-8">
          <Link href="/photos" className="font-serif text-xl tracking-tight">Nosso álbum</Link>
          <nav className="hidden md:flex items-center gap-1" aria-label="Principal">
            {NAV.map((n) => {
              const active = path.startsWith(n.href);
              return n.href === "/upload" ? (
                <Link key={n.href} href={n.href} className={`btn-primary btn-sm ml-2 ${active ? "ring-4 ring-terra/20" : ""}`}><Icon d={n.icon} className="h-4 w-4" />Enviar fotos</Link>
              ) : (
                <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined}
                  className={`rounded-full px-4 py-2 text-sm transition ${active ? "bg-ink text-ivory" : "text-muted hover:text-ink hover:bg-ivory-deep"}`}>{n.label}</Link>
              );
            })}
            {me.isAdmin && <Link href="/admin" className="ml-2 rounded-full px-3 py-2 text-xs font-medium uppercase tracking-wider text-amber hover:bg-amber-soft">Admin</Link>}
          </nav>
          {me.isAdmin && <Link href="/admin" className="md:hidden rounded-full px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-amber bg-amber-soft">Admin</Link>}
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 pb-10 pt-5 md:px-8 md:pt-8 min-h-[70dvh]">{children}</main>
      <Footer className="pb-28 md:pb-10" />
      {!path.startsWith("/upload") && <UploadPill />}
      <UploadEvents />
      <nav aria-label="Principal" className="md:hidden fixed inset-x-0 bottom-0 z-30 border-t border-line/70 bg-card/95 backdrop-blur-md pb-safe">
        <div className="grid grid-cols-4">
          {NAV.map((n) => {
            const active = path.startsWith(n.href);
            if (n.href === "/upload") return (
              <Link key={n.href} href={n.href} className="flex flex-col items-center gap-1 py-2">
                <span className={`-mt-6 grid h-12 w-12 place-items-center rounded-full bg-terra text-white shadow-lift ${active ? "ring-4 ring-terra/25" : ""}`}><Icon d={n.icon} /></span>
                <span className={`text-[11px] ${active ? "text-terra font-medium" : "text-muted"}`}>{n.label}</span>
              </Link>
            );
            return (
              <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined} className={`flex flex-col items-center gap-1 py-2.5 ${active ? "text-ink" : "text-muted"}`}>
                <Icon d={n.icon} />
                <span className={`text-[11px] ${active ? "font-medium" : ""}`}>{n.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </MeContext.Provider>
  );
}

function UploadEvents() {
  useEvents((e) => { if (e.t === "upload") manager().onServerUpload(e.uploadId, e.state, e.reason); });
  return null;
}

type Heroes = Record<"landing-desktop" | "landing-mobile" | "auth", number>;
let heroesCache: Promise<Heroes | null> | null = null;
function useHeroes() {
  const [h, setH] = useState<Heroes | null>(null);
  useEffect(() => {
    heroesCache ??= fetch("/api/public/info").then((r) => r.json()).then((d) => d.heroes ?? null).catch(() => null);
    heroesCache.then(setH);
  }, []);
  return h;
}

// Which photo each page uses, and where the couple sits in frame — 3 corner
// crops so the subjects land in the strip above the cards, not directly behind them.
const BANNERS: { prefix: string; slot: keyof Heroes; pos: "top-left" | "top-right" | "top-center" }[] = [
  { prefix: "/photos", slot: "landing-desktop", pos: "top-right" },
  { prefix: "/albums", slot: "landing-desktop", pos: "top-right" },
  { prefix: "/upload", slot: "auth", pos: "top-left" },
  { prefix: "/downloads", slot: "landing-mobile", pos: "top-center" },
  { prefix: "/account", slot: "auth", pos: "top-left" },
];
const POS_CLASS = { "top-left": "object-[20%_26%]", "top-right": "object-[78%_24%]", "top-center": "object-[50%_22%]" } as const;

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  const path = usePathname();
  const heroes = useHeroes();
  const b = BANNERS.find((x) => path.startsWith(x.prefix));
  const v = b && heroes ? heroes[b.slot] || heroes["landing-desktop"] || heroes["landing-mobile"] : 0;
  const [loaded, setLoaded] = useState(false);

  if (!b || !v) {
    return (
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 md:mb-8">
        <div>
          <h1 className="font-serif text-[30px] leading-tight tracking-tight md:text-[40px]">{title}</h1>
          {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
        </div>
        {actions}
      </div>
    );
  }

  return (
    <>
      {/* whole-page watermark: fixed photo behind the content, faded but visible; couple framed in the corner opposite the title so cards don't sit right on top of them */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/public/hero?slot=${heroes && heroes[b.slot] ? b.slot : "landing-desktop"}&w=1920&v=${v}`} alt="" onLoad={() => setLoaded(true)}
          className={`h-full w-full object-cover ${POS_CLASS[b.pos]} saturate-[.9] transition-opacity duration-1000 ${loaded ? "opacity-[.6]" : "opacity-0"}`} />
        <div className="absolute inset-0 bg-gradient-to-b from-ivory/65 via-ivory/25 to-ivory/70" />
      </div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 md:mb-8">
        <div>
          <h1 className="font-serif text-[30px] leading-tight tracking-tight md:text-[40px]">{title}</h1>
          {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
        </div>
        {actions}
      </div>
    </>
  );
}
