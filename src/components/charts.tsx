"use client";
// Small dependency-free SVG/HTML charts. Palette validated with the dataviz checker (light surface).
import { useState } from "react";

export const CAT = ["#C0603F", "#2F7FB0", "#B07D10", "#8E5A9A", "#3F8F5F"] as const;
export const SEQ = "#C0603F";

export function Card({ title, subtitle, children, className = "" }: { title: string; subtitle?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`card p-5 md:p-6 ${className}`}>
      <h3 className="font-medium">{title}</h3>
      {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

export function Kpi({ label, value, hint, accent }: { label: string; value: React.ReactNode; hint?: React.ReactNode; accent?: boolean }) {
  return (
    <div className={`card relative overflow-hidden p-5 ${accent ? "bg-ink text-ivory border-ink" : ""}`}>
      <p className={`text-[11px] uppercase tracking-[0.14em] ${accent ? "text-ivory/60" : "text-muted"}`}>{label}</p>
      <p className="mt-2 font-serif text-[34px] leading-none tabular-nums tracking-tight">{value}</p>
      {hint && <p className={`mt-2 text-xs ${accent ? "text-ivory/60" : "text-muted"}`}>{hint}</p>}
    </div>
  );
}

/** Horizontal bars, direct-labeled; one series, one hue. */
export function BarList({ rows, format = (n) => n.toLocaleString("pt-BR"), color = SEQ, lead }: {
  rows: { key: string; label: React.ReactNode; value: number; sub?: string }[]; format?: (n: number) => string; color?: string; lead?: (key: string) => React.ReactNode;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <Empty />;
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.key} className="group" title={`${typeof r.label === "string" ? r.label : r.key}: ${format(r.value)}${r.sub ? ` · ${r.sub}` : ""}`}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2 truncate">{lead?.(r.key)}{r.label}</span>
            <span className="shrink-0 tabular-nums text-muted">{format(r.value)}{r.sub && <span className="ml-1.5 text-xs opacity-70">{r.sub}</span>}</span>
          </div>
          <div className="h-2 rounded-full bg-ivory-deep">
            <div className="h-full rounded-full transition-all duration-700 group-hover:opacity-80" style={{ width: `${(r.value / max) * 100}%`, background: color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Donut with legend + direct values (identity never color-alone). */
export function Donut({ parts, center, centerLabel, format = (n) => n.toLocaleString("pt-BR") }: {
  parts: { label: string; value: number }[]; center: React.ReactNode; centerLabel: string; format?: (n: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const total = parts.reduce((a, p) => a + p.value, 0);
  const R = 70, W = 18, C = 2 * Math.PI * R, GAP = parts.filter((p) => p.value).length > 1 ? 2 : 0;
  let acc = 0;
  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row">
      <svg viewBox="0 0 180 180" className="h-44 w-44 shrink-0" role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(", ")}>
        <circle cx="90" cy="90" r={R} fill="none" stroke="var(--color-ivory-deep)" strokeWidth={W} />
        {total > 0 && parts.map((p, i) => {
          const len = (p.value / total) * C;
          const el = p.value ? (
            <circle key={p.label} cx="90" cy="90" r={R} fill="none" stroke={CAT[i % CAT.length]} strokeWidth={hover === i ? W + 4 : W}
              strokeDasharray={`${Math.max(0, len - GAP)} ${C}`} strokeDashoffset={-acc} transform="rotate(-90 90 90)"
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} className="cursor-pointer transition-all">
              <title>{`${p.label}: ${format(p.value)} (${Math.round((p.value / total) * 100)}%)`}</title>
            </circle>
          ) : null;
          acc += len;
          return el;
        })}
        <text x="90" y="88" textAnchor="middle" className="fill-ink font-serif" fontSize="26">{hover != null ? format(parts[hover]!.value) : center}</text>
        <text x="90" y="108" textAnchor="middle" className="fill-muted" fontSize="10" letterSpacing="1">{(hover != null ? parts[hover]!.label : centerLabel).toUpperCase()}</text>
      </svg>
      <ul className="w-full space-y-2 text-sm">
        {parts.map((p, i) => (
          <li key={p.label} className="flex items-center justify-between gap-3" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: CAT[i % CAT.length] }} />{p.label}</span>
            <span className="tabular-nums text-muted">{format(p.value)} <span className="text-xs">· {total ? Math.round((p.value / total) * 100) : 0}%</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Vertical columns with hover tooltip; labels thinned to avoid collisions. */
export function Columns({ values, labels, format = (n) => n.toLocaleString("pt-BR"), every = 1, height = 160, color = SEQ, tooltip }: {
  values: number[]; labels: string[]; format?: (n: number) => string; every?: number; height?: number; color?: string; tooltip?: (i: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...values);
  return (
    <div className="relative">
      <div className="absolute inset-x-0 top-0 border-t border-dashed border-line" aria-hidden />
      <span className="absolute -top-2.5 right-0 bg-card pl-1 text-[10px] tabular-nums text-muted">{format(max)}</span>
      <div className="flex items-end gap-[2px]" style={{ height }}>
        {values.map((v, i) => (
          <div key={i} className="relative flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <div className="w-full rounded-t-[4px] transition-all" style={{ height: `${(v / max) * 100}%`, minHeight: v ? 3 : 0, background: color, opacity: hover == null || hover === i ? 1 : 0.45 }} />
            {hover === i && (
              <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-xs text-ivory shadow-lift">
                {tooltip ? tooltip(i) : `${labels[i]}: ${format(v)}`}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-2 flex min-h-5 gap-[2px] border-t border-line pt-1.5">
        {labels.map((l, i) => <span key={i} className="relative flex-1 text-center text-[10px] leading-tight text-muted">{i % every === 0 && <span className={every > 1 ? "absolute left-0 whitespace-nowrap" : ""}>{l}</span>}</span>)}
      </div>
    </div>
  );
}

export function Meter({ used, total, label }: { used: number; total: number; label: React.ReactNode }) {
  const pct = total ? (used / total) * 100 : 0;
  return (
    <div>
      <div className="flex justify-between text-sm"><span>{label}</span><span className="tabular-nums text-muted">{pct.toFixed(1).replace(".", ",")}%</span></div>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-ivory-deep"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct > 85 ? "var(--color-danger)" : "var(--color-sage)" }} /></div>
    </div>
  );
}

function Empty() {
  return <p className="py-6 text-center text-sm text-muted">Sem dados ainda.</p>;
}
