"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { ErrorNote, Spinner } from "./auth";

type Item = { id: string; kind: string; filename: string; uploader: { id: string; name: string } };
type Page = { items: Item[]; nextCursor: string | null };

const MAX_STAGE = 280; // css px, diameter of the circular crop window (shrinks on very narrow screens)
const OUT = 512; // exported square size
const MAX_ZOOM = 4;

/** Modal: pick a photo from the device or from the album, then frame the face in a circular crop editor. */
export function AvatarPicker({ userId, onClose, onSaved }: { userId: string; onClose: () => void; onSaved: () => void }) {
  const [tab, setTab] = useState<"device" | "album">("device");
  const [src, setSrc] = useState<{ url: string; file?: File } | null>(null);
  const [undecodable, setUndecodable] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  useEffect(() => () => { if (src?.url.startsWith("blob:")) URL.revokeObjectURL(src.url); }, [src]);

  async function send(blob: Blob, name: string) {
    setBusy(true); setErr(null);
    const fd = new FormData(); fd.append("file", blob, name);
    const r = await fetch("/api/me/avatar", { method: "POST", body: fd, headers: { "x-requested-with": "fetch" } }).catch(() => null);
    if (!r?.ok) { setErr((await r?.json().catch(() => ({})))?.message ?? "Falha ao enviar."); setBusy(false); return; }
    onSaved();
  }

  async function pickAlbum(id: string) {
    setErr(null); setBusy(true);
    try {
      const r = await fetch(`/api/media/${id}/thumb?s=lg`);
      if (!r.ok) throw new Error();
      setSrc({ url: URL.createObjectURL(await r.blob()) });
    } catch { setErr("Não foi possível abrir esta foto."); }
    setBusy(false);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="avp-title" className="card flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 id="avp-title" className="font-medium">{src ? "Ajuste o enquadramento" : "Escolher foto de perfil"}</h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Fechar" className="rounded-full p-1.5 text-muted hover:bg-ivory-deep hover:text-ink">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="overflow-y-auto p-5">
          {src ? (
            <Cropper url={src.url} busy={busy} onBack={() => { setSrc(null); setErr(null); }} onError={() => { setSrc(null); setErr("Não foi possível carregar esta imagem."); }}
              onDone={(b) => send(b, "avatar.webp")} />
          ) : undecodable ? (
            <div>
              <p className="text-sm">Este formato (<b>{undecodable.name}</b>) não pode ser editado aqui, mas podemos usá-lo com um recorte automático centrado no rosto.</p>
              <div className="mt-4 flex gap-2">
                <button className="btn-primary btn-sm" disabled={busy} onClick={() => send(undecodable, undecodable.name)}>{busy ? <Spinner /> : "Usar recorte automático"}</button>
                <button className="btn-ghost btn-sm" onClick={() => setUndecodable(null)}>Escolher outra</button>
              </div>
            </div>
          ) : (
            <>
              <div role="tablist" aria-label="Origem da foto" className="mb-4 grid grid-cols-2 gap-1 rounded-full bg-ivory-deep p-1 text-sm">
                {([["device", "Do aparelho"], ["album", "Do álbum"]] as const).map(([k, label]) => (
                  <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)}
                    className={`rounded-full px-4 py-2 transition ${tab === k ? "bg-card font-medium shadow-sm" : "text-muted hover:text-ink"}`}>{label}</button>
                ))}
              </div>
              {tab === "device" ? (
                <DeviceTab onFile={(f) => {
                  const url = URL.createObjectURL(f);
                  const im = new Image();
                  im.onload = () => setSrc({ url, file: f });
                  im.onerror = () => { URL.revokeObjectURL(url); setUndecodable(f); };
                  im.src = url;
                }} />
              ) : (
                <AlbumTab userId={userId} disabled={busy} onPick={pickAlbum} />
              )}
            </>
          )}
          {!src && busy && <p className="mt-4 flex items-center gap-2 text-sm text-muted"><Spinner /> Abrindo…</p>}
          <ErrorNote msg={err} />
        </div>
      </div>
    </div>
  );
}

