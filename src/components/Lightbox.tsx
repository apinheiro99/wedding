"use client";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { fmtBytes, fmtDateTime, fmtDuration } from "@/lib/format";
import { Avatar } from "./Avatar";
import { FilePlaceholder, type Item } from "./Gallery";

type Detail = {
  id: string; filename: string; bytes: number; mime: string; takenAt: string; dateSource: string; width: number | null; height: number | null;
  durationMs: number | null; camera: string | null; canDelete: boolean; uploader: { id: string; name: string }; uploadedAt: string;
};

const DATE_SOURCE: Record<string, string> = { EXIF: "data da câmera", CONTAINER: "data do vídeo", CLIENT_FILE: "data do arquivo", UPLOAD: "data do envio" };

export function Lightbox({ items, index, onIndex, onClose, onDeleted, onNeedMore }: {
  items: Item[]; index: number; onIndex: (i: number) => void; onClose: () => void; onDeleted: (id: string) => void; onNeedMore: () => void;
}) {
  const item = items[index]!;
  const [detail, setDetail] = useState<Detail | null>(null);
  const [info, setInfo] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const [dx, setDx] = useState(0);

  const prev = () => index > 0 && onIndex(index - 1);
  const next = () => { if (index < items.length - 1) onIndex(index + 1); if (index > items.length - 6) onNeedMore(); };

  useEffect(() => {
    setDetail(null); setConfirm(false); setErr(null); setLoaded(false);
    api<Detail>(`/api/media/${item.id}`).then(setDetail).catch(() => {});
    // preload neighbours
    for (const n of [items[index + 1], items[index - 1]]) if (n?.thumb === "READY" && n.kind === "IMAGE") { const i = new Image(); i.src = `/api/media/${n.id}/thumb?s=lg`; }
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "i") setInfo((v) => !v);
    };
    window.addEventListener("keydown", k);
    const o = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = o; };
  });

  async function del() {
    try { await api(`/api/media/${item.id}`, { method: "DELETE" }); onDeleted(item.id); }
    catch (e) { setErr(e instanceof ApiError ? e.message : "Falha ao excluir."); }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Visualizador" className="fixed inset-0 z-50 flex bg-[#141210] text-white fade-up" style={{ animationDuration: ".25s" }}>
      <div className="relative flex flex-1 flex-col">
        {/* top bar */}
        <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-3 bg-gradient-to-b from-black/60 to-transparent px-3 pb-8 pt-3 md:px-5" style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}>
          <div className="flex min-w-0 items-center gap-3">
            <button onClick={onClose} aria-label="Fechar" className="grid h-10 w-10 place-items-center rounded-full hover:bg-white/10">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
            <Avatar id={item.uploader.id} name={item.uploader.name} size={30} />
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-medium">{item.uploader.name}</p>
              <p className="truncate text-xs text-white/60">{fmtDateTime(item.takenAt)}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <IconBtn label="Informações" onClick={() => setInfo((v) => !v)} active={info} d="M12 16v-5M12 8h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" />
            <a href={`/api/media/${item.id}/original`} aria-label="Baixar original" title="Baixar original" className="grid h-10 w-10 place-items-center rounded-full hover:bg-white/10">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden><path d="M12 4v12M7 11l5 5 5-5M4 20h16" /></svg>
            </a>
            {detail?.canDelete && <IconBtn label="Excluir" onClick={() => setConfirm(true)} d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />}
          </div>
        </div>

        {/* stage */}
        <div className="relative flex flex-1 items-center justify-center overflow-hidden"
          onTouchStart={(e) => { touch.current = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY }; }}
          onTouchMove={(e) => { if (touch.current) setDx(e.touches[0]!.clientX - touch.current.x); }}
          onTouchEnd={(e) => {
            if (!touch.current) return;
            const ddx = e.changedTouches[0]!.clientX - touch.current.x, ddy = e.changedTouches[0]!.clientY - touch.current.y;
            touch.current = null; setDx(0);
            if (Math.abs(ddx) > 60 && Math.abs(ddx) > Math.abs(ddy)) (ddx < 0 ? next() : prev());
            else if (ddy > 120) onClose();
          }}>
          <div className="flex h-full w-full items-center justify-center transition-transform duration-200" style={{ transform: `translateX(${dx}px)` }}>
            {item.kind === "VIDEO" ? (
              <video key={item.id} src={`/api/media/${item.id}/original?inline=1`} controls autoPlay playsInline
                poster={item.thumb === "READY" ? `/api/media/${item.id}/thumb?s=lg` : undefined} className="max-h-full max-w-full" />
            ) : item.kind === "IMAGE" && item.thumb === "READY" ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/media/${item.id}/thumb`} alt="" aria-hidden className={`absolute max-h-full max-w-full object-contain blur-sm transition-opacity ${loaded ? "opacity-0" : "opacity-60"}`} />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img key={item.id} src={`/api/media/${item.id}/thumb?s=lg`} alt={`Foto de ${item.uploader.name}`} onLoad={() => setLoaded(true)} draggable={false}
                  className={`relative max-h-full max-w-full select-none object-contain transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`} />
              </>
            ) : (
              <div className="h-72 w-72 overflow-hidden rounded-2xl text-ink"><FilePlaceholder item={item} large /></div>
            )}
          </div>
          {index > 0 && <NavBtn side="left" onClick={prev} />}
          {index < items.length - 1 && <NavBtn side="right" onClick={next} />}
        </div>

        {confirm && (
          <div className="absolute inset-x-0 bottom-0 z-20 flex justify-center p-4 pb-safe fade-up">
            <div className="w-full max-w-md rounded-2xl bg-card p-5 text-ink shadow-lift">
              <p className="font-medium">Excluir este arquivo do álbum?</p>
              <p className="mt-1 text-sm text-muted">Ele deixa de aparecer para a família. Se alguém enviar o mesmo arquivo de novo, ele volta.</p>
              {err && <p className="mt-2 text-sm text-danger">{err}</p>}
              <div className="mt-4 flex justify-end gap-2">
                <button className="btn-ghost btn-sm" onClick={() => setConfirm(false)}>Cancelar</button>
                <button className="btn btn-sm bg-danger text-white hover:bg-danger/90" onClick={del}>Excluir</button>
              </div>
            </div>
          </div>
        )}
        <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 text-xs tabular-nums text-white/40">{index + 1} / {items.length}</p>
      </div>

      {/* info panel */}
      {info && (
        <aside className="absolute inset-x-0 bottom-0 z-30 max-h-[60dvh] overflow-auto rounded-t-3xl bg-card p-6 text-ink shadow-lift md:static md:max-h-none md:w-80 md:rounded-none fade-up">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-serif text-xl">Detalhes</h2>
            <button onClick={() => setInfo(false)} className="text-sm text-muted hover:text-ink md:hidden">Fechar</button>
          </div>
          {detail ? (
            <dl className="space-y-4 text-sm">
              <Row k="Arquivo" v={<span className="break-all">{detail.filename}</span>} />
              <Row k="Enviado por" v={detail.uploader.name} />
              <Row k="Data" v={<>{fmtDateTime(detail.takenAt)} <span className="text-muted">· {DATE_SOURCE[detail.dateSource] ?? ""}</span></>} />
              {detail.camera && <Row k="Câmera" v={detail.camera} />}
              {detail.width && <Row k="Dimensões" v={`${detail.width} × ${detail.height}`} />}
              {detail.durationMs && <Row k="Duração" v={fmtDuration(detail.durationMs)} />}
              <Row k="Tamanho" v={fmtBytes(detail.bytes)} />
              <Row k="Tipo" v={detail.mime} />
              <Row k="Enviado em" v={fmtDateTime(detail.uploadedAt)} />
            </dl>
          ) : <div className="skeleton h-40 rounded-xl" />}
          <a href={`/api/media/${item.id}/original`} className="btn-primary mt-6 w-full">Baixar original</a>
        </aside>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div><dt className="text-xs uppercase tracking-wider text-muted">{k}</dt><dd className="mt-0.5">{v}</dd></div>;
}
function IconBtn({ label, onClick, d, active }: { label: string; onClick: () => void; d: string; active?: boolean }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className={`grid h-10 w-10 place-items-center rounded-full hover:bg-white/10 ${active ? "bg-white/15" : ""}`}>
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {d.split(/(?=M)/).map((p, i) => <path key={i} d={p} />)}
      </svg>
    </button>
  );
}
function NavBtn({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label={side === "left" ? "Anterior" : "Próxima"}
      className={`absolute top-1/2 hidden h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white/10 backdrop-blur transition hover:bg-white/20 md:grid ${side === "left" ? "left-4" : "right-4"}`}>
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden><path d={side === "left" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} /></svg>
    </button>
  );
}
