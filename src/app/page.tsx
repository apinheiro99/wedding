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
    <main className={`relative min-h-dvh overflow-hidden bg-ivory ${hero ? "md:bg-[#1d1a17]" : ""}`}>
      {hero && (
        <picture>
          <source media="(min-width: 768px)" srcSet={`/api/public/hero?w=1920&${desk}`} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/public/hero?w=900&${mob}`} alt="" onLoad={() => setLoaded(true)}
            className={`h-[58dvh] w-full object-cover object-[52%_40%] transition-all duration-[1600ms] ease-out md:absolute md:inset-0 md:h-full md:object-[70%_50%] ${loaded ? "scale-100 opacity-100" : "scale-[1.04] opacity-0"}`} />
        </picture>
      )}
      {hero && <div aria-hidden className="pointer-events-none absolute inset-x-0 top-[38dvh] h-[20dvh] bg-gradient-to-b from-transparent to-ivory md:hidden" />}
      {hero && <div aria-hidden className="pointer-events-none absolute inset-0 hidden bg-gradient-to-r from-[rgba(20,17,14,.78)] via-[rgba(20,17,14,.38)_45%] to-transparent md:block" />}
      {hero && <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 hidden h-1/3 bg-gradient-to-t from-black/40 to-transparent md:block" />}

      <div className={`relative mx-auto flex max-w-6xl flex-col px-6 md:min-h-dvh md:justify-center md:px-10 md:py-16 ${hero ? "-mt-10 pb-10 md:mt-0" : "min-h-dvh justify-center"} ${hero ? "md:text-white" : ""}`}>
        <div className="md:max-w-[560px]">
          <p className={`fade-up text-[13px] uppercase tracking-[0.22em] ${hero ? "text-muted md:text-white/75" : "text-muted"}`}>{info?.eventTitle ?? " "}</p>
          <h1 className="fade-up mt-4 font-serif text-[42px] leading-[1.04] tracking-tight md:text-[68px]" style={{ animationDelay: "80ms" }}>
            Nosso dia, <em className={`not-italic md:italic ${hero ? "text-terra md:text-[#f3cbb9]" : "text-terra"}`}>por todos os olhares.</em>
          </h1>
          <p className={`fade-up mt-5 max-w-md text-[17px] leading-relaxed ${hero ? "text-muted md:text-white/85" : "text-muted"}`} style={{ animationDelay: "160ms" }}>
            {info?.subtitle ?? "Envie suas fotos e veja as lembranças que cada pessoa guardou desse dia."}
          </p>
          <div className="fade-up mt-9 flex flex-col gap-3 sm:flex-row" style={{ animationDelay: "240ms" }}>
            <Link href="/login" className="btn-primary h-13 px-8 text-base">Entrar no álbum</Link>
            <Link href="/onboarding" className={`btn h-13 px-8 text-base ${hero ? "border border-line bg-card text-ink md:border-white/40 md:bg-white/10 md:text-white md:backdrop-blur-md md:hover:bg-white/20" : "btn-ghost"}`}>Primeiro acesso</Link>
          </div>
          <p className={`fade-up mt-9 text-xs ${hero ? "text-muted/80 md:text-white/65" : "text-muted/80"}`} style={{ animationDelay: "320ms" }}>
            Álbum privado da família · os arquivos originais são preservados.
          </p>
          <Footer className={`fade-up mt-4 !text-left ${hero ? "md:!text-white/65 md:[&_span]:!text-white/85" : ""}`} />
        </div>
      </div>
    </main>
  );
}
