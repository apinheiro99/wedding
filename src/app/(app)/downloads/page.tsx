"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useEvents } from "@/lib/events";
import { useMe } from "@/lib/me";
import { fmtBytes, plural } from "@/lib/format";
import { PageHeader } from "@/components/AppShell";
import { Avatar } from "@/components/Avatar";

type Pkg = { id: string; label: string; available: boolean; updating: boolean; failed: boolean; bytes: number | null; items: number | null; state: string };
type Uploader = { userId: string; displayName: string; photos: number; videos: number; others: number; bytes: number; packages: Pkg[] };

export default function Downloads() {
  const { me } = useMe();
  const [data, setData] = useState<Uploader[] | null>(null);
  const load = useCallback(() => api<{ uploaders: Uploader[] }>("/api/packages").then((r) => setData(r.uploaders)).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  useEvents((e) => { if (e.t === "package" || e.t === "media") load(); });

  const total = data?.reduce((a, u) => a + u.bytes, 0) ?? 0;
  const sorted = data ? [...data].sort((a, b) => (a.userId === me.id ? -1 : b.userId === me.id ? 1 : 0)) : null;

  return (
    <>
      <PageHeader title="Downloads"
        subtitle={data ? <>Tudo o que a família enviou, separado por pessoa · {fmtBytes(total)}</> : " "} />

      <div className="mb-6 flex items-start gap-3 rounded-2xl border border-line/70 bg-card/60 p-4 text-sm text-muted">
        <span aria-hidden className="mt-0.5 text-terra">✦</span>
        <p>Cada pessoa tem pacotes <b className="text-ink">.zip</b> de até ~2 GB. Cada pacote abre sozinho, sem depender dos outros, e tem os arquivos <b className="text-ink">originais</b>. Para escolher só algumas fotos, selecione na galeria.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {sorted?.map((u) => (
          <article key={u.userId} className="card p-5 md:p-6 fade-up">
            <header className="flex items-center gap-3">
              <Avatar id={u.userId} name={u.displayName} size={44} />
              <div className="min-w-0 flex-1">
                <h2 className="flex items-center gap-2 truncate text-lg font-medium">
                  {u.displayName}
                  {u.userId === me.id && <span className="rounded-full bg-terra-soft px-2 py-0.5 text-[11px] font-medium text-terra">você</span>}
                </h2>
                <p className="text-sm text-muted">
                  {[u.photos && plural(u.photos, "foto", "fotos"), u.videos && plural(u.videos, "vídeo", "vídeos"), u.others && plural(u.others, "outro", "outros")].filter(Boolean).join(" · ")} · {fmtBytes(u.bytes)}
                </p>
              </div>
            </header>
            <div className="mt-5 flex flex-wrap gap-2">
              {u.packages.map((p) => <PackageButton key={p.id} p={p} />)}
              {u.packages.length === 0 && <span className="text-sm text-muted">Preparando…</span>}
            </div>
          </article>
        ))}
        {data === null && Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-40 rounded-2xl" />)}
      </div>
      {data?.length === 0 && (
        <div className="card p-10 text-center text-muted">Ainda não há nada para baixar. Os pacotes aparecem aqui assim que alguém enviar fotos.</div>
      )}
    </>
  );
}

function PackageButton({ p }: { p: Pkg }) {
  if (p.available) {
    return (
      <a href={`/api/packages/${p.id}/download`} title={p.updating ? "Uma versão atualizada está sendo preparada" : undefined}
        className="group flex items-center gap-3 rounded-2xl border border-line bg-ivory/60 py-2 pl-2 pr-4 transition hover:border-terra hover:bg-terra-soft/40">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-terra text-sm font-semibold text-white transition group-hover:scale-105">{p.label}</span>
        <span className="leading-tight">
          <span className="block text-sm font-medium">Baixar {p.label}</span>
          <span className="block text-xs text-muted">{fmtBytes(p.bytes)}{p.items ? ` · ${p.items} arq.` : ""}{p.updating ? " · atualizando" : ""}</span>
        </span>
      </a>
    );
  }
  return (
    <span className="flex items-center gap-3 rounded-2xl border border-dashed border-line py-2 pl-2 pr-4 text-muted" aria-live="polite">
      <span className={`grid h-10 w-10 place-items-center rounded-xl bg-ivory-deep text-sm font-semibold ${p.failed ? "" : "animate-pulse"}`}>{p.label}</span>
      <span className="leading-tight">
        <span className="block text-sm">{p.failed ? "Falhou" : "Preparando…"}</span>
        <span className="block text-xs">{p.failed ? "vamos tentar de novo" : "fica pronto em instantes"}</span>
      </span>
    </span>
  );
}
