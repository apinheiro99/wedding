"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fmtBytes, fmtDateTime } from "@/lib/format";
import { Badge } from "@/components/AdminShell";
import { FilePlaceholder } from "@/components/Gallery";

type M = { id: string; kind: string; takenAt: string; thumb: string; filename: string; bytes: number; deleted: boolean; uploader: { name: string } };
export default function AdminMedia() {
  const [filter, setFilter] = useState<"all" | "deleted">("deleted");
  const [items, setItems] = useState<M[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const load = useCallback((c: string | null) => api<{ items: M[]; nextCursor: string | null }>(`/api/admin/media?filter=${filter}${c ? `&cursor=${c}` : ""}`)
    .then((r) => { setItems((x) => (c ? [...(x ?? []), ...r.items] : r.items)); setCursor(r.nextCursor); }), [filter]);
  useEffect(() => { setItems(null); load(null); }, [load]);
  const act = async (m: M) => {
    if (m.deleted) await api(`/api/admin/media/${m.id}/restore`, { method: "POST" });
    else await api(`/api/media/${m.id}`, { method: "DELETE" });
    setItems((x) => x?.map((i) => (i.id === m.id ? { ...i, deleted: !i.deleted } : i)) ?? null);
  };
  return (
    <>
      <div className="mb-4 flex gap-2">
        {(["deleted", "all"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`rounded-full border px-4 py-1.5 text-sm ${filter === f ? "border-ink bg-ink text-ivory" : "border-line bg-card text-muted"}`}>
            {f === "deleted" ? "Excluídas" : "Todas"}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {items?.map((m) => (
          <div key={m.id} className={`card overflow-hidden ${m.deleted ? "opacity-80" : ""}`}>
            <div className="relative aspect-square bg-ivory-deep">
              {m.thumb === "READY"
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={`/api/media/${m.id}/thumb`} alt="" loading="lazy" className={`h-full w-full object-cover ${m.deleted ? "grayscale" : ""}`} />
                : <FilePlaceholder item={{ filename: m.filename, kind: m.kind as "OTHER" }} />}
              {m.deleted && <span className="absolute left-2 top-2"><Badge tone="danger">excluída</Badge></span>}
            </div>
            <div className="p-3 text-xs">
              <p className="truncate font-medium" title={m.filename}>{m.filename}</p>
              <p className="text-muted">{m.uploader.name} · {fmtBytes(m.bytes)}</p>
              <p className="text-muted">{fmtDateTime(m.takenAt)}</p>
              <div className="mt-2 flex gap-1">
                <a href={`/api/media/${m.id}/original`} className="rounded-full px-2 py-1 text-muted hover:bg-ivory-deep">Baixar</a>
                <button onClick={() => act(m)} className={`rounded-full px-2 py-1 ${m.deleted ? "text-sage hover:bg-sage-soft" : "text-danger hover:bg-danger-soft"}`}>{m.deleted ? "Restaurar" : "Excluir"}</button>
              </div>
            </div>
          </div>
        ))}
      </div>
      {items?.length === 0 && <div className="card p-10 text-center text-muted">Nenhuma mídia aqui.</div>}
      {cursor && <div className="mt-6 text-center"><button className="btn-ghost btn-sm" onClick={() => load(cursor)}>Carregar mais</button></div>}
    </>
  );
}
