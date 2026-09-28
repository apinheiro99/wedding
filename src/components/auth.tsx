"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { Footer } from "./Footer";

export function AuthShell({ title, subtitle, step, children }: { title: string; subtitle?: string; step?: string; children: React.ReactNode }) {
  return (
    <main className="min-h-dvh flex flex-col">
      <header className="px-6 pt-6 md:px-10">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted hover:text-ink transition">
          <span aria-hidden>←</span> Voltar
        </Link>
      </header>
      <div className="flex-1 flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-[400px] fade-up">
          {step && <p className="text-[12px] uppercase tracking-[0.2em] text-terra mb-3">{step}</p>}
          <h1 className="font-serif text-[34px] leading-tight tracking-tight">{title}</h1>
          {subtitle && <p className="mt-2 text-muted leading-relaxed">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </div>
      <Footer className="pb-6" />
    </main>
  );
}

export function ErrorNote({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <p role="alert" className="mt-4 flex items-start gap-2 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
      <span aria-hidden className="mt-px">⚠</span>{msg}
    </p>
  );
}

export function OtpInput({ onComplete, disabled }: { onComplete: (code: string) => void; disabled?: boolean }) {
  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  function setAt(i: number, v: string) {
    const clean = v.replace(/\D/g, "");
    if (clean.length > 1) {
      const next = clean.slice(0, 6).split("");
      const arr = Array(6).fill("").map((_, k) => next[k] ?? "");
      setDigits(arr);
      refs.current[Math.min(next.length, 5)]?.focus();
      if (next.length === 6) onComplete(arr.join(""));
      return;
    }
    const arr = [...digits];
    arr[i] = clean;
    setDigits(arr);
    if (clean && i < 5) refs.current[i + 1]?.focus();
    if (arr.every((d) => d)) onComplete(arr.join(""));
  }

  return (
    <div className="flex justify-between gap-2" role="group" aria-label="Código de 6 dígitos">
      {digits.map((d, i) => (
        <input key={i} ref={(el) => { refs.current[i] = el; }}
          value={d} disabled={disabled} inputMode="numeric" autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={`Dígito ${i + 1}`} autoFocus={i === 0}
          onChange={(e) => setAt(i, e.target.value)}
          onKeyDown={(e) => { if (e.key === "Backspace" && !d && i > 0) refs.current[i - 1]?.focus(); }}
          className="h-14 w-12 rounded-xl border border-line bg-card text-center text-2xl font-medium outline-none transition focus:border-terra focus:ring-4 focus:ring-terra/10 disabled:opacity-60" />
      ))}
    </div>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent ${className}`} />;
}
