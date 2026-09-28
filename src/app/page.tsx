"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Footer } from "@/components/Footer";

type Info = { eventTitle: string; motto: string; subtitle: string; heroVersion: number };

export default function Landing() {
  const [info, setInfo] = useState<Info | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { api<Info>("/api/public/info").then(setInfo).catch(() => {}); }, []);
  const hero = !!info?.heroVersion;

  return (
    <main className={`relative min-h-dvh overflow-hidden bg-ivory ${hero ? "md:bg-[#1d1a17]" : ""}`}>
      {hero && (
        <picture>
          <source media="(min-width: 768px)" srcSet={`/api/public/hero?w=1920&v=${info!.heroVersion}`} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/public/hero?w=900&v=${info!.heroVersion}`} alt="" onLoad={() => setLoaded(true)}
            className={`h-[58dvh] w-full object-cover object-[52%_40%] transition-all duration-[1600ms] ease-out md:absolute md:inset-0 md:h-full md:object-center ${loaded ? "scale-100 opacity-100" : "scale-[1.04] opacity-0"}`} />
        </picture>
      )}
      {/* legibility: desktop gets a warm bottom-left veil; mobile fades the photo into the ivory page */}
      {hero && <div aria-hidden className="pointer-events-none absolute inset-x-0 top-[38dvh] h-[20dvh] bg-gradient-to-b from-transparent to-ivory md:hidden" />}
      {hero && <div aria-hidden className="pointer-events-none absolute inset-0 hidden bg-[radial-gradient(ellipse_at_10%_100%,rgba(20,17,14,.7)_0%,rgba(20,17,14,.3)_35%,rgba(20,17,14,0)_60%)] md:block" />}
      {hero && <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 hidden h-[55%] bg-gradient-to-t from-black/70 via-black/35 to-transparent md:block" />}

      <div className={`relative mx-auto flex max-w-6xl flex-col px-6 md:min-h-dvh md:justify-end md:px-10 md:pb-10 ${hero ? "-mt-10 pb-10 md:mt-0" : "min-h-dvh justify-center"} ${hero ? "md:text-white" : ""}`}>
        <p className={`fade-up text-[13px] uppercase tracking-[0.22em] ${hero ? "text-muted md:text-white/75" : "text-muted"}`}>{info?.eventTitle ?? " "}</p>
        <h1 className="fade-up mt-4 max-w-2xl font-serif text-[42px] leading-[1.04] tracking-tight md:text-[54px] md:max-w-4xl" style={{ animationDelay: "80ms" }}>
          As fotos de todo mundo, <em className={`not-italic md:italic ${hero ? "text-terra md:text-[#f3cbb9]" : "text-terra"}`}>em um só lugar.</em>
        </h1>
        <p className={`fade-up mt-3 max-w-md text-[17px] leading-relaxed ${hero ? "text-muted md:text-white/80" : "text-muted"}`} style={{ animationDelay: "160ms" }}>
          {info?.subtitle ?? "Envie as suas. Baixe as de todo mundo. Sem perder o original."}
        </p>
        <div className="fade-up mt-7 flex flex-col gap-3 sm:flex-row" style={{ animationDelay: "240ms" }}>
          <Link href="/login" className="btn-primary h-13 px-8 text-base">Já tenho acesso</Link>
          <Link href="/onboarding" className={`btn h-13 px-8 text-base ${hero ? "border border-line bg-card text-ink md:border-white/40 md:bg-white/10 md:text-white md:backdrop-blur-md md:hover:bg-white/20" : "btn-ghost"}`}>Primeiro acesso</Link>
        </div>
        <p className={`fade-up mt-7 text-xs ${hero ? "text-muted/80 md:text-white/60" : "text-muted/80"}`} style={{ animationDelay: "320ms" }}>
          Álbum privado da família · os arquivos originais são preservados.
        </p>
        <Footer className={`fade-up mt-4 !text-left ${hero ? "md:!text-white/60 md:[&_span]:!text-white/80" : ""}`} />
      </div>
    </main>
  );
}
