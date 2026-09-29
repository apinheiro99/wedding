"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { manager, TERMINAL, type Item, type ItemState, type Snapshot } from "@/lib/upload/manager";
import { fmtBytes, plural } from "@/lib/format";
import { PageHeader } from "@/components/AppShell";

type Filter = "all" | "active" | "done" | "dup" | "err";
const FILTERS: { k: Filter; label: string }[] = [
  { k: "all", label: "Todos" }, { k: "active", label: "Enviando" }, { k: "done", label: "Concluídos" }, { k: "dup", label: "Duplicados" }, { k: "err", label: "Erros" },
];
const ACTIVE: ItemState[] = ["HASH_WAIT", "HASHING", "CHECKING", "QUEUED", "UPLOADING", "PAUSED", "RETRY_WAIT", "VERIFYING", "NEEDS_FILE"];
const match = (f: Filter, s: ItemState) =>
  f === "all" || (f === "active" && ACTIVE.includes(s)) || (f === "done" && s === "COMPLETE") || (f === "dup" && (s === "DUPLICATE" || s === "RESTORED")) || (f === "err" && (s === "FAILED" || s === "CANCELLED"));

export default function UploadPage() {
  const m = useMemo(() => manager(), []);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [drag, setDrag] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);
  useEffect(() => m.subscribe(setSnap), [m]);
  // The phone's own photo picker (iCloud download/HEIC-video conversion) can take a while before
  // it hands files back to us, and until then we get no event at all — so as soon as the picker is
  // opened we show our own "preparando" message, and clear it once files arrive (onChange) or the
  // picker is dismissed (window regains focus), whichever comes first.
  useEffect(() => {
    const onFocus = () => setTimeout(() => setPreparing(false), 600);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  const openPicker = (ref: typeof fileRef) => { setPreparing(true); ref.current?.click(); };

  const t = snap?.totals;
  const list = useMemo(() => (snap ? snap.items.filter((i) => match(filter, i.state)) : []), [snap, filter]);
  const pct = t && t.bytesTotal ? Math.min(100, (t.bytesDone / t.bytesTotal) * 100) : 0;
  const hasItems = !!t && t.total > 0;
  const running = !!t && t.pending > 0;

  const pick = (files: FileList | null) => { setPreparing(false); if (files?.length) void m.addFiles(Array.from(files)); };

  return (
    <>
      <PageHeader title="Enviar" subtitle="Fotos e vídeos em qualidade original. Pode mandar muitos de uma vez." />

      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files); }}
        className={`relative overflow-hidden rounded-3xl border-2 border-dashed transition ${drag ? "border-terra bg-terra-soft/60 scale-[1.01]" : "border-line bg-card"} ${hasItems ? "p-5 md:p-6" : "p-8 md:p-14"}`}>
        <div className={`flex ${hasItems ? "flex-col gap-4 sm:flex-row sm:items-center sm:justify-between" : "flex-col items-center text-center"}`}>
          <div className={`flex ${hasItems ? "items-center gap-4" : "flex-col items-center"}`}>
            <div className={`grid shrink-0 place-items-center rounded-2xl bg-terra-soft text-terra ${hasItems ? "h-12 w-12" : "mb-5 h-20 w-20"}`}>
              <svg viewBox="0 0 24 24" className={hasItems ? "h-6 w-6" : "h-9 w-9"} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 16V4M7 9l5-5 5 5M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" /></svg>
            </div>
            <div>
              <p className={`font-serif ${hasItems ? "text-xl" : "text-2xl md:text-3xl"}`}>{hasItems ? "Adicionar mais" : "Arraste suas fotos e vídeos para cá"}</p>
              <p className="mt-1 text-sm text-muted">{hasItems ? "Os novos entram no fim da fila." : "Ou escolha do celular, do computador, ou uma pasta inteira. Sem limite de quantidade."}</p>
            </div>
          </div>
          <div className={`flex flex-wrap gap-2 ${hasItems ? "" : "mt-7 justify-center"}`}>
            <button className="btn-primary" disabled={preparing} onClick={() => openPicker(fileRef)}>{preparing ? "Abrindo…" : "Selecionar arquivos"}</button>
            <button className="btn-ghost hidden sm:inline-flex" disabled={preparing} onClick={() => openPicker(dirRef)}>Selecionar pasta</button>
          </div>
        </div>
        <input ref={fileRef} type="file" multiple hidden accept="image/*,video/*,*/*" onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
        <input ref={dirRef} type="file" multiple hidden {...({ webkitdirectory: "", directory: "" } as object)} onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
      </div>

      {preparing && (
        <p role="status" className="mt-4 flex items-center gap-2 rounded-2xl bg-terra-soft px-4 py-3 text-sm text-terra-dark">
          <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent" />
          Abrindo suas fotos… vídeos e fotos guardados só na nuvem (iCloud) podem levar alguns segundos. Não feche esta página.
        </p>
      )}

      {snap && !snap.online && (
        <p role="status" className="mt-4 flex items-center gap-2 rounded-2xl bg-amber-soft px-4 py-3 text-sm text-amber">
          <span className="h-2 w-2 animate-pulse rounded-full bg-amber" /> Sem conexão. O envio continua sozinho quando a internet voltar.
        </p>
      )}
      {!!t?.needsFile && (
        <p role="status" className="mt-4 rounded-2xl bg-amber-soft px-4 py-3 text-sm text-amber">
          {plural(t.needsFile, "arquivo precisa", "arquivos precisam")} ser selecionado(s) de novo para continuar de onde parou. Selecione os mesmos arquivos acima.
        </p>
      )}

      {hasItems && t && snap && (
        <section className="card mt-6 overflow-hidden fade-up" aria-label="Progresso do envio">
          <div className="p-5 md:p-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-sm text-muted">{running ? (snap.paused ? "Pausado" : "Enviando…") : t.failed ? "Terminado, com erros" : "Tudo enviado ✦"}</p>
                <p className="mt-1 font-serif text-4xl tabular-nums tracking-tight">{Math.floor(pct)}<span className="text-2xl text-muted">%</span></p>
                <p className="mt-1 text-sm tabular-nums text-muted">
                  {fmtBytes(t.bytesDone)} de {fmtBytes(t.bytesTotal)}
                  {running && !snap.paused && snap.speed > 0 && <> · {fmtBytes(snap.speed)}/s</>}
                  {snap.eta != null && running && !snap.paused && <> · cerca de {fmtEta(snap.eta)}</>}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {running && (snap.paused
                  ? <button className="btn-primary btn-sm" onClick={() => m.resume()}>▶ Retomar</button>
                  : <button className="btn-ghost btn-sm" onClick={() => m.pause()}>❚❚ Pausar</button>)}
                {t.failed > 0 && <button className="btn-ghost btn-sm" onClick={() => m.retryFailed()}>↻ Repetir erros</button>}
                {running && <button className="btn-ghost btn-sm text-danger" onClick={() => m.cancelPending()}>Cancelar pendentes</button>}
                {!running && <button className="btn-ghost btn-sm" onClick={() => m.clearFinished()}>Limpar lista</button>}
              </div>
            </div>
            <div className="mt-5 h-2.5 overflow-hidden rounded-full bg-ivory-deep" role="progressbar" aria-valuenow={Math.floor(pct)} aria-valuemin={0} aria-valuemax={100}>
              <div className={`h-full rounded-full transition-[width] duration-500 ${running ? "bg-terra" : t.failed ? "bg-amber" : "bg-sage"}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
          <dl className="grid grid-cols-3 border-t border-line/70 text-center sm:grid-cols-6">
            <Stat k="Selecionados" v={t.total} />
            <Stat k="Concluídos" v={t.complete} tone="sage" />
            <Stat k="Duplicados" v={t.duplicate} />
            <Stat k="Restaurados" v={t.restored} />
            <Stat k="Pendentes" v={t.pending + t.needsFile} tone="amber" />
            <Stat k="Erros" v={t.failed} tone="danger" />
          </dl>
        </section>
      )}

      {hasItems && (
        <section className="mt-6" aria-label="Fila de arquivos">
          <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0 [scrollbar-width:none]" role="tablist">
            {FILTERS.map((f) => {
              const n = snap!.items.reduce((a, i) => a + (match(f.k, i.state) ? 1 : 0), 0);
              return (
                <button key={f.k} role="tab" aria-selected={filter === f.k} onClick={() => setFilter(f.k)}
                  className={`shrink-0 rounded-full border px-4 py-1.5 text-sm transition ${filter === f.k ? "border-ink bg-ink text-ivory" : "border-line bg-card text-muted hover:text-ink"}`}>
                  {f.label} <span className="ml-1 tabular-nums opacity-60">{n.toLocaleString("pt-BR")}</span>
                </button>
              );
            })}
          </div>
          <VirtualList items={list} onPause={(k) => m.pauseItem(k)} onResume={(k) => m.resumeItem(k)} />
        </section>
      )}

      {!hasItems && (
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {[
            ["Original preservado", "Nada é comprimido nem convertido. A foto chega do jeito que saiu da câmera."],
            ["Pode fechar e voltar", "Se a internet cair, o envio continua de onde parou."],
            ["Sem duplicadas", "Se alguém já enviou a mesma foto, ela não é guardada duas vezes."],
          ].map(([h, p]) => (
            <div key={h} className="rounded-2xl border border-line/70 p-5">
              <p className="font-medium">{h}</p><p className="mt-1 text-sm text-muted leading-relaxed">{p}</p>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function fmtEta(s: number) {
  if (s < 90) return "1 min";
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
}

function Stat({ k, v, tone }: { k: string; v: number; tone?: "sage" | "amber" | "danger" }) {
  const c = tone === "sage" ? "text-sage" : tone === "amber" ? "text-amber" : tone === "danger" ? "text-danger" : "text-ink";
  return (
    <div className="border-line/70 px-2 py-4 [&:not(:last-child)]:border-r max-sm:[&:nth-child(3)]:border-r-0 max-sm:[&:nth-child(-n+3)]:border-b">
      <dd className={`font-serif text-2xl tabular-nums ${v ? c : "text-muted/50"}`}>{v.toLocaleString("pt-BR")}</dd>
      <dt className="mt-0.5 text-[11px] uppercase tracking-wider text-muted">{k}</dt>
    </div>
  );
}

const ROW = 64;
function VirtualList({ items, onPause, onResume }: { items: Item[]; onPause: (k: string) => void; onResume: (k: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(0);
  const height = Math.min(560, Math.max(ROW * 3, items.length * ROW));
  const start = Math.max(0, Math.floor(scroll / ROW) - 6);
  const end = Math.min(items.length, Math.ceil((scroll + height) / ROW) + 6);
  if (!items.length) return <div className="card grid h-32 place-items-center text-sm text-muted">Nada por aqui.</div>;
  return (
    <div ref={ref} onScroll={(e) => setScroll(e.currentTarget.scrollTop)} className="card overflow-y-auto" style={{ height }}>
      <div style={{ height: items.length * ROW, position: "relative" }}>
        {items.slice(start, end).map((it, i) => (
          <Row key={it.key} it={it} top={(start + i) * ROW} onPause={onPause} onResume={onResume} />
        ))}
      </div>
    </div>
  );
}

const LABEL: Record<ItemState, [string, string]> = {
  HASH_WAIT: ["Aguardando verificação", "text-muted"], HASHING: ["Verificando", "text-muted"], CHECKING: ["Procurando duplicata", "text-muted"],
  QUEUED: ["Na fila", "text-muted"], UPLOADING: ["Enviando", "text-terra"], PAUSED: ["Pausado", "text-amber"], RETRY_WAIT: ["Tentando de novo…", "text-amber"],
  VERIFYING: ["Finalizando", "text-amber"], COMPLETE: ["Concluído", "text-sage"], DUPLICATE: ["Duplicado — já está no álbum", "text-muted"],
  RESTORED: ["Restaurado — já existia no servidor", "text-sage"], FAILED: ["Erro", "text-danger"], CANCELLED: ["Cancelado", "text-muted"],
  NEEDS_FILE: ["Selecione de novo para continuar", "text-amber"],
};

function Row({ it, top, onPause, onResume }: { it: Item; top: number; onPause: (k: string) => void; onResume: (k: string) => void }) {
  const [label, color] = LABEL[it.state];
  const p = it.state === "HASHING" ? it.hashProgress : it.size ? it.sent / it.size : 1;
  const icon = it.state === "COMPLETE" || it.state === "RESTORED" ? "✓" : it.state === "FAILED" ? "!" : it.state === "DUPLICATE" ? "=" : null;
  const isVideo = it.type.startsWith("video/") || /\.(mov|mp4|m4v|3gp|avi|mkv)$/i.test(it.name);
  return (
    <div className="absolute inset-x-0 flex items-center gap-3 border-b border-line/50 px-4" style={{ top, height: ROW }}>
      <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl text-sm font-medium ${it.state === "COMPLETE" || it.state === "RESTORED" ? "bg-sage-soft text-sage" : it.state === "FAILED" ? "bg-danger-soft text-danger" : "bg-ivory-deep text-muted"}`}>
        {icon ?? (isVideo ? "▶" : "◐")}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate text-sm font-medium" title={it.relPath || it.name}>{it.name}</p>
          <p className="shrink-0 text-xs tabular-nums text-muted">{fmtBytes(it.size)}</p>
        </div>
        <div className="mt-1.5 flex items-center gap-3">
          {!TERMINAL.includes(it.state) && it.state !== "NEEDS_FILE" ? (
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-ivory-deep">
              <div className={`h-full rounded-full transition-[width] duration-300 ${it.state === "HASHING" ? "bg-muted/40" : it.state === "PAUSED" ? "bg-amber" : "bg-terra"}`} style={{ width: `${Math.max(2, p * 100)}%` }} />
            </div>
          ) : <div className="flex-1" />}
          <p className={`shrink-0 text-xs ${color}`} title={it.reason ?? undefined}>{label}{it.state === "FAILED" && it.reason ? `: ${it.reason}` : ""}</p>
        </div>
      </div>
      {(it.state === "UPLOADING" || it.state === "QUEUED") && (
        <button onClick={() => onPause(it.key)} aria-label={`Pausar ${it.name}`} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted hover:bg-ivory-deep hover:text-ink">❚❚</button>
      )}
      {it.state === "PAUSED" && (
        <button onClick={() => onResume(it.key)} aria-label={`Retomar ${it.name}`} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-terra hover:bg-terra-soft">▶</button>
      )}
    </div>
  );
}
