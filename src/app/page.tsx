"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Footer } from "@/components/Footer";

type Heroes = { "landing-desktop": number; "landing-mobile": number; auth: number };
type Info = { eventTitle: string; motto: string; subtitle: string; heroes: Heroes };

export default function Landing() {
  const [info, setInfo] = useState<Info | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { api<Info>("/api/public/info").then(setInfo).catch(() => {}); }, []);
  const h = info?.heroes;
  // desktop prefers the photo composed for text on the left; each viewport falls back to the other slot
  const desk = h?.["landing-desktop"] ? `slot=landing-desktop&v=${h["landing-desktop"]}` : h?.["landing-mobile"] ? `slot=landing-mobile&v=${h["landing-mobile"]}` : null;
  const mob = h?.["landing-mobile"] ? `slot=landing-mobile&v=${h["landing-mobile"]}` : desk;
  const hero = !!desk;

  return (
    <main className={`relative min-h-dvh overflow-hidden bg-ivory ${hero ? "lg:bg-[#1d1a17]" : ""}`}>
      {hero && (
        <picture>
          <source media="(min-width: 1024px)" srcSet={`/api/public/hero?w=1920&${desk}`} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/public/hero?w=900&${mob}`} alt="" onLoad={() => setLoaded(true)}
            className={`h-[58dvh] w-full object-cover object-[52%_40%] transition-all duration-[1600ms] ease-out lg:absolute lg:inset-0 lg:h-full lg:object-[55%_50%] xl:object-[70%_50%] ${loaded ? "scale-100 opacity-100" : "scale-[1.04] opacity-0"}`} />
        </picture>
      )}
      {hero && <div aria-hidden className="pointer-events-none absolute inset-x-0 top-[38dvh] h-[20dvh] bg-gradient-to-b from-transparent to-ivory lg:hidden" />}
      {hero && <div aria-hidden className="pointer-events-none absolute inset-0 hidden bg-gradient-to-r from-[rgba(16,13,11,.86)] via-[rgba(16,13,11,.55)_38%] to-transparent to-[78%] lg:block" />}
      {hero && <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 hidden h-1/3 bg-gradient-to-t from-black/45 to-transparent lg:block" />}

      <div className={`relative mx-auto flex max-w-[80rem] flex-col px-6 sm:px-10 lg:min-h-dvh lg:justify-center lg:px-[clamp(2.5rem,6vw,6rem)] lg:py-[clamp(3rem,8vh,6rem)] ${hero ? "-mt-10 pb-10 lg:mt-0" : "min-h-dvh justify-center"} ${hero ? "lg:text-white lg:[text-shadow:0_2px_28px_rgba(0,0,0,.35)]" : ""}`}>
        <div className="max-w-[38rem] lg:max-w-[31rem] xl:max-w-[38rem]">
          <p className={`fade-up text-[clamp(0.875rem,0.75rem+0.95vw,1.5rem)] text-balance font-semibold uppercase tracking-[0.13em] sm:tracking-[0.2em] ${hero ? "text-terra lg:text-white" : "text-terra"}`}>
            {info?.eventTitle ?? "Matheus & Maria Fernanda"}
          </p>
          <h1 className="fade-up mt-[clamp(0.875rem,2vw,1.5rem)] text-balance font-serif text-[clamp(2.375rem,1.3rem+5vw,5.25rem)] font-medium leading-[1.04] tracking-[-0.015em]" style={{ animationDelay: "80ms" }}>
            <span className="block">Um dia,</span>
            <em className={`block not-italic lg:italic ${hero ? "text-terra lg:text-[#f3cbb9]" : "text-terra"}`}>muitos olhares.</em>
          </h1>
          <p className={`fade-up mt-[clamp(1.125rem,2.4vw,1.75rem)] max-w-[34ch] text-[clamp(1.0625rem,0.98rem+0.4vw,1.3125rem)] leading-relaxed ${hero ? "text-muted lg:text-white/90" : "text-muted"}`} style={{ animationDelay: "160ms" }}>
            {info?.subtitle ?? "Envie suas fotos e reviva com a gente as lembranças desse dia."}
          </p>
          <div className="fade-up mt-[clamp(1.75rem,3.6vw,2.75rem)] flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4" style={{ animationDelay: "240ms" }}>
            <Link href="/login" className="btn-primary min-h-[3.375rem] w-full px-9 text-base font-semibold shadow-lift sm:w-auto">Entrar no álbum</Link>
            <Link href="/onboarding" className={`btn min-h-[3.375rem] w-full px-7 text-[0.9375rem] sm:w-auto ${hero ? "border border-line bg-transparent text-ink hover:bg-ivory-deep lg:border-white/35 lg:text-white/90 lg:backdrop-blur-sm lg:hover:bg-white/10" : "btn-ghost"}`}>Primeiro acesso</Link>
          </div>
          <p className={`fade-up mt-[clamp(1.75rem,3.6vw,2.5rem)] text-[0.8125rem] leading-relaxed ${hero ? "text-muted/80 lg:text-white/70" : "text-muted/80"}`} style={{ animationDelay: "320ms" }}>
            Álbum privado da família · os arquivos originais são preservados.
          </p>
          <Footer className={`fade-up mt-4 !text-left ${hero ? "lg:!text-white/65 lg:[&_span]:!text-white/85" : ""}`} />
        </div>
      </div>
    </main>
  );
}
