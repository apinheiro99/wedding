"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Footer } from "@/components/Footer";

type Info = { eventTitle: string; motto: string; subtitle: string };

const TILES = [
  "from-[#e9d6c9] to-[#d9b8a5]", "from-[#dfe3da] to-[#c3cbbd]", "from-[#f1e4cf] to-[#e0c79f]",
  "from-[#e7d9d3] to-[#c9a99c]", "from-[#ece6dd] to-[#d6cabb]", "from-[#e3d3c0] to-[#caa98a]",
];

export default function Landing() {
  const [info, setInfo] = useState<Info | null>(null);
  useEffect(() => { api<Info>("/api/public/info").then(setInfo).catch(() => {}); }, []);

  return (
    <main className="relative min-h-dvh overflow-hidden">
      {/* soft photographic collage */}
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-70">
        <div className="absolute -top-16 -right-24 grid grid-cols-3 gap-3 rotate-[8deg] md:-right-10 md:top-10">
          {TILES.map((t, i) => (
            <div key={i}
              className={`h-36 w-28 md:h-52 md:w-40 rounded-2xl bg-gradient-to-br ${t} shadow-soft fade-up`}
              style={{ animationDelay: `${120 + i * 70}ms`, transform: `translateY(${(i % 3) * 22}px)` }} />
          ))}
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-ivory via-ivory/85 to-ivory/10 md:bg-gradient-to-r md:from-ivory md:via-ivory/90 md:to-transparent" />
      </div>

      <div className="relative mx-auto flex min-h-dvh max-w-6xl flex-col justify-end px-6 pb-14 pt-24 md:justify-center md:px-10">
        <p className="fade-up text-[13px] uppercase tracking-[0.22em] text-muted">{info?.eventTitle ?? " "}</p>
        <h1 className="fade-up mt-4 max-w-xl font-serif text-[44px] leading-[1.04] tracking-tight md:text-[68px]"
          style={{ animationDelay: "80ms" }}>
          As fotos de todo mundo, <em className="text-terra not-italic md:italic">em um só lugar.</em>
        </h1>
        <p className="fade-up mt-5 max-w-md text-[17px] leading-relaxed text-muted" style={{ animationDelay: "160ms" }}>
          {info?.subtitle ?? "Envie as suas. Baixe as de todo mundo. Sem perder o original."}
        </p>
        <div className="fade-up mt-10 flex flex-col gap-3 sm:flex-row" style={{ animationDelay: "240ms" }}>
          <Link href="/login" className="btn-primary h-13 px-8 text-base">Já tenho acesso</Link>
          <Link href="/onboarding" className="btn-ghost h-13 px-8 text-base">Primeiro acesso</Link>
        </div>
        <p className="fade-up mt-10 text-xs text-muted/80" style={{ animationDelay: "320ms" }}>
          Álbum privado da família · os arquivos originais são preservados.
        </p>
        <Footer className="fade-up mt-6 !text-left" />
      </div>
    </main>
  );
}
