"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useEvents } from "@/lib/events";
import { dayKey, fmtDay, fmtDuration, plural } from "@/lib/format";
import { Avatar } from "./Avatar";
import { Lightbox } from "./Lightbox";

export type Item = {
  id: string; kind: "IMAGE" | "VIDEO" | "OTHER"; takenAt: string; width: number | null; height: number | null;
  durationMs: number | null; thumb: "PENDING" | "READY" | "FAILED" | "UNSUPPORTED"; filename: string; bytes: number;
  uploader: { id: string; name: string };
};
type Page = { items: Item[]; nextCursor: string | null; counts?: { photos: number; videos: number; others: number } };

export function Gallery({ uploader, order, onCounts }: { uploader?: string | null; order: "asc" | "desc"; onCounts?: (c: Page["counts"]) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const sentinel = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const selecting = selected.size > 0;

  const query = useCallback((c: string | null) => {
    const p = new URLSearchParams({ order, limit: "80" });
    if (uploader) p.set("uploader", uploader);
    if (c) p.set("cursor", c);
    return api<Page>(`/api/media?${p}`);
  }, [order, uploader]);

  const reset = useCallback(() => {
    setLoading(true); loadingRef.current = true;
    query(null).then((p) => {
      setItems(p.items); setCursor(p.nextCursor); setDone(!p.nextCursor); onCounts?.(p.counts);
    }).finally(() => { setLoading(false); loadingRef.current = false; });
  }, [query, onCounts]);

  useEffect(() => { setSelected(new Set()); reset(); }, [reset]);

  const more = useCallback(() => {
    if (loadingRef.current || done || !cursor) return;
    loadingRef.current = true; setLoading(true);
    query(cursor).then((p) => { setItems((x) => [...x, ...p.items]); setCursor(p.nextCursor); setDone(!p.nextCursor); })
      .finally(() => { setLoading(false); loadingRef.current = false; });
  }, [cursor, done, query]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => e[0]?.isIntersecting && more(), { rootMargin: "1200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [more]);

  // live: refresh thumbnails as the worker finishes; new uploads show up on the next refresh
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEvents((e) => {
    if (e.t !== "media") return;
    if (e.change === "deleted") { setItems((x) => x.filter((i) => i.id !== e.mediaId)); return; }
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => { refreshTimer.current = null; if (!cursor || items.length <= 80) reset(); }, 2500);
  });

  const groups = useMemo(() => {
    const g: { key: string; label: string; items: { item: Item; index: number }[] }[] = [];
    items.forEach((item, index) => {
      const k = dayKey(item.takenAt);
      if (g[g.length - 1]?.key !== k) g.push({ key: k, label: fmtDay(item.takenAt), items: [] });
      g[g.length - 1]!.items.push({ item, index });
    });
    return g;
  }, [items]);

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  if (!loading && items.length === 0) return <Empty />;

  return (
    <>
      <div className="space-y-8">
        {groups.map((g) => (
          <section key={g.key} aria-label={g.label}>
            <div className="sticky top-14 md:top-16 z-10 -mx-4 mb-3 flex items-center justify-between bg-ivory/90 px-4 py-2 backdrop-blur md:-mx-8 md:px-8">
              <h2 className="text-[13px] font-medium capitalize text-ink/80">{g.label}</h2>
              <span className="text-xs text-muted">{g.items.length}</span>
            </div>
            <div className="grid grid-cols-3 gap-1 sm:grid-cols-4 md:grid-cols-5 md:gap-2 lg:grid-cols-6 xl:grid-cols-7">
              {g.items.map(({ item, index }) => (
                <Tile key={item.id} item={item} selected={selected.has(item.id)} selecting={selecting}
                  onOpen={() => (selecting ? toggle(item.id) : setOpen(index))} onToggle={() => toggle(item.id)} />
              ))}
            </div>
          </section>
        ))}
        {loading && <SkeletonGrid />}
        <div ref={sentinel} className="h-4" />
        {done && items.length > 40 && <p className="py-8 text-center text-sm text-muted">Você chegou ao fim ✦</p>}
      </div>

      {selecting && <SelectionBar ids={[...selected]} onClear={() => setSelected(new Set())} />}
      {open != null && items[open] && (
        <Lightbox items={items} index={open} onIndex={setOpen} onClose={() => setOpen(null)}
          onDeleted={(id) => { setItems((x) => x.filter((i) => i.id !== id)); setOpen(null); }}
          onNeedMore={more} />
      )}
    </>
  );
}

function Tile({ item, selected, selecting, onOpen, onToggle }: { item: Item; selected: boolean; selecting: boolean; onOpen: () => void; onToggle: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  return (
    <div className={`group relative aspect-square overflow-hidden bg-ivory-deep transition-all duration-200 first:rounded-tl-xl md:rounded-lg ${selected ? "scale-[0.92] rounded-xl ring-[3px] ring-terra" : ""}`}>
      <button type="button" className="absolute inset-0 h-full w-full cursor-zoom-in focus-visible:outline-offset-[-3px]"
        aria-label={`${item.kind === "VIDEO" ? "Vídeo" : "Foto"} de ${item.uploader.name}`}
        onClick={() => { if (longPressed.current) { longPressed.current = false; return; } onOpen(); }}
        onTouchStart={() => { pressTimer.current = setTimeout(() => { longPressed.current = true; onToggle(); navigator.vibrate?.(10); }, 450); }}
        onTouchEnd={() => pressTimer.current && clearTimeout(pressTimer.current)}
        onTouchMove={() => pressTimer.current && clearTimeout(pressTimer.current)}
        onContextMenu={(e) => e.preventDefault()}>
        {item.thumb === "READY" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/media/${item.id}/thumb`} alt="" loading="lazy" decoding="async" draggable={false} onLoad={() => setLoaded(true)}
            className={`h-full w-full object-cover transition duration-500 group-hover:scale-[1.03] ${loaded ? "opacity-100" : "opacity-0"}`} />
        ) : item.thumb === "PENDING" ? (
          <div className="skeleton h-full w-full" />
        ) : (
          <FilePlaceholder item={item} />
        )}
      </button>
      {item.kind === "VIDEO" && (
        <span className="pointer-events-none absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur">
          <svg viewBox="0 0 24 24" className="h-3 w-3 fill-current" aria-hidden><path d="M8 5v14l11-7z" /></svg>
          {fmtDuration(item.durationMs)}
        </span>
      )}
      <span className="pointer-events-none absolute bottom-1.5 left-1.5 opacity-0 transition group-hover:opacity-100">
        <Avatar id={item.uploader.id} name={item.uploader.name} size={22} />
      </span>
      <button type="button" onClick={onToggle} aria-pressed={selected} aria-label={selected ? "Desmarcar" : "Selecionar"}
        className={`absolute left-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full border-2 transition ${selected ? "border-terra bg-terra text-white opacity-100" : `border-white/90 bg-black/15 text-transparent ${selecting ? "opacity-100" : "opacity-0 group-hover:opacity-100"} md:group-hover:opacity-100`}`}>
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={3} aria-hidden><path d="M5 12l5 5 9-10" /></svg>
      </button>
    </div>
  );
}

export function FilePlaceholder({ item, large = false }: { item: Pick<Item, "filename" | "kind">; large?: boolean }) {
  const ext = item.filename.includes(".") ? item.filename.split(".").pop()!.toUpperCase().slice(0, 5) : "ARQ";
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-ivory-deep to-line/60 p-2 text-muted">
      <svg viewBox="0 0 24 24" className={large ? "h-16 w-16" : "h-8 w-8"} fill="none" stroke="currentColor" strokeWidth={1.3} aria-hidden>
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" />
      </svg>
      <span className={`rounded-md bg-card/80 px-1.5 py-0.5 font-mono font-medium tracking-wider ${large ? "text-sm" : "text-[10px]"}`}>{ext}</span>
      {large && <span className="max-w-[80%] truncate text-sm">{item.filename}</span>}
    </div>
  );
}

function SelectionBar({ ids, onClear }: { ids: string[]; onClear: () => void }) {
  return (
    <div className="fixed inset-x-0 bottom-20 z-40 flex justify-center px-4 md:bottom-8 fade-up">
      <form method="post" action="/api/downloads/selection" className="flex items-center gap-2 rounded-full bg-ink py-2 pl-5 pr-2 text-ivory shadow-lift">
        <input type="hidden" name="ids" value={ids.join(",")} />
        <span className="text-sm font-medium tabular-nums">{plural(ids.length, "selecionada", "selecionadas")}</span>
        <button type="button" onClick={onClear} className="rounded-full px-3 py-2 text-sm text-ivory/70 hover:text-ivory">Limpar</button>
        <button className="btn-primary btn-sm">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden><path d="M12 4v12M7 11l5 5 5-5M4 20h16" /></svg>
          Baixar ZIP
        </button>
      </form>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-3 gap-1 sm:grid-cols-4 md:grid-cols-5 md:gap-2 lg:grid-cols-6 xl:grid-cols-7" aria-hidden>
      {Array.from({ length: 14 }).map((_, i) => <div key={i} className="skeleton aspect-square md:rounded-lg" style={{ animationDelay: `${i * 40}ms` }} />)}
    </div>
  );
}

function Empty() {
  return (
    <div className="card mx-auto mt-6 flex max-w-lg flex-col items-center px-8 py-14 text-center fade-up">
      <div className="relative mb-6 h-24 w-32">
        <div className="absolute left-2 top-3 h-20 w-16 -rotate-12 rounded-xl bg-gradient-to-br from-[#e9d6c9] to-[#d9b8a5] shadow-soft" />
        <div className="absolute right-2 top-2 h-20 w-16 rotate-12 rounded-xl bg-gradient-to-br from-[#dfe3da] to-[#c3cbbd] shadow-soft" />
        <div className="absolute left-1/2 top-0 h-20 w-16 -translate-x-1/2 rounded-xl bg-gradient-to-br from-[#f1e4cf] to-[#e0c79f] shadow-lift" />
      </div>
      <h2 className="font-serif text-2xl">O álbum está esperando</h2>
      <p className="mt-2 text-muted">Ainda não há fotos aqui. Que tal ser a primeira pessoa a enviar?</p>
      <a href="/upload" className="btn-primary mt-6">Enviar fotos e vídeos</a>
    </div>
  );
}
