"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fmtBytes } from "@/lib/format";
import { StatCard } from "@/components/AdminShell";

type O = { stats: any; packages: Record<string, number> };
export default function Overview() {
  const [o, setO] = useState<O | null>(null);
  const [sent, setSent] = useState(false);
  useEffect(() => { api<O>("/api/admin/overview").then(setO); }, []);
  if (!o) return <div className="skeleton h-64 rounded-2xl" />;
  const s = o.stats;
  const used = s.disk ? s.disk.total - s.disk.free : 0;
  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-sm font-medium text-muted">Últimas 24 horas</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Novos usuários" value={s.users.new} hint={`${s.users.total} no total`} />
          <StatCard label="Arquivos recebidos" value={s.media.uploads} hint={`${s.media.photos} fotos · ${s.media.videos} vídeos · ${s.media.others} outros`} />
          <StatCard label="Volume recebido" value={fmtBytes(s.media.bytes_new)} />
          <StatCard label="Downloads" value={s.downloads} />
          <StatCard label="Duplicatas" value={s.events.dups} />
          <StatCard label="Restaurados" value={s.events.restored} tone="sage" />
          <StatCard label="Erros de upload" value={s.uploads.errors} tone={s.uploads.errors ? "danger" : undefined} />
          <StatCard label="Falhas de e-mail" value={s.events.email_failed} tone={s.events.email_failed ? "danger" : undefined} />
        </div>
      </section>
      <section>
        <h2 className="mb-3 text-sm font-medium text-muted">Acumulado e armazenamento</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Mídias ativas" value={s.media.total_active.toLocaleString("pt-BR")} hint={`${s.media.total_deleted} excluídas (soft)`} />
          <StatCard label="Originais" value={fmtBytes(s.media.originals_bytes)} />
          <StatCard label="Thumbnails" value={fmtBytes(s.thumbsBytes)} />
          <StatCard label="Pacotes ZIP" value={fmtBytes(s.packagesBytes)} hint={Object.entries(o.packages).map(([k, v]) => `${v} ${k}`).join(" · ")} />
        </div>
        {s.disk && (
          <div className="card mt-3 p-5">
            <div className="flex justify-between text-sm"><span>Disco do storage</span><span className="tabular-nums text-muted">{fmtBytes(s.disk.free)} livres de {fmtBytes(s.disk.total)}</span></div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-ivory-deep"><div className="h-full rounded-full bg-sage" style={{ width: `${(used / s.disk.total) * 100}%` }} /></div>
          </div>
        )}
      </section>
      <section className="grid gap-3 md:grid-cols-3">
        <StatCard label="Jobs pendentes" value={s.jobs.pending} hint={`${s.jobs.running} rodando agora`} />
        <StatCard label="Jobs em retry" value={s.jobs.retrying} tone={s.jobs.retrying ? "amber" : undefined} />
        <StatCard label="Jobs falhos" value={s.jobs.failed} tone={s.jobs.failed ? "danger" : "sage"} hint={s.jobs.failed ? "veja em Jobs" : "tudo saudável"} />
      </section>
      <button className="btn-ghost btn-sm" disabled={sent} onClick={async () => { await api("/api/admin/report", { method: "POST" }); setSent(true); }}>
        {sent ? "✓ Relatório enviado" : "Enviar relatório diário agora"}
      </button>
    </div>
  );
}