function DeviceTab({ onFile }: { onFile: (f: File) => void }) {
  const [drag, setDrag] = useState(false);
  return (
    <label onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f && f.type.startsWith("image/")) onFile(f); }}
      className={`flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition ${drag ? "border-terra bg-terra/5" : "border-line hover:border-terra/60"}`}>
      <svg viewBox="0 0 24 24" className="h-8 w-8 text-terra" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 16V4M7 9l5-5 5 5M4 20h16" /></svg>
      <span className="font-medium">Escolher um arquivo</span>
      <span className="text-sm text-muted">ou arraste uma imagem para cá</span>
      <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
    </label>
  );
}

function AlbumTab({ userId, disabled, onPick }: { userId: string; disabled: boolean; onPick: (id: string) => void }) {
  const [mine, setMine] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [more, setMore] = useState(false);

  const load = useCallback(async (reset: boolean, cur: string | null) => {
    if (reset) setState("loading"); else setMore(true);
    try {
      const q = new URLSearchParams({ limit: "60" });
      if (mine) q.set("uploader", userId);
      if (cur) q.set("cursor", cur);
      const p = await api<Page>(`/api/media?${q}`);
      setItems((old) => [...(reset ? [] : old), ...p.items.filter((i) => i.kind === "IMAGE")]);
      setCursor(p.nextCursor); setState("ready");
    } catch { setState("error"); }
    setMore(false);
  }, [mine, userId]);

  useEffect(() => { load(true, null); }, [load]);

  return (
    <div>
      <label className="mb-3 flex items-center gap-2 text-sm text-muted">
        <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Mostrar só as fotos que eu enviei
      </label>
      {state === "loading" && <div className="skeleton h-40 rounded-2xl" />}
      {state === "error" && <p className="text-sm text-danger">Não foi possível carregar o álbum.</p>}
      {state === "ready" && !items.length && <p className="py-8 text-center text-sm text-muted">{mine ? "Você ainda não enviou fotos." : "O álbum ainda não tem fotos."}</p>}
      {state === "ready" && items.length > 0 && (
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
          {items.map((it) => (
            <button key={it.id} type="button" disabled={disabled} onClick={() => onPick(it.id)} aria-label={`Usar foto de ${it.uploader.name}`}
              className="group relative aspect-square overflow-hidden rounded-lg bg-ivory-deep focus:outline-none focus-visible:ring-4 focus-visible:ring-terra/30">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/media/${it.id}/thumb`} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" />
            </button>
          ))}
        </div>
      )}
      {cursor && <button type="button" className="btn-ghost btn-sm mt-3 w-full" disabled={more} onClick={() => load(false, cursor)}>{more ? <Spinner /> : "Carregar mais"}</button>}
    </div>
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function Cropper({ url, busy, onBack, onError, onDone }: { url: string; busy: boolean; onBack: () => void; onError: () => void; onDone: (b: Blob) => void }) {
  // dialog gutter (2×16) + inner padding (2×20) + a little slack
  const [STAGE] = useState(() => Math.max(200, Math.min(MAX_STAGE, (typeof window === "undefined" ? 400 : window.innerWidth) - 76)));
  const imgRef = useRef<HTMLImageElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; z: number } | null>(null);

  const base = nat ? STAGE / Math.min(nat.w, nat.h) : 1; // scale that just covers the circle
  const scale = base * zoom;
  const limits = useCallback((z: number) => {
    if (!nat) return { mx: 0, my: 0 };
    const s = base * z;
    return { mx: Math.max(0, (nat.w * s - STAGE) / 2), my: Math.max(0, (nat.h * s - STAGE) / 2) };
  }, [nat, base]);
  const place = useCallback((x: number, y: number, z: number) => {
    const { mx, my } = limits(z);
    setOff({ x: clamp(x, -mx, mx), y: clamp(y, -my, my) });
  }, [limits]);

  // faces are usually in the upper half, so start slightly toward the top
  useEffect(() => { if (nat) { const { my } = limits(1); setOff({ x: 0, y: my * 0.35 }); } }, [nat, limits]);

  const setZ = useCallback((z: number) => {
    const nz = clamp(z, 1, MAX_ZOOM);
    setZoom(nz); place(off.x, off.y, nz);
  }, [off, place]);

  useEffect(() => {
    const el = stageRef.current; if (!el) return;
    const wheel = (e: WheelEvent) => { e.preventDefault(); setZ(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)); };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [zoom, setZ]);

  function down(e: React.PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) { const [a, b] = [...pointers.current.values()]; pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), z: zoom }; }
  }
  function move(e: React.PointerEvent) {
    const p = pointers.current.get(e.pointerId); if (!p) return;
    if (pointers.current.size === 2 && pinch.current) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [a, b] = [...pointers.current.values()];
      setZ(pinch.current.z * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.d));
      return;
    }
    place(off.x + e.clientX - p.x, off.y + e.clientY - p.y, zoom);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }
  function up(e: React.PointerEvent) { pointers.current.delete(e.pointerId); if (pointers.current.size < 2) pinch.current = null; }
  function key(e: React.KeyboardEvent) {
    const step = 12;
    const map: Record<string, () => void> = {
      ArrowLeft: () => place(off.x + step, off.y, zoom), ArrowRight: () => place(off.x - step, off.y, zoom),
      ArrowUp: () => place(off.x, off.y + step, zoom), ArrowDown: () => place(off.x, off.y - step, zoom),
      "+": () => setZ(zoom * 1.1), "=": () => setZ(zoom * 1.1), "-": () => setZ(zoom / 1.1),
    };
    if (map[e.key]) { e.preventDefault(); map[e.key](); }
  }

  function done() {
    const img = imgRef.current; if (!img || !nat) return;
    const k = OUT / STAGE;
    const c = document.createElement("canvas"); c.width = c.height = OUT;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, OUT, OUT);
    ctx.drawImage(img, (STAGE / 2 + off.x - (nat.w * scale) / 2) * k, (STAGE / 2 + off.y - (nat.h * scale) / 2) * k, nat.w * scale * k, nat.h * scale * k);
    c.toBlob((b) => { if (b) onDone(b); else onError(); }, "image/webp", 0.92);
  }

  return (
    <div className="flex flex-col items-center">
      <div ref={stageRef} tabIndex={0} role="application" aria-label="Área de recorte. Arraste para mover; use as setas e as teclas + e - para ajustar."
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}
        className="relative touch-none select-none overflow-hidden rounded-2xl bg-[#141210] outline-none focus-visible:ring-4 focus-visible:ring-terra/30"
        style={{ width: STAGE, height: STAGE, cursor: "grab" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img ref={imgRef} src={url} alt="" draggable={false} onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} onError={onError}
          className="pointer-events-none absolute left-1/2 top-1/2 max-w-none"
          style={nat ? { width: nat.w, height: nat.h, transform: `translate(-50%, -50%) translate(${off.x}px, ${off.y}px) scale(${scale})`, transformOrigin: "center" } : { opacity: 0 }} />
        {/* dim everything outside the circle */}
        <div aria-hidden className="pointer-events-none absolute inset-0 rounded-full" style={{ boxShadow: "0 0 0 999px rgba(20,18,16,.62)", outline: "2px solid rgba(255,255,255,.9)", outlineOffset: -2 }} />
        {!nat && <div className="absolute inset-0 grid place-items-center text-white/80"><Spinner /></div>}
      </div>

      <div className="mt-4 flex w-full items-center gap-3" style={{ maxWidth: STAGE }}>
        <svg viewBox="0 0 24 24" className="h-4 w-4 text-muted" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="6" /><path d="M20 20l-4-4M8 11h6" /></svg>
        <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={zoom} onChange={(e) => setZ(Number(e.target.value))} aria-label="Zoom" className="w-full accent-[var(--color-terra)]" />
        <svg viewBox="0 0 24 24" className="h-5 w-5 text-muted" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="6" /><path d="M20 20l-4-4M8 11h6M11 8v6" /></svg>
      </div>
      <p className="mt-2 text-center text-xs text-muted">Arraste a foto e use o zoom para deixar o rosto dentro do círculo.</p>

      <div className="mt-5 flex w-full gap-2" style={{ maxWidth: STAGE }}>
        <button type="button" className="btn-ghost btn-sm flex-1" onClick={onBack} disabled={busy}>Voltar</button>
        <button type="button" className="btn-primary btn-sm flex-1" onClick={done} disabled={busy || !nat}>{busy ? <Spinner /> : "Salvar foto"}</button>
      </div>
    </div>
  );
}
