"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { manager, type Snapshot } from "@/lib/upload/manager";

/** Shows transfer progress while browsing other pages (uploads keep running in this tab). */
export function UploadPill() {
  const [s, setS] = useState<Snapshot | null>(null);
  useEffect(() => manager().subscribe(setS), []);
  if (!s || s.totals.pending === 0) return null;
  const pct = s.totals.bytesTotal ? Math.floor((s.totals.bytesDone / s.totals.bytesTotal) * 100) : 0;
  return (
    <Link href="/upload" className="fixed bottom-24 right-4 z-40 flex items-center gap-3 rounded-full bg-ink py-2 pl-2 pr-4 text-sm text-ivory shadow-lift fade-up md:bottom-6 md:right-6">
      <span className="relative grid h-9 w-9 place-items-center">
        <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90" aria-hidden>
          <circle cx="18" cy="18" r="15" fill="none" stroke="rgb(255 255 255 / .15)" strokeWidth="3" />
          <circle cx="18" cy="18" r="15" fill="none" stroke="#B86F59" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${(pct / 100) * 94.2} 94.2`} />
        </svg>
        <span className="text-[10px] font-medium tabular-nums">{pct}%</span>
      </span>
      {s.paused ? "Envio pausado" : `Enviando ${s.totals.pending.toLocaleString("pt-BR")}`}
    </Link>
  );
}
